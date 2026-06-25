from pathlib import Path

# Project paths
SERVER_DIR = Path(__file__).parent
PROJECT_DIR = SERVER_DIR.parent
DATASETS_DIR = SERVER_DIR / "data" / "datasets"

# OpenAI defaults — API key must be provided from frontend
import os
DEFAULT_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
DEFAULT_OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "")  # empty = OpenAI official

# Default pipeline parameters
DEFAULT_MODEL = "gpt-4o-mini"
DEFAULT_BLOCKING_STRATEGY = "lsh"
DEFAULT_BLOCK_THRESHOLD = None  # None means auto-calculate
DEFAULT_MERGE_THRESHOLD = None  # None means auto-calculate
DEFAULT_MDG_RETRY_TIMES = 3
DEFAULT_MAX_WORKERS = 5
DEFAULT_CHUNK_SIZE = 10
DEFAULT_RETRY_ATTEMPTS = 2
DEFAULT_LSH_HASH_SIZE = 15
DEFAULT_LSH_NUM_HASHTABLES = 8
DEFAULT_MAX_K = 5

# Persistence directories
LOGS_DIR = SERVER_DIR / "data" / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR = SERVER_DIR / "data" / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Available LLM models
AVAILABLE_MODELS = [
    {"value": "gpt-4o", "label": "GPT-4o"},
    {"value": "gpt-4o-mini", "label": "GPT-4o-mini"},
    {"value": "gpt-4.1", "label": "GPT-4.1"},
    {"value": "gpt-4.1-mini", "label": "GPT-4.1-mini"},
    {"value": "gpt-4.1-nano", "label": "GPT-4.1-nano"},
    {"value": "o3-mini", "label": "o3-mini"},
    {"value": "o4-mini", "label": "o4-mini"},
]

# Upload directory for custom datasets
UPLOAD_DIR = SERVER_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
