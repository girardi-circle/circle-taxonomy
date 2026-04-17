# SCHEMA.md

## Redshift Schema: `taxonomy`

This document describes the Redshift tables, their purpose, relationships, and important constraints.

---

## Entity relationship overview

```
product_areas ──< topics ──< sub_topics ──< classified_issues >── natures
                                                    │           >── intents
                                                    │
                                              transcripts

emerging_candidates ──> product_areas (suggested)
                    ──> classified_issues (via issue_ids)
```

---

## Table: taxonomy.product_areas

Stable dimension. Defines the product/engineering teams that own topic categories.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| name | VARCHAR(100) | NOT NULL, UNIQUE | e.g. "CMS", "Live", "Paywalls", "Growth" |
| description | VARCHAR(2000) | | Team scope and ownership definition |
| slack_channel | VARCHAR(100) | | Slack channel for alerts and routing |

Expected row count: 8. Rarely changes. Current values: CMS, Live, Paywalls, Growth, CRM, Email Hub, Apps, Circle Plus.

**Note:** Product area definitions (with sub-bullet coverage areas) are also maintained as a static Python constant in `shared/prompts/product_areas.py` for prompt injection. The database and the constant must be kept in sync manually.

---

## Table: taxonomy.natures

Stable dimension. Classifies the type of issue.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| name | VARCHAR(50) | NOT NULL, UNIQUE | Bug, Feedback, Question, Complaint, Feature Request, Exploration |
| description | VARCHAR(255) | | Human-readable definition of this nature |

Expected row count: 6. Fixed vocabulary.

---

## Table: taxonomy.intents

Stable dimension. Classifies why the customer is raising the issue.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| name | VARCHAR(50) | NOT NULL, UNIQUE | Support, Action, Insights, Strategy, Sales |
| description | VARCHAR(255) | | Human-readable definition of this intent |

Expected row count: 5. Fixed vocabulary.

---

## Table: taxonomy.topics

Top-level topic categories. Controlled vocabulary — grows slowly, ideally curated by humans.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| product_area_id | INT | FK → product_areas, **NULLABLE** | Nullable to allow topics before product areas are fully defined |
| name | VARCHAR(255) | NOT NULL | e.g. "Website Builder", "Events", "Paywall Management" |
| description | VARCHAR(1000) | | What this topic category covers |
| created_at | TIMESTAMP | DEFAULT GETDATE() | |
| is_active | BOOLEAN | DEFAULT TRUE | Soft delete flag |

Expected row count: 15-30. Product area is enforced here and inherited by all child subtopics.

---

## Table: taxonomy.sub_topics

Specific issue categories under each topic. This is the entity that Weaviate indexes for vector matching.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| topic_id | INT | FK → topics, NOT NULL | Parent topic |
| name | VARCHAR(255) | NOT NULL | e.g. "Drag-and-drop component render failure" |
| canonical_description | VARCHAR(2000) | | **Primary vector field.** Normalized description synced to Weaviate. Must be written in canonical register, not customer voice. |
| match_count | INT | DEFAULT 0 | Number of classified issues matched to this subtopic. Incremented by Step 2. |
| created_at | TIMESTAMP | DEFAULT GETDATE() | |
| is_active | BOOLEAN | DEFAULT TRUE | Soft delete flag |

Expected row count: 50-500+, growing as new issues are discovered. `canonical_description` evolves over time via Step 4 (centroid maintenance).

---

## Table: taxonomy.transcripts

One row per source record. Stores the raw input and transcript-level AI extractions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| source_id | VARCHAR(255) | NOT NULL, UNIQUE | Source system ID (Zendesk ticket ID, Fathom call ID) |
| source_type | VARCHAR(50) | NOT NULL | 'zendesk', 'fathom', 'slack' |
| community_id | INT | NULLABLE | Circle community ID associated with this transcript |
| title | VARCHAR(255) | NULLABLE | Ticket subject or call title |
| raw_text | VARCHAR(65535) | | Full raw transcript text |
| source_url | VARCHAR(255) | NULLABLE | Link back to the source (Zendesk ticket URL, Fathom recording) |
| summary | VARCHAR(2000) | | Claude-generated overview of the entire conversation. NULL until Step 1 processes it. |
| ingested_at | TIMESTAMP | DEFAULT GETDATE() | |

**Important:** This table holds no classification data. Classification lives on `classified_issues`. One transcript produces one or more classified issues.

