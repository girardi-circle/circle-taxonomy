"""
Prompt store — registry + override management.

Default prompt content mirrors the Python prompt files. Users can override
any prompt via the Configuration UI; overrides are persisted in overrides.json
and applied at build time via the get_system() / get_user_template() helpers.

Template variables (injected at runtime) use {{VARIABLE_NAME}} syntax in the
stored templates. Build functions replace these before sending to Claude.
"""
import json
import os
import threading
from shared import config as _config

_OVERRIDE_FILE = os.path.join(os.path.dirname(__file__), "overrides.json")
_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Default prompt content
# ---------------------------------------------------------------------------

_DEFAULTS: dict[str, dict] = {
    "extraction": {
        "name": "Prompt 1 — Extraction",
        "description": "Decomposes a raw transcript into a summary and individual classified issues.",
        "model_key": "MODEL_EXTRACTION",
        "temperature": 0.0,
        "max_tokens": 4096,
        "variables": ["NATURES_PROMPT", "INTENTS_PROMPT", "SENTIMENTS_PROMPT", "raw_text"],
        "system": (
            "You are a support ticket analyst. You extract structured data from customer support transcripts. "
            "Your job is to identify issues raised, experienced, or reported by the customer — not observations "
            "or explanations made by the support agent."
        ),
        "user_template": """\
Analyze this transcript and extract:

TRANSCRIPT LEVEL:
- summary: 2-3 sentence overview of the entire conversation

ISSUE LEVEL:
Identify each distinct issue that the customer is raising, experiencing, or requesting. Only extract issues from the customer's perspective — ignore anything that is solely an agent observation, explanation, or workaround not directly tied to a customer-reported problem. For each customer issue, provide:
- segment_description: A 1-2 sentence description written in neutral, canonical language, suitable for use as a knowledge base topic definition. This field is used for vector similarity matching, so quality is critical. Follow these rules strictly:
    - Subject must be the product feature or system, not the customer or member. Never use "customer", "user", "member", "she", "he", "they", "we".
    - Describe the general class of problem or request, not the specific incident. Abstract one level up — the description must apply to any future occurrence of this issue, not just this ticket.
    - Use declarative, present-tense language as if defining the issue type.
    - BAD:  "Member not receiving invitation emails after account deletion and recreation."
    - GOOD: "Invitation emails fail to send when a member account is deleted and a new account is created using the same email address, preventing the member from receiving onboarding access to the intended community or space."
- verbatim_excerpt: An array of strings — one element per distinct quote. Each element is a single verbatim excerpt from the transcript relevant to this issue, preserved exactly as spoken. Use multiple elements when the issue is discussed in separate parts of the conversation.
- nature: exactly one of the following (use the key in lowercase_with_underscores):
{NATURES_PROMPT}
- intent: exactly one of the following (use the key in lowercase):
{INTENTS_PROMPT}
- sentiment: exactly one of {SENTIMENTS_PROMPT}

IMPORTANT: Your response must be raw JSON and nothing else. Do not wrap it in markdown code fences (no ```json or ```). Start your response with { and end with }.

<transcript>
{raw_text}
</transcript>""",
    },

    "arbitration": {
        "name": "Prompt 2 — Arbitration (Band B)",
        "description": "Asks Claude to pick the best match from ambiguous Weaviate candidates. Candidates may be approved subtopics or pending review candidates.",
        "model_key": "MODEL_ARBITRATION",
        "temperature": 0.0,
        "max_tokens": 256,
        "variables": ["segment_description", "nature", "intent", "candidates_block"],
        "system": (
            "You are a classification specialist. You determine whether a customer issue matches an existing "
            "subtopic category or represents something new. Candidates may be approved subtopics (already in "
            "the taxonomy) or proposed candidates (pending human review). Both are valid matches."
        ),
        "user_template": """\
Does this issue match any of the candidates below?

ISSUE:
- Description: {segment_description}
- Nature: {nature}
- Intent: {intent}

CANDIDATES:
{candidates_block}

Rules:
- Select the single best match ONLY if the issue is genuinely about the same underlying subject.
- Minor wording differences are fine — match on meaning, not exact phrasing.
- Approved subtopics and proposed candidates are equally valid matches.
- If the issue is about a related but distinct problem, reject all candidates.

Respond with valid JSON only. Use the exact format matching the candidate type:
- If matched to an APPROVED SUBTOPIC: {"matched": true, "type": "subtopic", "subtopic_id": <id>, "rationale": "..."}
- If matched to a PROPOSED CANDIDATE: {"matched": true, "type": "candidate", "candidate_id": <id>, "rationale": "..."}
- If no match: {"matched": false, "rationale": "..."}""",
    },

    "new_subtopic": {
        "name": "Prompt 3 — New Subtopic Proposal (Band C)",
        "description": "When no subtopic matches, Claude proposes a new topic and subtopic. Never returns 'Unknown' or other generic names.",
        "model_key": "MODEL_NEW_SUBTOPIC",
        "temperature": None,
        "max_tokens": 512,
        "variables": ["segment_description", "nature", "intent", "topics_block", "PRODUCT_AREAS_PROMPT_BLOCK"],
        "system": "You are a taxonomy architect. You propose new subtopic categories that fit cleanly into an existing topic hierarchy.",
        "user_template": """\
This issue did not match any existing subtopic. Propose a new one.

ISSUE:
- Description: {segment_description}
- Nature: {nature}
- Intent: {intent}

EXISTING TOPICS:
{topics_block}

PRODUCT AREAS:
{PRODUCT_AREAS_PROMPT_BLOCK}

Instructions:
1. First, determine if this issue belongs under an existing topic. Prefer reusing an existing topic unless the issue is genuinely outside all current categories.
2. If no existing topic fits, propose a new topic name and description. Use the product area definitions to determine which product area the new topic belongs to.
3. Propose a subtopic name and canonical_description in neutral, definitional language.

CRITICAL NAMING RULES — these will cause the proposal to be rejected if violated:
- Topic names and subtopic names MUST be specific and meaningful.
- NEVER use: "Unknown", "General", "Other", "Miscellaneous", "Uncategorized", "N/A", "None", "Various".
- A specific, imperfect name is always better than a generic placeholder.

Respond with valid JSON only:
{
  "existing_topic": true/false,
  "topic_id": <id or null if new topic>,
  "topic_name": "...",
  "topic_description": "...",
  "product_area": "...",
  "suggested_subtopic_name": "...",
  "canonical_description": "...",
  "rationale": "..."
}""",
    },

    "centroid_update": {
        "name": "Prompt 4 — Centroid Update",
        "description": "Regenerates a subtopic's canonical description from accumulated matched issues to strengthen its vector representation.",
        "model_key": "MODEL_CENTROID_UPDATE",
        "temperature": 0.2,
        "max_tokens": 512,
        "variables": ["subtopic_name", "canonical_description", "match_count", "issue_descriptions_block"],
        "system": "You are a taxonomy curator. You refine category descriptions to better represent the full range of issues that belong to a category.",
        "user_template": """\
This subtopic has accumulated multiple matched issues. Regenerate a stronger canonical description that captures the common pattern across all of them.

CURRENT SUBTOPIC:
- Name: {subtopic_name}
- Current description: {canonical_description}
- Match count: {match_count}

MATCHED ISSUE DESCRIPTIONS:
{issue_descriptions_block}

Instructions:
- Write a new canonical_description (1-3 sentences) that synthesizes the common pattern.
- Use neutral, definitional language suitable for a knowledge base.
- Be specific enough to distinguish this subtopic from related ones.
- Preserve the core meaning while enriching with patterns from the matched issues.

Respond with valid JSON only:
{"canonical_description": "...", "changes_summary": "..."}""",
    },

    "reprocess": {
        "name": "Prompt 5 — Segment Description Reprocess",
        "description": "Rewrites a poor-quality segment_description from the verbatim excerpt. Used in the Issues page bulk reprocess feature.",
        "model_key": "MODEL_EXTRACTION",
        "temperature": 0.0,
        "max_tokens": 512,
        "variables": ["verbatim_excerpt"],
        "system": "You are a support ticket analyst. You rewrite issue descriptions into high-quality canonical knowledge base entries used for vector similarity search.",
        "user_template": """\
Given this verbatim customer transcript excerpt, generate a high-quality segment_description.

Rules:
- 1-2 sentences in neutral, canonical, present-tense language
- Subject must be the product feature or system — never the customer, user, member, or any pronoun
- Describe the general class of problem or request, not this specific incident. Abstract one level up.
- Be specific enough to distinguish this issue from similar ones in vector search.
- BAD:  "Member not receiving invitation emails after account deletion and recreation."
- GOOD: "Invitation emails fail to send when a member account is deleted and a new account is created using the same email address, preventing the member from receiving onboarding access to the intended community or space."

VERBATIM EXCERPT:
{verbatim_excerpt}

Respond with valid JSON only: {"segment_description": "..."}""",
    },

    "taxonomy_review": {
        "name": "Prompt 6 — Taxonomy AI Review",
        "description": "Analyzes selected topics and subtopics and proposes merges and reorganizations.",
        "model_key": "MODEL_NEW_SUBTOPIC",
        "temperature": None,
        "max_tokens": 4096,
        "variables": ["taxonomy_block"],
        "system": (
            "You are a taxonomy architect for a customer support classification system. "
            "Your job is to analyze a set of topics and subtopics and propose a cleaner, "
            "more generic reorganization that reduces fragmentation and merges overlapping categories."
        ),
        "user_template": """\
Review the following topics and subtopics from our customer support taxonomy.

{taxonomy_block}

Analyze them and return a list of concrete suggestions. Focus on:
1. Subtopics that are too specific and could be merged into a broader subtopic
2. Topics that overlap and could be consolidated
3. Subtopics that describe essentially the same problem with different wording

Rules:
- Only suggest merges that make semantic sense — don't merge unrelated issues
- Proposed canonical descriptions must be in neutral, present-tense, system-as-subject language
- If a topic/subtopic is already well-scoped, mark it as "looks good"
- Prioritize suggestions with the highest impact (most issues affected)

Respond with valid JSON only:
{
  "summary": "2-3 sentence overview of findings",
  "suggestions": [
    {
      "type": "merge_subtopics",
      "title": "...",
      "rationale": "...",
      "subtopic_ids": [N, ...],
      "subtopic_names": ["..."],
      "surviving_subtopic_id": N,
      "proposed_name": "...",
      "proposed_description": "...",
      "estimated_issues": N
    }
  ],
  "looks_good": ["topic or subtopic names that don't need changes"]
}""",
    },
}


