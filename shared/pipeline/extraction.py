import json
import logging
import os
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, wait, as_completed, FIRST_COMPLETED
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from shared.services.anthropic import call_claude
from shared.services.redshift import (
    get_connection, get_pooled_connection, fetch_all, fetch_one, execute,
    execute_with_retry,
)
from shared.prompts.extraction import build_extraction_prompt, build_loggable_prompt
from shared.prompts.fields import validate_nature, validate_intent, validate_sentiment
from shared import config

logger = logging.getLogger(__name__)

_loggable_system, _loggable_user = build_loggable_prompt()

# File logger — writes one JSON line per event to logs/pipeline.log
_LOG_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'logs'))
os.makedirs(_LOG_DIR, exist_ok=True)
_file_logger = logging.getLogger('pipeline.file')
if not _file_logger.handlers:
    _fh = RotatingFileHandler(
        os.path.join(_LOG_DIR, 'pipeline.log'),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
    )
    _fh.setFormatter(logging.Formatter('%(message)s'))
    _file_logger.addHandler(_fh)
    _file_logger.setLevel(logging.INFO)
    _file_logger.propagate = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _emit(event: dict) -> dict:
    event.setdefault('ts', _now())
    _file_logger.info(json.dumps(event, default=str))
    return event


def _strip_fences(text: str) -> str:
    """Remove markdown code fences Claude sometimes adds despite being told not to."""
    text = text.strip()
    if text.startswith("```"):
        text = text[text.find("\n") + 1:] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()


def _serialize_verbatim(value) -> str:
    """Normalize verbatim_excerpt to a JSON array string regardless of what Claude returns."""
    if isinstance(value, list):
        return json.dumps([str(v) for v in value if v])
    if isinstance(value, str) and value.strip():
        # Wrap legacy plain strings in an array
        return json.dumps([value])
    return json.dumps([])


def _load_lookup_tables() -> tuple[dict, dict]:
    natures = fetch_all("SELECT id, name FROM taxonomy.natures")
    intents = fetch_all("SELECT id, name FROM taxonomy.intents")
    return (
        {row["name"]: row["id"] for row in natures},
        {row["name"]: row["id"] for row in intents},
    )


def _fetch_unprocessed(limit: int) -> list[dict]:
    return fetch_all(
        "SELECT id, raw_text FROM taxonomy.transcripts WHERE summary IS NULL LIMIT %s",
        (limit,),
    )


