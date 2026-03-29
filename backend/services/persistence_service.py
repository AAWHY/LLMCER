"""Persistence for pipeline logs and results.

- Logs: Each pipeline run writes events to server/data/logs/<task_id>.json
- Results: Final results saved to server/data/results/<task_id>.json
- Both directories are auto-created on import.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from config import LOGS_DIR, RESULTS_DIR


def _save_json(path: Path, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)


def _load_json(path: Path) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


# ── Log persistence ─────────────────────────────────────────────────────────

class RunLogger:
    """Collects SSE events for a pipeline run and saves them to disk."""

    def __init__(self, task_id: str, request_data: dict[str, Any]):
        self.task_id = task_id
        self.log_path = LOGS_DIR / f"{task_id}.json"
        self.events: list[dict[str, Any]] = []
        self.meta = {
            "task_id": task_id,
            "dataset": request_data.get("dataset_name", ""),
            "model": request_data.get("model", ""),
            "created_at": datetime.now().isoformat(),
            "request": {k: v for k, v in request_data.items() if k != "openai_api_key"},
        }

    def record_event(self, event: dict[str, Any]) -> None:
        """Record one SSE event."""
        self.events.append({
            **event,
            "timestamp": datetime.now().isoformat(),
        })

    def save(self, status: str = "completed", error: Optional[str] = None) -> None:
        """Save all events + metadata to disk."""
        self.meta["status"] = status
        self.meta["finished_at"] = datetime.now().isoformat()
        self.meta["total_events"] = len(self.events)
        if error:
            self.meta["error"] = error
        doc = {**self.meta, "events": self.events}
        _save_json(self.log_path, doc)


# ── Result persistence ──────────────────────────────────────────────────────

def save_result(task_id: str, result: dict[str, Any]) -> None:
    """Save pipeline result (clusters + metrics + stats) to disk."""
    path = RESULTS_DIR / f"{task_id}.json"
    result_doc = {
        "task_id": task_id,
        "saved_at": datetime.now().isoformat(),
        **result,
    }
    _save_json(path, result_doc)


def load_result(task_id: str) -> Optional[dict[str, Any]]:
    """Load a saved pipeline result."""
    return _load_json(RESULTS_DIR / f"{task_id}.json")


def list_results() -> list[dict[str, Any]]:
    """List all saved results (summary only, no full cluster data)."""
    results = []
    for f in sorted(RESULTS_DIR.glob("*.json"), key=os.path.getmtime, reverse=True):
        doc = _load_json(f)
        if doc:
            results.append({
                "task_id": doc.get("task_id", f.stem),
                "saved_at": doc.get("saved_at", ""),
                "stats": doc.get("stats", {}),
                "metrics": doc.get("metrics", {}),
            })
    return results


def list_logs() -> list[dict[str, Any]]:
    """List all saved pipeline logs (metadata only)."""
    logs = []
    for f in sorted(LOGS_DIR.glob("*.json"), key=os.path.getmtime, reverse=True):
        doc = _load_json(f)
        if doc:
            logs.append({
                "task_id": doc.get("task_id", f.stem),
                "dataset": doc.get("dataset", ""),
                "model": doc.get("model", ""),
                "status": doc.get("status", ""),
                "created_at": doc.get("created_at", ""),
                "finished_at": doc.get("finished_at", ""),
                "total_events": doc.get("total_events", 0),
            })
    return logs


def load_log(task_id: str) -> Optional[dict[str, Any]]:
    """Load full log for a pipeline run."""
    return _load_json(LOGS_DIR / f"{task_id}.json")
