# CLAUDE.md

## Project overview

Automated ticket categorization system that classifies customer support tickets (Zendesk) and call transcripts (Fathom) into a multi-dimensional taxonomy. Each transcript is decomposed into individual issues, each classified by topic > subtopic, intent, nature, and sentiment.

The project is built in two phases. Phase 1 covers extraction (turning transcripts into classified issues). Phase 2 adds vector-based subtopic matching, the review queue, and taxonomy management.

## Tech stack

- **Core logic:** Python 3.11+
- **Web API:** FastAPI
- **Frontend:** React + Vite + Tailwind CSS + shadcn/ui
- **AI extraction:** Claude API (Anthropic) via `anthropic` Python SDK. Model per prompt defined in `shared/config.py`.
- **Relational store:** Redshift (schema: `taxonomy`, database: `dev`)
- **Vector search:** Weaviate (Phase 2 only)
- **Future orchestration:** Dagster (not used in current development)

## Configuration

Secrets and configuration are kept separate. Secrets go in `.env` (gitignored). Everything else lives in `shared/config.py` (version-controlled).

### .env — secrets only (gitignored)

```bash
ANTHROPIC_API_KEY=sk-ant-...
REDSHIFT_HOST=...
REDSHIFT_PORT=5439
REDSHIFT_DB=dev
REDSHIFT_USER=...
REDSHIFT_PASSWORD=...
# Phase 2 only:
WEAVIATE_URL=...
WEAVIATE_API_KEY=...
```

### shared/config.py — secrets + all configuration in one place

```python
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
MODEL_EXTRACTION = "claude-sonnet-4-20250514"        # Prompt 1: high volume, structured task
MODEL_ARBITRATION = "claude-sonnet-4-20250514"       # Prompt 2: simple decision (Phase 2)
MODEL_NEW_SUBTOPIC = "claude-opus-4-6-20250415"      # Prompt 3: needs reasoning depth (Phase 2)
MODEL_CENTROID_UPDATE = "claude-sonnet-4-20250514"   # Prompt 4: low stakes (Phase 2)

# === Pipeline defaults ===
EXTRACTION_BATCH_LIMIT = 10
EXTRACTION_MAX_RETRIES = 3
EXTRACTION_TEMPERATURE = 0.0
MAX_CONCURRENCY = 8
SLEEP_BETWEEN_BATCHES = 2  # seconds

# === Phase 2 thresholds ===
BAND_A_CEILING = 0.15       # Below: auto-assign subtopic (vector_direct)
BAND_B_CEILING = 0.35       # Below: send to Claude for arbitration (llm_confirmed)
CLUSTER_SIMILARITY = 0.85   # Minimum similarity to group unmatched issues
DUPLICATE_DETECTION_THRESHOLD = 0.15  # Flag subtopic pairs closer than this
```

All prompt modules import their model and settings from `shared/config.py`. To change a model or threshold, edit one file — nothing else needs to change.

### shared/prompts/fields.py — valid field values + validation

This file defines the valid values for each classification dimension. Prompt templates import these lists to inject into the prompt, and validation logic uses them to verify Claude's output.

```python
# Valid classification values — single source of truth
NATURES = ["Bug", "Feedback", "Question", "Complaint", "Feature Request", "Exploration"]
INTENTS = ["Support", "Action", "Insights", "Strategy", "Sales"]
SENTIMENTS = ["positive", "negative", "neutral", "frustrated"]

# Formatted strings for prompt injection
NATURES_PROMPT = "[" + ", ".join(NATURES) + "]"
INTENTS_PROMPT = "[" + ", ".join(INTENTS) + "]"
SENTIMENTS_PROMPT = "[" + ", ".join(SENTIMENTS) + "]"

# Validation helpers — used after Claude returns a response
def validate_nature(value: str) -> str | None:
    """Returns the canonical name if valid, None if not."""
    lookup = {n.lower().replace(" ", "_"): n for n in NATURES}
    return lookup.get(value.lower().replace(" ", "_"))

def validate_intent(value: str) -> str | None:
    lookup = {i.lower(): i for i in INTENTS}
    return lookup.get(value.lower())

def validate_sentiment(value: str) -> str | None:
    return value.lower() if value.lower() in SENTIMENTS else None
```

