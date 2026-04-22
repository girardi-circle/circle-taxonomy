# PROMPTS.md

## Claude API Prompt Templates

All prompts import their model from `shared/config.py`. All responses are expected as raw JSON — the pipeline strips markdown fences (`_strip_fences()`) as a safety net in case Claude adds them despite instructions.

---

## Prompt 1: Transcript Extraction

**File:** `shared/prompts/extraction.py`
**Model:** `MODEL_EXTRACTION` (claude-sonnet-4-20250514)
**Temperature:** 0.0 (deterministic)
**Max tokens:** 4096

**Purpose:** Decompose a raw transcript into a transcript-level summary and individual issues.

**System:**
```
You are a support ticket analyst. You extract structured data from customer support
transcripts. Your job is to identify issues raised, experienced, or reported by the
customer — not observations or explanations made by the support agent.
```

**User template:**
```
Analyze this transcript and extract:

TRANSCRIPT LEVEL:
- summary: 2-3 sentence overview of the entire conversation

ISSUE LEVEL:
Identify each distinct issue that the customer is raising, experiencing, or requesting.
Only extract issues from the customer's perspective — ignore anything that is solely an
agent observation, explanation, or workaround not directly tied to a customer-reported
problem. For each customer issue, provide:

- segment_description: A 1-2 sentence description written in neutral, canonical language,
  suitable for use as a knowledge base topic definition. This field is used for vector
  similarity matching, so quality is critical. Follow these rules strictly:
    - Subject must be the product feature or system, not the customer or member.
      Never use "customer", "user", "member", "she", "he", "they", "we".
    - Describe the general class of problem or request, not the specific incident.
      Abstract one level up — the description must apply to any future occurrence,
      not just this ticket.
    - Use declarative, present-tense language as if defining the issue type.
    - BAD:  "Member not receiving invitation emails after account deletion and recreation."
    - GOOD: "Invitation emails fail to send when a member account is deleted and a new
             account is created using the same email address, preventing the member from
             receiving onboarding access to the intended community or space."

- verbatim_excerpt: An array of strings — one element per distinct quote. Each element
  is a single verbatim excerpt from the transcript relevant to this issue, preserved
  exactly as spoken. Use multiple elements when the issue is discussed in separate parts
  of the conversation.
  Example: ["yeah the drag and drop thing just disappears", "it only happens in Chrome"]

- nature: exactly one of the following (use the key in lowercase_with_underscores):
  - Bug: A defect or malfunction in existing functionality that is not working as expected.
  - Feedback: General observations or opinions about the product experience without a specific ask.
  - Question: A request for information or clarification about how something works.
  - Complaint: An expression of dissatisfaction about the product or service experience.
  - Feature Request: A request for new functionality or capability that does not currently exist.
  - Exploration: Open-ended discussion about possibilities, use cases, or future direction.
  - Cancellation: Customer requesting to cancel their subscription, membership, or account.

- intent: exactly one of the following (use the key in lowercase):
  - Support: Customer is seeking help to resolve an issue or get unblocked.
  - Action: Customer is requesting a specific action to be taken on their behalf.
  - Insights: Customer is seeking data, analytics, or deeper understanding of their usage.
  - Strategy: Customer is discussing long-term plans, direction, or strategic alignment.
  - Sales: Conversation involves purchasing, pricing, renewals, or commercial terms.

- sentiment: exactly one of [positive, negative, neutral, frustrated]

IMPORTANT: Your response must be raw JSON and nothing else. Do not wrap it in markdown
code fences (no ```json or ```). Do not add any text before or after the JSON object.
Start your response with { and end with }.

<transcript>
{raw_text}
</transcript>
```

**Expected output shape:**
```json
{
  "summary": "...",
  "issues": [
    {
      "segment_description": "...",
      "verbatim_excerpt": ["quote1", "quote2"],
      "nature": "bug",
      "intent": "support",
      "sentiment": "frustrated"
    }
  ]
}
```

---

## Prompt 2: Ambiguous Match Arbitration (Band B)

**File:** `shared/prompts/validation.py`
**Model:** `MODEL_ARBITRATION` (claude-sonnet-4-20250514)
**Temperature:** 0.0
**Max tokens:** 256

**Purpose:** When Weaviate returns candidates in the ambiguous range (0.15–0.35), ask Claude to confirm the best match. Candidates may be approved subtopics OR pending emerging candidates — both are labelled.

**System:**
```
You are a classification specialist. You determine whether a customer issue matches an
existing subtopic category or represents something new. Candidates may be approved
subtopics (already in the taxonomy) or proposed candidates (pending human review).
Both are valid matches.
```

