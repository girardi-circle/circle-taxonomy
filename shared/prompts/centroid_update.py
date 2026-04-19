"""
Prompt 4 — Centroid Description Update.

Used in Step 4 (centroid maintenance) to regenerate a subtopic's canonical
description from accumulated matched issues, strengthening its vector representation.
"""


def build_centroid_update_prompt(
    subtopic_name: str,
    canonical_description: str,
    match_count: int,
    issue_descriptions: list[str],
) -> tuple[str, str]:
    """
    Build the system and user prompts for Prompt 4 (centroid update).

    Args:
        subtopic_name: The subtopic's name.
        canonical_description: The current canonical description.
        match_count: Total number of issues matched to this subtopic.
        issue_descriptions: List of segment_description strings from matched issues.

    Returns:
        (system, user) tuple of prompt strings.
    """
    system = (
        "You are a taxonomy curator. You refine category descriptions to better "
        "represent the full range of issues that belong to a category."
    )

    descriptions_block = "\n".join(f"- {desc}" for desc in issue_descriptions)

    user = f"""This subtopic has accumulated multiple matched issues. Regenerate a stronger
canonical description that captures the common pattern across all of them.

CURRENT SUBTOPIC:
- Name: {subtopic_name}
- Current description: {canonical_description}
- Match count: {match_count}

MATCHED ISSUE DESCRIPTIONS:
{descriptions_block}

Instructions:
- Write a new canonical_description (1-3 sentences) that synthesizes the common
  pattern across these issues.
- Use neutral, definitional language suitable for a knowledge base.
- The description should be general enough to match future similar issues but
  specific enough to distinguish this subtopic from related ones.
- Do not make it so broad that it would match unrelated issues.
- Preserve the core meaning of the original description while enriching it with
  patterns from the matched issues.

Respond with valid JSON only:
{{
  "canonical_description": "...",
  "changes_summary": "..."
}}"""

    return system, user
