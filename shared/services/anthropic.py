import threading
import logging
import anthropic
from shared import config
from shared.services.redshift import exp_backoff, sleep_with_jitter

logger = logging.getLogger(__name__)

# One Anthropic client per thread — avoids shared-state contention
_thread_local = threading.local()

# Semaphore caps concurrent in-flight Claude requests
_claude_sem = threading.Semaphore(config.CLAUDE_MAX_CONCURRENCY)

# Models that do not accept the temperature parameter
_NO_TEMPERATURE_MODELS = {"claude-opus-4-7", "claude-opus-4-7-20251101"}

# HTTP status codes that are permanent failures — never retry
_PERMANENT_HTTP_CODES = {400, 401, 403, 404}


def get_client() -> anthropic.Anthropic:
    if not hasattr(_thread_local, "client"):
        _thread_local.client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _thread_local.client


def _is_permanent(e: Exception) -> bool:
    """Return True if the error is a permanent failure that should not be retried."""
    msg = str(e).lower()
    # 400-range HTTP errors are client mistakes, not transient
    for code in _PERMANENT_HTTP_CODES:
        if f"error code: {code}" in msg or f"http/{code}" in msg or f" {code} " in msg:
            return True
    return False


def call_claude(
    system: str,
    user: str,
    model: str,
    temperature: float = 0.0,
    max_tokens: int = 4096,
) -> tuple[str, dict]:
    """
    Thread-safe Claude call with:
    - Semaphore throttling (max CLAUDE_MAX_CONCURRENCY in-flight)
    - Per-thread client instance
    - Exponential backoff with jitter on transient errors
    - Skips temperature for models that don't support it
    - Does not retry permanent 4xx errors
    """
    supports_temperature = model not in _NO_TEMPERATURE_MODELS

    with _claude_sem:
        last_error: Exception | None = None

        for attempt in range(config.CLAUDE_MAX_RETRIES + 1):
            try:
                kwargs = dict(
                    model=model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                )
                if supports_temperature:
                    kwargs["temperature"] = temperature

                response = get_client().messages.create(**kwargs)
                usage = {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                }
                if not response.content:
                    raise ValueError(
                        f"Empty content list (stop_reason={response.stop_reason}, "
                        f"output_tokens={response.usage.output_tokens})"
                    )
                text_blocks = [b for b in response.content if hasattr(b, "text")]
                if not text_blocks:
                    raise ValueError(
                        f"No text blocks in response "
                        f"(types={[type(b).__name__ for b in response.content]})"
                    )
                text = text_blocks[0].text
                if not text:
                    raise ValueError(
                        f"Empty text block (stop_reason={response.stop_reason}, "
                        f"output_tokens={response.usage.output_tokens})"
                    )
                return text, usage

            except Exception as e:
                last_error = e
                if _is_permanent(e):
                    logger.error("Claude permanent error (not retrying): %s", e)
                    raise
                if attempt >= config.CLAUDE_MAX_RETRIES:
                    logger.error("Claude permanently failed after %d attempts: %s", attempt + 1, e)
                    raise
                backoff = exp_backoff(attempt, config.CLAUDE_BACKOFF_BASE, config.CLAUDE_BACKOFF_CAP)
                logger.warning(
                    "Claude attempt %d/%d failed: %s — retrying in %.1fs",
                    attempt + 1, config.CLAUDE_MAX_RETRIES + 1, e, backoff,
                )
                sleep_with_jitter(backoff)

        raise last_error  # type: ignore[misc]