When Claude returns `"nature": "feature_request"`, the validation helper normalizes it to `"Feature Request"` and maps it to the correct FK in `taxonomy.natures`. If Claude returns an unexpected value, the validator returns `None` and the pipeline can log and handle the error.

## Running locally

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
# Vite dev server proxies /api/* to localhost:8000
```

Vite config must proxy `/api` to `http://localhost:8000` to avoid CORS issues.

---

## Phase 1 — Extraction

Phase 1 reads unprocessed transcripts from Redshift, sends them to Claude for decomposition into issues, and provides a UI to trigger the process, monitor progress, and browse results.

### What exists before Phase 1

The following Redshift tables are already created and populated:
- `taxonomy.natures` — 6 rows (Bug, Feedback, Question, Complaint, Feature Request, Exploration)
- `taxonomy.intents` — 5 rows (Support, Action, Insights, Strategy, Sales)
- `taxonomy.product_areas` — 8 rows (CMS, Live, Paywalls, Growth, CRM, Email Hub, Apps, Circle Plus)
- `taxonomy.transcripts` — pre-loaded from `circle.dbt_daniel.int_control_studio__conversations_unioned`. Contains `source_id`, `source_type`, `community_id`, `title`, `raw_text`, `source_url`. The `summary` column is NULL for all rows (filled by Phase 1).

The following tables exist but are empty:
- `taxonomy.classified_issues`
- `taxonomy.topics`
- `taxonomy.sub_topics`
- `taxonomy.emerging_candidates`
- `taxonomy.axioms`

### Phase 1 project structure

```
├── CLAUDE.md
├── .env
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SCHEMA.md
│   ├── WEAVIATE.md
│   └── PROMPTS.md
├── shared/
│   ├── __init__.py
│   ├── config.py                     # Secrets from .env + all configuration constants
│   ├── services/
│   │   ├── __init__.py
│   │   ├── anthropic.py              # Claude API client wrapper
│   │   └── redshift.py               # Redshift connection and query helpers
│   ├── prompts/
│   │   ├── __init__.py
│   │   ├── fields.py                 # Valid values for natures, intents, sentiments + validation helpers
│   │   └── extraction.py             # Extraction prompt template (Prompt 1), imports from fields.py
│   └── pipeline/
│       ├── __init__.py
│       └── extraction.py             # Step 1 logic: read transcripts, call Claude, persist results
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                   # FastAPI app entry point
│   │   └── routes/
│   │       ├── __init__.py
│   │       ├── pipeline.py           # POST /api/pipeline/extract
│   │       ├── status.py             # GET /api/status/overview
│   │       ├── transcripts.py        # GET /api/transcripts, GET /api/transcripts/{id}
│   │       └── issues.py             # GET /api/issues, GET /api/issues/{id}
│   └── requirements.txt
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── src/
│   │   ├── App.jsx                   # Layout with sidebar navigation
│   │   ├── api/
│   │   │   └── client.js             # Fetch wrapper for /api/* endpoints
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx         # Overview counts and recent activity
│   │   │   ├── Pipeline.jsx          # Trigger extraction, view progress
│   │   │   ├── Transcripts.jsx       # Browse transcripts
│   │   │   └── Issues.jsx            # Browse extracted issues
│   │   └── components/               # Shared UI components
│   └── index.html
└── tests/
    └── shared/
```

### Phase 1 pipeline logic (Step 1 — Extraction)

**Trigger:** `POST /api/pipeline/extract` with optional `limit` parameter (default: 10).

**Step 1.1 — Find unprocessed transcripts:**
Query `taxonomy.transcripts` where `summary IS NULL`. Apply the limit. These are transcripts loaded but not yet processed by Claude.

