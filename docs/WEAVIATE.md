# WEAVIATE.md

## Weaviate Collections & Query Patterns

**Client version:** `weaviate-client>=4.6.0` (v4 API). All code uses v4 patterns.
**Vectorizer:** `text2vec-weaviate` (Weaviate Cloud built-in, no external API key required).
**Instance:** Weaviate Cloud Serverless.

Weaviate is a derived search index — Redshift is the source of truth. Always write to Redshift first, then sync to Weaviate.

---

## Collection 1: SubTopic

**Purpose:** Classification pipeline (Step 2). Single collection holds both **approved subtopics** and **pending emerging candidates**, distinguished by the `status` field. This allows the classification pipeline to check for existing pending candidates in the same query as approved subtopics — preventing duplicate candidates from being created.

### Properties

| Property | Type | Vectorized | Description |
|----------|------|-----------|-------------|
| subtopic_id | INT | No | FK to `taxonomy.sub_topics.id`. 0 for pending candidates. |
| candidate_id | INT | No | FK to `taxonomy.emerging_candidates.id`. 0 for approved subtopics. |
| status | TEXT | No | `"approved"` or `"pending"` |
| topic_id | INT | No | FK to `taxonomy.topics.id`. 0 for pending candidates. |
| product_area_id | INT | No | FK to `taxonomy.product_areas.id`. 0 if unassigned. |
| name | TEXT | No | Subtopic name for readability. |
| canonical_description | TEXT | **Yes** | Primary vector field. Searched against issue `segment_description`. |

### Dual-status lifecycle

```
Band C fires (auto_create=False)
    → INSERT into Weaviate SubTopic with status="pending", candidate_id=<id>, subtopic_id=0
    → INSERT into taxonomy.emerging_candidates

Reviewer approves candidate
    → UPDATE Weaviate object: status="approved", subtopic_id=<new_id>, candidate_id=0
    → If no Weaviate entry found (pre-migration candidate): INSERT fresh with status="approved"

Reviewer rejects or merges candidate
    → DELETE Weaviate object (so it can no longer be matched)
    → UPDATE taxonomy.emerging_candidates status='rejected'
```

### Schema migration

The `status` and `candidate_id` properties were added after initial setup. Run once:

```
POST /api/weaviate/migrate/subtopic-status
```

This adds both properties and backfills all existing objects with `status="approved"`, `candidate_id=0`.

### Query patterns (v4 client)

**Search for nearest subtopics (classification pipeline):**
```python
collection = client.collections.get("SubTopic")
results = collection.query.near_text(
    query=segment_description,
    limit=5,
    return_metadata=MetadataQuery(distance=True),
)
for obj in results.objects:
    status = obj.properties.get("status")       # "approved" or "pending"
    subtopic_id = obj.properties.get("subtopic_id")
    candidate_id = obj.properties.get("candidate_id")
    distance = obj.metadata.distance
```

**Find pending candidate by candidate_id:**
```python
results = collection.query.fetch_objects(
    filters=Filter.by_property("candidate_id").equal(candidate_id),
    limit=1,
)
```

**Find approved subtopic by subtopic_id:**
```python
results = collection.query.fetch_objects(
    filters=Filter.by_property("subtopic_id").equal(subtopic_id),
    limit=1,
)
```

---

## Collection 2: ClassifiedIssue

**Purpose:** RAG chat (Phase 2c). Semantic search over classified issues with dimensional filters. Also used to update sub_topic_id after classification assigns a subtopic.

### Properties

