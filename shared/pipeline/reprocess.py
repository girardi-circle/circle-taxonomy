import json
import logging
from shared.services.anthropic import call_claude
from shared.services.redshift import fetch_all, fetch_one, execute
from shared.prompts.reprocess import build_reprocess_prompt
from shared.pipeline.extraction import _strip_fences
from shared import config

logger = logging.getLogger(__name__)


def _write_reprocess_log(
    issue_id: int,
    old_description: str,
    new_description: str,
    verbatim_excerpt: str,
    input_tokens: int | None,
    output_tokens: int | None,
    cost_usd: float | None,
) -> None:
    try:
        execute(
            """INSERT INTO taxonomy.issue_reprocess_logs
               (issue_id, model, old_segment_description, new_segment_description,
                verbatim_excerpt, input_tokens, output_tokens, cost_usd)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (issue_id, config.MODEL_EXTRACTION, old_description, new_description,
             verbatim_excerpt, input_tokens, output_tokens, cost_usd),
        )
    except Exception as e:
        logger.error("Failed to write reprocess log for issue %s: %s", issue_id, e)


def reprocess_segment_descriptions(issue_ids: list[int]) -> dict:
    if not issue_ids:
        return {"updated": 0, "errors": 0}

    placeholders = ",".join(["%s"] * len(issue_ids))
    issues = fetch_all(
        f"SELECT id, segment_description, verbatim_excerpt FROM taxonomy.classified_issues WHERE id IN ({placeholders})",
        issue_ids,
    )

    updated = 0
    errors = 0

    for issue in issues:
        verbatim = issue.get("verbatim_excerpt") or ""
        old_description = issue.get("segment_description") or ""

        if not verbatim.strip():
            logger.warning("Issue %s has no verbatim_excerpt — skipping", issue["id"])
            errors += 1
            continue

        try:
            system, user = build_reprocess_prompt(verbatim)
            text, usage = call_claude(
                system=system,
                user=user,
                model=config.MODEL_EXTRACTION,
                temperature=0.0,
                max_tokens=512,
            )
            result = json.loads(_strip_fences(text))
            new_description = result.get("segment_description", "").strip()
            if not new_description:
                raise ValueError("Empty segment_description returned")

            execute(
                "UPDATE taxonomy.classified_issues SET segment_description = %s WHERE id = %s",
                (new_description, issue["id"]),
            )

            cost = config.compute_cost(
                config.MODEL_EXTRACTION,
                usage.get("input_tokens", 0),
                usage.get("output_tokens", 0),
            )
            _write_reprocess_log(
                issue_id=issue["id"],
                old_description=old_description,
                new_description=new_description,
                verbatim_excerpt=verbatim,
                input_tokens=usage.get("input_tokens"),
                output_tokens=usage.get("output_tokens"),
                cost_usd=cost,
            )
            updated += 1

        except Exception as e:
            logger.error("Failed to reprocess issue %s: %s", issue["id"], e)
            errors += 1

    return {"updated": updated, "errors": errors}
