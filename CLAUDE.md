# CLAUDE.md

## Project overview

Automated ticket categorization system that classifies customer support tickets (Zendesk) and call transcripts (Fathom) into a multi-dimensional taxonomy. Each transcript is decomposed into individual issues, each classified by topic > subtopic, intent, nature, and sentiment.

Built in phases:
- **Phase 1** — Extraction: transcripts → classified issues
- **Phase 2a** — Classification pipeline: Weaviate subtopic matching, Band A/B/C routing, review queue
- **Phase 2 governance** — Review Topics: taxonomy governance (merge, move, rename, deactivate) with soft-delete, `merged_into_id` lineage, centroid update after merge, and taxonomy_changes audit log
- **AI Review** — Review with AI: Weaviate similarity pre-computation + Claude proposes merges/moves/renames; sessions persisted to DB with apply/skip tracking
- **Phase 2b/2c** — Analytics + RAG chat (not yet built)

---

## Tech stack

- **Core logic:** Python 3.11+
- **Web API:** FastAPI + Uvicorn
- **Frontend:** React 18 + Vite + Tailwind CSS (shadcn/ui components)
- **AI:** Anthropic Claude via `anthropic` Python SDK
- **Relational store:** Redshift (`taxonomy` schema, `dev` database)
- **Vector search:** Weaviate Cloud (v4 client, `weaviate-client>=4.6.0`)
- **Future orchestration:** Dagster (not yet used)

---

## Configuration

Secrets in `.env` (gitignored). Everything else in `shared/config.py`.

### .env — secrets only

```bash
ANTHROPIC_API_KEY=sk-ant-...
REDSHIFT_HOST=...
REDSHIFT_PORT=5439
REDSHIFT_DB=dev
REDSHIFT_USER=...
REDSHIFT_PASSWORD=...
WEAVIATE_URL=...
WEAVIATE_API_KEY=...
```

### shared/config.py — all non-secret configuration

```python
# Models
MODEL_EXTRACTION    = "claude-sonnet-4-20250514"
MODEL_ARBITRATION   = "claude-sonnet-4-20250514"
MODEL_NEW_SUBTOPIC  = "claude-opus-4-7"
MODEL_CENTROID_UPDATE = "claude-sonnet-4-20250514"
MODEL_RAG_CHAT      = "claude-sonnet-4-20250514"

# Extraction pipeline
EXTRACTION_BATCH_LIMIT   = 10
EXTRACTION_TEMPERATURE   = 0.0
MAX_CONCURRENCY          = 8       # ThreadPoolExecutor workers
SLEEP_BETWEEN_BATCHES    = 2

# Parallel processing
CLAUDE_MAX_CONCURRENCY   = 8       # Semaphore cap for concurrent Claude calls
MAX_DB_CONNS             = 20      # ThreadedConnectionPool maxconn (shared by API + pipeline)
CLAUDE_MAX_RETRIES       = 6
CLAUDE_BACKOFF_BASE      = 1.0
CLAUDE_BACKOFF_CAP       = 30.0
DB_MAX_RETRIES           = 5
DB_BACKOFF_BASE          = 0.5
DB_BACKOFF_CAP           = 10.0
PREFETCH                 = 50

# Classification bands (Weaviate cosine distance)
BAND_A_CEILING           = 0.15   # auto-assign
BAND_B_CEILING           = 0.35   # Claude arbitration
CLUSTER_SIMILARITY       = 0.85
DUPLICATE_DETECTION_THRESHOLD = 0.15

# Weaviate
WEAVIATE_VECTORIZER      = "text2vec-weaviate"
CLASSIFICATION_BATCH_LIMIT = 100

# AI Review
AI_REVIEW_BATCH_SIZE            = 10    # topics/subtopics per Claude call
AI_REVIEW_SUBTOPIC_LIMIT        = 50    # max subtopics selectable per topic in UI
AI_REVIEW_TOPIC_REQUEST_LIMIT   = 200   # max topics per ai-review request
AI_REVIEW_SUBTOPIC_REQUEST_LIMIT= 200   # max subtopics per ai-review request
AI_REVIEW_PARALLEL_BATCHES      = 3     # max concurrent Claude batch calls
AI_REVIEW_WEAVIATE_NEIGHBORS    = 5     # neighbours per similarity search
AI_REVIEW_TOPICS_REF_LIMIT      = 200   # max topics in reference list (ordered by subtopic count desc)
AI_REVIEW_SUBTOPICS_REF_LIMIT   = 500   # max subtopics in reference list (ordered by match_count desc)

# RAG (Phase 2c — not yet built)
RAG_CHAT_TEMPERATURE         = 0.3
RAG_CHAT_MAX_TOKENS          = 2048
RAG_ISSUE_RETRIEVAL_LIMIT    = 20
RAG_TRANSCRIPT_RETRIEVAL_LIMIT = 10
RAG_RELEVANCE_THRESHOLD      = 0.40

# Pricing (USD per million tokens)
MODEL_PRICING = {
    "claude-sonnet-4-20250514": {"input": 3.00, "output": 15.00},
    "claude-opus-4-7":          {"input": 15.00, "output": 75.00},
}
```

