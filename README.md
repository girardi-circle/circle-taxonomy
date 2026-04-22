# Taxonomy Classifier

Automated ticket categorization system that classifies customer support tickets (Zendesk) and call transcripts (Fathom) into a multi-dimensional taxonomy using AI-powered extraction and Weaviate vector-based matching.

A single support call might cover a bug, a feature request, and a billing question — the system extracts and classifies each independently.

---

## What it does

### Phase 1 — Extraction
Each transcript is sent to Claude (Prompt 1), which decomposes it into individual issues. For every issue, Claude produces:
- `segment_description` — a canonical-register description of the problem (system as subject, present tense, general class of problem)
- `verbatim_excerpt` — raw quotes from the customer
- `nature` — Bug, Feedback, Question, Complaint, Feature Request, Exploration, or Cancellation
- `intent` — Support, Action, Insights, Strategy, or Sales
- `sentiment` — positive, negative, neutral, or frustrated

Extraction runs in parallel across transcripts using `ThreadPoolExecutor` with 8 workers.

### Phase 2a — Classification
Each extracted issue is matched against the existing subtopic taxonomy via Weaviate vector search. The match distance determines routing:

| Band | Similarity | Action |
|------|-----------|--------|
| **A** | > 85% | Auto-assign to existing subtopic |
| **B** | 65–85% | Claude arbitration (Prompt 2) chooses between candidates |
| **C** | < 65% | Claude proposes a new subtopic name (Prompt 3) |

Band C issues enter a **review queue** where a human can approve (creating a new subtopic), merge into an existing one, or reject. Every classification decision is logged to `taxonomy.classification_logs`.

### Phase 2 — Taxonomy Governance
The **Review Topics** page provides full governance over the taxonomy:
- **Health indicators** — topics with 0 or 1 subtopic, subtopics with 0 or 1 issue, filterable by product area
- **Bulk operations** — merge, move, or delete multiple topics or subtopics at once
- **Per-item editing** — rename topics/subtopics, reassign issues, merge or move individual items
- **Centroid update** — after merges, Claude (Prompt 4) regenerates the `canonical_description` of the surviving subtopic based on all matched issues
- **Taxonomy log** — every structural change (merge/move/rename/deactivate) is audited in `taxonomy.taxonomy_changes`

### AI Review
The **Review with AI** feature runs a full taxonomy analysis session:
- Select topics (for topic-unit review) and/or subtopics (for subtopic-detail review)
- Optional scope: "Within Product Area only" restricts Claude's reference lists to the same product area, preventing cross-PA suggestions
- Claude (Prompt 6, Opus) proposes merges, moves, and renames — or explicitly states when no change is needed (with rationale)
- Suggestions display full `PA > Topic > Subtopic` context so cross-area suggestions are immediately visible
- **Bulk apply** with conflict detection: overlapping suggestions are flagged and resolved before execution; applies run in parallel grouped by type (renames → moves → merges → centroids)
- Sessions are persisted so incomplete reviews can be resumed

### Segment Description Reprocessing
Issues with poor `segment_description` quality can be bulk-selected in the **Issues** page and reprocessed — Claude (Prompt 5) rewrites the description from the original verbatim quotes, and the change is logged in `issue_reprocess_logs`.

---

## Classification dimensions

| Dimension | Values | Method |
|-----------|--------|--------|
| **Topic > Subtopic** | Dynamic, grows via review queue | Weaviate vector search |
| **Nature** | Bug, Feedback, Question, Complaint, Feature Request, Exploration, Cancellation | Claude AI |
| **Intent** | Support, Action, Insights, Strategy, Sales | Claude AI |
| **Sentiment** | positive, negative, neutral, frustrated | Claude AI |

