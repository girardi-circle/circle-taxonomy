"""
Prompt 3 — New Subtopic Proposal.

Used in Band C of the classification pipeline when no existing subtopic matches
the issue. Claude proposes a new subtopic (and optionally a new topic).
"""

from shared.prompts.product_areas import PRODUCT_AREAS_PROMPT_BLOCK


def build_new_subtopic_prompt(
    segment_description: str,
    nature: str,
    intent: str,
    topics: list[dict],
) -> tuple[str, str]:
    """
    Build the system and user prompts for Prompt 3 (new subtopic proposal).

    Args:
        segment_description: The issue's normalized description.
        nature: The issue's nature (e.g. "Bug", "Feature Request").
        intent: The issue's intent (e.g. "Support", "Action").
        topics: List of dicts with id, name, description, product_area_name.

    Returns:
        (system, user) tuple of prompt strings.
    """
    system = (
        "You are a taxonomy architect. You propose new subtopic categories that fit "
        "cleanly into an existing topic hierarchy."
    )

    topics_block = "\n".join(
        f"- ID: {t['id']}\n"
        f"  Name: {t['name']}\n"
        f"  Description: {t.get('description') or '(no description)'}\n"
        f"  Product area: {t.get('product_area_name') or 'unassigned'}"
        for t in topics
    )

    user = f"""This issue did not match any existing subtopic. Propose a new one.

ISSUE:
- Description: {segment_description}
- Nature: {nature}
- Intent: {intent}

EXISTING TOPICS:
{topics_block}

PRODUCT AREAS:
{PRODUCT_AREAS_PROMPT_BLOCK}

Instructions:
1. First, determine if this issue belongs under an existing topic. Compare the
   issue's subject matter against each topic's description. Prefer reusing an
   existing topic unless the issue is genuinely outside all current categories.
2. If no existing topic fits, propose a new topic name and description. Use the
   product area definitions and their coverage areas to determine which product
   area the new topic belongs to. If none clearly applies, leave it unassigned.
3. Propose a subtopic name and canonical_description. The canonical_description
   must be written in neutral, definitional language — as it would appear in a
   knowledge base. It should be 1-2 sentences describing the general class of
   issue, not this specific instance.

Respond with valid JSON only:
{{
  "existing_topic": true/false,
  "topic_id": <id or null if new topic>,
  "topic_name": "...",
  "topic_description": "...",
  "product_area": "...",
  "suggested_subtopic_name": "...",
  "canonical_description": "...",
  "rationale": "..."
}}"""

    return system, user