---

## Running locally

```bash
# Backend (from project root/backend/)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

Vite proxies `/api/*` to `http://localhost:8000`.

---

## Project structure

```
├── shared/
│   ├── config.py                      # All config constants
│   ├── services/
│   │   ├── anthropic.py               # Claude client (thread-safe, semaphore, per-thread client)
│   │   ├── redshift.py                # psycopg2 helpers + ThreadedConnectionPool
│   │   └── weaviate.py                # Weaviate v4 client (all 3 collections)
│   ├── prompts/
│   │   ├── fields.py                  # NATURES, INTENTS, SENTIMENTS with descriptions
│   │   ├── extraction.py              # Prompt 1 — transcript → issues
│   │   ├── validation.py              # Prompt 2 — Band B arbitration (approved + pending)
│   │   ├── new_subtopic.py            # Prompt 3 — Band C new subtopic proposal
│   │   ├── centroid_update.py         # Prompt 4 — centroid regeneration
│   │   ├── reprocess.py               # Segment description reprocessing prompt
│   │   └── product_areas.py           # Static product area definitions
│   ├── pipeline/
│   │   ├── extraction.py              # Phase 1: parallel extraction (FIRST_COMPLETED)
│   │   ├── classification.py          # Phase 2: Band A/B/C routing + candidate creation
│   │   ├── review.py                  # Phase 2: approve/reject/merge candidates
│   │   ├── maintenance.py             # Phase 2: centroid update + duplicate detection
│   │   ├── vectorize.py               # Weaviate bulk sync from Redshift
│   │   └── reprocess.py               # Reprocess segment_descriptions via Claude
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py
│       └── routes/
│           ├── pipeline.py            # extract/stream, classify/stream, vectorize, log
│           ├── status.py              # overview counts
│           ├── transcripts.py         # list + detail
│           ├── issues.py              # list + detail + reprocess + reprocess-logs
│           ├── logs.py                # extraction audit log
│           ├── classification_logs.py # classification audit log
│           ├── candidates.py          # review queue (approve/reject/merge)
│           ├── taxonomy.py            # tree, topics, subtopics, uncategorized
│           ├── taxonomy_ai.py         # AI review sessions + suggestions
│           ├── review.py              # topic/subtopic merge, move, delete, issue reassignment
│           ├── maintenance.py         # centroids, duplicates
│           └── weaviate.py            # setup, migrate, sync, status
├── frontend/
│   └── src/
│       ├── App.jsx                    # Sidebar nav + routes
│       ├── api/client.js              # All API calls
│       ├── pages/
│       │   ├── Dashboard.jsx
│       │   ├── Pipeline.jsx           # Extraction with live SSE log
│       │   ├── Transcripts.jsx
│       │   ├── Issues.jsx             # With bulk reprocess + issue ID filter
│       │   ├── Logs.jsx               # Extraction audit log
│       │   ├── ClassificationLogs.jsx # Classification audit log
│       │   ├── taxonomy/
│       │   │   ├── ProcessTopics.jsx  # Classify + review queue
│       │   │   ├── ReviewTopics.jsx   # Governance: health, bulk ops, AI review
│       │   │   └── ViewTopics.jsx     # Browse taxonomy tree (read-only)
│       │   └── config/
│       │       ├── WeaviateSetup.jsx  # Collections status, migrate, sync issues/transcripts
│       │       └── Prompts.jsx        # View and edit all Claude prompts
│       └── components/
│           ├── ClassificationBadge.jsx
│           ├── StatTile.jsx               # Shared stat tile used by Logs, ClassificationLogs, WeaviateSetup
│           ├── MergeModal.jsx             # Topic/subtopic merge dialog
│           ├── ReassignModal.jsx          # Issue/subtopic reassignment dialog
│           └── ui/                    # button, card, input, select, skeleton, table, sheet
└── logs/
    └── pipeline.log                   # JSON-per-line event log (RotatingFileHandler)
```

---

## Redshift schema (taxonomy.*)

### Dimension tables (pre-populated)
| Table | Rows | Key columns |
|-------|------|-------------|
| `product_areas` | 8 | id, name, description |
| `natures` | 7 | id, name — Bug, Feedback, Question, Complaint, Feature Request, Exploration, Cancellation |
| `intents` | 5 | id, name — Support, Action, Insights, Strategy, Sales |

### Core tables
**`transcripts`** — one row per source ticket/call
- id, source_id (UNIQUE), source_type, community_id, title, raw_text, source_url, summary (NULL until extracted), ingested_at

**`topics`** — taxonomy level 1
- id, product_area_id (FK, nullable), name, description, is_active, created_at
- **`merged_into_id`** (INT, nullable) — set when soft-deleted via merge; preserves lineage

**`sub_topics`** — taxonomy level 2
- id, topic_id (FK), name, canonical_description, match_count, is_active, created_at
- **`merged_into_id`** (INT, nullable) — set when soft-deleted via merge; preserves lineage

**`classified_issues`** — one row per extracted issue
- id, transcript_id (FK), extraction_log_id (FK, nullable), sub_topic_id (FK, nullable), nature_id (FK), intent_id (FK)
- segment_description, verbatim_excerpt (JSON array string), sentiment
- confidence_score, match_method, classification_status (pending/matched/unmatched/under_review)
- classified_at

**`emerging_candidates`** — proposed new subtopics pending human review
- id, issue_ids (comma-separated), suggested_topic_name, suggested_subtopic_name
- suggested_product_area_id (FK), canonical_description, cluster_size, avg_similarity
- status (pending/approved/rejected), reviewed_by, created_at

### Audit / log tables
**`extraction_logs`** — one row per transcript extraction
- id, transcript_id (FK), model, prompt_system, prompt_user, response_raw
- issues_created, status, error_message, input_tokens, output_tokens, cost_usd
- **`triggered_by`** VARCHAR(50) DEFAULT `'ui'` — `'ui'` or `'dagster'` (Phase 3 Dagster integration)
- executed_at

**`classification_logs`** — one row per issue classification decision
- id, issue_id (FK), band (A/B/C/manual — VARCHAR(10)), decision
- matched_subtopic_id, matched_subtopic_name, confidence_score
- weaviate_candidates (JSON), prompt_used, claude_response
- model_used, input_tokens, output_tokens, cost_usd, auto_create, error_message
- **`triggered_by`** VARCHAR(50) DEFAULT `'ui'` — `'ui'` or `'dagster'`
- classified_at

**`issue_reprocess_logs`** — one row per segment_description reprocess
- id, issue_id (FK), model, old_segment_description, new_segment_description
- verbatim_excerpt, input_tokens, output_tokens, cost_usd, reprocessed_at

**`taxonomy_changes`** — structural taxonomy operations audit trail
- id, action_type (merge_topic/merge_subtopic/move_subtopic/rename_topic/rename_subtopic/deactivate_topic/deactivate_subtopic)
- entity_type (topic/subtopic), source_id, source_name, target_id, target_name, notes, performed_at

**`ai_review_sessions`** — one row per "Review with AI" run
- id, topic_ids (comma-separated), model, input_tokens, output_tokens, cost_usd, batches, created_at

**`ai_review_suggestions`** — one row per suggestion returned by Claude
- id, session_id (FK), suggestion_idx, suggestion_type, title, payload (full JSON), status (pending/applied/skipped), applied_at, skipped_at

---

## Weaviate collections

### SubTopic
Vectorized field: `canonical_description`. Used by the classification pipeline for semantic matching.

| Property | Type | Vectorized |
|----------|------|-----------|
| subtopic_id | INT | No — 0 for pending candidates |
| candidate_id | INT | No — 0 for approved subtopics |
| status | TEXT | No — `"approved"` or `"pending"` |
| topic_id | INT | No |
| product_area_id | INT | No |
| name | TEXT | No |
| canonical_description | TEXT | **Yes** |

**Important:** Pending emerging candidates are inserted here with `status="pending"` so subsequent issues in the same batch can find them (avoiding duplicate candidates). When a candidate is approved, its entry is promoted to `status="approved"`.

### ClassifiedIssue
Vectorized field: `segment_description`. Used by RAG chat (Phase 2c).

Properties: issue_id, transcript_id, sub_topic_id, topic_id, product_area_id, nature_id, intent_id, sentiment, classified_at, source_url, segment_description *(vectorized)*, verbatim_excerpt

### Transcript
Vectorized field: `raw_text`. Used by RAG chat for conversation-level search.

Properties: transcript_id, source_id, source_type, community_id, title, source_url, summary, raw_text *(vectorized)*

---

## Phase 1 — Extraction pipeline

### What it does
1. Fetch unprocessed transcripts (`summary IS NULL`) with optional filters
2. Send each to Claude (Prompt 1) — parallel via `ThreadPoolExecutor` + `FIRST_COMPLETED`
3. Parse response: summary + array of issues (segment_description, verbatim_excerpt[], nature, intent, sentiment)
4. Persist to Redshift (transcript summary + classified_issues rows)
5. Write `extraction_logs` row with tokens/cost
6. Emit SSE events for live UI log

### Endpoints
```
GET  /api/pipeline/extract/stream?limit=N&nature_names=...&source_types=...&auto_create=...
POST /api/pipeline/extract              # non-streaming version
GET  /api/pipeline/unprocessed-count
GET  /api/pipeline/log                  # read logs/pipeline.log
GET  /api/status/overview
GET  /api/transcripts
GET  /api/transcripts/{id}
GET  /api/issues
GET  /api/issues/{id}
POST /api/issues/reprocess              # bulk reprocess segment_descriptions
GET  /api/issues/reprocess-logs
GET  /api/logs                          # extraction audit log
GET  /api/logs/{id}
GET  /api/logs/models
```

### Key implementation notes
- `verbatim_excerpt` stored as JSON array string (`["quote1", "quote2"]`)
- `segment_description` must be in canonical register (not customer voice) — critical for vector matching
- Parallelism: `ThreadPoolExecutor(MAX_CONCURRENCY)` + `FIRST_COMPLETED` from `concurrent.futures`
- Claude client: one instance per thread via `threading.local()`
- Semaphore: `threading.Semaphore(CLAUDE_MAX_CONCURRENCY)` caps in-flight calls
- DB connections: `ThreadedConnectionPool` for parallel writes; per-call connections for routes
- Retry: `exp_backoff` + `sleep_with_jitter` on transient errors; 400s are permanent (not retried)
- `claude-opus-4-7` does not support `temperature` — skipped automatically

---

## Phase 2a — Classification pipeline

### Band routing
1. Embed issue's `segment_description`, query Weaviate `SubTopic` (includes both `approved` and `pending` entries)
2. **Band A** (distance < 0.15): auto-assign to approved subtopic OR link to existing pending candidate
3. **Band B** (0.15–0.35): Claude arbitration (Prompt 2) — candidates labelled as `[APPROVED]` or `[PROPOSED — pending review]`. Claude returns `type: "subtopic"|"candidate"` in response
4. **Band C** (> 0.35 or no match): Claude proposes new subtopic (Prompt 3). If `auto_create=True`: create topic/subtopic immediately. If `auto_create=False`: create `emerging_candidate` in Redshift AND insert into Weaviate SubTopic as `status="pending"` immediately (so the next issue in the same batch can find it)

Every decision writes a `classification_logs` row. Manual review actions (approve/reject/merge) write rows with `band='manual'`.

### Endpoints
```
GET  /api/pipeline/classify/stream?limit=N&auto_create=...&nature_names=...
GET  /api/taxonomy/tree
GET  /api/taxonomy/topics
GET  /api/taxonomy/topics/lookup?name=...
GET  /api/taxonomy/topics/{id}
GET  /api/taxonomy/subtopics/search?q=...
GET  /api/taxonomy/subtopics/{id}
GET  /api/taxonomy/subtopics/{id}/issues
PUT  /api/taxonomy/subtopics/{id}
GET  /api/taxonomy/uncategorized
GET  /api/candidates
GET  /api/candidates/{id}
POST /api/candidates/{id}/approve       # body: {topic_name?, subtopic_name?, canonical_description?}
POST /api/candidates/{id}/reject        # returns issues to pending status
POST /api/candidates/{id}/merge         # body: {type: "candidate"|"subtopic", target_id: int}
POST /api/maintenance/centroids
POST /api/maintenance/duplicates
GET  /api/classification-logs
GET  /api/classification-logs/{id}
```

### Review queue actions
All three actions are **fire-and-forget** — the UI removes the item immediately and shows a toast notification when the background request completes.

- **Approve**: creates subtopic in Redshift, promotes Weaviate entry from `pending` → `approved` (falls back to fresh insert if no Weaviate entry found — handles pre-migration candidates)
- **Reject**: returns all linked issues to `classification_status='pending'`, deletes Weaviate pending entry, logs `band='manual', decision='rejected_to_pending'`
- **Merge into candidate**: appends issue_ids to target candidate, deletes source Weaviate entry, logs `merged_to_candidate`
- **Merge into subtopic**: assigns issues to approved subtopic, deletes source Weaviate entry, logs `merged_to_subtopic`

### Weaviate setup / migration
Before first classification run:
1. `POST /api/weaviate/setup` — creates all 3 collections
2. `POST /api/weaviate/migrate/subtopic-status` — adds `status` + `candidate_id` to SubTopic schema, backfills existing objects with `status="approved"`
3. `POST /api/weaviate/sync/issues` — bulk load ClassifiedIssue collection
4. `POST /api/weaviate/sync/transcripts` — bulk load Transcript collection

SubTopic is populated dynamically as candidates are created and approved — no initial bulk load needed.

---

## Prompts

### Prompt 1 — Extraction (`shared/prompts/extraction.py`)
- **Model:** `MODEL_EXTRACTION`, temperature 0, max_tokens 4096
- **Input:** raw transcript text
- **Output:** `{summary, issues: [{segment_description, verbatim_excerpt[], nature, intent, sentiment}]}`
- **Key instruction:** segment_description must be in canonical register (system as subject, present tense, general class of problem). verbatim_excerpt is an array of strings.
- **Format:** raw JSON, no markdown fences. Both the prompt and a code fallback (`_strip_fences`) handle the case where Claude wraps in ```json blocks.

### Prompt 2 — Arbitration (`shared/prompts/validation.py`)
- **Model:** `MODEL_ARBITRATION`, temperature 0, max_tokens 256
- **Input:** issue description + candidates (labelled as `[APPROVED SUBTOPIC]` or `[PROPOSED — pending review]`)
- **Output:** `{matched: true, type: "subtopic", subtopic_id: N}` or `{matched: true, type: "candidate", candidate_id: N}` or `{matched: false}`

### Prompt 3 — New subtopic (`shared/prompts/new_subtopic.py`)
- **Model:** `MODEL_NEW_SUBTOPIC` (claude-opus-4-7), no temperature, max_tokens 512
- **Input:** issue description + existing topics list + `PRODUCT_AREAS_PROMPT_BLOCK`
- **Output:** `{existing_topic, topic_id, topic_name, topic_description, product_area, suggested_subtopic_name, canonical_description, rationale}`

### Prompt 4 — Centroid update (`shared/prompts/centroid_update.py`)
- **Model:** `MODEL_CENTROID_UPDATE`, temperature 0.2, max_tokens 512
- **Input:** subtopic name + current description + matched issue descriptions
- **Output:** `{canonical_description, changes_summary}`
- **Automatic trigger:** runs via `_run_centroid_for_subtopic()` after every `merge_subtopic` and `merge_topic` operation (unless `run_centroid=False`). Requires ≥ 3 matched issues to run.

### Prompt 5 — Segment description reprocess (`shared/prompts/reprocess.py`)
- **Model:** `MODEL_EXTRACTION`, temperature 0, max_tokens 512
- **Input:** verbatim_excerpt (raw customer quotes)
- **Output:** `{segment_description}`

### Prompt 6 — Taxonomy AI Review (`shared/prompts/taxonomy_review.py`)
- **Model:** `MODEL_NEW_SUBTOPIC` (claude-opus-4-7), no temperature, max_tokens 16000
- **Two independent review modes in a single prompt:**
  - **Topic-level** (`topic_ids`): topics evaluated as units against all other topics → only `merge_topics`, `rename_topic`
  - **Subtopic-level** (`subtopic_ids`): subtopics evaluated in full detail → only `merge_subtopics`, `move_subtopic`, `rename_subtopic`
- **Input:** `topics_for_unit_review` (name + product area + subtopic name list) + `subtopics_for_detail_review` (canonical description + examples + Weaviate similarity pairs < 0.25) + `all_topics_reference` (top 200 by subtopic count) + `all_subtopics_reference` (top 500 by match_count, both with PA context)
- **`restrict_to_pa`:** when true, reference lists are filtered to the product area(s) of the selected items — prevents cross-PA merge suggestions
- **No-change is valid:** prompt explicitly states changes are not mandatory; items left unchanged go to `looks_good` with rationale
- **Output:** `{suggestions: [{type, title, rationale, ...ids, proposed_name, proposed_description}], looks_good: [{type, topic_id/subtopic_id, name, rationale}]}`
- **Suggestion details enriched with PA context:** `merge_topics` includes `topic_product_areas`; `merge_subtopics` includes `subtopic_contexts`; all types show `PA > Topic > Subtopic` paths in the UI
- **Auto-batching:** `AI_REVIEW_BATCH_SIZE=10` items per list per batch, `AI_REVIEW_PARALLEL_BATCHES=3` concurrent Claude calls; results aggregated across batches
- **Sessions:** results saved to `ai_review_sessions` + `ai_review_suggestions`; apply/skip tracked per suggestion
- **Bulk apply:** conflict detection (merge+move on same entity, survivor=source, move-dest-merged, rename-deleted) → resolution UI → grouped parallel execution (renames → moves → merges) → centroid run for applied merges only (targeted by `suggestion_indices`)

### Prompt override system (`shared/prompts/store.py`)
All 6 prompts are defined as defaults in `store.py`. Overrides are saved to `shared/prompts/overrides.json` (gitignored). At runtime, `get_system()` and `get_user_template()` check for overrides first. The Configuration → Prompts UI page lets users edit any prompt and save/reset overrides.

---

## Frontend — sidebar structure and pages

```
Dashboard
──────────────────
Pipeline
  Pipeline           # Extraction with live SSE log, filters, stop button
  Transcripts        # Browse with expand to see raw_text + issues
  Issues             # Browse with bulk reprocess + reprocess history; filter by Issue ID
──────────────────
Taxonomy
  Process Topics     # Run classification + review queue (approve/merge/reject)
  Review Topics      # Governance: health per PA, filters, bulk ops, AI review with conflict detection
  View Topics        # Browse product areas > topics > subtopics > issues (read-only)
──────────────────
Audit Logs
  Extraction Log     # extraction_logs with filters (incl. triggered_by), tokens, cost, prompt/response
  Classification Log # classification_logs with band/decision/source/issue ID filters
  Taxonomy Log       # taxonomy_changes — merge/move/rename/deactivate history
──────────────────
Configuration
  Weaviate Setup     # Collections status, initialize, migrate schema, sync issues/transcripts
  Prompts            # View and edit all Claude prompts with model info; overrides saved to overrides.json
```

### Key UI conventions
- **SSE streaming:** extraction and classification use `EventSource` for live log display
- **Fire-and-forget actions:** approve/reject/merge in the review queue remove items immediately, fire API in background, show toast on completion — no spinners blocking the UI
- **CSS hide vs unmount:** expandable components (SubtopicCandidate, TopicGroup, SubtopicDetail) use `everExpanded` + `className="hidden"` to preserve state across collapse/re-expand, avoiding redundant fetches
- **Toast notifications:** fixed bottom-right, auto-dismiss after 4 seconds
- **Parallel data loading:** review queue fetches all topic infos in parallel (`Promise.all`) before rendering so badges appear with the list, not after

---

## Review Topics — Taxonomy Governance (built)

The Review Topics page is purpose-built for cleaning up auto-created topics: editing names, merging duplicates, reorganizing subtopics, and reassigning issues. Lives at `frontend/src/pages/taxonomy/ReviewTopics.jsx`.

### Top section — taxonomy health indicators
- Total topics count | Total subtopics count
- Topics with only 1 subtopic (candidates for merging): count + warning badge
- Subtopics with fewer than 3 issues (potentially too narrow): count + warning badge
- Orphaned subtopics (topic was deleted but subtopic remains): count + warning badge

### Main section — dual-panel layout

Left panel shows the full topic list. Right panel shows the detail/action area for whatever is selected.

**Left panel — topic list:**
- Each topic row shows: name, product area badge, subtopic count, issue count
- Sortable by: name, subtopic count, issue count, created date
- Filter by: product area
- Checkbox selection for bulk operations (multi-select topics for merge)
- Click a topic to select it → right panel shows topic detail
- Expand a topic to see its subtopics listed below
- Click a subtopic → right panel switches to subtopic detail

**Right panel — topic detail (when a topic is selected):**
- Editable fields:
  - Topic name (inline text input)
  - Topic description (textarea)
  - Product area (dropdown selector)
- Save button — updates Redshift, re-syncs Weaviate for all child subtopics
- Action buttons:
  - **Merge topic** — opens modal (`MergeModal.jsx`): select target topic from dropdown. All subtopics under this topic move to the target. This topic is deleted. All linked Weaviate `SubTopic` and `ClassifiedIssue` records are updated.
  - **Delete topic** — only enabled when topic has 0 subtopics. Confirmation dialog.
- Below: list of subtopics under this topic (compact view with name + issue count)

**Right panel — subtopic detail (when a subtopic is selected):**
- Editable fields:
  - Subtopic name (inline text input)
  - Canonical description (textarea — triggers Weaviate re-vectorization on save)
- Save button — updates Redshift + re-syncs Weaviate
- Action buttons:
  - **Move to another topic** — dropdown to select target topic. Updates `topic_id` FK in Redshift, updates `topic_id` and `product_area_id` on the Weaviate `SubTopic` record and all linked `ClassifiedIssue` records.
  - **Merge into another subtopic** — opens modal (`MergeModal.jsx`):
    - Search/select target subtopic
    - Preview: "This will move N issues to [target subtopic] and delete [this subtopic]"
    - Option to broaden the target's canonical_description (checkbox + suggested new description)
    - Confirm → reassign all issues, combine match counts, delete this subtopic from Redshift + Weaviate, update all `ClassifiedIssue` records in Weaviate
  - **Delete subtopic** — only enabled when subtopic has 0 matched issues. Confirmation dialog.
- **Issues table** (below actions):
  - All issues matched to this subtopic
  - Columns: segment_description, nature badge, intent badge, sentiment badge
  - Each issue has a **reassign** button (↗ icon) — opens `ReassignModal.jsx` to pick a different subtopic
  - Checkbox selection for bulk reassignment — select multiple issues, then "Move selected to..." dropdown

**Bulk operations toolbar** (sticky, appears when checkboxes are selected):
- Contextual actions based on selection type:
  - **Topics only:** Merge into…, Delete N, Review with AI
  - **Subtopics only:** Merge into…, Move to topic…, Delete N, Review with AI
  - **Mixed:** Delete N, Review with AI
- **"Within Product Area only"** option on Review with AI — when all selected items belong to one PA, shows confirmation dialog before firing; restricts Claude's reference lists to that PA only
- **Select dropdown** on the select-all checkbox: "Select all topics", "Select all subtopics", "Select all (topics + subtopics)" — all capped at `AI_REVIEW_TOPIC_REQUEST_LIMIT` / `AI_REVIEW_SUBTOPIC_REQUEST_LIMIT`
- **Health metric filter toggles** below the health table: 0 subtopics, 1 subtopic, 1 issue, Few issues, No issues
- **Screen lock during AI review and bulk operations:** health banner, filter toggles, and topic checkboxes are disabled while a review is processing or bulk action is running

### Review Topics endpoints

```
# Topic management
PUT  /api/taxonomy/topics/{id}          # Edit topic name, description, product_area_id
POST /api/taxonomy/topics/{id}/merge    # Merge topic into another
  Body: {"target_topic_id": N}          # Moves all subtopics to target, deletes this topic
DELETE /api/taxonomy/topics/{id}        # Delete topic (must have 0 subtopics)

# Subtopic management
POST /api/taxonomy/subtopics/{id}/move  # Move subtopic to another topic
  Body: {"target_topic_id": N}
POST /api/taxonomy/subtopics/{id}/merge # Merge subtopic into another
  Body: {"target_subtopic_id": N, "broaden_description": true}
DELETE /api/taxonomy/subtopics/{id}     # Delete subtopic (must have 0 matched issues)

# Issue reassignment
POST /api/issues/{id}/reassign          # Move a single issue to a different subtopic
  Body: {"target_subtopic_id": N}
POST /api/issues/bulk-reassign          # Move multiple issues at once
  Body: {"issue_ids": [1, 2, 3], "target_subtopic_id": N}

# Taxonomy health
GET  /api/taxonomy/health               # Taxonomy quality indicators
  Response: {
    "total_topics": N,
    "total_subtopics": N,
    "topics_with_one_subtopic": N,
    "subtopics_with_few_issues": N,
    "orphaned_subtopics": N
  }
```

### What merge/move/reassign operations do under the hood

**All operations use soft-delete — no hard DELETE.** Source records are deactivated with `is_active = FALSE` and `merged_into_id = <target>` so lineage is preserved and operations are reversible. Every action writes to `taxonomy.taxonomy_changes`.

**Merge topic A into topic B:**
1. Move all subtopics: `UPDATE taxonomy.sub_topics SET topic_id = B WHERE topic_id = A`
2. Update Weaviate SubTopic + ClassifiedIssue for all moved subtopics
3. Soft-delete: `UPDATE taxonomy.topics SET is_active = FALSE, merged_into_id = B WHERE id = A`
4. Write to `taxonomy_changes`: `action_type='merge_topic'`
5. Optionally run centroid update on each surviving subtopic (`run_centroid=True` by default)

**Move subtopic from topic A to topic B:**
1. `UPDATE taxonomy.sub_topics SET topic_id = B WHERE id = subtopic_id`
2. Update Weaviate SubTopic + ClassifiedIssue with new topic_id/product_area_id
3. Write to `taxonomy_changes`: `action_type='move_subtopic'`

**Merge subtopic A into subtopic B:**
1. Reassign all issues from A to B
2. Update Weaviate ClassifiedIssue for each issue
3. Soft-delete A: `UPDATE taxonomy.sub_topics SET is_active = FALSE, merged_into_id = B WHERE id = A`
4. Delete A from Weaviate SubTopic
5. Write to `taxonomy_changes`: `action_type='merge_subtopic'`
6. **Automatically** run centroid update on B (Prompt 4) unless `run_centroid=False`

**Reassign issue from subtopic A to subtopic B:**
1. Update classified_issue + Weaviate ClassifiedIssue
2. Adjust match_counts on A and B
3. Write to `classification_logs` with `band='manual'`, `decision='issue_reassigned'`

### AI Review sessions

`POST /api/taxonomy/ai-review` body: `{topic_ids: [...], subtopic_ids: [...], restrict_to_pa: bool}` — topic_ids or subtopic_ids or both.
- `topic_ids` → topic-unit review (merge/rename topic suggestions only)
- `subtopic_ids` → subtopic detail review (merge/move/rename subtopic suggestions only)
- `restrict_to_pa` → when true, reference lists filtered to the PA(s) of selected items

Results persisted to `ai_review_sessions` + `ai_review_suggestions`. Endpoints:
- `POST /api/taxonomy/ai-reviews/{id}/suggestions/{idx}/apply?run_centroid=bool`
- `POST /api/taxonomy/ai-reviews/{id}/suggestions/{idx}/skip`
- `POST /api/taxonomy/ai-reviews/{id}/dismiss` — skips all pending
- `POST /api/taxonomy/ai-reviews/{id}/run-centroids` body: `{suggestion_indices: [...]}` — runs centroid for specific applied merges only (avoids re-running previous session merges)

**Bulk apply flow:** conflict detection → resolution UI → grouped parallel execution (renames → moves → merges) → single targeted centroid run for this run's merges only.

The Review Topics page checks for incomplete sessions on load and shows a warning banner if any exist.

---

## Phase 2b — Analytics dashboard (not yet built)

**Purpose:** Let users explore classified data through filtered aggregations on the Explore page. Pure Redshift queries, no AI.

## Phase 2c — Conversational RAG chat (not yet built)

**Purpose:** Chat sidebar on the Explore page. Queries Weaviate `ClassifiedIssue` and `Transcript` collections with active filters, retrieves relevant context, streams Claude responses with source attribution.

See `docs/ARCHITECTURE.md` and `docs/PROMPTS.md` for full specs on Phase 2b and 2c.

---

## Key conventions

- **API keys** from `.env` via `shared/config.py`. Never hardcoded.
- **Models and thresholds** in `shared/config.py`. Change one file.
- **Redshift is source of truth.** Weaviate is a derived search index.
- **shared/ has no FastAPI dependency.** Routes are thin wrappers.
- **Pipeline functions return dicts.** Routes pass them through as JSON.
- **segment_description in canonical register** — system as subject, present tense, general class of problem. Critical for vector matching quality.
- **verbatim_excerpt is a JSON array string** — parse with `parseVerbatim()` in frontend, `_serialize_verbatim()` in backend.
- **classification_logs band='manual'** — used for human review actions (approve/reject/merge) to distinguish from automated pipeline decisions.
- **Weaviate SubTopic dual-status** — pending candidates live in the same collection as approved subtopics. Query always returns both; routing logic uses the `status` field to decide the action.

## Reference docs

- `docs/ARCHITECTURE.md` — original pipeline spec
- `docs/SCHEMA.md` — Redshift table definitions
- `docs/WEAVIATE.md` — Weaviate collection patterns (v3 style — actual code uses v4)
- `docs/PROMPTS.md` — original prompt templates
- `docs/PARALLELISM_GUIDE.md` — parallelism implementation reference
