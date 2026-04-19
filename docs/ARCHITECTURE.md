# ARCHITECTURE.md

## Automated Ticket Categorization System

---

## 1. Overview

Classifies customer support tickets (Zendesk) and call transcripts (Fathom) into a multi-dimensional taxonomy: **topic > subtopic**, **intent**, **nature**, and **sentiment**.

### Core principles

- **One transcript, many issues.** Each transcript is decomposed into individual issues before classifying.
- **Vector search for subject matching, LLM for linguistic classification.** Weaviate handles semantic subtopic matching. Claude handles intent, nature, sentiment, and new subtopic proposals.
- **Human-in-the-loop for taxonomy growth.** New subtopics go through a review queue before entering the taxonomy. Auto-create mode skips the queue.
- **Pending candidates live in Weaviate.** When a candidate is created in the review queue, it is immediately inserted into Weaviate `SubTopic` with `status="pending"`. Subsequent issues in the same batch can match against it, preventing duplicate candidates.

---

## 2. Data model

### Taxonomy dimensions

- **Topic > Subtopic** — hierarchical subject classification. Managed via Weaviate + Redshift.
- **Intent** — why the customer is raising this (Support, Action, Insights, Strategy, Sales).
- **Nature** — type of issue (Bug, Feedback, Question, Complaint, Feature Request, Exploration, Cancellation).
- **Sentiment** — how the customer feels (positive, negative, neutral, frustrated).

### Product areas

8 product areas: CMS, Live, Paywalls, Growth, CRM, Email Hub, Apps, Circle Plus. Defined as a static constant in `shared/prompts/product_areas.py`. Each topic optionally belongs to a product area.

---

## 3. Pipeline architecture

```
Step 1: Extraction          Step 2: Classification
(parallel, per batch)       (per pending issue)
     │                           │
     ▼                           ▼
 Claude API                 Weaviate SubTopic query
 (Prompt 1)                 (approved + pending candidates)
     │                           │
     ▼                      Band A / B / C routing
 transcripts.summary             │
 classified_issues               ├─ Band A: auto-assign subtopic or link to pending candidate
 extraction_logs                 ├─ Band B: Claude arbitration (Prompt 2)
                                 └─ Band C: Claude proposes new subtopic (Prompt 3)
                                            │
                                    auto_create=ON ──→ create subtopic immediately
                                    auto_create=OFF ──→ emerging_candidate + Weaviate pending entry
                                            │
                                     Step 3: Review queue
                                     (Approve / Merge / Reject)
                                            │
                                     Step 4: Centroid maintenance
                                     (Prompt 4, periodic)
```

---

## 4. Step 1 — Extraction

**Trigger:** `GET /api/pipeline/extract/stream?limit=N&...` (SSE)

### Parallelism

`ThreadPoolExecutor(MAX_CONCURRENCY)` + `FIRST_COMPLETED` pattern. Each worker:
1. Builds the extraction prompt
2. Acquires the Claude semaphore (`threading.Semaphore(CLAUDE_MAX_CONCURRENCY)`)
3. Calls Claude (Prompt 1)
4. Writes to Redshift via `ThreadedConnectionPool`
5. Returns collected events

Events are yielded as soon as each worker completes — no blocking on the slowest worker.

### What Claude returns

```json
{
  "summary": "2-3 sentence transcript overview",
  "issues": [
    {
      "segment_description": "System-as-subject canonical description...",
      "verbatim_excerpt": ["exact quote 1", "exact quote 2"],
      "nature": "bug",
      "intent": "support",
      "sentiment": "frustrated"
    }
  ]
}
```

`verbatim_excerpt` is an **array of strings**. Stored as a JSON string in Redshift. Parse with `json.loads()` before use.

### Audit trail

Every extraction writes an `extraction_logs` row with the loggable prompt (raw_text replaced with `[transcript_raw_text]`), Claude response, token counts, and cost.

---

## 5. Step 2 — Classification

**Trigger:** `GET /api/pipeline/classify/stream?limit=N&auto_create=...&...` (SSE)

### Band routing

The single Weaviate SubTopic query returns both approved subtopics and pending candidates (distinguished by `status` field). The top result determines the band:

#### Band A (distance < 0.15)
- If `status="approved"`: assign issue to that subtopic (`match_method='vector_direct'`)
- If `status="pending"`: link issue to existing emerging_candidate (append to `issue_ids`, increment `cluster_size`)

#### Band B (0.15 – 0.35)
Send all Band B candidates (approved + pending, clearly labelled) to Claude (Prompt 2).
- Claude returns `{"matched": true, "type": "subtopic", "subtopic_id": N}` → assign to approved subtopic
- Claude returns `{"matched": true, "type": "candidate", "candidate_id": N}` → link to pending candidate
- Claude returns `{"matched": false}` → fall through to Band C

