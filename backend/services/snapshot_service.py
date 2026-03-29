"""Serve pre-built snapshot JSON for the center panel visualisation.

Snapshots live in ``server/data/snapshots/<run_name>.json`` and are shipped
with the app.  A fallback path parses the raw LLMCER log files on the fly
when a pre-built file is not available.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

# Pre-built snapshots shipped with the app (server/data/snapshots/)
_SNAPSHOTS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data", "snapshots"
)


def get_snapshot_by_dataset(dataset_name: str) -> Optional[Dict[str, Any]]:
    """Find the latest snapshot whose filename starts with *dataset_name*."""
    if not os.path.isdir(_SNAPSHOTS_DIR):
        return None
    # e.g. dataset_name="cora" matches "cora_detail_20260225_103554.json"
    candidates = sorted(
        [f for f in os.listdir(_SNAPSHOTS_DIR)
         if f.startswith(dataset_name + "_") and f.endswith(".json")],
        reverse=True,  # latest first (timestamp in name)
    )
    if not candidates:
        return None
    path = os.path.join(_SNAPSHOTS_DIR, candidates[0])
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_snapshot(run_name: str) -> Optional[Dict[str, Any]]:
    """Return a snapshot dict for *run_name*, or ``None`` if not found."""

    # Pre-built snapshot in server/data/snapshots/
    local = os.path.join(_SNAPSHOTS_DIR, f"{run_name}.json")
    if os.path.isfile(local):
        with open(local, "r", encoding="utf-8") as f:
            return json.load(f)

    # Fallback: parse raw log files (requires LLMCER logs on disk)
    return _build_snapshot_from_logs(run_name)


# ── Fallback: build from raw logs ─────────────────────────────────────────


def _build_snapshot_from_logs(run_name: str) -> Optional[Dict[str, Any]]:
    """Parse blocking.log + block_*.log to build a snapshot on the fly."""
    try:
        from services.log_replay_service import _parse_log_file, LLMCER_LOGS_DIR
    except ImportError:
        return None

    run_path = os.path.join(LLMCER_LOGS_DIR, run_name)
    if not os.path.isdir(run_path):
        return None

    # 1. Blocking
    blocking_events = _parse_log_file(os.path.join(run_path, "blocking.log"))
    block_record_ids: List[List[int]] = []

    for ev in blocking_events:
        if ev["type"] == "block_result":
            raw_blocks = ev["data"].get("blocks", [])
            if isinstance(raw_blocks, list):
                for raw in raw_blocks:
                    if isinstance(raw, list):
                        block_record_ids.append([int(x) for x in raw])
                    elif isinstance(raw, str):
                        nums = [int(x) for x in re.findall(r"\d+", raw)]
                        block_record_ids.append(nums)

    if not block_record_ids:
        return None

    # 2. Per-block clusters
    block_files = sorted(
        [f for f in os.listdir(run_path) if re.match(r"block_\d+\.log", f)],
        key=lambda f: int(re.search(r"(\d+)", f).group(1)),
    )

    block_clusters: Dict[int, List[List[int]]] = {}
    for bf in block_files:
        bidx = int(re.search(r"(\d+)", bf).group(1))
        events = _parse_log_file(os.path.join(run_path, bf))
        clusters: List[List[int]] = []
        for ev in events:
            if ev["type"] == "separate_result":
                raw = ev["data"].get("clusters", [])
                if isinstance(raw, list):
                    for c in raw:
                        if isinstance(c, list):
                            clusters.append([int(x) for x in c])
                        elif isinstance(c, str):
                            clusters.append(
                                [int(x) for x in re.findall(r"\d+", c)]
                            )
        block_clusters[bidx] = clusters

    # 3. Entity assignment
    entity_counter = 1
    record_entity: Dict[int, int] = {}
    for bidx, rec_ids in enumerate(block_record_ids):
        clusters = block_clusters.get(bidx, [])
        if clusters:
            for cluster in clusters:
                eid = entity_counter
                entity_counter += 1
                for rid in cluster:
                    record_entity[rid] = eid
        else:
            for rid in rec_ids:
                record_entity[rid] = entity_counter
                entity_counter += 1

    # 4. Records
    all_record_ids = set()
    for rids in block_record_ids:
        all_record_ids.update(rids)

    records: Dict[str, Dict[str, Any]] = {}
    for rid in sorted(all_record_ids):
        key = f"r{rid}"
        records[key] = {
            "id": key,
            "entity": record_entity.get(rid, 1),
            "display": f"Record {rid}",
        }

    # 5. Blocks
    blocks: List[Dict[str, Any]] = []
    for bidx, rec_ids in enumerate(block_record_ids):
        str_ids = [f"r{rid}" for rid in rec_ids]
        clusters = block_clusters.get(bidx, [])
        str_clusters = (
            [[f"r{rid}" for rid in c] for c in clusters] if clusters else [str_ids]
        )
        blocks.append(
            {
                "block_id": bidx,
                "record_ids": str_ids,
                "clusters": str_clusters,
                "num_records": len(rec_ids),
                "num_clusters": len(str_clusters),
            }
        )

    dataset_name = run_name.split("_detail_")[0] if "_detail_" in run_name else run_name

    return {
        "dataset": dataset_name,
        "total_records": len(records),
        "total_blocks": len(blocks),
        "records": records,
        "blocks": blocks,
    }


# ── Build & save snapshot from a completed pipeline run ───────────────────


def save_pipeline_snapshot(
    task_id: str,
    dataset_name: str,
    data,                        # pandas DataFrame
    merge_clusters_pre: list,    # blocks: list of lists of record indices
    result_sep: list,            # post-separation clusters
    final_result: list,          # post-merge clusters
    metrics: Dict[str, Any],
    stats: Dict[str, Any],
    run_logger,                  # RunLogger with .events
) -> Optional[str]:
    """Build a snapshot JSON from pipeline results and save it to disk.

    Returns the saved file path, or ``None`` on failure.
    """
    import pandas as pd
    from datetime import datetime

    try:
        from llmcer.id_utils import get_id_column
        id_col = get_id_column(data)
    except Exception:
        id_col = data.columns[0] if len(data.columns) > 0 else None

    # 1. Record → final-entity mapping (post-merge)
    record_entity: Dict[int, int] = {}
    for eid, cluster in enumerate(final_result, start=1):
        for rid in cluster:
            record_entity[rid] = eid

    # 2. Build records dict
    display_cols = [c for c in data.columns if c != id_col][:3]
    records: Dict[str, Dict[str, Any]] = {}
    for idx in range(len(data)):
        row = data.iloc[idx]
        key = f"r{idx}"
        parts = [str(row[c])[:40] for c in display_cols if pd.notna(row[c])]
        display = " \u2014 ".join(parts) if parts else key

        rec: Dict[str, Any] = {
            "id": key,
            "entity": record_entity.get(idx, 1),
            "display": display,
        }
        for c in data.columns:
            if c != id_col:
                val = row[c]
                rec[c] = str(val) if pd.notna(val) else ""
        records[key] = rec

    # 3. Per-block separation clusters from RunLogger events
    block_sep_clusters: Dict[int, List] = {}
    # 3b. Per-block real NRS sets (the actual record groups sent to LLM)
    block_nrs_sets: Dict[int, List[List[int]]] = {}
    _nrs_seen: Dict[int, set] = {}  # dedup retries within same block
    if run_logger and hasattr(run_logger, "events"):
        for ev in run_logger.events:
            if ev.get("type") == "separate_result" and ev.get("stage") == "separation":
                ctx = (ev.get("data") or {}).get("context", "")
                m = re.match(r"block_(\d+)", ctx)
                if m:
                    bidx = int(m.group(1))
                    block_sep_clusters[bidx] = (ev.get("data") or {}).get("clusters", [])
            # Capture real NRS sets from llm_request events
            if ev.get("type") == "llm_request" and ev.get("stage") == "nrs_separate":
                ctx = (ev.get("data") or {}).get("context", "")
                m = re.match(r"block_(\d+)", ctx)
                if not m:
                    continue
                bidx = int(m.group(1))
                rids = (ev.get("data") or {}).get("record_ids", [])
                if not rids:
                    continue
                # Dedup retries (same slice emitted multiple times)
                key = tuple(sorted(rids))
                if bidx not in _nrs_seen:
                    _nrs_seen[bidx] = set()
                if key in _nrs_seen[bidx]:
                    continue
                _nrs_seen[bidx].add(key)
                if bidx not in block_nrs_sets:
                    block_nrs_sets[bidx] = []
                block_nrs_sets[bidx].append(rids)

    # 4. Build blocks array
    blocks: List[Dict[str, Any]] = []
    for bidx, block_ids in enumerate(merge_clusters_pre):
        str_ids = [f"r{rid}" for rid in block_ids]
        # Use per-block separation result if non-empty, else whole block as one cluster
        if bidx in block_sep_clusters and block_sep_clusters[bidx]:
            str_clusters = [[f"r{rid}" for rid in c] for c in block_sep_clusters[bidx]]
        else:
            str_clusters = [str_ids]
        # Real NRS sets (actual record groups sent to LLM during separation)
        nrs = block_nrs_sets.get(bidx, [])
        str_nrs = [[f"r{rid}" for rid in s] for s in nrs] if nrs else []
        blocks.append({
            "block_id": bidx,
            "record_ids": str_ids,
            "clusters": str_clusters,
            "nrs_sets": str_nrs,
            "num_records": len(block_ids),
            "num_clusters": len(str_clusters),
        })

    # 5. Convert RunLogger events → snapshot event format
    events = _convert_events(run_logger)

    has_merge = any(
        ev.get("action") == "llm_call" and ev.get("type") == "merge"
        for ev in events
    )

    # 6. Build stats
    snap_stats: Dict[str, Any] = {
        "total_events": len(events),
        "total_llm_calls": sum(1 for e in events if e.get("action") == "llm_call"),
        "total_tokens": stats.get("total_tokens", 0),
        "cost_estimate": round(stats.get("total_tokens", 0) * 0.00000015, 4),
        "time_seconds": stats.get("total_time", 0),
        "mdg_interventions": stats.get("mdg_fails", 0),
        "total_records": len(records),
        "pred_entities": len(final_result),
        "has_merge": has_merge,
        "cmr_skipped": not has_merge,
        "param_ss": stats.get("chunk_size", 9),
    }
    if metrics:
        for key in [
            "purity", "inverse_purity", "f_measure", "ari", "nmi",
            "bcubed_precision", "bcubed_recall", "bcubed_f1",
            "pairwise_accuracy", "pairwise_precision", "pairwise_recall", "pairwise_f1",
        ]:
            if metrics.get(key) is not None:
                snap_stats[key] = round(metrics[key], 4)
        if metrics.get("pairwise_accuracy") is not None:
            snap_stats["acc"] = round(metrics["pairwise_accuracy"], 4)
        if metrics.get("ari") is not None:
            snap_stats["ari"] = round(metrics["ari"], 4)
        if metrics.get("f_measure") is not None:
            snap_stats["f1"] = round(metrics["f_measure"], 4)

    # 7. Assemble snapshot
    snapshot = {
        "dataset": dataset_name,
        "total_records": len(records),
        "total_blocks": len(blocks),
        "records": records,
        "blocks": blocks,
        "events": events,
        "has_merge": has_merge,
        "stats": snap_stats,
    }

    # 8. Save
    os.makedirs(_SNAPSHOTS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{dataset_name}_detail_{ts}.json"
    filepath = os.path.join(_SNAPSHOTS_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2, default=str)

    return filepath


def list_snapshots_for_dataset(dataset_name: str) -> List[Dict[str, Any]]:
    """Return summary info for every snapshot whose filename starts with *dataset_name*."""
    if not os.path.isdir(_SNAPSHOTS_DIR):
        return []
    candidates = sorted(
        [f for f in os.listdir(_SNAPSHOTS_DIR)
         if f.startswith(dataset_name + "_") and f.endswith(".json")],
        reverse=True,
    )
    results: List[Dict[str, Any]] = []
    for fname in candidates:
        path = os.path.join(_SNAPSHOTS_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                snap = json.load(f)
            st = snap.get("stats") or {}
            results.append({
                "filename": fname,
                "param_ss": st.get("param_ss", st.get("chunk_size")),
                "total_records": snap.get("total_records", 0),
                "total_blocks": snap.get("total_blocks", 0),
                "acc": st.get("acc"),
                "ari": st.get("ari"),
                "f1": st.get("f1"),
                "time_seconds": st.get("time_seconds"),
                "total_llm_calls": st.get("total_llm_calls"),
                "total_tokens": st.get("total_tokens"),
                "pred_entities": st.get("pred_entities"),
            })
        except Exception:
            continue
    return results


def get_snapshot_by_ss(
    dataset_name: str, param_ss: int
) -> Optional[Dict[str, Any]]:
    """Return the latest snapshot for *dataset_name* whose param_ss matches."""
    if not os.path.isdir(_SNAPSHOTS_DIR):
        return None
    candidates = sorted(
        [f for f in os.listdir(_SNAPSHOTS_DIR)
         if f.startswith(dataset_name + "_") and f.endswith(".json")],
        reverse=True,
    )
    for fname in candidates:
        path = os.path.join(_SNAPSHOTS_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                snap = json.load(f)
            st = snap.get("stats") or {}
            # Support both new field name and legacy field name
            ss_val = st.get("param_ss", st.get("chunk_size"))
            if ss_val == param_ss:
                return snap
        except Exception:
            continue
    return None


def _convert_events(run_logger) -> List[Dict[str, Any]]:
    """Convert RunLogger events to the snapshot event format consumed by the
    frontend replay animation."""
    if not run_logger or not hasattr(run_logger, "events"):
        return []

    out: List[Dict[str, Any]] = []
    current_block = ""
    pending_req: Optional[Dict] = None

    for ev in run_logger.events:
        etype = ev.get("type", "")
        stage = ev.get("stage", "")
        msg = ev.get("message", "")
        data = ev.get("data") or {}
        ctx = data.get("context", "")

        # ── Blocking result ───────────────────────────────────────────
        if etype == "block_result":
            out.append({
                "action": "info",
                "title": msg or "LSH blocking done",
                "phase": "blocking",
                "detail": f"{data.get('num_blocks', '?')} blocks",
            })
            continue

        # ── Block start (inferred from context change) ────────────────
        if etype in ("kmeans_result",) and stage == "separation":
            if ctx and ctx != current_block:
                current_block = ctx
                out.append({
                    "action": "block_start",
                    "title": f"Processing {ctx}",
                    "block": ctx,
                })

        # ── LLM request (store for pairing) ───────────────────────────
        if etype == "llm_request":
            pending_req = {
                "stage": stage,
                "ctx": ctx,
                "prompt": data.get("prompt", ""),
            }
            continue

        # ── LLM response (pair with request) ──────────────────────────
        if etype == "llm_response":
            pr = pending_req or {}
            req_stage = pr.get("stage", stage)
            block_name = pr.get("ctx", ctx) or current_block

            call_type = "merge" if "merge" in req_stage else "cluster"
            if "classify" in req_stage:
                prefix = "NRS classify"
            elif "separate" in req_stage:
                prefix = "NRS separate"
            elif "merge" in req_stage:
                prefix = "CMR merge"
                block_name = ""
            else:
                prefix = "LLM"

            resp_text = str(data.get("parsed_result") or data.get("raw_response", ""))[:200]
            if "merge" in req_stage:
                is_m = data.get("is_merge", False)
                ans = data.get("answer", "")
                resp_text = f"Answer: {ans}\n\u2192 {'Merge accepted' if is_m else 'Not merged'}"

            entry: Dict[str, Any] = {
                "action": "llm_call",
                "title": f"{prefix} {block_name}".strip(),
                "type": call_type,
                "promptShort": pr.get("prompt") or "",
                "response": resp_text,
                "tokens": data.get("tokens", 0),
            }
            if block_name:
                entry["block"] = block_name
            out.append(entry)
            pending_req = None
            continue

        # ── MDG check ─────────────────────────────────────────────────
        if etype == "mdg_check":
            passed = data.get("acceptable", True)
            out.append({
                "action": "mdg",
                "title": f"MDG check: {'pass' if passed else 'fail'}",
                "passed": passed,
                "detail": str(data.get("clusters", []))[:100],
                "phase": "separation",
                "block": ctx or current_block,
            })
            continue

        # ── Block separation done ─────────────────────────────────────
        if etype == "separate_result" and stage == "separation":
            clusters = data.get("clusters", [])
            block_name = ctx or current_block
            out.append({
                "action": "info",
                "title": f"Block {block_name} separation done",
                "phase": "separation",
                "block": block_name,
                "detail": f"Block separation done: {len(clusters)} clusters\n  clusters: {str(clusters)[:100]}",
            })
            continue

        # ── Merge round ───────────────────────────────────────────────
        if etype == "merge_round":
            out.append({
                "action": "merge_round",
                "title": f"Merge round threshold={data.get('threshold', 0)}",
                "threshold": data.get("threshold", 0),
                "yesCount": data.get("yes_count", 0),
                "total": data.get("total", 0),
                "accepted": data.get("accepted", False),
            })
            continue

        # ── Merge phase start (from explicit progress event) ──────────
        if etype == "progress" and stage == "merge" and "Running" in msg:
            out.append({"action": "phase_start", "title": "CMR Merge Phase"})
            continue

    return out