---

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
  → Band A (>85%): auto-assign
  → Band B (65–85%): Claude arbitration
  → Band C (<65%): emerging_candidate (review queue)
  → taxonomy.classification_logs (audit)
        │
        ▼
  Review queue (UI)
  Approve / Merge / Reject
  → taxonomy.sub_topics + Weaviate
        │
        ▼
  Taxonomy Governance (UI)
  Merge / Move / Rename / Delete / AI Review
  → taxonomy.taxonomy_changes (audit)
  → Centroid updates via Claude
```

---

## Tech stack

| Component | Technology |
|-----------|-----------|
| Core logic | Python 3.11+ |
| Web API | FastAPI + Uvicorn |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| AI | Claude API (Anthropic) — Sonnet 4 + Opus 4 |
| Database | Redshift (`taxonomy` schema) |
| Vector search | Weaviate Cloud (v4 client) |

---

## Project structure

```
├── CLAUDE.md                         # Living project reference — conventions, decisions, API specs
├── docs/
│   ├── ARCHITECTURE.md               # Pipeline spec and band routing logic
│   ├── SCHEMA.md                     # All Redshift table definitions
│   ├── PROMPTS.md                    # All 6 Claude prompt templates with input/output specs
│   ├── WEAVIATE.md                   # Weaviate collections and dual-status pattern
│   ├── PARALLELISM_GUIDE.md          # ThreadPoolExecutor + semaphore reference
│   └── create_tables.sql             # Full Redshift DDL with SORTKEY/DISTKEY/DISTSTYLE
├── shared/                           # Core logic — no FastAPI dependency
│   ├── config.py                     # All non-secret configuration constants
│   ├── services/
│   │   ├── anthropic.py              # Thread-safe Claude client with semaphore + retry
│   │   ├── redshift.py               # psycopg2 helpers + ThreadedConnectionPool
│   │   └── weaviate.py               # Weaviate v4 client (SubTopic, ClassifiedIssue, Transcript)
│   ├── prompts/                      # Prompt templates (extraction, validation, new_subtopic, etc.)
│   └── pipeline/                     # extraction, classification, review, maintenance, reprocess
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       └── routes/                   # pipeline, taxonomy, taxonomy_ai, candidates, logs, weaviate, etc.
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx                   # Sidebar nav + routes
│       ├── api/client.js             # All API calls
│       ├── pages/                    # Dashboard, Pipeline, Issues, Taxonomy, Config, Logs
│       └── components/               # Shared UI components
└── logs/
    └── pipeline.log                  # JSON-per-line event log (gitignored)
```

---

## Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Redshift** cluster with a `taxonomy` schema (run `docs/create_tables.sql` to create all tables)
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- **Weaviate Cloud** instance — [console.weaviate.cloud](https://console.weaviate.cloud) (free tier works)

---

## Installation

### 1. Clone and configure environment

```bash
git clone <repo-url>
cd taxonomy

cp .env.example .env
```

Edit `.env` and fill in all values:

```bash
ANTHROPIC_API_KEY=sk-ant-...

REDSHIFT_HOST=your-cluster.region.redshift.amazonaws.com
REDSHIFT_PORT=5439
REDSHIFT_DB=dev
REDSHIFT_USER=your_user
REDSHIFT_PASSWORD=your_password

