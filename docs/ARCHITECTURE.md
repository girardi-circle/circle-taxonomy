# ARCHITECTURE.md

## Automated Ticket Categorization System

### Technical Specification & Implementation Plan

---

## 1. Overview

This system automatically classifies customer support tickets (Zendesk) and call transcripts (Fathom) into a multi-dimensional taxonomy. The goal is to categorize every customer interaction by **topic > subtopic**, **intent**, **nature**, and **sentiment** — enabling data-driven insights into what customers are discussing, why, and how they feel about it.

### Core principles

- **One transcript, many issues.** A single support call can cover multiple distinct problems. The system decomposes transcripts into individual issues before classifying them.
- **Vector search for subject matching, LLM for linguistic classification.** Weaviate handles "what is this about?" (fuzzy semantic matching against a growing taxonomy). Claude handles "how is the customer framing it?" (intent, nature, sentiment — linguistic signals).
- **Human-in-the-loop for taxonomy growth.** New subtopics are proposed by the system but require human approval before entering the taxonomy. This prevents fragmentation and ensures taxonomy governance.

### Tech stack

| Component | Technology | Role |
|-----------|-----------|------|
| Backend API | FastAPI | REST endpoints for pipeline triggering, status, review |
| Dev UI | React + Tailwind + shadcn/ui | Admin dashboard for monitoring and review |
| AI extraction | Claude API (Anthropic) | Transcript decomposition, classification, subtopic proposals |
| Relational store | Redshift (schema: `taxonomy`) | Taxonomy registry, classified issues, review queue |
| Vector search | Weaviate | Subtopic similarity matching via embeddings |
| Language | Python 3.11+ | Pipeline implementation |
| Future orchestration | Dagster | Will replace manual triggers when moving to production |

---

## 2. Data Model

### Taxonomy dimensions

The classification system uses four independent dimensions per issue:

- **Topic > Subtopic** — hierarchical subject classification (e.g., "Website Builder > Drag-and-drop rendering failure"). This is the dimension that Weaviate manages.
- **Intent** — why the customer is raising this (Support, Action, Insights, Strategy, Sales). Determined by Claude from conversational context.
- **Nature** — what type of issue it is (Bug, Feedback, Question, Complaint, Feature Request, Exploration). Determined by Claude from conversational context.
- **Sentiment** — how the customer feels about this specific issue (positive, negative, neutral, frustrated). Determined per-issue, not per-transcript.

### Product areas

Product areas represent engineering teams at Circle. Each topic optionally belongs to a product area. Current product areas: CMS, Live, Paywalls, Growth, CRM, Email Hub, Apps, Circle Plus.

Product area definitions (with coverage sub-bullets) are maintained as a static Python constant in `shared/prompts/product_areas.py`. They are injected into Claude prompts when proposing new topics. They are not queried from the database at runtime.

### Key design decisions

**Product area is a property of the topic, not of each issue.** A topic like "Website Builder" inherently belongs to the CMS product area. This is enforced once at the topic level and inherited by all subtopics beneath it. The `product_area_id` on topics is nullable to allow topics before product areas are fully defined.

**No TopicProfile entity.** Intent, nature, and sentiment are flat attributes on each classified issue. The analytical power is identical (GROUP BY any combination), but the data model is simpler.

**Sub_topic_id on classified issues is nullable.** When the pipeline can't find a match, the issue is persisted immediately with `sub_topic_id = NULL` and `classification_status = 'unmatched'`. Once the proposed subtopic is approved, the FK is backfilled.

**Transcripts are pre-loaded from closed tickets.** The `taxonomy.transcripts` table is populated from `circle.dbt_daniel.int_control_studio__conversations_unioned`. Only closed tickets are processed — no re-processing of updated tickets. Deduplication is by `source_id`.

### Database schema

The full schema lives in `migrations/001_create_taxonomy_schema.sql`. See `docs/SCHEMA.md` for detailed table descriptions.

---

## 3. Pipeline Architecture

The system operates as four pipeline steps, triggered via FastAPI endpoints during local development (will become Dagster jobs in production).

```
Step 1: Extraction          Step 2: Classification
(per transcript batch)      (batch, all pending issues)
     │                           │
     ▼                           ▼
 Claude API                 Weaviate + Claude API
     │                           │
     ▼                           ▼
 transcripts.summary        classified_issues updated
 classified_issues created   emerging_candidates created
 (pending status)                 │
                                  ▼
                        Step 3: Review & Approval
                             (via dev UI)
                                  │
                                  ▼
                        sub_topics + Weaviate updated
                        issues backfilled
                                  │
                                  ▼
                        Step 4: Centroid Maintenance
                             (manual trigger)
```

---

## 4. Step 1 — Extraction

