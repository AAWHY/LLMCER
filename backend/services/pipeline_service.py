from __future__ import annotations

import io
import os
import sys
import queue
import threading
import time
import uuid
from contextlib import redirect_stdout
from typing import Any, Optional

import numpy as np

from utils.sse import EventBus
from services import dataset_service
from services.metrics_service import compute_all_metrics
from services.persistence_service import RunLogger, save_result, load_result, list_results

# ── In-memory task store ─────────────────────────────────────────────────────

tasks: dict[str, dict[str, Any]] = {}


def create_task(request_data: dict[str, Any]) -> str:
    """Create a new pipeline task and return task_id."""
    task_id = uuid.uuid4().hex[:12]
    event_bus = EventBus()
    run_logger = RunLogger(task_id, request_data)
    event_bus.add_listener(run_logger.record_event)
    tasks[task_id] = {
        "status": "pending",
        "stage": None,
        "progress": 0.0,
        "message": "",
        "event_bus": event_bus,
        "run_logger": run_logger,
        "results": None,
        "error": None,
        "request": request_data,
        "mdg_queue": queue.Queue(),  # for human MDG responses
    }
    return task_id


def submit_mdg_response(task_id: str, accepted: bool) -> bool:
    """Submit a human MDG review response for a pending pipeline."""
    task = tasks.get(task_id)
    if task is None:
        return False
    task["mdg_queue"].put(accepted)
    return True


def get_task(task_id: str) -> Optional[dict[str, Any]]:
    return tasks.get(task_id)


def start_pipeline(task_id: str) -> None:
    """Start the pipeline in a background thread."""
    task = tasks.get(task_id)
    if task is None:
        return
    task["status"] = "running"
    thread = threading.Thread(target=_run_pipeline, args=(task_id,), daemon=True)
    thread.start()


class _PrintCapture(io.StringIO):
    """Captures print output and forwards to EventBus."""

    def __init__(self, event_bus: EventBus, stage: str, original_stdout):
        super().__init__()
        self.event_bus = event_bus
        self.stage = stage
        self._original = original_stdout

    def write(self, s: str):
        if s.strip():
            self.event_bus.put(type="log", stage=self.stage, message=s.strip())
        # Also write to original stdout for debugging
        if self._original:
            self._original.write(s)
        return super().write(s)

    def flush(self):
        if self._original:
            self._original.flush()
        super().flush()