**Step 1.2 — Claude extraction:**
For each transcript, send `raw_text` to Claude (model and temperature from `shared/config.py`: `MODEL_EXTRACTION` and `EXTRACTION_TEMPERATURE`). The prompt asks for:
- `summary` — 2-3 sentence overview of the entire conversation
- `issues[]` — array of distinct issues, each with:
  - `segment_description` — normalized 1-2 sentence description in canonical register (NOT customer voice). Must read like a knowledge base topic definition. This is critical for Phase 2 vector matching quality.
  - `verbatim_excerpt` — raw transcript portions for audit trail
  - `nature` — one of: bug, feedback, question, complaint, feature_request, exploration
  - `intent` — one of: support, action, insights, strategy, sales
  - `sentiment` — one of: positive, negative, neutral, frustrated

See `docs/PROMPTS.md` for the full prompt template and expected JSON output shape.

**Step 1.3 — Persist results:**
- Update the transcript row: set `summary`
- For each issue: insert a row into `taxonomy.classified_issues` with:
  - `transcript_id` — FK to the transcript
  - `nature_id`, `intent_id` — mapped from string to FK by querying `taxonomy.natures` and `taxonomy.intents`
  - `segment_description`, `verbatim_excerpt`, `sentiment` — from Claude's output
  - `sub_topic_id` = NULL (Phase 2 fills this)
  - `confidence_score` = NULL (Phase 2 fills this)
  - `match_method` = NULL (Phase 2 fills this)
  - `classification_status` = 'pending'