#### Band C (> 0.35 or no match)
Call Claude (Prompt 3) for a new subtopic proposal.

- **auto_create=True**: create topic + subtopic in Redshift immediately, assign issue (`match_method='new_subtopic'`), insert approved subtopic into Weaviate
- **auto_create=False**: insert `emerging_candidate` into Redshift AND Weaviate SubTopic with `status="pending"`, `candidate_id=<new_id>`. Mark issue `under_review`.

Every decision writes a `classification_logs` row with the band, decision, Weaviate candidates JSON, and Claude prompt/response where applicable.

---

## 6. Step 3 — Review queue

**UI:** Process Topics page → Review queue section.

Candidates are grouped by `suggested_topic_name` in the UI. Each topic group shows existing approved subtopics for context.

### Actions (all fire-and-forget — UI removes item immediately, API runs in background)

#### Approve
1. Create topic (if new) and subtopic in Redshift
2. Promote Weaviate entry: `status="approved"`, `subtopic_id=<new_id>` (fallback: insert fresh if no Weaviate entry — handles pre-migration candidates)
3. Assign all linked issues: `sub_topic_id`, `classification_status='matched'`
4. Sync updated issues to Weaviate ClassifiedIssue

#### Reject (returns issues to queue)
1. Reset all linked issues to `classification_status='pending'`, `sub_topic_id=NULL`
2. Delete Weaviate pending entry
3. Write `classification_logs` rows: `band='manual'`, `decision='rejected_to_pending'`

#### Merge into another candidate
1. Append source `issue_ids` to target candidate
2. Delete source Weaviate pending entry
3. Write `classification_logs` rows: `decision='merged_to_candidate'`

#### Merge into approved subtopic
1. Assign all linked issues to target subtopic
2. Delete source Weaviate pending entry
3. Write `classification_logs` rows: `decision='merged_to_subtopic'`

---

## 7. Step 4 — Centroid maintenance

**Trigger:** `POST /api/maintenance/centroids`

For each subtopic with significant new matches: collect all matched `segment_descriptions`, send to Claude (Prompt 4) to regenerate `canonical_description`, update Redshift + Weaviate.

Also: `POST /api/maintenance/duplicates` — find subtopic pairs with vector distance < `DUPLICATE_DETECTION_THRESHOLD`.

---

## 8. Segment description quality

`segment_description` quality directly determines classification accuracy. Rules enforced in both Prompt 1 and the reprocess prompt:

- **System as subject** — never "customer", "user", "member", pronouns
- **Present tense declarative** — "Invitation emails fail to send..."
- **General class, not specific incident** — applies to any future occurrence
- **Specific enough to distinguish** — enough detail to separate from related subtopics

Issues with poor descriptions can be bulk-reprocessed from the Issues page (select + "Reprocess segment description"), which calls Prompt 5 and logs changes in `issue_reprocess_logs`.

---

## 9. Threshold values

| Threshold | Value | What it controls |
|-----------|-------|-----------------|
| BAND_A_CEILING | 0.15 | Auto-assign without Claude |
| BAND_B_CEILING | 0.35 | Claude arbitration range |
| CLUSTER_SIMILARITY | 0.85 | Legacy clustering threshold |
| DUPLICATE_DETECTION_THRESHOLD | 0.15 | Flag similar subtopic pairs |

All thresholds are in `shared/config.py`. Calibrate based on `match_method` distribution over time.

---

## 10. Parallelism and concurrency

| Primitive | Value | Purpose |
|-----------|-------|---------|
| `ThreadPoolExecutor(MAX_CONCURRENCY)` | 8 workers | Parallel transcript/issue processing |
| `threading.Semaphore(CLAUDE_MAX_CONCURRENCY)` | 8 | Cap concurrent in-flight Claude calls |
| `ThreadedConnectionPool(MAX_DB_CONNS)` | 10 conns | Reuse Redshift connections across threads |
| `threading.local()` | per-thread | One Anthropic client per thread (no shared state) |

Exponential backoff with jitter on both Claude errors (`CLAUDE_BACKOFF_BASE/CAP`) and Redshift transient errors (`DB_BACKOFF_BASE/CAP`). 400-range HTTP errors from Claude are treated as permanent (not retried).

---

## 11. Security

- API keys in `.env`, loaded via `shared/config.py`. Never committed.
- Weaviate stores only subtopic metadata and issue descriptions — no PII beyond what's in segment_descriptions.
- All Claude and Weaviate calls are server-side only.
- No authentication on dev UI (internal tool).
