from __future__ import annotations

from fastapi import APIRouter

from config import (
    AVAILABLE_MODELS, DEFAULT_MODEL, DEFAULT_BLOCKING_STRATEGY,
    DEFAULT_MDG_RETRY_TIMES, DEFAULT_MAX_WORKERS, DEFAULT_CHUNK_SIZE,
    DEFAULT_RETRY_ATTEMPTS, DEFAULT_LSH_HASH_SIZE, DEFAULT_LSH_NUM_HASHTABLES,
    DEFAULT_MAX_K,
)
from models.schemas import ConfigResponse, ConfigUpdate, ModelInfo
from services import dataset_service

router = APIRouter(prefix="/api", tags=["config"])

# In-memory mutable config (single instance)
_current_config: dict = {
    "model": DEFAULT_MODEL,
    "blocking_strategy": DEFAULT_BLOCKING_STRATEGY,
    "block_threshold": None,
    "merge_threshold": None,
    "mdg_retry_times": DEFAULT_MDG_RETRY_TIMES,
    "max_workers": DEFAULT_MAX_WORKERS,
    "chunk_size": DEFAULT_CHUNK_SIZE,
    "retry_attempts": DEFAULT_RETRY_ATTEMPTS,
    "lsh_hash_size": DEFAULT_LSH_HASH_SIZE,
    "lsh_num_hashtables": DEFAULT_LSH_NUM_HASHTABLES,
    "max_k": DEFAULT_MAX_K,
}


@router.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get current configuration."""
    datasets = dataset_service.list_datasets()
    return ConfigResponse(
        **_current_config,
        available_datasets=[d["name"] for d in datasets],
    )


@router.put("/config", response_model=ConfigResponse)
async def update_config(update: ConfigUpdate):
    """Update configuration."""
    for field, value in update.model_dump(exclude_none=True).items():
        if field in _current_config:
            _current_config[field] = value
    datasets = dataset_service.list_datasets()
    return ConfigResponse(
        **_current_config,
        available_datasets=[d["name"] for d in datasets],
    )


@router.get("/models", response_model=list[ModelInfo])
async def list_models():
    """Get available LLM models."""
    return AVAILABLE_MODELS