**User template:**
```
Does this issue match any of the candidates below?

ISSUE:
- Description: {segment_description}
- Nature: {nature}
- Intent: {intent}

CANDIDATES:
{for each candidate}
- [APPROVED SUBTOPIC] or [PROPOSED — pending review]
  subtopic_id: N  (for approved)  OR  candidate_id: N  (for pending)
  Name: {name}
  Description: {canonical_description}
  Similarity: {1 - distance:.0%}
{end for}

Rules:
- Select the single best match ONLY if the issue is genuinely about the same underlying subject.
- Minor wording differences are fine — match on meaning, not exact phrasing.
- Approved subtopics and proposed candidates are equally valid matches.
- If the issue is about a related but distinct problem, reject all candidates.

Respond with valid JSON only. Use the exact format matching the candidate type:
- If matched to an APPROVED SUBTOPIC: {"matched": true, "type": "subtopic", "subtopic_id": <id>, "rationale": "..."}
- If matched to a PROPOSED CANDIDATE: {"matched": true, "type": "candidate", "candidate_id": <id>, "rationale": "..."}
- If no match: {"matched": false, "rationale": "..."}
```

---

## Prompt 3: New Subtopic Proposal (Band C)

**File:** `shared/prompts/new_subtopic.py`
**Model:** `MODEL_NEW_SUBTOPIC` (claude-opus-4-7)
**Temperature:** not set (claude-opus-4-7 does not support temperature)
**Max tokens:** 512

**Purpose:** When no existing subtopic or pending candidate matches, propose a new subtopic. Claude determines whether to place it under an existing topic or propose a new one.

**System:**
```
You are a taxonomy architect. You propose new subtopic categories that fit cleanly
into an existing topic hierarchy.
```

**User template:**
```
This issue did not match any existing subtopic. Propose a new one.

ISSUE:
- Description: {segment_description}
- Nature: {nature}
- Intent: {intent}

EXISTING TOPICS:
{for each topic}
- ID: {topic_id}
  Name: {name}
  Description: {description}
  Product area: {product_area_name or "unassigned"}
{end for}

PRODUCT AREAS:
{PRODUCT_AREAS_PROMPT_BLOCK}

Instructions:
1. First, determine if this issue belongs under an existing topic.
2. If no existing topic fits, propose a new topic name and description.
3. Propose a subtopic name and canonical_description written in neutral, definitional
   language — as it would appear in a knowledge base.

Respond with valid JSON only:
{
  "existing_topic": true/false,
  "topic_id": <id or null if new topic>,
  "topic_name": "...",
  "topic_description": "..." (only if new topic),
  "product_area": "..." (name, only if new topic),
  "suggested_subtopic_name": "...",
  "canonical_description": "...",
  "rationale": "..."
}
```

---

## Prompt 4: Centroid Description Update

**File:** `shared/prompts/centroid_update.py`
**Model:** `MODEL_CENTROID_UPDATE` (claude-sonnet-4-20250514)
**Temperature:** 0.2
**Max tokens:** 512

**Purpose:** Regenerate a subtopic's canonical description from accumulated matched issues to strengthen its vector representation over time. Also triggered **automatically** by `_run_centroid_for_subtopic()` after every merge_subtopic and merge_topic governance operation (requires ≥ 3 matched issues; skippable via `run_centroid=False`).

**System:**
```
You are a taxonomy curator. You refine category descriptions to better represent the
full range of issues that belong to a category.
```

**User template:**
```
This subtopic has accumulated multiple matched issues. Regenerate a stronger canonical
description that captures the common pattern across all of them.

CURRENT SUBTOPIC:
- Name: {subtopic_name}
- Current description: {canonical_description}
- Match count: {match_count}

MATCHED ISSUE DESCRIPTIONS:
{for each matched issue}
- {segment_description}
{end for}

Instructions:
- Write a new canonical_description (1-3 sentences) that synthesizes the common pattern.
- Use neutral, definitional language suitable for a knowledge base.
- Be specific enough to distinguish this subtopic from related ones.
- Preserve the core meaning while enriching with patterns from matched issues.

Respond with valid JSON only:
{"canonical_description": "...", "changes_summary": "..."}
```

---

## Prompt 5: Segment Description Reprocessing

**File:** `shared/prompts/reprocess.py`
**Model:** `MODEL_EXTRACTION` (claude-sonnet-4-20250514)
**Temperature:** 0.0
**Max tokens:** 512

**Purpose:** Regenerate a single issue's `segment_description` from its `verbatim_excerpt` when the original was poor quality. Used in the Issues page bulk reprocess feature.

**System:**
```
You are a support ticket analyst. You rewrite issue descriptions into high-quality
canonical knowledge base entries used for vector similarity search.
```

