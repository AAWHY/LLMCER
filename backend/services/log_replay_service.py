"""Parse LLMCER per-block log files into structured replay events."""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional

from pathlib import Path

_DEFAULT_LOGS_DIR = str(Path(__file__).resolve().parent.parent.parent.parent / "LLMCER" / "logs")
LLMCER_LOGS_DIR = os.environ.get("LLMCER_LOGS_DIR", _DEFAULT_LOGS_DIR)


# ── Public API ───────────────────────────────────────────────────────────────


def list_runs() -> List[Dict[str, Any]]:
    """Return metadata for every *_detail_* log directory."""
    runs: list[dict] = []
    if not os.path.isdir(LLMCER_LOGS_DIR):
        return runs
    for name in sorted(os.listdir(LLMCER_LOGS_DIR)):
        path = os.path.join(LLMCER_LOGS_DIR, name)
        if not os.path.isdir(path) or "_detail_" not in name:
            continue
        log_files = [f for f in os.listdir(path) if f.endswith(".log")]
        block_files = [f for f in log_files if f.startswith("block_")]
        runs.append(
            {
                "name": name,
                "num_blocks": len(block_files),
                "has_merge": "cmr_merge.log" in log_files,
            }
        )
    return runs


def get_replay_events(run_name: str) -> Optional[Dict[str, Any]]:
    """Parse a run directory and return a flat list of frontend replay events."""
    run_path = os.path.join(LLMCER_LOGS_DIR, run_name)
    if not os.path.isdir(run_path):
        return None

    # 1. Blocking
    blocking = _parse_log_file(os.path.join(run_path, "blocking.log"))

    # 2. Block files (sorted numerically)
    block_files = sorted(
        [f for f in os.listdir(run_path) if re.match(r"block_\d+\.log", f)],
        key=lambda f: int(re.search(r"(\d+)", f).group(1)),
    )
    blocks = []
    for bf in block_files:
        blocks.append(
            {
                "name": bf.replace(".log", ""),
                "events": _parse_log_file(os.path.join(run_path, bf)),
            }
        )

    # 3. Merge
    merge = _parse_log_file(os.path.join(run_path, "cmr_merge.log"))

    # Build flat replay list
    replay = _build_replay(blocking, blocks, merge)

    return {
        "run_name": run_name,
        "num_blocks": len(blocks),
        "has_merge": len(merge) > 0,
        "total_events": len(replay),
        "events": replay,
    }


# ── Log file parser ─────────────────────────────────────────────────────────


def _parse_log_file(filepath: str) -> List[Dict[str, Any]]:
    if not os.path.exists(filepath):
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    raw_blocks = re.split(r"\n\n+", content.strip())
    events = []
    for rb in raw_blocks:
        ev = _parse_event_block(rb.strip())
        if ev:
            events.append(ev)
    return events


def _parse_event_block(text: str) -> Optional[Dict[str, Any]]:
    lines = text.split("\n")
    if not lines:
        return None

    header = re.match(r"\[(\w+)\]\s+\[(\w+)\]\s+(.*)", lines[0])
    if not header:
        return None

    event: Dict[str, Any] = {
        "stage": header.group(1),
        "type": header.group(2),
        "message": header.group(3).strip(),
        "data": {},
    }

    i = 1
    while i < len(lines):
        line = lines[i]
        kv = re.match(r"^  (\w[\w_]*):\s*(.*)", line)
        if not kv:
            i += 1
            continue

        key = kv.group(1)
        rest = kv.group(2).strip()

        # Detect "(N items)" list header or empty value (multiline)
        is_list_header = bool(re.match(r"\(\d+ items?\)$", rest))

        if rest and not is_list_header:
            # Single-line value
            event["data"][key] = _coerce(rest)
            i += 1
        else:
            # Collect continuation lines (4-space indent)
            value_lines: list[str] = []
            i += 1
            while i < len(lines) and lines[i].startswith("    "):
                value_lines.append(lines[i][4:])
                i += 1

            if is_list_header:
                items = []
                for vl in value_lines:
                    m = re.match(r"\[\d+\]\s+(.*)", vl)
                    items.append(m.group(1) if m else vl)
                event["data"][key] = items
            else:
                event["data"][key] = "\n".join(value_lines)

    return event


def _coerce(s: str) -> Any:
    if s.lower() == "true":
        return True
    if s.lower() == "false":
        return False
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


# ── Replay event builder ────────────────────────────────────────────────────

def _truncate_prompt(prompt: str, max_lines: int = 6) -> str:
    """Keep first few lines of a prompt for the thinking display."""
    lines = prompt.split("\n")
    if len(lines) <= max_lines:
        return prompt
    return "\n".join(lines[:max_lines]) + f"\n... ({len(lines)} lines total)"