def _run_pipeline(task_id: str) -> None:
    """Execute the full LLMCER pipeline. Runs in a background thread."""
    task = tasks[task_id]
    event_bus: EventBus = task["event_bus"]
    req = task["request"]

    try:
        # Set up environment for LLMCER (use request values, fallback to config defaults)
        from config import DEFAULT_OPENAI_API_KEY, DEFAULT_OPENAI_BASE_URL, DEFAULT_MODEL
        os.environ["OPENAI_API_KEY"] = req.get("openai_api_key") or DEFAULT_OPENAI_API_KEY
        os.environ["OPENAI_MODEL"] = req.get("model") or DEFAULT_MODEL
        base_url = req.get("openai_base_url") or DEFAULT_OPENAI_BASE_URL
        if base_url:
            os.environ["OPENAI_BASE_URL"] = base_url

        # Reload config to pick up new env vars
        import importlib
        import llmcer.config as llmcer_config
        importlib.reload(llmcer_config)

        # Inject event callback so LLMCER emits structured SSE events
        from llmcer.event_logger import set_callback, reset_callback, get_context

        def _emit_to_sse(**kwargs):
            ctx = get_context()
            if ctx:
                data = kwargs.get("data") or {}
                data["context"] = ctx
                kwargs["data"] = data
            event_bus.put(**kwargs)

        set_callback(_emit_to_sse)

        # Human MDG hook: when mdg_mode='manual', block on user review
        from llmcer.llm_interaction import set_mdg_review_hook, clear_mdg_review_hook
        mdg_mode = req.get("mdg_mode", "auto")
        if mdg_mode == "manual":
            mdg_q = task["mdg_queue"]
            def _human_mdg_hook(slice_ids, clusters):
                # Emit review request to frontend via SSE
                event_bus.put(
                    type="mdg_review_request",
                    stage="nrs_separate",
                    message="Waiting for human MDG review",
                    data={
                        "slice_ids": slice_ids,
                        "clusters": clusters,
                    },
                )
                # Block until user responds
                return mdg_q.get()  # True=accept, False=reject
            set_mdg_review_hook(_human_mdg_hook)
        else:
            clear_mdg_review_hook()

        from llmcer.vectorization import cal_total_simi_vector
        from llmcer.clustering import lsh_block
        from llmcer.pipeline import seperate_parallel
        from llmcer.llm_interaction import merge_2
        from llmcer.id_utils import get_id_column

        dataset_name = req["dataset_name"]
        data_path = dataset_service.get_dataset_data_path(dataset_name)
        gt_path = dataset_service.get_dataset_gt_path(dataset_name)

        if data_path is None:
            raise ValueError(f"Dataset '{dataset_name}' not found")

        original_stdout = sys.stdout
        total_start = time.time()

        # ── Stage 1: Vectorization ───────────────────────────────────────
        task["stage"] = "vectorize"
        task["progress"] = 0.0
        event_bus.put(
            type="progress",
            stage="vectorize",
            message="Starting vectorization & similarity matrix...",
            data={"progress": 0.0},
        )

        sys.stdout = _PrintCapture(event_bus, "vectorize", original_stdout)
        vectors, simi_matrix, data = cal_total_simi_vector(data_path)
        sys.stdout = original_stdout

        # Dynamic threshold calculation
        sim_mean = float(np.mean(simi_matrix))
        sim_std = float(np.std(simi_matrix))
        block_threshold = req.get("block_threshold")
        merge_threshold = req.get("merge_threshold")

        if block_threshold is None:
            block_threshold = min(sim_mean + 2.5 * sim_std, 0.99)
        if merge_threshold is None:
            merge_threshold = min(sim_mean + 3.0 * sim_std, 0.90)

        event_bus.put(
            type="progress",
            stage="vectorize",
            message=f"Vectorization complete. Records: {len(data)}, "
                    f"block_threshold={block_threshold:.4f}, merge_threshold={merge_threshold:.4f}",
            data={"progress": 0.2, "records": len(data),
                  "block_threshold": round(block_threshold, 4),
                  "merge_threshold": round(merge_threshold, 4)},
        )
        task["progress"] = 0.2

        # ── Stage 2: Blocking ──────────────────────────────────────────
        task["stage"] = "block"
        blocking_strategy = req.get("blocking_strategy", "lsh")

        # Filtering-based and Canopy not yet implemented → fallback to LSH
        actual_strategy = blocking_strategy
        if blocking_strategy in ("filtering", "canopy"):
            event_bus.put(
                type="log",
                stage="block",
                message=f"'{blocking_strategy}' blocking not yet implemented, falling back to LSH blocking.",
                data={"requested": blocking_strategy, "actual": "lsh"},
            )
            actual_strategy = "lsh"

        strategy_label = {
            "lsh": "LSH-based Blocking",
            "filtering": "Filtering-based Block Creation",
            "canopy": "Canopy Blocking",
        }.get(actual_strategy, actual_strategy)

        event_bus.put(
            type="progress",
            stage="block",
            message=f"Running {strategy_label}...",
            data={"progress": 0.2, "strategy": actual_strategy},
        )

        lsh_hash_size = req.get("lsh_hash_size", 15)
        lsh_num_hashtables = req.get("lsh_num_hashtables", 8)
        # input_dim is determined by the embedding model (384 for all-MiniLM-L6-v2)
        lsh_input_dim = vectors.shape[1] if hasattr(vectors, 'shape') else 384

        sys.stdout = _PrintCapture(event_bus, "block", original_stdout)
        merge_clusters_pre = lsh_block(vectors, data, block_threshold,
                                       hash_size=lsh_hash_size,
                                       input_dim=lsh_input_dim,
                                       num_hashtables=lsh_num_hashtables)
        sys.stdout = original_stdout

        num_blocks = len(merge_clusters_pre)
        event_bus.put(
            type="progress",
            stage="block",
            message=f"{strategy_label} done. Found {num_blocks} blocks.",
            data={"progress": 0.3, "num_blocks": num_blocks,
                  "strategy": actual_strategy},
        )
        task["progress"] = 0.3

        # Emit block structure for center panel animation
        blocks_for_panel = []
        for bidx, block_ids in enumerate(merge_clusters_pre):
            str_ids = [f"r{rid}" for rid in block_ids]
            blocks_for_panel.append({
                "block_id": bidx,
                "record_ids": str_ids,
                "num_records": len(block_ids),
            })
        event_bus.put(
            type="pipeline_blocks",
            stage="block",
            message=f"Blocking complete: {num_blocks} blocks",
            data={
                "blocks": blocks_for_panel,
                "total_records": len(data),
                "dataset": dataset_name,
            },
        )

        # ── Stage 3: Separation ──────────────────────────────────────────
        task["stage"] = "separation"
        event_bus.put(
            type="progress",
            stage="separation",
            message=f"Running parallel separation on {num_blocks} blocks...",
            data={"progress": 0.3},
        )

        max_workers = 1 if mdg_mode == "manual" else req.get("max_workers", 5)
        max_k = req.get("max_k", 5)
        chunk_size = req.get("chunk_size", 10)
        retry_attempts = req.get("retry_attempts", 2)

        sys.stdout = _PrintCapture(event_bus, "separation", original_stdout)
        (
            result_sep,
            sep_api_calls,
            sep_time,
            sep_tokens,
            sep_in_tokens,
            sep_out_tokens,
            mdg_fails,
        ) = seperate_parallel(vectors, simi_matrix, merge_clusters_pre, data, block_threshold,
                              max_workers=max_workers, max_k=max_k,
                              chunk_size=chunk_size, retry_attempts=retry_attempts)
        sys.stdout = original_stdout

        event_bus.put(
            type="progress",
            stage="separation",
            message=f"Separation done. {len(result_sep)} clusters, "
                    f"{sep_api_calls} API calls, {sep_time:.1f}s",
            data={
                "progress": 0.7,
                "clusters": len(result_sep),
                "api_calls": sep_api_calls,
                "time": round(sep_time, 2),
                "tokens": sep_tokens,
                "mdg_fails": mdg_fails,
            },
        )
        task["progress"] = 0.7

        # ── Stage 4: Merging ─────────────────────────────────────────────
        task["stage"] = "merge"
        event_bus.put(
            type="progress",
            stage="merge",
            message="Running merging stage...",
            data={"progress": 0.7},
        )

        sys.stdout = _PrintCapture(event_bus, "merge", original_stdout)
        (
            final_result,
            merge_api_calls,
            merge_time,
            merge_tokens,
            m_in_tokens,
            m_out_tokens,
        ) = merge_2(result_sep, simi_matrix, data, block_threshold, merge_threshold)
        sys.stdout = original_stdout

        event_bus.put(
            type="progress",
            stage="merge",
            message=f"Merging done. {len(final_result)} final clusters, "
                    f"{merge_api_calls} API calls, {merge_time:.1f}s",
            data={
                "progress": 0.9,
                "clusters": len(final_result),
                "api_calls": merge_api_calls,
                "time": round(merge_time, 2),
                "tokens": merge_tokens,
            },
        )
        task["progress"] = 0.9

        # ── Stage 5: Metrics ─────────────────────────────────────────────
        task["stage"] = "metrics"
        event_bus.put(
            type="progress",
            stage="metrics",
            message="Computing evaluation metrics...",
            data={"progress": 0.9},
        )

        # Get all IDs for ground-truth augmentation
        id_col = get_id_column(data)
        if id_col and id_col in data.columns:
            all_ids = data[id_col].tolist()
        elif hasattr(data, "iloc"):
            all_ids = data.iloc[:, 0].tolist()
        else:
            all_ids = []

        metrics = compute_all_metrics(final_result, gt_path, all_ids)

        total_time = time.time() - total_start

        # Build results
        clusters_out = [
            {"cluster_id": i, "record_ids": cluster}
            for i, cluster in enumerate(final_result)
        ]
        stats = {
            "total_api_calls": sep_api_calls + merge_api_calls,
            "separation_api_calls": sep_api_calls,
            "merge_api_calls": merge_api_calls,
            "total_tokens": sep_tokens + merge_tokens,
            "input_tokens": sep_in_tokens + m_in_tokens,
            "output_tokens": sep_out_tokens + m_out_tokens,
            "separation_time": round(sep_time, 2),
            "merge_time": round(merge_time, 2),
            "total_time": round(total_time, 2),
            "mdg_fails": mdg_fails,
            "num_blocks": num_blocks,
            "block_threshold": round(block_threshold, 4),
            "merge_threshold": round(merge_threshold, 4),
            "max_workers": max_workers,
            "chunk_size": chunk_size,
            "retry_attempts": retry_attempts,
            "max_k": max_k,
            "lsh_hash_size": lsh_hash_size,
            "lsh_num_hashtables": lsh_num_hashtables,
        }

        task["results"] = {
            "task_id": task_id,
            "clusters": clusters_out,
            "metrics": metrics,
            "stats": stats,
        }
        task["status"] = "completed"
        task["stage"] = "complete"
        task["progress"] = 1.0

        # Persist results, logs, and snapshot to disk BEFORE emitting
        # the result event so the frontend can immediately fetch the snapshot.
        save_result(task_id, task["results"])
        run_logger = task.get("run_logger")
        if run_logger:
            run_logger.save(status="completed")

        try:
            from services.snapshot_service import save_pipeline_snapshot
            save_pipeline_snapshot(
                task_id=task_id,
                dataset_name=dataset_name,
                data=data,
                merge_clusters_pre=merge_clusters_pre,
                result_sep=result_sep,
                final_result=final_result,
                metrics=metrics,
                stats=stats,
                run_logger=run_logger,
            )
        except Exception as snap_err:
            event_bus.put(
                type="log", stage="complete",
                message=f"Warning: Failed to save snapshot: {snap_err}",
            )

        # NOW emit result event (snapshot is already on disk)
        event_bus.put(
            type="result",
            stage="complete",
            message=f"Pipeline completed. {len(final_result)} clusters in {total_time:.1f}s",
            data={
                "progress": 1.0,
                "total_clusters": len(final_result),
                "total_time": round(total_time, 2),
                "total_api_calls": sep_api_calls + merge_api_calls,
                "metrics": metrics,
            },
        )

    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        task["status"] = "failed"
        task["error"] = str(e)
        event_bus.put(type="error", stage=task.get("stage"), message=str(e),
                      data={"traceback": err_msg})
        # Save failed run log
        run_logger = task.get("run_logger")
        if run_logger:
            run_logger.save(status="failed", error=str(e))
    finally:
        # Clean up event callback and MDG hook
        try:
            from llmcer.event_logger import reset_callback
            reset_callback()
            from llmcer.llm_interaction import clear_mdg_review_hook
            clear_mdg_review_hook()
        except Exception:
            pass
        # Restore stdout just in case
        sys.stdout = sys.__stdout__
        event_bus.close()
