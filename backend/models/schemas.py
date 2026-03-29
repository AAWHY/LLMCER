from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Dataset ──────────────────────────────────────────────────────────────────

class DatasetInfo(BaseModel):
    name: str
    record_count: int
    columns: list[str]
    has_ground_truth: bool
    data_file: str
    ground_truth_file: Optional[str] = None


class DatasetDetail(DatasetInfo):
    preview: list[dict[str, Any]]  # first N rows


class DatasetRecordsResponse(BaseModel):
    total: int
    offset: int
    limit: int
    records: list[dict[str, Any]]


# ── Pipeline ─────────────────────────────────────────────────────────────────

class PipelineRequest(BaseModel):
    dataset_name: str
    openai_api_key: Optional[str] = None    # None → use server default
    openai_base_url: Optional[str] = None   # None → use server default
    model: str = "gpt-4o-mini"
    blocking_strategy: str = "lsh"
    block_threshold: Optional[float] = None   # None → auto
    merge_threshold: Optional[float] = None   # None → auto
    mdg_retry_times: int = 3
    # Parallelism & batching
    max_workers: int = 5               # ThreadPoolExecutor concurrency
    chunk_size: int = 10               # LLM batch size per separation call
    retry_attempts: int = 2            # LLM call retry count
    # LSH blocking parameters
    lsh_hash_size: int = 15
    lsh_num_hashtables: int = 8
    # Clustering
    max_k: int = 5                     # Elbow method max K
    # MDG mode
    mdg_mode: str = "auto"             # "auto" or "manual" (human-in-the-loop)


class PipelineStatus(BaseModel):
    task_id: str
    status: str  # pending | running | completed | failed
    stage: Optional[str] = None
    progress: Optional[float] = None
    message: Optional[str] = None


class ClusterResult(BaseModel):
    cluster_id: int
    record_ids: list[Any]


class MetricsResult(BaseModel):
    purity: Optional[float] = None
    inverse_purity: Optional[float] = None
    f_measure: Optional[float] = None
    ari: Optional[float] = None
    bcubed_precision: Optional[float] = None
    bcubed_recall: Optional[float] = None
    bcubed_f1: Optional[float] = None
    pairwise_accuracy: Optional[float] = None
    pairwise_precision: Optional[float] = None
    pairwise_recall: Optional[float] = None
    pairwise_f1: Optional[float] = None


class PipelineStats(BaseModel):
    total_api_calls: int = 0
    separation_api_calls: int = 0
    merge_api_calls: int = 0
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    separation_time: float = 0.0
    merge_time: float = 0.0
    total_time: float = 0.0
    mdg_fails: int = 0
    num_blocks: int = 0
    block_threshold: Optional[float] = None
    merge_threshold: Optional[float] = None


class PipelineResult(BaseModel):
    task_id: str
    clusters: list[ClusterResult]
    metrics: Optional[MetricsResult] = None
    stats: PipelineStats


# ── Config ───────────────────────────────────────────────────────────────────

class ConfigResponse(BaseModel):
    model: str
    blocking_strategy: str
    block_threshold: Optional[float] = None
    merge_threshold: Optional[float] = None
    mdg_retry_times: int = 3
    max_workers: int = 5
    chunk_size: int = 10
    retry_attempts: int = 2
    lsh_hash_size: int = 15
    lsh_num_hashtables: int = 8
    max_k: int = 5
    available_datasets: list[str] = []


class ConfigUpdate(BaseModel):
    model: Optional[str] = None
    api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    blocking_strategy: Optional[str] = None
    block_threshold: Optional[float] = None
    merge_threshold: Optional[float] = None
    mdg_retry_times: Optional[int] = None
    max_workers: Optional[int] = None
    chunk_size: Optional[int] = None
    retry_attempts: Optional[int] = None
    lsh_hash_size: Optional[int] = None
    lsh_num_hashtables: Optional[int] = None
    max_k: Optional[int] = None


class ModelInfo(BaseModel):
    value: str
    label: str


# ── SSE Event ────────────────────────────────────────────────────────────────

class SSEEvent(BaseModel):
    type: str = "log"            # log | progress | result | error
    stage: Optional[str] = None  # vectorize | block | separation | merge | metrics
    message: str = ""
    data: Optional[dict[str, Any]] = None
