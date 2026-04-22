from shared.prompts.fields import NATURES_PROMPT, INTENTS_PROMPT, SENTIMENTS_PROMPT
from shared.prompts import store as _store


def build_loggable_prompt() -> tuple[str, str]:
    """Same prompt shape but with raw_text replaced by a placeholder for audit logging."""
    return build_extraction_prompt("[transcript_raw_text]")


def build_extraction_prompt(raw_text: str) -> tuple[str, str]:
    system = _store.get_system("extraction")
    template = _store.get_user_template("extraction")
    user = (
        template
        .replace("{NATURES_PROMPT}", NATURES_PROMPT)
        .replace("{INTENTS_PROMPT}", INTENTS_PROMPT)
        .replace("{SENTIMENTS_PROMPT}", SENTIMENTS_PROMPT)
        .replace("{raw_text}", raw_text)
    )
    return system, user
