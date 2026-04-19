import os
from dotenv import load_dotenv

load_dotenv()

# === Secrets (from .env) ===
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
REDSHIFT_HOST = os.environ["REDSHIFT_HOST"]
REDSHIFT_PORT = int(os.environ.get("REDSHIFT_PORT", 5439))
REDSHIFT_DB = os.environ["REDSHIFT_DB"]
REDSHIFT_USER = os.environ["REDSHIFT_USER"]
REDSHIFT_PASSWORD = os.environ["REDSHIFT_PASSWORD"]
# Phase 2:
WEAVIATE_URL = os.environ.get("WEAVIATE_URL")
WEAVIATE_API_KEY = os.environ.get("WEAVIATE_API_KEY")

# === Model assignments per prompt ===
MODEL_EXTRACTION = "claude-sonnet-4-20250514"
MODEL_ARBITRATION = "claude-sonnet-4-20250514"
MODEL_NEW_SUBTOPIC = "claude-opus-4-7"
MODEL_CENTROID_UPDATE = "claude-sonnet-4-20250514"

# === Pipeline defaults ===
EXTRACTION_BATCH_LIMIT = 10
EXTRACTION_TEMPERATURE = 0.0
MAX_CONCURRENCY = 8           # ThreadPoolExecutor max_workers
SLEEP_BETWEEN_BATCHES = 2     # seconds (legacy, not used in parallel mode)

# === Parallel processing ===
CLAUDE_MAX_CONCURRENCY = 8    # Semaphore cap: max in-flight Claude calls
MAX_DB_CONNS = 10             # ThreadedConnectionPool maxconn (>= MAX_CONCURRENCY)
CLAUDE_MAX_RETRIES = 6        # retry attempts for Claude API errors
CLAUDE_BACKOFF_BASE = 1.0     # initial backoff seconds
CLAUDE_BACKOFF_CAP = 30.0     # max backoff seconds
DB_MAX_RETRIES = 5            # retry attempts for transient DB errors
DB_BACKOFF_BASE = 0.5
DB_BACKOFF_CAP = 10.0
PREFETCH = 50                 # rows pulled from DB per buffer refill

# === Model pricing (USD per million tokens) — verify at console.anthropic.com/settings/billing ===
MODEL_PRICING: dict[str, dict[str, float]] = {
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
    "claude-opus-4-6-20250415": {"input": 15.00, "output": 75.00},
    "claude-opus-4-7":          {"input": 15.00, "output": 75.00},
}

def compute_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        return None
    return round(
        (input_tokens / 1_000_000) * pricing["input"]
        + (output_tokens / 1_000_000) * pricing["output"],
        6,
    )

# === Phase 2 thresholds ===
BAND_A_CEILING = 0.15
BAND_B_CEILING = 0.35
CLUSTER_SIMILARITY = 0.85
DUPLICATE_DETECTION_THRESHOLD = 0.15

# === Phase 2 — Weaviate & RAG ===
WEAVIATE_VECTORIZER = "text2vec-weaviate"
MODEL_RAG_CHAT = "claude-sonnet-4-20250514"
RAG_CHAT_TEMPERATURE = 0.3
RAG_CHAT_MAX_TOKENS = 2048
RAG_ISSUE_RETRIEVAL_LIMIT = 20
RAG_TRANSCRIPT_RETRIEVAL_LIMIT = 10
RAG_RELEVANCE_THRESHOLD = 0.40
CLASSIFICATION_BATCH_LIMIT = 100