**Error handling:**
- Wrap Claude calls in try/catch with 3 retries and exponential backoff
- If Claude returns invalid JSON, log the error and skip that transcript (don't crash the batch)
- The endpoint should process transcripts sequentially and return a summary: `{"transcripts_processed": N, "issues_created": M, "errors": E}`

### Phase 1 FastAPI endpoints

```
POST /api/pipeline/extract              # Trigger extraction
  Body: {"limit": 10}                   # Optional, defaults to 10
  Response: {"transcripts_processed": N, "issues_created": M, "errors": E}

GET  /api/status/overview               # Dashboard counts
  Response: {
    "transcripts_total": N,
    "transcripts_processed": N,          # WHERE summary IS NOT NULL
    "transcripts_unprocessed": N,        # WHERE summary IS NULL
    "issues_total": N,
    "issues_by_status": {"pending": N, "matched": N, "unmatched": N},
    "issues_by_nature": {"bug": N, "question": N, ...},
    "issues_by_intent": {"support": N, "strategy": N, ...}
  }

GET  /api/transcripts                   # List transcripts
  Query params: ?page=1&limit=20&status=processed|unprocessed&source_type=zendesk|fathom
  Response: paginated list with id, source_id, source_type, title, source_url, summary, issue_count, ingested_at

GET  /api/transcripts/{id}              # Transcript detail
  Response: transcript fields + array of linked classified_issues

GET  /api/issues                        # List issues
  Query params: ?page=1&limit=20&nature=bug&intent=support&sentiment=frustrated&status=pending
  Response: paginated list with id, segment_description, nature, intent, sentiment, classification_status, confidence_score, transcript_title

GET  /api/issues/{id}                   # Issue detail
  Response: all issue fields + parent transcript (title, source_url, summary)
```

### Phase 1 frontend pages

**Dashboard:**
- Cards showing: total transcripts, processed count, unprocessed count, total issues extracted
- Breakdown charts: issues by nature, issues by intent, issues by sentiment
- Recent activity: last 20 extracted issues with timestamp

**Pipeline:**
- Number input for batch limit (default 10)
- "Run extraction" button that calls `POST /api/pipeline/extract`
- While running: show a loading state with progress (disable the button)
- On completion: show results summary (transcripts processed, issues created, errors)
- Below: history of recent extraction runs (optional, can store in local state)

**Transcripts:**
- Table with columns: source_type, title, summary (truncated), issues count, source_url (link), ingested_at
- Filter by: processed/unprocessed, source_type
- Click a row to expand and see the full summary and linked issues

**Issues:**
- Table with columns: segment_description, nature (badge), intent (badge), sentiment (badge), status (badge), transcript title
- Filters: nature, intent, sentiment, classification_status
- Click a row to expand: shows full segment_description, verbatim_excerpt, and link to parent transcript
- Use colored badges for nature/intent/sentiment to make scanning easy

### Phase 1 UI design notes

- Use shadcn/ui components: Table, Badge, Button, Card, Input, Select, Dialog, Skeleton (loading states)
- Sidebar navigation with icons for each page
- Responsive but desktop-first (this is an internal admin tool)
- No auth required
- Color-code badges consistently:
  - Nature: bug=red, question=blue, feature_request=purple, complaint=orange, feedback=teal, exploration=gray
  - Intent: support=blue, action=green, insights=purple, strategy=amber, sales=teal
  - Sentiment: positive=green, negative=red, neutral=gray, frustrated=orange
  - Status: pending=gray, matched=green, unmatched=orange, under_review=blue

---

## Phase 2 — Classification, Review & Taxonomy Management

Phase 2 adds Weaviate for subtopic matching, the classification pipeline (Step 2), the review queue (Step 3), centroid maintenance (Step 4), and taxonomy browsing.

### What Phase 2 adds to the project structure

```
shared/
  ├── services/
  │   └── weaviate.py                 # NEW: Weaviate client wrapper
  ├── prompts/
  │   ├── product_areas.py            # NEW: Static product area definitions
  │   ├── validation.py               # NEW: Ambiguous match arbitration prompt (Prompt 2)
  │   ├── new_subtopic.py             # NEW: New subtopic proposal prompt (Prompt 3)
  │   └── centroid_update.py          # NEW: Centroid regeneration prompt (Prompt 4)
  ├── pipeline/
  │   ├── classification.py           # NEW: Step 2 logic
  │   ├── review.py                   # NEW: Step 3 logic
  │   └── maintenance.py              # NEW: Step 4 logic
  └── lib/
      ├── __init__.py                 # NEW
      ├── embedding.py                # NEW: Embedding generation
      ├── clustering.py               # NEW: Pairwise similarity and clustering
      └── thresholds.py               # NEW: Confidence band configuration

backend/
  └── app/routes/
      ├── candidates.py               # NEW: Review queue endpoints
      ├── taxonomy.py                 # NEW: Taxonomy browsing endpoints
      └── maintenance.py              # NEW: Centroid maintenance endpoints

frontend/
  └── src/pages/
      ├── Candidates.jsx              # NEW: Review queue page
      └── Taxonomy.jsx                # NEW: Taxonomy tree browser
```

### Phase 2 pipeline logic

**Step 2 — Classification** (`POST /api/pipeline/classify`):
- Read all `classified_issues` where `classification_status = 'pending'`
- For each issue, embed `segment_description` and query Weaviate for top 5 nearest subtopics
- Route through confidence bands:
  - Band A (distance < `BAND_A_CEILING`): auto-assign subtopic, `match_method = 'vector_direct'`
  - Band B (distance `BAND_A_CEILING`–`BAND_B_CEILING`): send candidates to Claude for arbitration (Prompt 2, `MODEL_ARBITRATION`), `match_method = 'llm_confirmed'`
  - Band C (distance > `BAND_B_CEILING`): propose new subtopic via Claude (Prompt 3, `MODEL_NEW_SUBTOPIC`), `match_method = 'new_subtopic'`
- Cluster unmatched issues (similarity > 0.85) into `taxonomy.emerging_candidates`

**Step 3 — Review & Approval** (via UI):
- `POST /api/candidates/{id}/approve` — create subtopic in Redshift + Weaviate, backfill linked issues
- `POST /api/candidates/{id}/reject` — merge linked issues into existing subtopic selected by reviewer
- After any approval, offer to re-run classification on remaining unmatched issues

**Step 4 — Centroid Maintenance** (`POST /api/maintenance/centroids`):
- For subtopics with significant new matches, regenerate `canonical_description` from accumulated issue descriptions (Prompt 4, `MODEL_CENTROID_UPDATE`)
- Update in Redshift and re-sync to Weaviate
- Run duplicate detection: flag subtopic pairs with distance < 0.15

### Phase 2 new endpoints

```
POST /api/pipeline/classify             # Trigger Step 2
GET  /api/candidates                    # List pending candidates
GET  /api/candidates/{id}               # Candidate detail with linked issues
POST /api/candidates/{id}/approve       # Approve (with optional edits in body)
POST /api/candidates/{id}/reject        # Reject (body: {"merge_into_subtopic_id": N})
GET  /api/taxonomy/tree                 # Full tree: product_area > topic > subtopic
GET  /api/taxonomy/topics               # List topics
GET  /api/taxonomy/subtopics/{id}       # Subtopic detail
PUT  /api/taxonomy/subtopics/{id}       # Edit subtopic (triggers Weaviate re-sync)
POST /api/maintenance/centroids         # Trigger centroid regeneration
POST /api/maintenance/duplicates        # Trigger duplicate detection
```

### Phase 2 new frontend pages

**Candidates** — review queue:
- Table of pending candidates: suggested topic, subtopic, canonical_description, cluster_size, avg_similarity
- Expand to see linked issues with their segment_descriptions and verbatim_excerpts
- Approve button (creates subtopic as-is)
- Approve with edits (inline edit name and description before creating)
- Reject button (opens modal to select existing subtopic to merge into)

**Taxonomy** — tree browser:
- Collapsible tree: product_area > topic > subtopic
- Each subtopic shows match_count and canonical_description
- Click to edit description (calls PUT endpoint, triggers Weaviate re-sync)

### Phase 2 model assignments per prompt

All models are defined in `shared/config.py`. Change them there, nowhere else.

| Prompt | Config constant | Default value | Reason |
|--------|----------------|---------------|--------|
| Prompt 1 — Extraction | `MODEL_EXTRACTION` | claude-sonnet-4-20250514 | High volume, structured task |
| Prompt 2 — Arbitration | `MODEL_ARBITRATION` | claude-sonnet-4-20250514 | Simple decision, short context |
| Prompt 3 — New subtopic | `MODEL_NEW_SUBTOPIC` | claude-opus-4-6-20250415 | Low volume, high impact, needs reasoning depth |
| Prompt 4 — Centroid update | `MODEL_CENTROID_UPDATE` | claude-sonnet-4-20250514 | Low stakes, runs periodically |

---

## Key conventions (both phases)

- **API keys** are loaded from `.env` via `shared/config.py`. Never hardcoded.
- **Models, thresholds, and batch limits** are defined in `shared/config.py`, not in `.env`. They are not secrets and should be version-controlled.
- **Redshift is the source of truth.** Weaviate (Phase 2) is a search index synced from Redshift.
- **segment_description must be in canonical register** — like a topic definition, not customer voice. This is critical for Phase 2 vector matching quality, so it must be right from Phase 1.
- **sub_topic_id on classified_issues is nullable** — Phase 1 leaves it NULL for all issues. Phase 2 fills it.
- **Product areas are a static constant** in `shared/prompts/product_areas.py` (Phase 2). Not queried from DB.
- **Transcripts are closed tickets only** — no re-processing. Deduplication by `source_id`.
- **shared/ has no dependency on FastAPI** — pure Python. FastAPI routes are thin wrappers that call shared functions.
- **Pipeline functions return result dicts** — the FastAPI route passes them through as JSON responses. No HTTP logic in shared/.

## Reference docs

- `docs/ARCHITECTURE.md` — full pipeline spec with examples and rationale
- `docs/SCHEMA.md` — Redshift table definitions and relationships
- `docs/WEAVIATE.md` — Weaviate collection schema and query patterns (Phase 2)
- `docs/PROMPTS.md` — Claude prompt templates and product area constants
