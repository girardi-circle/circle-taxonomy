# SCHEMA.md

## Redshift Schema: `taxonomy`

All tables live in the `taxonomy` schema in the `dev` database. Redshift is the source of truth — Weaviate is a derived search index.

---

## Entity relationship overview

```
product_areas ──< topics ──< sub_topics ──< classified_issues >── natures
                                                    │           >── intents
                                                    │
                                              transcripts
                                                    │
                                         extraction_logs ──────< classified_issues (extraction_log_id)

classified_issues ──< classification_logs
classified_issues ──< issue_reprocess_logs

emerging_candidates ──> product_areas (suggested)
                    ──> classified_issues (via issue_ids)
```

---

## Dimension tables

### taxonomy.product_areas

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| name | VARCHAR(100) | NOT NULL, UNIQUE |
| description | VARCHAR(2000) | |
| slack_channel | VARCHAR(100) | |

Values: CMS, Live, Paywalls, Growth, CRM, Email Hub, Apps, Circle Plus.

### taxonomy.natures

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| name | VARCHAR(50) | NOT NULL, UNIQUE |
| description | VARCHAR(255) | |

Values: Bug, Feedback, Question, Complaint, Feature Request, Exploration, Cancellation.

### taxonomy.intents

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| name | VARCHAR(50) | NOT NULL, UNIQUE |
| description | VARCHAR(255) | |

Values: Support, Action, Insights, Strategy, Sales.

---

## Core tables

### taxonomy.topics

Top-level topic categories.

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| product_area_id | INT | FK → product_areas, **NULLABLE** |
| name | VARCHAR(255) | NOT NULL |
| description | VARCHAR(1000) | |
| created_at | TIMESTAMP | DEFAULT GETDATE() |
| is_active | BOOLEAN | DEFAULT TRUE |

### taxonomy.sub_topics

Specific issue categories under each topic. Vectorized in Weaviate `SubTopic` collection.

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| topic_id | INT | FK → topics, NOT NULL |
| name | VARCHAR(255) | NOT NULL |
| canonical_description | VARCHAR(2000) | Primary vector field in Weaviate |
| match_count | INT | DEFAULT 0 |
| created_at | TIMESTAMP | DEFAULT GETDATE() |
| is_active | BOOLEAN | DEFAULT TRUE |

### taxonomy.transcripts

One row per source record (Zendesk ticket, Fathom call).

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| source_id | VARCHAR(255) | NOT NULL, UNIQUE |
| source_type | VARCHAR(50) | NOT NULL — 'zendesk', 'fathom' |
| community_id | INT | NULLABLE |
| title | VARCHAR(255) | NULLABLE |
| raw_text | VARCHAR(65535) | Full transcript text |
| source_url | VARCHAR(255) | NULLABLE |
| summary | VARCHAR(2000) | NULL until Step 1 fills it |
| ingested_at | TIMESTAMP | DEFAULT GETDATE() |

**`summary IS NULL`** = unprocessed. The extraction pipeline queries on this condition.

### taxonomy.classified_issues

One row per distinct issue extracted from a transcript. Core analytical table.

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| transcript_id | INT | FK → transcripts, NOT NULL |
| extraction_log_id | INT | FK → extraction_logs, NULLABLE |
| sub_topic_id | INT | FK → sub_topics, **NULLABLE** |
| nature_id | INT | FK → natures, NOT NULL |
| intent_id | INT | FK → intents, NOT NULL |
| segment_description | VARCHAR(2000) | Canonical-register description. Used for Weaviate embedding. |
| verbatim_excerpt | VARCHAR(65535) | **JSON array string** — `["quote1", "quote2", ...]` |
| sentiment | VARCHAR(20) | positive, negative, neutral, frustrated |
| confidence_score | FLOAT | 1 - weaviate_distance. NULL until classified. |
| match_method | VARCHAR(20) | vector_direct, llm_confirmed, new_subtopic. NULL until classified. |
| classification_status | VARCHAR(20) | DEFAULT 'pending' |
| classified_at | TIMESTAMP | DEFAULT GETDATE() |