def _write_log(
    transcript_id: int,
    response_raw: str | None,
    issues_created: int,
    status: str,
    error_message: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cost_usd: float | None = None,
) -> int | None:
    """Inserts the log entry and returns its id."""
    try:
        execute(
            """INSERT INTO taxonomy.extraction_logs
               (transcript_id, model, prompt_system, prompt_user, response_raw,
                issues_created, status, error_message,
                input_tokens, output_tokens, cost_usd)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                transcript_id,
                config.MODEL_EXTRACTION,
                _loggable_system,
                _loggable_user,
                response_raw,
                issues_created,
                status,
                error_message,
                input_tokens,
                output_tokens,
                cost_usd,
            ),
        )
        row = fetch_one(
            "SELECT MAX(id) AS id FROM taxonomy.extraction_logs WHERE transcript_id = %s",
            (transcript_id,),
        )
        return row["id"] if row else None
    except Exception as e:
        logger.error("Failed to write extraction log for transcript %s: %s", transcript_id, e)
        return None


def _link_issues_to_log(issue_ids: list[int], log_id: int) -> None:
    if not issue_ids:
        return
    placeholders = ",".join(["%s"] * len(issue_ids))
    try:
        execute(
            f"UPDATE taxonomy.classified_issues SET extraction_log_id = %s WHERE id IN ({placeholders})",
            [log_id] + issue_ids,
        )
    except Exception as e:
        logger.error("Failed to link issues to log %s: %s", log_id, e)


def _process_transcript(
    transcript: dict,
    nature_map: dict,
    intent_map: dict,
) -> tuple[int, str | None]:
    """Returns (issues_created, error_message). error_message is None on success."""
    system, user = build_extraction_prompt(transcript["raw_text"] or "")
    usage: dict = {}

    try:
        response_raw, usage = call_claude(
            system=system,
            user=user,
            model=config.MODEL_EXTRACTION,
            temperature=config.EXTRACTION_TEMPERATURE,
            max_tokens=4096,
        )
        if not response_raw or not response_raw.strip():
            raise ValueError(f"Claude returned an empty response (transcript {transcript['id']})")
        result = json.loads(response_raw)
    except json.JSONDecodeError as e:
        logger.error("JSON parse error for transcript %s. Raw response (first 500 chars): %s",
                     transcript["id"], (response_raw or "")[:500])
        error = f"JSON parse error: {e}"
        _write_log(transcript["id"], response_raw if "response_raw" in dir() else None, 0, "error", error,
                   usage.get("input_tokens"), usage.get("output_tokens"),
                   config.compute_cost(config.MODEL_EXTRACTION, usage.get("input_tokens", 0), usage.get("output_tokens", 0)))
        return 0, error
    except Exception as e:
        error = f"Claude call failed: {e}"
        logger.error("Claude call failed for transcript %s: %s", transcript["id"], e)
        _write_log(transcript["id"], None, 0, "error", error)
        return 0, error

    summary = result.get("summary", "")
    issues = result.get("issues", [])
    issues_created = 0

    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE taxonomy.transcripts SET summary = %s WHERE id = %s",
                    (summary, transcript["id"]),
                )

                for issue in issues:
                    nature_name = validate_nature(issue.get("nature", ""))
                    intent_name = validate_intent(issue.get("intent", ""))
                    sentiment = validate_sentiment(issue.get("sentiment", "")) or "neutral"

                    if not nature_name:
                        logger.warning(
                            "Unknown nature %r for transcript %s — skipping issue",
                            issue.get("nature"),
                            transcript["id"],
                        )
                        continue
                    if not intent_name:
                        logger.warning(
                            "Unknown intent %r for transcript %s — skipping issue",
                            issue.get("intent"),
                            transcript["id"],
                        )
                        continue

                    nature_id = nature_map.get(nature_name)
                    intent_id = intent_map.get(intent_name)

                    if not nature_id or not intent_id:
                        logger.warning(
                            "Missing FK for nature=%s or intent=%s — skipping issue",
                            nature_name,
                            intent_name,
                        )
                        continue

                    cur.execute(
                        """INSERT INTO taxonomy.classified_issues
                           (transcript_id, nature_id, intent_id, segment_description,
                            verbatim_excerpt, sentiment, classification_status)
                           VALUES (%s, %s, %s, %s, %s, %s, 'pending')""",
                        (
                            transcript["id"],
                            nature_id,
                            intent_id,
                            issue.get("segment_description", ""),
                            _serialize_verbatim(issue.get("verbatim_excerpt")),
                            sentiment,
                        ),
                    )
                    issues_created += 1

            conn.commit()

        cost = config.compute_cost(
            config.MODEL_EXTRACTION,
            usage.get("input_tokens", 0),
            usage.get("output_tokens", 0),
        )
        log_id = _write_log(transcript["id"], response_raw, issues_created, "success",
                            input_tokens=usage.get("input_tokens"),
                            output_tokens=usage.get("output_tokens"),
                            cost_usd=cost)
        if log_id:
            issue_ids = [
                r["id"] for r in fetch_all(
                    "SELECT id FROM taxonomy.classified_issues WHERE transcript_id = %s AND extraction_log_id IS NULL",
                    (transcript["id"],),
                )
            ]
            _link_issues_to_log(issue_ids, log_id)

        return issues_created, None

    except Exception as e:
        error = str(e)
        logger.error("DB write failed for transcript %s: %s", transcript["id"], error)
        cost = config.compute_cost(
            config.MODEL_EXTRACTION,
            usage.get("input_tokens", 0),
            usage.get("output_tokens", 0),
        )
        _write_log(transcript["id"], response_raw, 0, "error", error,
                   input_tokens=usage.get("input_tokens"),
                   output_tokens=usage.get("output_tokens"),
                   cost_usd=cost)
        return 0, error


def _transcript_filters(
    source_id_min: str | None,
    source_id_max: str | None,
    community_id: int | None,
    source_type: str | None,
) -> tuple[str, list]:
    conditions = ["summary IS NULL"]
    params: list = []
    if source_id_min:
        conditions.append("source_id >= %s")
        params.append(source_id_min)
    if source_id_max:
        conditions.append("source_id <= %s")
        params.append(source_id_max)
    if community_id is not None:
        conditions.append("community_id = %s")
        params.append(community_id)
    if source_type:
        conditions.append("source_type = %s")
        params.append(source_type)
    return "WHERE " + " AND ".join(conditions), params


def count_unprocessed(
    source_id_min: str | None = None,
    source_id_max: str | None = None,
    community_id: int | None = None,
    source_type: str | None = None,
) -> int:
    where, params = _transcript_filters(source_id_min, source_id_max, community_id, source_type)
    row = fetch_one(
        f"SELECT COUNT(*) AS count FROM taxonomy.transcripts {where}",
        params or None,
    )
    return row["count"] if row else 0


def _fetch_unprocessed_with_meta(
    limit: int,
    source_id_min: str | None = None,
    source_id_max: str | None = None,
    community_id: int | None = None,
    source_type: str | None = None,
) -> list[dict]:
    where, params = _transcript_filters(source_id_min, source_id_max, community_id, source_type)
    return fetch_all(
        f"""SELECT id, raw_text, title, source_type, source_id, source_url
            FROM taxonomy.transcripts {where} LIMIT %s""",
        params + [limit],
    )


def _process_transcript_parallel(
    transcript: dict,
    meta: dict,
    nature_map: dict,
    intent_map: dict,
) -> tuple[list[dict], int, int]:
    """
    Runs inside a worker thread. Processes one transcript end-to-end.
    Returns (events, issues_created, error_count).
    Events are already logged via _emit(); the caller just yields them.
    Uses pooled DB connection — always returns it in finally.
    """
    events: list[dict] = []

    events.append(_emit({"type": "transcript_start", **meta}))
    events.append(_emit({"type": "step", "transcript_id": transcript["id"], "message": "Sending to Claude..."}))

    system, user = build_extraction_prompt(transcript["raw_text"] or "")
    usage: dict = {}
    response_raw = None

    try:
        response_raw, usage = call_claude(
            system=system,
            user=user,
            model=config.MODEL_EXTRACTION,
            temperature=config.EXTRACTION_TEMPERATURE,
            max_tokens=4096,
        )
        if not response_raw or not response_raw.strip():
            raise ValueError(f"Empty response for transcript {transcript['id']}")
        result = json.loads(_strip_fences(response_raw))
    except json.JSONDecodeError as e:
        logger.error("JSON parse error for transcript %s. Raw (first 500): %s",
                     transcript["id"], (response_raw or "")[:500])
        error = f"JSON parse error: {e}"
        _write_log(transcript["id"], response_raw, 0, "error", error,
                   usage.get("input_tokens"), usage.get("output_tokens"),
                   config.compute_cost(config.MODEL_EXTRACTION, usage.get("input_tokens", 0), usage.get("output_tokens", 0)))
        events.append(_emit({"type": "transcript_error", **meta, "message": error}))
        return events, 0, 1
    except Exception as e:
        error = f"Claude call failed: {e}"
        logger.error("Claude failed for transcript %s: %s", transcript["id"], e)
        _write_log(transcript["id"], None, 0, "error", error)
        events.append(_emit({"type": "transcript_error", **meta, "message": error}))
        return events, 0, 1

    n_raw = len(result.get("issues", []))
    events.append(_emit({"type": "step", "transcript_id": transcript["id"],
                         "message": f"Claude returned {n_raw} issues. Persisting..."}))

    summary = result.get("summary", "")
    issues = result.get("issues", [])
    issues_created = 0

    try:
        with get_pooled_connection() as conn:
            execute_with_retry(
                conn,
                "UPDATE taxonomy.transcripts SET summary = %s WHERE id = %s",
                (summary, transcript["id"]),
            )
            for issue in issues:
                nature_name = validate_nature(issue.get("nature", ""))
                intent_name = validate_intent(issue.get("intent", ""))
                sentiment = validate_sentiment(issue.get("sentiment", "")) or "neutral"
                if not nature_name or not intent_name:
                    continue
                nature_id = nature_map.get(nature_name)
                intent_id = intent_map.get(intent_name)
                if not nature_id or not intent_id:
                    continue
                execute_with_retry(
                    conn,
                    """INSERT INTO taxonomy.classified_issues
                       (transcript_id, nature_id, intent_id, segment_description,
                        verbatim_excerpt, sentiment, classification_status)
                       VALUES (%s, %s, %s, %s, %s, %s, 'pending')""",
                    (transcript["id"], nature_id, intent_id,
                     issue.get("segment_description", ""),
                     _serialize_verbatim(issue.get("verbatim_excerpt")), sentiment),
                )
                issues_created += 1

        cost = config.compute_cost(
            config.MODEL_EXTRACTION,
            usage.get("input_tokens", 0),
            usage.get("output_tokens", 0),
        )
        log_id = _write_log(transcript["id"], response_raw, issues_created, "success",
                            input_tokens=usage.get("input_tokens"),
                            output_tokens=usage.get("output_tokens"),
                            cost_usd=cost)
        if log_id:
            issue_ids = [
                r["id"] for r in fetch_all(
                    "SELECT id FROM taxonomy.classified_issues WHERE transcript_id = %s AND extraction_log_id IS NULL",
                    (transcript["id"],),
                )
            ]
            _link_issues_to_log(issue_ids, log_id)

        events.append(_emit({
            "type": "transcript_done", **meta,
            "issues_created": issues_created,
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "cost_usd": cost,
            "log_id": log_id,
        }))
        return events, issues_created, 0

    except Exception as e:
        error = str(e)
        logger.error("DB write failed for transcript %s: %s", transcript["id"], error)
        cost = config.compute_cost(
            config.MODEL_EXTRACTION,
            usage.get("input_tokens", 0),
            usage.get("output_tokens", 0),
        )
        _write_log(transcript["id"], response_raw, 0, "error", error,
                   input_tokens=usage.get("input_tokens"),
                   output_tokens=usage.get("output_tokens"),
                   cost_usd=cost)
        events.append(_emit({"type": "transcript_error", **meta, "message": error}))
        return events, 0, 1


def stream_extraction(
    limit: int | None = None,
    source_id_min: str | None = None,
    source_id_max: str | None = None,
    community_id: int | None = None,
    source_type: str | None = None,
):
    """
    Parallel SSE generator using FIRST_COMPLETED to keep the thread pool always full.
    Yields events as each transcript finishes — no idle threads between completions.
    """
    if limit is None:
        limit = config.EXTRACTION_BATCH_LIMIT

    nature_map, intent_map = _load_lookup_tables()
    transcripts = _fetch_unprocessed_with_meta(limit, source_id_min, source_id_max, community_id, source_type)
    total = len(transcripts)

    yield _emit({"type": "batch_start", "total": total, "limit": limit,
                 "workers": config.MAX_CONCURRENCY})

    transcripts_processed = 0
    issues_created_total = 0
    errors = 0

    # Build work queue with pre-computed meta dicts
    work: deque = deque()
    for i, transcript in enumerate(transcripts, 1):
        meta = {
            "transcript_id": transcript["id"],
            "title": transcript.get("title") or f"Transcript #{transcript['id']}",
            "source_type": transcript.get("source_type"),
            "source_id": transcript.get("source_id"),
            "source_url": transcript.get("source_url"),
            "index": i,
            "total": total,
        }
        work.append((transcript, meta))

    with ThreadPoolExecutor(max_workers=config.MAX_CONCURRENCY) as executor:
        futures: set = set()

        # Fill all worker slots initially
        while work and len(futures) < config.MAX_CONCURRENCY:
            transcript, meta = work.popleft()
            futures.add(executor.submit(
                _process_transcript_parallel, transcript, meta, nature_map, intent_map
            ))

        # Reactive loop: react to each completion, immediately refill the slot
        while futures:
            done, futures = wait(futures, return_when=FIRST_COMPLETED)

            for future in done:
                try:
                    transcript_events, n_issues, n_errors = future.result()
                except Exception as e:
                    logger.error("Unexpected future error: %s", e)
                    transcript_events, n_issues, n_errors = [], 0, 1

                # Events were already logged by _emit in the thread; just yield them
                for event in transcript_events:
                    yield event

                if n_errors:
                    errors += 1
                else:
                    transcripts_processed += 1
                    issues_created_total += n_issues

            # Top up executor immediately after each completion
            while work and len(futures) < config.MAX_CONCURRENCY:
                transcript, meta = work.popleft()
                futures.add(executor.submit(
                    _process_transcript_parallel, transcript, meta, nature_map, intent_map
                ))

    yield _emit({
        "type": "batch_done",
        "transcripts_processed": transcripts_processed,
        "issues_created": issues_created_total,
        "errors": errors,
    })


def run_extraction(limit: int | None = None) -> dict:
    """Parallel non-streaming extraction using ThreadPoolExecutor + as_completed."""
    if limit is None:
        limit = config.EXTRACTION_BATCH_LIMIT

    nature_map, intent_map = _load_lookup_tables()
    transcripts = _fetch_unprocessed(limit)

    transcripts_processed = 0
    issues_created = 0
    errors = 0

    with ThreadPoolExecutor(max_workers=config.MAX_CONCURRENCY) as executor:
        futures = {
            executor.submit(_process_transcript, t, nature_map, intent_map): t
            for t in transcripts
        }
        for future in as_completed(futures):
            n_issues, error = future.result()
            if error:
                logger.error("Transcript failed: %s", error)
                errors += 1
            else:
                transcripts_processed += 1
                issues_created += n_issues

    return {
        "transcripts_processed": transcripts_processed,
        "issues_created": issues_created,
        "errors": errors,
    }
