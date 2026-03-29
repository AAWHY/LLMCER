from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, UploadFile, File

from models.schemas import DatasetInfo, DatasetDetail, DatasetRecordsResponse
from services import dataset_service

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("", response_model=list[DatasetInfo])
async def list_datasets():
    """List all available datasets."""
    return dataset_service.list_datasets()


@router.get("/{name}", response_model=DatasetDetail)
async def get_dataset(name: str, preview_rows: int = Query(10, ge=1, le=100)):
    """Get dataset details with preview rows."""
    result = dataset_service.get_dataset_detail(name, preview_rows)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{name}' not found")
    return result


@router.get("/{name}/records", response_model=DatasetRecordsResponse)
async def get_dataset_records(
    name: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
):
    """Get paginated dataset records."""
    result = dataset_service.get_dataset_records(name, offset, limit)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{name}' not found")
    return result


@router.get("/{name}/gt-clusters")
async def get_gt_clusters(name: str):
    """Return ground-truth entity color map {recordId: colorIndex(1-8)}."""
    entity_map = dataset_service.get_gt_entity_map(name)
    if entity_map is None:
        raise HTTPException(status_code=404, detail="No ground truth available")
    return entity_map


@router.post("/upload", response_model=DatasetInfo)
async def upload_dataset(
    name: str = Query(..., description="Dataset name"),
    file: UploadFile = File(...),
    gt_file: UploadFile | None = File(None),
):
    """Upload a custom CSV dataset with optional ground-truth file."""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await file.read()
    gt_content = None
    gt_filename = None
    if gt_file and gt_file.filename:
        gt_content = await gt_file.read()
        gt_filename = gt_file.filename
    try:
        result = dataset_service.save_uploaded_dataset(
            name, content, file.filename, gt_content, gt_filename
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid CSV file: {e}")
    return result