**Status lifecycle:** `pending` → `matched` / `unmatched` / `under_review`

**Important:** `verbatim_excerpt` is stored as a JSON array string. Parse with `JSON.parse()` in frontend, `json.loads()` in backend. Never treat as plain text.

### taxonomy.emerging_candidates

Review queue for proposed new subtopics. Also maintained in Weaviate `SubTopic` with `status="pending"`.

| Column | Type | Constraints |
|--------|------|-------------|
| id | INT | PK, IDENTITY |
| issue_ids | VARCHAR(2000) | Comma-separated classified_issue IDs |
| suggested_topic_name | VARCHAR(255) | |
| suggested_subtopic_name | VARCHAR(255) | |
| suggested_product_area_id | INT | FK → product_areas, NULLABLE |
| canonical_description | VARCHAR(2000) | |
| cluster_size | INT | |
| avg_similarity | FLOAT | |
| status | VARCHAR(20) | DEFAULT 'pending' — pending, approved, rejected |
| reviewed_by | VARCHAR(100) | |
| created_at | TIMESTAMP | DEFAULT GETDATE() |

**Important:** When a candidate is created, it is immediately inserted into Weaviate `SubTopic` with `status="pending"` and `candidate_id=<id>`. This allows subsequent issues in the same classification batch to find it semantically and link to it rather than creating a duplicate candidate.

---

## Audit / log tables

### taxonomy.extraction_logs

One row per transcript processed by the extraction pipeline.

| Column | Type |
|--------|------|
| id | INT PK IDENTITY |
| transcript_id | INT FK → transcripts |
| model | VARCHAR(100) |
| prompt_system | VARCHAR(2000) |
| prompt_user | VARCHAR(4000) — with `[transcript_raw_text]` placeholder |
| response_raw | VARCHAR(65535) |
| issues_created | INT |
| status | VARCHAR(20) — success, error |
| error_message | VARCHAR(2000) |
| input_tokens | INT |
| output_tokens | INT |
| cost_usd | FLOAT |
| executed_at | TIMESTAMP DEFAULT GETDATE() |

### taxonomy.classification_logs

One row per issue classification decision. Covers both automated pipeline decisions and manual review actions.

| Column | Type | Notes |
|--------|------|-------|
| id | INT PK IDENTITY | |
| issue_id | INT FK → classified_issues | |
| band | VARCHAR(10) | A, B, C, or **manual** (for review actions) |
| decision | VARCHAR(30) | matched, auto_created, unmatched, linked_to_candidate, rejected_to_C, rejected_to_pending, merged_to_candidate, merged_to_subtopic, error |
| matched_subtopic_id | INT | |
| matched_subtopic_name | VARCHAR(255) | |
| confidence_score | FLOAT | |
| weaviate_candidates | VARCHAR(4000) | JSON array of top candidates with distances |
| prompt_used | VARCHAR(65535) | Full prompt sent to Claude (Band B/C only) |
| claude_response | VARCHAR(4000) | Raw Claude JSON response |
| model_used | VARCHAR(100) | NULL for Band A and manual actions |
| input_tokens | INT | |
| output_tokens | INT | |
| cost_usd | FLOAT | |
| auto_create | BOOLEAN | |
| error_message | VARCHAR(2000) | |
| classified_at | TIMESTAMP DEFAULT GETDATE() | |

**`band='manual'`** is used for human review actions (approve/reject/merge) to distinguish from automated pipeline decisions.

### taxonomy.issue_reprocess_logs

One row per segment_description reprocessing operation.

| Column | Type |
|--------|------|
| id | INT PK IDENTITY |
| issue_id | INT FK → classified_issues |
| model | VARCHAR(100) |
| old_segment_description | VARCHAR(2000) |
| new_segment_description | VARCHAR(2000) |
| verbatim_excerpt | VARCHAR(65535) |
| input_tokens | INT |
| output_tokens | INT |
| cost_usd | FLOAT |
| reprocessed_at | TIMESTAMP DEFAULT GETDATE() |

---

## Unused tables (reserved for future phases)

- `taxonomy.axioms` — business rules engine (not yet used)