WEAVIATE_URL=https://your-cluster.weaviate.cloud
WEAVIATE_API_KEY=your-weaviate-api-key
```

### 2. Create the database tables

Connect to your Redshift cluster and run:

```sql
-- Creates all 14 tables with correct SORTKEY / DISTKEY / DISTSTYLE
\i docs/create_tables.sql
```

Or paste the contents of `docs/create_tables.sql` into your SQL client. The script is idempotent-safe — it uses `IF NOT EXISTS` where supported.

### 3. Install backend dependencies

```bash
cd backend
pip install -r requirements.txt
```

> **Tip:** Use a virtual environment:
> ```bash
> python3 -m venv .venv && source .venv/bin/activate
> pip install -r requirements.txt
> ```

### 4. Install frontend dependencies

```bash
cd frontend
npm install
```

---

## Running locally

Open two terminal windows:

**Terminal 1 — Backend**
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser. The Vite dev server proxies all `/api/*` requests to `localhost:8000`.

---

## First-time Weaviate setup

Before running the classification pipeline, initialize the Weaviate collections from the UI:

1. Go to **Configuration → Weaviate Setup**
2. Click **Initialize collections** — creates the `SubTopic`, `ClassifiedIssue`, and `Transcript` collections
3. Click **Migrate SubTopic schema** — adds the `status` and `candidate_id` fields required by the dual-status pattern
4. Click **Sync issues** — loads existing classified issues into the `ClassifiedIssue` collection
5. Click **Sync transcripts** — loads transcripts into the `Transcript` collection

> Collections only need to be initialized once. The SubTopic collection is populated dynamically as issues are classified and candidates are approved — no initial bulk load is needed for it.

---

## Usage walkthrough

### Ingesting transcripts
Transcripts must be inserted directly into `taxonomy.transcripts` (via your data pipeline or manually). The `summary` column must be `NULL` for a transcript to be picked up by the extraction pipeline.

### Running the pipeline
1. **Pipeline → Pipeline** — click **Run extraction** to process unprocessed transcripts. Issues are extracted and stored.
2. **Taxonomy → Process Topics** — click **Run classification** to classify extracted issues against the subtopic taxonomy.
3. Review the **candidate queue** on the same page — approve, merge, or reject proposed new subtopics.

### Governing the taxonomy
- **Taxonomy → Review Topics** — merge duplicate topics/subtopics, move misplaced subtopics, bulk-delete empty topics, run AI review sessions
- **Taxonomy → View Topics** — read-only browse of the full taxonomy tree

### Monitoring
- **Audit Logs → Extraction Log** — per-transcript cost, tokens, prompt, and response
- **Audit Logs → Classification Log** — per-issue band routing, Weaviate candidates, Claude decisions
- **Audit Logs → Taxonomy Log** — every structural taxonomy change

---

## Database schema

The system uses 14 tables in the `taxonomy` schema. Full DDL with Redshift-optimised sort/dist keys is in `docs/create_tables.sql`.

| Table | Purpose |
|-------|---------|
| `product_areas` | 8 product teams (CMS, Live, Paywalls, …) |
| `natures` | 7 issue types |
| `intents` | 5 intent categories |
| `topics` | Top-level topic categories (soft-delete with `merged_into_id`) |
| `sub_topics` | Specific subtopics, vectorized in Weaviate (soft-delete with `merged_into_id`) |
| `transcripts` | Source records from Zendesk/Fathom |
| `classified_issues` | One row per extracted issue |
| `emerging_candidates` | Proposed subtopics pending review |
| `extraction_logs` | Per-transcript extraction audit (`triggered_by`: ui/dagster) |
| `classification_logs` | Per-issue classification decisions + manual actions (`triggered_by`: ui/dagster) |
| `issue_reprocess_logs` | Segment description reprocess history |
| `taxonomy_changes` | Structural taxonomy operations (merge/move/rename/deactivate) |
| `ai_review_sessions` | Persisted AI review runs with cost + batch info |
| `ai_review_suggestions` | Individual Claude suggestions with apply/skip/applied status |

---

## Documentation

| Document | Contents |
|----------|----------|
| `CLAUDE.md` | Full project reference — conventions, API specs, key decisions |
| `docs/ARCHITECTURE.md` | Pipeline steps, band routing, parallelism, AI review flow |
| `docs/SCHEMA.md` | All table definitions including audit tables |
| `docs/PROMPTS.md` | All 6 Claude prompts with input/output specs |
| `docs/WEAVIATE.md` | Collection schemas and dual-status pattern |
| `docs/create_tables.sql` | Full Redshift DDL ready to run |
| `docs/PARALLELISM_GUIDE.md` | ThreadPoolExecutor + semaphore implementation reference |
