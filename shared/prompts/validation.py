from shared.prompts import store as _store


def build_arbitration_prompt(
    segment_description: str,
    nature: str,
    intent: str,
    candidates: list[dict],
) -> tuple[str, str]:
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

    system = _store.get_system("arbitration")
    template = _store.get_user_template("arbitration")
    user = (
        template
        .replace("{segment_description}", segment_description)
        .replace("{nature}", nature)
        .replace("{intent}", intent)
        .replace("{candidates_block}", candidates_block)
    )
    return system, user
