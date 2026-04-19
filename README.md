# Taxonomy Classifier

Automated ticket categorization system that classifies customer support tickets (Zendesk) and call transcripts (Fathom) into a multi-dimensional taxonomy using AI-powered extraction and Weaviate vector-based matching.

## What it does

1. **Extracts** — decomposes each transcript into individual issues using Claude AI, with summary, nature, intent, sentiment, and verbatim customer quotes
2. **Classifies** — matches each issue against existing subtopics via Weaviate vector search (Band A: auto-assign, Band B: Claude arbitration, Band C: propose new subtopic)
3. **Reviews** — human review queue to approve, merge, or reject proposed subtopics before they enter the taxonomy
4. **Maintains** — centroid updates, duplicate detection, and segment description reprocessing to keep the taxonomy clean over time

A single support call might cover a bug, a feature request, and a billing question — the system extracts and classifies each independently.

## Classification dimensions

| Dimension | Values | Method |
|-----------|--------|--------|
| **Topic > Subtopic** | Dynamic, grows via review queue | Weaviate vector search |
| **Nature** | Bug, Feedback, Question, Complaint, Feature Request, Exploration, Cancellation | Claude AI |
| **Intent** | Support, Action, Insights, Strategy, Sales | Claude AI |
| **Sentiment** | positive, negative, neutral, frustrated | Claude AI |

## Architecture

```
Transcripts (Zendesk / Fathom)
        │
        ▼
  Phase 1: Extraction
  Claude API (parallel, 8 workers)
  → taxonomy.transcripts (summary)
  → taxonomy.classified_issues (issues)
  → taxonomy.extraction_logs (audit)
        │
        ▼
  Phase 2a: Classification
  Weaviate SubTopic query (approved + pending)
  → Band A: auto-assign
  → Band B: Claude arbitration
  → Band C: emerging_candidate (review queue)
  → taxonomy.classification_logs (audit)
        │
        ▼
  Review queue (UI)
  Approve / Merge / Reject
  → taxonomy.sub_topics + Weaviate
```

## Tech stack

| Component | Technology |
|-----------|-----------|
| Core logic | Python 3.11+ |
| Web API | FastAPI + Uvicorn |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| AI | Claude API (Anthropic) — Sonnet + Opus |
| Database | Redshift (`taxonomy` schema) |
| Vector search | Weaviate Cloud (v4 client) |

## Project structure

```
├── CLAUDE.md                         # Living project reference
├── CLAUDE_NEW.md                     # Updated reference (review before replacing)
├── docs/
│   ├── ARCHITECTURE.md               # Pipeline spec and band routing logic
│   ├── SCHEMA.md                     # All Redshift table definitions
│   ├── WEAVIATE.md                   # Weaviate collections, dual-status pattern
│   ├── PROMPTS.md                    # All 5 Claude prompt templates
│   └── PARALLELISM_GUIDE.md          # Parallel processing implementation reference
├── shared/                           # Core logic — no framework dependencies
│   ├── config.py                     # Models, thresholds, parallelism settings
│   ├── services/                     # anthropic.py, redshift.py, weaviate.py
│   ├── prompts/                      # Prompt templates + field definitions
│   ├── pipeline/                     # extraction, classification, review, maintenance
│   └── lib/                          # clustering utilities
├── backend/
│   ├── app/main.py
│   ├── app/routes/                   # pipeline, taxonomy, candidates, weaviate, logs
│   └── requirements.txt
├── frontend/
│   ├── src/pages/                    # Dashboard, Pipeline, Issues, Taxonomy, Weaviate
│   └── package.json
├── backup/                           # Timestamped doc backups
└── logs/                             # pipeline.log (gitignored)
```

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Redshift with `taxonomy` schema
- Anthropic API key
- Weaviate Cloud instance (URL + API key)

### Installation

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, REDSHIFT_*, WEAVIATE_URL, WEAVIATE_API_KEY

# Backend
cd backend && pip install -r requirements.txt

# Frontend
cd frontend && npm install
```

### Running

```bash
# Terminal 1
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to `localhost:8000`.

### First-time Weaviate setup

Before running classification, initialize Weaviate from the UI (**Weaviate → Setup**):

1. Click **Initialize collections** — creates SubTopic, ClassifiedIssue, Transcript
2. Click **Migrate SubTopic schema** — adds `status` + `candidate_id` fields
3. Go to **Sync Issues** and sync all classified issues
4. Go to **Sync Transcripts** and sync all transcripts

## Database schema

The system uses 11 tables in the `taxonomy` schema:

| Table | Purpose |
|-------|---------|
| `product_areas` | 8 product teams (CMS, Live, Paywalls, …) |
| `natures` | 7 issue types including Cancellation |
| `intents` | 5 intent categories |
| `topics` | Top-level topic categories |
| `sub_topics` | Specific subtopics, vectorized in Weaviate |
| `transcripts` | Source records from Zendesk/Fathom |
| `classified_issues` | One row per extracted issue |
| `emerging_candidates` | Proposed subtopics pending review |
| `extraction_logs` | Per-transcript extraction audit trail |
| `classification_logs` | Per-issue classification decisions + manual actions |
| `issue_reprocess_logs` | Segment description reprocess history |

See `docs/SCHEMA.md` for full definitions.

## Documentation

| Document | Contents |
|----------|----------|
| `CLAUDE.md` | Project overview, conventions, key decisions |
| `docs/ARCHITECTURE.md` | Pipeline steps, band routing, parallelism |
| `docs/SCHEMA.md` | All table definitions including audit tables |
| `docs/WEAVIATE.md` | Collection schemas, dual-status pattern, setup |
| `docs/PROMPTS.md` | All 5 Claude prompts with input/output specs |
| `docs/PARALLELISM_GUIDE.md` | ThreadPoolExecutor + semaphore reference |
