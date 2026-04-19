"""
Step 4 — Centroid Maintenance & Duplicate Detection.
"""

import json
import logging

from shared import config
from shared.services.anthropic import call_claude
from shared.services.redshift import fetch_all, execute
from shared.services import weaviate as weaviate_service
from shared.prompts.centroid_update import build_centroid_update_prompt
from shared.pipeline.extraction import _strip_fences

logger = logging.getLogger(__name__)


def run_centroid_maintenance(min_new_matches: int = 5) -> dict:
    """
    For each subtopic with match_count >= min_new_matches:
    1. Fetch all matched issue segment_descriptions.
    2. Call Claude Prompt 4 to regenerate canonical_description.
    3. Update canonical_description in Redshift and Weaviate.

    Returns dict with results per subtopic.
    """
    # Find subtopics with enough matches to warrant centroid update
    subtopics = fetch_all(
        """
        SELECT id, name, canonical_description, match_count
        FROM taxonomy.sub_topics
        WHERE match_count >= %s AND is_active = TRUE
        ORDER BY match_count DESC
        """,
        (min_new_matches,),
    )

    results = []
    updated = 0
    errors = 0

    for subtopic in subtopics:
        subtopic_id = subtopic["id"]
        subtopic_name = subtopic["name"]
        current_description = subtopic.get("canonical_description") or ""
        match_count = subtopic.get("match_count") or 0

        # Fetch issue descriptions matched to this subtopic
        issue_rows = fetch_all(
            """
            SELECT segment_description
            FROM taxonomy.classified_issues
            WHERE sub_topic_id = %s AND classification_status = 'matched'
            ORDER BY classified_at DESC
            LIMIT 50
            """,
            (subtopic_id,),
        )

        if not issue_rows:
            logger.debug("No matched issues for subtopic %s, skipping", subtopic_id)
            continue

        issue_descriptions = [r["segment_description"] for r in issue_rows if r.get("segment_description")]

        if len(issue_descriptions) < min_new_matches:
            continue

        system, user = build_centroid_update_prompt(
            subtopic_name=subtopic_name,
            canonical_description=current_description,
            match_count=match_count,
            issue_descriptions=issue_descriptions,
        )

        try:
            text, _usage = call_claude(
                system=system,
                user=user,
                model=config.MODEL_CENTROID_UPDATE,
                temperature=0.2,
                max_tokens=512,
            )
            result = json.loads(_strip_fences(text))
            new_description = result.get("canonical_description") or current_description
            changes_summary = result.get("changes_summary") or ""

            # Update Redshift
            execute(
                "UPDATE taxonomy.sub_topics SET canonical_description = %s WHERE id = %s",
                (new_description, subtopic_id),
            )

            # Update Weaviate
            try:
                weaviate_service.update_subtopic_description(subtopic_id, new_description)
            except Exception as e:
                logger.warning("Weaviate update for subtopic %s failed: %s", subtopic_id, e)

            results.append({
                "subtopic_id": subtopic_id,
                "subtopic_name": subtopic_name,
                "match_count": match_count,
                "issues_sampled": len(issue_descriptions),
                "changes_summary": changes_summary,
                "status": "updated",
            })
            updated += 1
            logger.info("Updated centroid for subtopic '%s' (id=%s): %s", subtopic_name, subtopic_id, changes_summary)

        except Exception as e:
            logger.error("Centroid update failed for subtopic %s: %s", subtopic_id, e)
            results.append({
                "subtopic_id": subtopic_id,
                "subtopic_name": subtopic_name,
                "error": str(e),
                "status": "error",
            })
            errors += 1

    return {
        "subtopics_evaluated": len(subtopics),
        "updated": updated,
        "errors": errors,
        "results": results,
    }


def run_duplicate_detection() -> dict:
    """
    For each subtopic, query Weaviate for similar subtopics within
    DUPLICATE_DETECTION_THRESHOLD distance. Return list of duplicate pairs.
    """
    subtopics = fetch_all(
        """
        SELECT id, name, canonical_description
        FROM taxonomy.sub_topics
        WHERE is_active = TRUE AND canonical_description IS NOT NULL
        ORDER BY id
        """
    )

    duplicate_pairs = []
    seen_pairs: set = set()

    for subtopic in subtopics:
        subtopic_id = subtopic["id"]
        canonical_description = subtopic.get("canonical_description") or ""

        if not canonical_description.strip():
            continue

        try:
            similar = weaviate_service.find_similar_subtopics(
                canonical_description=canonical_description,
                exclude_subtopic_id=subtopic_id,
                limit=3,
            )
        except Exception as e:
            logger.warning("find_similar_subtopics failed for subtopic %s: %s", subtopic_id, e)
            continue

        for candidate in similar:
            candidate_id = candidate.get("subtopic_id")
            distance = candidate.get("distance") or 1.0

            if candidate_id is None:
                continue

            if distance >= config.DUPLICATE_DETECTION_THRESHOLD:
                continue

            # Deduplicate pairs (A,B) and (B,A)
            pair_key = tuple(sorted([subtopic_id, candidate_id]))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            duplicate_pairs.append({
                "subtopic_a_id": subtopic_id,
                "subtopic_a_name": subtopic["name"],
                "subtopic_b_id": candidate_id,
                "subtopic_b_name": candidate.get("name"),
                "distance": round(distance, 4),
                "similarity": round(1 - distance, 4),
            })

    return {
        "subtopics_evaluated": len(subtopics),
        "duplicate_pairs_found": len(duplicate_pairs),
        "pairs": duplicate_pairs,
    }
