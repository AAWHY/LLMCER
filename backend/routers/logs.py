"""API endpoints for browsing and replaying LLMCER log runs."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services import log_replay_service, snapshot_service

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/runs")
async def list_runs():
    """List available log run directories."""
    return log_replay_service.list_runs()


@router.get("/runs/{run_name}/events")
async def get_events(run_name: str):
    """Get all parsed replay events for a given run."""
    result = log_replay_service.get_replay_events(run_name)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")
    return result


@router.get("/runs/{run_name}/snapshot")
async def get_snapshot(run_name: str):
    """Get block + cluster snapshot for the center panel visualisation."""
    result = snapshot_service.get_snapshot(run_name)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_name}' not found")
    return result


@router.get("/snapshot/{dataset_name}")
async def get_snapshot_by_dataset(dataset_name: str):
    """Find the latest snapshot for a dataset (e.g. 'cora')."""
    result = snapshot_service.get_snapshot_by_dataset(dataset_name)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No snapshot for '{dataset_name}'")
    return result


@router.get("/snapshots/{dataset_name}")
async def list_dataset_snapshots(dataset_name: str):
    """List all snapshots for a dataset with summary info."""
    return snapshot_service.list_snapshots_for_dataset(dataset_name)


@router.get("/snapshot/{dataset_name}/ss/{param_ss}")
async def get_snapshot_by_ss(dataset_name: str, param_ss: int):
    """Get the latest snapshot matching a specific S_s value."""
    result = snapshot_service.get_snapshot_by_ss(dataset_name, param_ss)
    if not result:
        raise HTTPException(status_code=404, detail=f"No snapshot for S_s={param_ss}")
    return result