**Trigger:** `POST /api/pipeline/extract` with optional `limit` parameter.

### Step 1.1 — Find unprocessed transcripts

Query `taxonomy.transcripts` for rows where `summary IS NULL`. These are transcripts that have been loaded but not yet processed by Claude. Apply the optional limit.

### Step 1.2 — Claude extraction

Send the full transcript to Claude in a single API call. The prompt requests two levels of output simultaneously:

**Transcript-level fields:**
- `summary` — 2-3 sentence overview of the entire conversation

**Issue-level decomposition:**
For each distinct issue discussed in the transcript, Claude returns:
- `segment_description` — normalized 1-2 sentence description of the issue, written in a neutral/canonical register (not customer voice). This is critical: it must read like a topic definition, not a transcript excerpt, because it will be embedded and compared against stored subtopic descriptions in Weaviate.
- `verbatim_excerpt` — the actual transcript portions related to this issue, preserved verbatim for audit trail
- `nature` — bug, feedback, question, complaint, feature_request, or exploration
- `intent` — support, action, insights, strategy, or sales
- `sentiment` — positive, negative, neutral, or frustrated

**Example Claude output:**

```json
{
  "summary": "Customer from Acme Corp discussed two issues: a rendering bug in the drag-and-drop editor and a feature request for bulk CSV import.",
  "issues": [
    {
      "segment_description": "Drag-and-drop components disappear on drop in the CMS Builder editor. Issue is browser-specific, occurring in Chrome but not Firefox.",
      "verbatim_excerpt": "yeah so the drag and drop thing... it's been weird lately... when I drop a component it just disappears... and it only happens in Chrome, Firefox is fine",
      "nature": "bug",
      "intent": "support",
      "sentiment": "frustrated"
    },
    {
      "segment_description": "Request for bulk import capability via CSV file upload to populate content entries, replacing current one-by-one manual entry.",
      "verbatim_excerpt": "it would be great if we could just upload a CSV with all our entries instead of adding them one at a time",
      "nature": "feature_request",
      "intent": "strategy",
      "sentiment": "neutral"
    }
  ]
}
```

### Step 1.3 — Persist results

Update the transcript row: set `summary` to Claude's generated summary.

For each issue in Claude's response array, insert a row into `taxonomy.classified_issues`:
- Map `nature` and `intent` strings to their FK IDs in `taxonomy.natures` and `taxonomy.intents`
- Populate `segment_description`, `verbatim_excerpt`, `sentiment`
- Leave `sub_topic_id`, `confidence_score`, `match_method` as NULL
- Set `classification_status = 'pending'`

**Step 1 is complete.** Every issue now exists in the database, fully described, waiting for subtopic classification.

---

## 5. Step 2 — Classification

**Trigger:** `POST /api/pipeline/classify`

### Step 2.1 — Load pending issues

Query all rows from `taxonomy.classified_issues` where `classification_status = 'pending'`.

### Step 2.2 — Vector search per issue

For each pending issue, embed its `segment_description` and query Weaviate for the **top 5** nearest subtopics.

### Step 2.3 — Apply threshold bands

The system routes each issue based on the distance of the best Weaviate match:

#### Band A — High confidence (distance < 0.15)

The top match is a strong semantic fit. Assign it directly without LLM validation.

- Set `sub_topic_id` to the matched subtopic
- Set `confidence_score = 1 - distance`
- Set `match_method = 'vector_direct'`
- Set `classification_status = 'matched'`
- Increment `match_count` on the subtopic in `taxonomy.sub_topics`

No Claude call is made. This is the cheapest and fastest path.

#### Band B — Ambiguous (distance 0.15–0.35)

Multiple subtopics are plausible. Filter the top 5 Weaviate results to only those within the 0.15–0.35 distance band. Send them to Claude for arbitration.

- If Claude confirms a match: update the issue with the confirmed `sub_topic_id`, `match_method = 'llm_confirmed'`, `classification_status = 'matched'`
- If Claude says none fit: move to Step 2.4

#### Band C — No match (distance > 0.35)

No existing subtopic is semantically close enough. Move to Step 2.4.

**Note on thresholds:** These distance values (0.15, 0.35) are starting estimates and must be tuned with real data. Start conservative — route more issues through Claude (Band B) in the first weeks.

### Step 2.4 — New subtopic proposal

For issues that no existing subtopic matched, ask Claude to propose a new subtopic.

Send Claude the issue's `segment_description` along with:
- The full list of existing topic names and descriptions
- The product area definitions from the static constant (with coverage sub-bullets)

The prompt asks two things:

1. **Topic assignment:** "Does this issue belong under an existing topic, or does it need a new one? If existing, which one?"
2. **Subtopic proposal:** "Propose a subtopic name and canonical description for this issue."

