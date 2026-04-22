from shared.prompts import store as _store


def build_centroid_update_prompt(
    subtopic_name: str,
    canonical_description: str,
    match_count: int,
    issue_descriptions: list[str],
) -> tuple[str, str]:
    issue_descriptions_block = "\n".join(f"- {d}" for d in issue_descriptions)

    system = _store.get_system("centroid_update")
    template = _store.get_user_template("centroid_update")
    user = (
        template
        .replace("{subtopic_name}", subtopic_name)
        .replace("{canonical_description}", canonical_description)
        .replace("{match_count}", str(match_count))
        .replace("{issue_descriptions_block}", issue_descriptions_block)
    )
    return system, user
