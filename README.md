# Taxonomy Classifier

Automated ticket categorization system that classifies customer support tickets (Zendesk) and call transcripts (Fathom) into a multi-dimensional taxonomy using AI-powered extraction and vector-based matching.

## What it does

1. **Reads** customer support transcripts from Redshift
2. **Decomposes** each transcript into individual issues using Claude AI
3. **Classifies** each issue by topic > subtopic, intent, nature, and sentiment
4. **Matches** issues against existing subtopics using Weaviate vector search
5. **Proposes** new subtopics when no match exists, with human review before creation

A single support call might cover a bug report, a feature request, and a billing question — the system extracts and classifies each one independently.

## Classification dimensions

| Dimension | Values | Method |
|-----------|--------|--------|
| **Topic > Subtopic** | Dynamic, grows over time | Weaviate vector search |
| **Nature** | Bug, Feedback, Question, Complaint, Feature Request, Exploration | Claude AI extraction |
| **Intent** | Support, Action, Insights, Strategy, Sales | Claude AI extraction |
| **Sentiment** | positive, negative, neutral, frustrated | Claude AI extraction |

## Architecture

```
┌──────────────┐     ┌───────────┐     ┌──────────┐
│   Zendesk    │────▶│           │────▶│          │
│   Fathom     │     │  Claude   │     │ Redshift │
│  (transcripts)│     │   API     │     │          │
└──────────────┘     └───────────┘     └────┬─────┘
                                            │
                          ┌─────────────────┤
                          ▼                 ▼
                     ┌──────────┐    ┌────────────┐
                     │ Weaviate │    │  FastAPI +  │
                     │ (vectors)│    │  React UI   │
                     └──────────┘    └────────────┘
```

The system runs in two phases:

- **Phase 1 — Extraction:** Decomposes transcripts into classified issues with nature, intent, and sentiment. No vector search.
- **Phase 2 — Classification:** Adds Weaviate for subtopic matching, a review queue for new subtopic proposals, and taxonomy management.

## Tech stack

| Component | Technology |
|-----------|-----------|
| Core logic | Python 3.11+ |
| Web API | FastAPI |
| Frontend | React + Vite + Tailwind CSS + shadcn/ui |
| AI | Claude API (Anthropic) |
| Database | Redshift (schema: `taxonomy`) |
| Vector search | Weaviate (Phase 2) |
| Future orchestration | Dagster |

## Project structure

```
├── CLAUDE.md                         # AI assistant context (project spec)
├── .env                              # Secrets (gitignored)
├── .env.example                      # Template for required env vars
├── docs/
│   ├── ARCHITECTURE.md               # Full pipeline spec and rationale
│   ├── SCHEMA.md                     # Redshift table definitions
│   ├── WEAVIATE.md                   # Weaviate collection schema (Phase 2)
│   └── PROMPTS.md                    # Claude prompt templates
├── shared/                           # Core logic (no framework dependencies)
│   ├── config.py                     # Configuration: secrets, models, thresholds
│   ├── services/                     # External service clients
│   ├── prompts/                      # Prompt templates and field definitions
│   ├── pipeline/                     # Pipeline step implementations
│   └── lib/                          # Utilities (embedding, clustering)
├── backend/                          # FastAPI app
│   ├── app/
│   │   ├── main.py
│   │   └── routes/
│   └── requirements.txt
├── frontend/                         # React app
│   ├── src/
│   │   ├── pages/
│   │   └── components/
│   └── package.json
└── tests/
```

The `shared/` directory contains all business logic with no dependency on FastAPI or Dagster. Both entry points are thin wrappers that import from `shared/`.

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Access to Redshift with `taxonomy` schema created
- Anthropic API key

### Installation

```bash
# Clone the repo
git clone https://github.com/your-org/taxonomy-classifier.git
cd taxonomy-classifier

# Create .env from template
cp .env.example .env
# Edit .env with your credentials

# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### Running

```bash
# Terminal 1: Backend
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```

The frontend dev server proxies `/api/*` to the backend at `localhost:8000`.

Open `http://localhost:5173` to access the UI.

## Configuration

All configuration lives in `shared/config.py`:

- **Model assignments** — which Claude model to use for each prompt
- **Pipeline settings** — batch limits, retries, concurrency
- **Thresholds** — confidence bands for vector matching (Phase 2)

Secrets (API keys, database credentials) are loaded from `.env` and never committed to git.

## Database schema

The system uses 7 tables in the `taxonomy` schema on Redshift:

| Table | Purpose |
|-------|---------|
| `natures` | Bug, Feedback, Question, Complaint, Feature Request, Exploration |
| `intents` | Support, Action, Insights, Strategy, Sales |
| `product_areas` | CMS, Live, Paywalls, Growth, CRM, Email Hub, Apps, Circle Plus |
| `topics` | Top-level topic categories (controlled vocabulary) |
| `sub_topics` | Specific issue categories, synced to Weaviate |
| `transcripts` | Raw source records from Zendesk/Fathom |
| `classified_issues` | One row per issue extracted from a transcript |

See `docs/SCHEMA.md` for full table definitions.

## Documentation

| Document | Contents |
|----------|----------|
| `CLAUDE.md` | Project overview, phase definitions, conventions |
| `docs/ARCHITECTURE.md` | Pipeline spec with step-by-step logic |
| `docs/SCHEMA.md` | Redshift table definitions and query patterns |
| `docs/WEAVIATE.md` | Weaviate collection schema and query patterns |
| `docs/PROMPTS.md` | Claude prompt templates with expected I/O |

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Test against the dev Redshift schema (`dev.taxonomy`)
4. Open a PR

Keep `shared/` free of framework dependencies. Pipeline logic goes in `shared/pipeline/`, not in FastAPI routes or Dagster assets.