| Property | Type | Vectorized | Description |
|----------|------|-----------|-------------|
| issue_id | INT | No | FK to `taxonomy.classified_issues.id` |
| transcript_id | INT | No | FK to `taxonomy.transcripts.id` |
| sub_topic_id | INT | No | FK to `taxonomy.sub_topics.id`. 0 if unmatched. |
| topic_id | INT | No | 0 if unmatched. |
| product_area_id | INT | No | 0 if unmatched. |
| nature_id | INT | No | FK to `taxonomy.natures.id` |
| intent_id | INT | No | FK to `taxonomy.intents.id` |
| sentiment | TEXT | No | positive, negative, neutral, frustrated |
| classified_at | TEXT | No | ISO date string. Enables timeframe filtering. |
| source_url | TEXT | No | Link to original ticket/call. |
| segment_description | TEXT | **Yes** | Primary vector field. |
| verbatim_excerpt | TEXT | No | Raw customer quotes. Sent to Claude as context. |

### Sync strategy

- **Bulk sync:** `POST /api/weaviate/sync/issues` — loads all issues from Redshift
- **After classification:** `update_classified_issue_subtopic()` patches existing object with assigned sub_topic_id/topic_id/product_area_id
- Note: bulk sync uses batch insert (not upsert) — running it twice creates duplicates. Always check the status page first.

---

## Collection 3: Transcript

**Purpose:** RAG chat (Phase 2c). Conversation-level semantic search for account history, similar calls, agent coaching.

### Properties

| Property | Type | Vectorized | Description |
|----------|------|-----------|-------------|
| transcript_id | INT | No | FK to `taxonomy.transcripts.id` |
| source_id | TEXT | No | Original ticket/call ID |
| source_type | TEXT | No | 'zendesk', 'fathom' |
| community_id | INT | No | 0 if null |
| title | TEXT | No | Ticket subject or call title |
| source_url | TEXT | No | Link to original source |
| summary | TEXT | No | Claude-generated summary. Sent as context. |
| raw_text | TEXT | **Yes** | Full conversation. Primary vector field. |

---

## Setup sequence

Run these once before using the classification pipeline:

```
1. POST /api/weaviate/setup                        # Create all 3 collections
2. POST /api/weaviate/migrate/subtopic-status      # Add status + candidate_id to SubTopic
3. POST /api/weaviate/sync/issues                  # Bulk load ClassifiedIssue
4. POST /api/weaviate/sync/transcripts             # Bulk load Transcript
```

SubTopic is populated dynamically as candidates are created and approved — no bulk load needed.

---

## Distance interpretation

Weaviate returns cosine distance (0 = identical, 2 = opposite). All collections use the same embedding model so distances are comparable.

### Classification bands (SubTopic)

| Distance | Band | Action |
|----------|------|--------|
| < 0.15 | A | Auto-assign or auto-link to candidate |
| 0.15 – 0.35 | B | Claude arbitration |
| > 0.35 | C | Propose new subtopic or candidate |

### AI Review pre-computation (Taxonomy Governance)

Before calling Claude (Prompt 6) for a taxonomy review, the pipeline calls `find_similar_subtopics()` for each selected subtopic. Pairs with distance < 0.25 are included in the prompt as pre-computed hints so Claude confirms rather than guesses similarity. This is done via `_enrich_with_weaviate_similarity()` in `taxonomy_ai.py`.

| Distance | Meaning |
|----------|---------|
| < 0.15 | Very likely duplicates — strong merge candidate |
| 0.15 – 0.25 | Closely related — Claude should evaluate for merge |
| > 0.25 | Not included in pre-computation |

### RAG retrieval (Phase 2c — not yet built)

| Distance | Action |
|----------|--------|
| < 0.25 | Include as primary source |
| 0.25 – 0.40 | Include if under retrieval limit |
| > 0.40 | Discard |

---

## Status page

`GET /api/weaviate/collections/status` returns Redshift vs Weaviate counts for all three collections:

```json
{
  "ClassifiedIssue": {"redshift": 1241, "weaviate": 1241, "unsynced": 0, "description": "..."},
  "Transcript": {"redshift": 350, "weaviate": 350, "unsynced": 0, "description": "..."},
  "SubTopic": {"redshift": 26, "weaviate": 24, "unsynced": 2, "description": "..."}
}
```
