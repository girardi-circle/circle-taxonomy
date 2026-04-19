"""
Prompt 2 — Ambiguous Match Arbitration.

Used in Band B when Weaviate returns candidates in the ambiguous distance range.
Candidates may be approved subtopics OR pending emerging candidates — both are
clearly labelled so Claude can make the right call.
"""


def build_arbitration_prompt(
    segment_description: str,
    nature: str,
    intent: str,
    candidates: list[dict],
) -> tuple[str, str]:
    system = (
        "You are a classification specialist. You determine whether a customer issue "
        "matches an existing subtopic category or represents something new. "
        "Candidates may be approved subtopics (already in the taxonomy) or proposed "
        "candidates (pending human review). Both are valid matches."
    )

    lines = []
    for c in candidates:
        is_pending = c.get("status") == "pending"
        if is_pending:
            label = "[PROPOSED — pending review]"
            ref_id = f"candidate_id: {c['candidate_id']}"
        else:
            label = "[APPROVED SUBTOPIC]"
            ref_id = f"subtopic_id: {c['subtopic_id']}"

        lines.append(
            f"- {label}\n"
            f"  {ref_id}\n"
            f"  Name: {c['name']}\n"
            f"  Description: {c['canonical_description']}\n"
            f"  Similarity: {(1 - c['distance']):.0%}"
        )

    candidates_block = "\n".join(lines)

    user = f"""Does this issue match any of the candidates below?

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
- If matched to an APPROVED SUBTOPIC: {{"matched": true, "type": "subtopic", "subtopic_id": <id>, "rationale": "..."}}
- If matched to a PROPOSED CANDIDATE: {{"matched": true, "type": "candidate", "candidate_id": <id>, "rationale": "..."}}
- If no match: {{"matched": false, "rationale": "..."}}"""

    return system, user