# ---------------------------------------------------------------------------
# Override management
# ---------------------------------------------------------------------------

def _load_overrides() -> dict:
    if not os.path.exists(_OVERRIDE_FILE):
        return {}
    try:
        with open(_OVERRIDE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_overrides(overrides: dict) -> None:
    with _lock:
        with open(_OVERRIDE_FILE, "w") as f:
            json.dump(overrides, f, indent=2)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_all() -> list[dict]:
    """Return all prompts with overrides applied and model resolved."""
    overrides = _load_overrides()
    result = []
    for key, defaults in _DEFAULTS.items():
        override = overrides.get(key, {})
        model_name = getattr(_config, defaults["model_key"], defaults["model_key"])
        result.append({
            "id": key,
            "name": defaults["name"],
            "description": defaults["description"],
            "model_key": defaults["model_key"],
            "model": model_name,
            "temperature": defaults["temperature"],
            "max_tokens": defaults["max_tokens"],
            "variables": defaults["variables"],
            "system": override.get("system", defaults["system"]),
            "user_template": override.get("user_template", defaults["user_template"]),
            "is_overridden": key in overrides,
        })
    return result


def get_one(prompt_id: str) -> dict | None:
    for p in get_all():
        if p["id"] == prompt_id:
            return p
    return None


def get_system(prompt_id: str) -> str:
    p = get_one(prompt_id)
    return p["system"] if p else _DEFAULTS.get(prompt_id, {}).get("system", "")


def get_user_template(prompt_id: str) -> str:
    p = get_one(prompt_id)
    return p["user_template"] if p else _DEFAULTS.get(prompt_id, {}).get("user_template", "")


def update(prompt_id: str, system: str, user_template: str) -> None:
    if prompt_id not in _DEFAULTS:
        raise ValueError(f"Unknown prompt id: {prompt_id}")
    overrides = _load_overrides()
    overrides[prompt_id] = {"system": system, "user_template": user_template}
    _save_overrides(overrides)


def reset(prompt_id: str) -> None:
    overrides = _load_overrides()
    overrides.pop(prompt_id, None)
    _save_overrides(overrides)