Update the issue: `match_method = 'new_subtopic'`, `classification_status = 'unmatched'`.

### Step 2.5 — Cluster unmatched issues before creating candidates

After processing all pending issues, gather all with `classification_status = 'unmatched'`.

Compute pairwise cosine similarity between their `segment_description` embeddings. Cluster issues with similarity > 0.85 into groups.

For each cluster, create one row in `taxonomy.emerging_candidates`:
- `issue_ids` — comma-separated `classified_issue` IDs in this cluster
- `suggested_topic_name` and `suggested_subtopic_name` — from Claude's proposal for the most representative issue
- `canonical_description` — Claude's proposed description
- `suggested_product_area_id` — inherited from existing topic if applicable
- `cluster_size` — number of issues in the cluster
- `avg_similarity` — average pairwise similarity within the cluster
- `status = 'pending'`

Singleton issues get their own candidate row with `cluster_size = 1`.

**Step 2 is complete.** All pending issues are now either matched or in the review queue.

---

## 6. Step 3 — Review & Approval

**Trigger:** Manual action via the dev UI (`POST /api/candidates/{id}/approve` or `/reject`).

### Step 3.1 — Review the candidate

The reviewer examines an emerging candidate in the dev UI. They see the suggested topic, subtopic name, canonical description, cluster size, similarity score, and can drill into the linked issues.

Three possible outcomes:

#### Outcome A — Approved as-is

1. If the suggested topic is new, create it in `taxonomy.topics` (optionally with `product_area_id`)
2. Create the subtopic in `taxonomy.sub_topics` with the proposed `name` and `canonical_description`
3. Sync the new subtopic to Weaviate
4. Backfill all linked `classified_issues` — set `sub_topic_id`, `classification_status = 'matched'`
5. Update the candidate: `status = 'approved'`

#### Outcome B — Approved with edits

Reviewer modifies name, description, or topic assignment before creating. Same flow as Outcome A with corrected values.

#### Outcome C — Rejected (merge into existing subtopic)

Reviewer selects a target existing subtopic.

1. Backfill linked `classified_issues` to point to the existing subtopic
2. Optionally broaden the existing subtopic's `canonical_description` → triggers Weaviate re-index
3. Update the candidate: `status = 'rejected'`

### Step 3.2 — Trigger reclassification

After any approval, re-run Step 2 on remaining `pending` or `unmatched` issues. The new subtopic might match other issues.

---

## 7. Step 4 — Centroid Maintenance

**Trigger:** `POST /api/pipeline/maintenance`

### Step 4.1 — Strengthen subtopic descriptions

For each subtopic with significant new matches since the last run:

1. Read all `classified_issues` matched to this subtopic
2. Collect their `segment_descriptions`
3. Send to Claude to regenerate a richer `canonical_description`
4. Update in `taxonomy.sub_topics` and re-sync to Weaviate

### Step 4.2 — Duplicate detection

Cluster all existing subtopics by vector similarity. Flag pairs with distance < 0.15 for human review.

---

## 8. Cold Start Strategy

On day one, Weaviate is empty. Every issue routes to `emerging_candidates`. A bootstrap phase is required:

1. Gather 50-100 representative transcripts from existing data
2. Run through a bootstrapping Claude prompt that proposes a taxonomy structure
3. Human reviews and refines the proposed taxonomy
4. Bulk-load approved topics and subtopics into Redshift and Weaviate
5. Switch to the normal pipeline

---

## 9. Threshold Tuning Guide

| Threshold | Starting value | What it controls |
|-----------|---------------|-----------------|
| Band A ceiling | distance < 0.15 | Issues auto-matched without LLM validation |
| Band B ceiling | distance < 0.35 | Issues sent to Claude for arbitration vs. treated as no match |
| Cluster similarity | similarity > 0.85 | How tightly unmatched issues must relate to form one candidate |
| Duplicate detection | distance < 0.15 | When existing subtopics are flagged as potential duplicates |

Track `match_method` distribution over time to calibrate.

---

## 10. Security Considerations

- **API keys** stored in `.env`, loaded via `shared/config.py`. Never committed to git.
- **Weaviate** stores only subtopic metadata and canonical descriptions — no customer data.
- **All API calls** to Claude and Weaviate happen server-side only.
- **Dev UI** is local only, no authentication required during development.

---

## 11. Open Questions

- [ ] What embedding model to use for Weaviate? (Weaviate built-in, Voyage AI, Cohere)
- [ ] Threshold values need calibration with real data — plan for a 2-week tuning period
- [ ] Approval workflow: automated approval for high-confidence clusters (cluster_size >= 5, avg_similarity >= 0.90)?
- [ ] Should axioms/business rules engine be part of a later phase?