**Deduplication:** Uses `source_id` with a UNIQUE constraint. Since we only process closed tickets, there are no updates to handle — each ticket is ingested once.

**Pre-populated:** This table is loaded from `circle.dbt_daniel.int_control_studio__conversations_unioned` before the pipeline runs. The `summary` column is NULL until Step 1 fills it.

---

## Table: taxonomy.classified_issues

One row per distinct issue extracted from a transcript. This is the core analytical table.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| transcript_id | INT | FK → transcripts, NOT NULL | Source transcript |
| sub_topic_id | INT | FK → sub_topics, **NULLABLE** | NULL when pending classification or awaiting new subtopic approval |
| nature_id | INT | FK → natures, NOT NULL | Bug, Question, etc. — set during extraction |
| intent_id | INT | FK → intents, NOT NULL | Support, Strategy, etc. — set during extraction |
| segment_description | VARCHAR(2000) | | Normalized issue description. Used for vector embedding and Weaviate matching. Written in canonical register. |
| verbatim_excerpt | VARCHAR(65535) | | Raw transcript portion for this issue. Audit trail only — not used for matching. |
| sentiment | VARCHAR(20) | | Per-issue sentiment: positive, negative, neutral, frustrated |
| confidence_score | FLOAT | | 1 - weaviate_distance. NULL until classified. |
| match_method | VARCHAR(20) | | 'vector_direct', 'llm_confirmed', 'new_subtopic'. NULL until classified. |
| classification_status | VARCHAR(20) | DEFAULT 'pending' | 'pending', 'matched', 'unmatched', 'under_review' |
| classified_at | TIMESTAMP | DEFAULT GETDATE() | |

**Status lifecycle:**
- `pending` — created by Step 1, waiting for Step 2 to classify
- `matched` — Step 2 found a subtopic match (direct or LLM-confirmed)
- `unmatched` — Step 2 found no match, emerging candidate created
- `under_review` — linked to an emerging candidate being reviewed

**Query patterns:**
- Step 2 reads: `WHERE classification_status = 'pending'`
- Reclassification reads: `WHERE classification_status IN ('pending', 'unmatched')`
- Analytics: `GROUP BY sub_topic_id, nature_id, intent_id` for any dimensional breakdown

**Navigating to product area from an issue:**
```sql
SELECT ci.*, t.name AS topic, st.name AS subtopic, pa.name AS product_area
FROM taxonomy.classified_issues ci
JOIN taxonomy.sub_topics st ON ci.sub_topic_id = st.id
JOIN taxonomy.topics t ON st.topic_id = t.id
LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id;
```

---

## Table: taxonomy.axioms

Business rules stored as data. Not used in initial rollout — reserved for future routing and alerting automation.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| rule_name | VARCHAR(100) | NOT NULL | Human-readable rule identifier |
| description | VARCHAR(500) | | What this rule does |
| condition_json | VARCHAR(2000) | NOT NULL | JSON condition. e.g. `{"nature":"Bug","intent":"Support"}` |
| action_json | VARCHAR(2000) | NOT NULL | JSON action. e.g. `{"priority":"high","alert_slack":"#channel"}` |
| is_active | BOOLEAN | DEFAULT TRUE | Enable/disable without deleting |

---

## Table: taxonomy.emerging_candidates

Review queue for proposed new subtopics. Populated by Step 2 when issues don't match existing subtopics.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INT | PK, IDENTITY | |
| issue_ids | VARCHAR(2000) | | Comma-separated classified_issue IDs that triggered this candidate |
| suggested_topic_name | VARCHAR(255) | | Claude's proposed topic (may be existing or new) |
| suggested_subtopic_name | VARCHAR(255) | | Claude's proposed subtopic name |
| suggested_product_area_id | INT | FK → product_areas, NULLABLE | Inherited from existing topic if applicable |
| canonical_description | VARCHAR(2000) | | Proposed description — ready to sync to Weaviate if approved |
| cluster_size | INT | | Number of similar unmatched issues grouped into this candidate |
| avg_similarity | FLOAT | | Average pairwise similarity within the cluster |
| status | VARCHAR(20) | DEFAULT 'pending' | pending, approved, rejected |
| reviewed_by | VARCHAR(100) | | Who approved/rejected |
| created_at | TIMESTAMP | DEFAULT GETDATE() | |

**Approval flow:**
- `approved` → create subtopic in Redshift + Weaviate, backfill linked issues
- `rejected` → merge linked issues into an existing subtopic selected by reviewer
