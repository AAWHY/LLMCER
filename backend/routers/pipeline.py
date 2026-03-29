from __future__ import annotations

from fastapi import APIRouter, HTTPException
from starlette.responses import StreamingResponse

from models.schemas import PipelineRequest, PipelineStatus, PipelineResult
from services import pipeline_service
from services.persistence_service import list_results, load_result, list_logs, load_log

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.post("/run", response_model=PipelineStatus)
async def run_pipeline(req: PipelineRequest):
    """Submit a new pipeline task. Returns task_id immediately."""
    task_id = pipeline_service.create_task(req.model_dump())
    pipeline_service.start_pipeline(task_id)
    task = pipeline_service.get_task(task_id)
    return PipelineStatus(
        task_id=task_id,
        status=task["status"],
        stage=task["stage"],
        progress=task["progress"],
        message=task["message"],
    )


@router.get("/{task_id}/status", response_model=PipelineStatus)
async def get_status(task_id: str):
    """Query current task status."""
    task = pipeline_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return PipelineStatus(
        task_id=task_id,
        status=task["status"],
        stage=task["stage"],
        progress=task["progress"],
        message=task.get("message", ""),
    )


@router.get("/{task_id}/events")
async def get_events(task_id: str):
    """SSE stream of real-time pipeline logs and progress."""
    task = pipeline_service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    event_bus = task["event_bus"]
    return StreamingResponse(
        event_bus.subscribe(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{task_id}/mdg-response")
async def mdg_response(task_id: str, body: dict):
    """Submit a human MDG review response (accept/reject) for a running pipeline."""
    accepted = body.get("accepted", True)
    ok = pipeline_service.submit_mdg_response(task_id, accepted)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "ok", "accepted": accepted}


@router.get("/{task_id}/results", response_model=PipelineResult)
async def get_results(task_id: str):
    """Get final pipeline results (clusters + metrics + stats).
    Checks in-memory first, then falls back to disk."""
    task = pipeline_service.get_task(task_id)
    if task is not None:
        if task["status"] == "failed":
            raise HTTPException(status_code=500, detail=task.get("error", "Pipeline failed"))
        if task["status"] != "completed":
            raise HTTPException(
                status_code=409,
                detail=f"Task not completed yet. Status: {task['status']}",
            )
        return task["results"]
    # Fallback: load from disk
    result = load_result(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.get("/history/results")
async def get_saved_results():
    """List all persisted pipeline results."""
    return list_results()


@router.get("/history/logs")
async def get_saved_logs():
    """List all persisted pipeline run logs."""
    return list_logs()


@router.get("/history/logs/{task_id}")
async def get_saved_log(task_id: str):
    """Get full log for a past pipeline run."""
    log = load_log(task_id)
    if log is None:
        raise HTTPException(status_code=404, detail="Log not found")
    return log


@router.get("/history/results/{task_id}")
async def get_saved_result(task_id: str):
    """Get full result for a past pipeline run."""
    result = load_result(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Result not found")
    return result
