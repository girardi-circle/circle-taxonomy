---
name: Taxonomy Phase 1 — Built
description: Phase 1 of the taxonomy project is complete; all backend and frontend files written.
type: project
---

Phase 1 build is complete as of 2026-04-17.

**Why:** User asked to build Phase 1 per CLAUDE.md spec.

**How to apply:** When discussing next steps, Phase 2 is the natural continuation (Weaviate vector search, classification pipeline, review queue, centroid maintenance).

### What was built

**Backend (Python/FastAPI):**
- `shared/config.py` — all config and secrets
- `shared/services/redshift.py` — psycopg2 connection helpers
- `shared/services/anthropic.py` — Claude API wrapper with retry logic
- `shared/prompts/fields.py` — valid values + validation helpers
- `shared/prompts/extraction.py` — Prompt 1 template builder
- `shared/pipeline/extraction.py` — full extraction pipeline (fetch unprocessed → Claude → persist)
- `backend/app/main.py` — FastAPI app with sys.path fix for shared/ resolution
- `backend/app/routes/{pipeline,status,transcripts,issues}.py` — all Phase 1 endpoints
- `backend/requirements.txt`

**Frontend (React/Vite/Tailwind):**
- `frontend/src/App.jsx` — sidebar nav + React Router layout
- `frontend/src/api/client.js` — fetch wrapper for all API calls
- `frontend/src/pages/{Dashboard,Pipeline,Transcripts,Issues}.jsx` — all 4 pages
- `frontend/src/components/ClassificationBadge.jsx` — colored badges for nature/intent/sentiment/status
- `frontend/src/components/ui/` — Button, Card, Input, Select, Skeleton, Table

### Key implementation notes
- Backend runs from `backend/` dir; `main.py` adds project root to sys.path so `shared.*` imports work
- Each transcript is processed in a single atomic transaction (summary + issues committed together)
- Invalid nature/intent values from Claude are skipped with a warning (don't abort the batch)
- Status endpoint includes `issues_by_sentiment` (added beyond spec for the Dashboard chart)
- Frontend build: `cd frontend && npm install && npm run dev`
- Backend start: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`