**User template:**
```
Given this verbatim customer transcript excerpt, generate a high-quality segment_description.

Rules:
- 1-2 sentences in neutral, canonical, present-tense language
- Subject must be the product feature or system — never the customer, user, member, or any pronoun
- Describe the general class of problem or request, not this specific incident.
  Abstract one level up so the description applies to any future occurrence.
- Be specific enough to distinguish this issue from similar ones in vector search.

[Examples omitted for brevity — see shared/prompts/reprocess.py for full examples]

VERBATIM EXCERPT:
{verbatim_excerpt}

Respond with valid JSON only: {"segment_description": "..."}
```

---

## Prompt 6: Taxonomy AI Review

**File:** `shared/prompts/taxonomy_review.py`  
**Model:** `MODEL_NEW_SUBTOPIC` (claude-opus-4-7)  
**Temperature:** not set (claude-opus-4-7 does not accept temperature)  
**Max tokens:** 16000

**Purpose:** Analyze selected topics/subtopics and propose merges, moves, and renames. Supports two independent review modes in a single prompt — topic-level and subtopic-level — allowing the user to mix both in one session.

**Two review modes:**
- **Topic-level** (`topic_ids`): evaluates each selected topic as a unit against all other existing topics. Only produces `merge_topics` and `rename_topic` suggestions. Subtopic list is included for context only.
- **Subtopic-level** (`subtopic_ids`): evaluates each selected subtopic in full detail. Only produces `merge_subtopics`, `move_subtopic`, and `rename_subtopic` suggestions. Weaviate similarity pre-computed at < 0.25 distance is included as confirmed hints.

Either or both modes may be active per request. The prompt contains up to two independent sections (Section 1 / Section 2) depending on what was selected.

**Invocation:** auto-batched at `AI_REVIEW_BATCH_SIZE=10` items per list per call, `AI_REVIEW_PARALLEL_BATCHES=3` concurrent Claude calls. Results persisted to `ai_review_sessions` + `ai_review_suggestions`.

**Input:**
- `topics_for_unit_review`: topics selected as units — name, description, product area, subtopic name list
- `subtopics_for_detail_review`: subtopics selected individually — name, canonical description, match count, up to 2 example issues, Weaviate similarity pairs (searched against ALL subtopics, not just selected)
- `all_topics_reference`: top 200 active topics by subtopic count — optionally filtered to involved PA(s) if `restrict_to_pa=true`
- `all_subtopics_reference`: top 500 active subtopics by match_count with PA context — optionally filtered to involved PA(s)

**No-change rule:** prompt explicitly states changes are NOT mandatory. Items left unchanged must be placed in `looks_good` with a rationale explaining why no change is needed.

**Output suggestion types:**
- `merge_topics` — topic_ids, surviving_topic_id, proposed_name, proposed_description; enriched with `topic_product_areas` and `surviving_topic_pa`
- `rename_topic` — topic_id, current_name, proposed_name, proposed_description; enriched with `topic_pa`
- `merge_subtopics` — subtopic_ids, surviving_subtopic_id, proposed_name, proposed_description, estimated_issues; enriched with `subtopic_contexts` (topic + PA per subtopic) and `surviving_subtopic_topic_name` / `surviving_subtopic_pa`
- `move_subtopic` — subtopic_id, from_topic_id, to_topic_id; enriched with `from_topic_pa`, `to_topic_pa`
- `rename_subtopic` — subtopic_id, current_name, proposed_name, proposed_description; enriched with `subtopic_topic_name`, `subtopic_pa`

**Output `looks_good`:** `[{type, topic_id/subtopic_id, name, rationale, pa_name, [topic_name]}]` — displayed as a tree grouped by topic in the UI

---

## Prompt override system

All prompts are defined in `shared/prompts/store.py` with default content. Overrides are stored in `shared/prompts/overrides.json` (gitignored). At runtime, `get_system()` and `get_user_template()` return the override if one exists, otherwise the default. The **Configuration → Prompts** UI page lets users edit any prompt live and reset to defaults.

---

## General guidelines

### Temperature settings
- Extraction (Prompt 1): 0.0 — deterministic structured output
- Arbitration (Prompt 2): 0.0 — deterministic classification
- New subtopic (Prompt 3): not set — claude-opus-4-7 does not accept temperature
- Centroid update (Prompt 4): 0.2 — slight creativity for synthesis
- Reprocess (Prompt 5): 0.0 — deterministic

### JSON fencing
Claude sometimes wraps responses in ` ```json ``` ` blocks despite instructions. All pipeline functions call `_strip_fences(text)` before `json.loads()` as a safety net.

### Error handling
All Claude calls: 3–6 retries with exponential backoff + jitter. 400-range HTTP errors (invalid model, bad request) are treated as permanent and not retried. Empty or non-JSON responses raise `ValueError` before retrying.
