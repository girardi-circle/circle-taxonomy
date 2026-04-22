from shared.prompts.product_areas import PRODUCT_AREAS_PROMPT_BLOCK
from shared.prompts import store as _store


def build_new_subtopic_prompt(
    segment_description: str,
    nature: str,
    intent: str,
    topics: list[dict],
) -> tuple[str, str]:
    topics_block = "\n".join(
        f"- ID: {t['id']}\n"
        f"  Name: {t['name']}\n"
        f"  Description: {t.get('description') or '(no description)'}\n"
        f"  Product area: {t.get('product_area_name') or 'unassigned'}"
        for t in topics
    )

    system = _store.get_system("new_subtopic")
    template = _store.get_user_template("new_subtopic")
    user = (
        template
        .replace("{segment_description}", segment_description)
        .replace("{nature}", nature)
        .replace("{intent}", intent)
        .replace("{topics_block}", topics_block)
        .replace("{PRODUCT_AREAS_PROMPT_BLOCK}", PRODUCT_AREAS_PROMPT_BLOCK)
    )
    return system, user