def _build_replay(
    blocking: List[Dict],
    blocks: List[Dict],
    merge: List[Dict],
) -> List[Dict[str, Any]]:
    events: list[dict] = []

    # ── Blocking phase ───────────────────────────────────────────────────
    for ev in blocking:
        if ev["type"] == "block_result":
            sizes = ev["data"].get("block_sizes", [])
            events.append(
                {
                    "action": "info",
                    "title": ev["message"],
                    "detail": f"{len(sizes)} blocks" if isinstance(sizes, list) else str(sizes),
                    "phase": "blocking",
                }
            )

    # ── Separation phase (per block) ─────────────────────────────────────
    for block in blocks:
        bname = block["name"]
        bevents = block["events"]

        events.append(
            {
                "action": "block_start",
                "title": f"Processing {bname}",
                "phase": "separation",
                "block": bname,
            }
        )

        i = 0
        while i < len(bevents):
            ev = bevents[i]

            if ev["type"] == "kmeans_result":
                events.append(
                    {
                        "action": "info",
                        "title": ev["message"],
                        "phase": "separation",
                        "block": bname,
                    }
                )

            elif ev["type"] == "llm_request":
                prompt = ev["data"].get("prompt", "")
                if not isinstance(prompt, str):
                    prompt = str(prompt)

                # Look ahead for matching response
                resp_text = ""
                tokens = 0
                if (
                    i + 1 < len(bevents)
                    and bevents[i + 1]["type"] == "llm_response"
                ):
                    resp = bevents[i + 1]
                    resp_text = str(
                        resp["data"].get(
                            "raw_response",
                            resp["data"].get("answer", ""),
                        )
                    )
                    tokens = resp["data"].get("tokens", 0)
                    if not isinstance(tokens, int):
                        try:
                            tokens = int(tokens)
                        except (ValueError, TypeError):
                            tokens = 0
                    i += 1

                entry_type = (
                    "cluster"
                    if ev["stage"] in ("nrs_classify", "nrs_separate")
                    else "merge"
                )

                events.append(
                    {
                        "action": "llm_call",
                        "type": entry_type,
                        "title": ev["message"],
                        "prompt": prompt,
                        "promptShort": _truncate_prompt(prompt),
                        "response": resp_text,
                        "tokens": tokens,
                        "phase": ev["stage"],
                        "block": bname,
                    }
                )

            elif ev["type"] == "mdg_check":
                passed = ev["data"].get("acceptable", True)
                events.append(
                    {
                        "action": "mdg",
                        "title": ev["message"],
                        "passed": passed if isinstance(passed, bool) else str(passed).lower() == "true",
                        "detail": str(ev["data"].get("clusters", "")),
                        "phase": "separation",
                        "block": bname,
                    }
                )

            elif ev["type"] == "mdg_fail":
                events.append(
                    {
                        "action": "mdg",
                        "title": ev["message"],
                        "passed": False,
                        "detail": str(ev["data"]),
                        "phase": "separation",
                        "block": bname,
                    }
                )

            elif ev["type"] in ("classify_result", "separate_result"):
                events.append(
                    {
                        "action": "info",
                        "title": ev["message"],
                        "phase": "separation",
                        "block": bname,
                    }
                )

            i += 1

    # ── Merge phase ──────────────────────────────────────────────────────
    if merge:
        events.append(
            {
                "action": "phase_start",
                "title": "CMR Merge Phase",
                "phase": "cmr_merge",
            }
        )

        i = 0
        while i < len(merge):
            ev = merge[i]

            if ev["type"] == "llm_request":
                prompt = ev["data"].get("prompt", "")
                if not isinstance(prompt, str):
                    prompt = str(prompt)

                resp_text = ""
                tokens = 0
                is_merge = False
                if (
                    i + 1 < len(merge)
                    and merge[i + 1]["type"] == "llm_response"
                ):
                    resp = merge[i + 1]
                    resp_text = str(
                        resp["data"].get("answer", resp["data"].get("raw_response", ""))
                    )
                    tokens = resp["data"].get("tokens", 0)
                    if not isinstance(tokens, int):
                        try:
                            tokens = int(tokens)
                        except (ValueError, TypeError):
                            tokens = 0
                    is_merge = resp["data"].get("is_merge", False)
                    i += 1

                events.append(
                    {
                        "action": "llm_call",
                        "type": "merge",
                        "title": ev["message"],
                        "prompt": prompt,
                        "promptShort": _truncate_prompt(prompt),
                        "response": resp_text,
                        "tokens": tokens,
                        "isMerge": is_merge,
                        "phase": "cmr_merge",
                    }
                )

            elif ev["type"] == "merge_round":
                events.append(
                    {
                        "action": "merge_round",
                        "title": ev["message"],
                        "threshold": ev["data"].get("threshold", 0),
                        "yesCount": ev["data"].get("yes_count", 0),
                        "total": ev["data"].get("total", 0),
                        "accepted": ev["data"].get("accepted", False),
                        "phase": "cmr_merge",
                    }
                )

            i += 1

    return events
