from shared.prompts import store as _store


def build_reprocess_prompt(verbatim_excerpt: str) -> tuple[str, str]:
    system = _store.get_system("reprocess")
    template = _store.get_user_template("reprocess")
    user = template.replace("{verbatim_excerpt}", verbatim_excerpt)
    return system, user
