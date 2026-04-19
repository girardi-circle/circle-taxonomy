"""
Step 3 — Review & Approval pipeline.

Handles approve/reject of emerging_candidates from the review queue.
"""

import logging
from typing import Optional

from shared.services.redshift import fetch_one, fetch_all, execute
from shared.services import weaviate as weaviate_service

logger = logging.getLogger(__name__)


def _parse_issue_ids(issue_ids_str: Optional[str]) -> list[int]:
    """Parse comma-separated issue IDs string into a list of ints."""
    if not issue_ids_str:
        return []
    result = []
    for part in issue_ids_str.split(","):
        part = part.strip()
        if part.isdigit():
            result.append(int(part))
    return result


def approve_candidate(
    candidate_id: int,
    subtopic_name: Optional[str] = None,
    canonical_description: Optional[str] = None,
    topic_name_override: Optional[str] = None,
) -> dict:
    """
    Approve an emerging candidate:
    1. Get candidate from DB.
    2. Get or create the topic (candidate may reference existing or new topic).
    3. Create subtopic in taxonomy.sub_topics.
    4. Sync to Weaviate SubTopic.
    5. UPDATE all linked classified_issues (sub_topic_id, status=matched, method=new_subtopic).
    6. Sync updated issues to Weaviate ClassifiedIssue.
    7. UPDATE candidate status=approved.

    Returns dict with updated counts.
    """
    candidate = fetch_one(
        "SELECT * FROM taxonomy.emerging_candidates WHERE id = %s",
        (candidate_id,),
    )
    if not candidate:
        raise ValueError(f"Candidate {candidate_id} not found")

    if candidate.get("status") != "pending":
        raise ValueError(f"Candidate {candidate_id} is not pending (status={candidate.get('status')})")

    # Use override values if provided, otherwise use candidate's values
    final_subtopic_name = subtopic_name or candidate.get("suggested_subtopic_name") or "Uncategorized"
    final_canonical_description = canonical_description or candidate.get("canonical_description") or ""

    # Resolve topic — use override if provided, else use candidate's suggestion
    topic_name = topic_name_override or candidate.get("suggested_topic_name") or ""
    topic_id = None
    product_area_id = candidate.get("suggested_product_area_id")

    if topic_name:
        existing_topic = fetch_one(
            "SELECT id, product_area_id FROM taxonomy.topics WHERE LOWER(name) = LOWER(%s)",
            (topic_name,),
        )
        if existing_topic:
            topic_id = existing_topic["id"]
            product_area_id = existing_topic.get("product_area_id") or product_area_id
        else:
            # Create new topic
            execute(
                "INSERT INTO taxonomy.topics (name, description, product_area_id) VALUES (%s, %s, %s)",
                (topic_name, "", product_area_id),
            )
            row = fetch_one(
                "SELECT MAX(id) AS id FROM taxonomy.topics WHERE LOWER(name) = LOWER(%s)",
                (topic_name,),
            )
            topic_id = row["id"] if row else None
            logger.info("Created new topic '%s' (id=%s) from candidate %s", topic_name, topic_id, candidate_id)

    if not topic_id:
        raise ValueError(f"Could not resolve topic for candidate {candidate_id}")

    # Create subtopic
    execute(
        "INSERT INTO taxonomy.sub_topics (topic_id, name, canonical_description) VALUES (%s, %s, %s)",
        (topic_id, final_subtopic_name, final_canonical_description),
    )
    row = fetch_one(
        "SELECT MAX(id) AS id FROM taxonomy.sub_topics WHERE topic_id = %s AND name = %s",
        (topic_id, final_subtopic_name),
    )
    subtopic_id = row["id"] if row else None
    logger.info("Created subtopic '%s' (id=%s) for candidate %s", final_subtopic_name, subtopic_id, candidate_id)

    # Sync to Weaviate — promote the pending entry if it exists, otherwise insert fresh.
    # Pre-migration candidates have no Weaviate entry, so the fallback handles them.
    try:
        promoted = weaviate_service.update_candidate_to_approved(candidate_id, subtopic_id)
        if not promoted:
            weaviate_service.upsert_subtopic(
                subtopic_id=subtopic_id,
                topic_id=topic_id,
                product_area_id=product_area_id,
                name=final_subtopic_name,
                canonical_description=final_canonical_description,
                status="approved",
            )
    except Exception as e:
        logger.warning("Weaviate sync for subtopic %s failed: %s", subtopic_id, e)

    # Update linked classified_issues
    issue_ids = _parse_issue_ids(candidate.get("issue_ids"))
    issues_updated = 0

    if issue_ids:
        placeholders = ",".join(["%s"] * len(issue_ids))
        execute(
            f"""
            UPDATE taxonomy.classified_issues
            SET
                sub_topic_id = %s,
                classification_status = 'matched',
                match_method = 'new_subtopic',
                classified_at = GETDATE()
            WHERE id IN ({placeholders})
            """,
            [subtopic_id] + issue_ids,
        )
        issues_updated = len(issue_ids)

        # Update match_count on subtopic
        execute(
            "UPDATE taxonomy.sub_topics SET match_count = match_count + %s WHERE id = %s",
            (issues_updated, subtopic_id),
        )

        # Sync updated issues to Weaviate
        for issue_id in issue_ids:
            try:
                weaviate_service.update_classified_issue_subtopic(
                    issue_id=issue_id,
                    sub_topic_id=subtopic_id,
                    topic_id=topic_id,
                    product_area_id=product_area_id,
                )
            except Exception as e:
                logger.warning("Weaviate update for issue %s failed: %s", issue_id, e)

    # Mark candidate as approved
    execute(
        "UPDATE taxonomy.emerging_candidates SET status = 'approved' WHERE id = %s",
        (candidate_id,),
    )

    logger.info(
        "Approved candidate %s → subtopic '%s' (id=%s), updated %d issues",
        candidate_id, final_subtopic_name, subtopic_id, issues_updated,
    )

    return {
        "candidate_id": candidate_id,
        "subtopic_id": subtopic_id,
        "subtopic_name": final_subtopic_name,
        "topic_id": topic_id,
        "issues_updated": issues_updated,
        "status": "approved",
    }


def _write_manual_log(issue_id: int, decision: str, notes: str) -> None:
    """Write a manual review action to classification_logs (band='manual')."""
    try:
        execute(
            """INSERT INTO taxonomy.classification_logs
               (issue_id, band, decision, error_message)
               VALUES (%s, %s, %s, %s)""",
            (issue_id, "manual", decision, notes),
        )
    except Exception as e:
        logger.warning("Failed to write manual log for issue %s: %s", issue_id, e)


def reject_candidate_to_pending(candidate_id: int) -> dict:
    """Reject a candidate and return all linked issues to 'pending' status.
    Issues will be picked up by the next classification run."""
    candidate = fetch_one(
        "SELECT * FROM taxonomy.emerging_candidates WHERE id = %s", (candidate_id,)
    )
    if not candidate:
        raise ValueError(f"Candidate {candidate_id} not found")
    if candidate.get("status") != "pending":
        raise ValueError(f"Candidate {candidate_id} is not pending")

    issue_ids = _parse_issue_ids(candidate.get("issue_ids"))

    if issue_ids:
        placeholders = ",".join(["%s"] * len(issue_ids))
        execute(
            f"""UPDATE taxonomy.classified_issues
               SET sub_topic_id = NULL, classification_status = 'pending',
                   match_method = NULL, confidence_score = NULL
               WHERE id IN ({placeholders})""",
            issue_ids,
        )
        for issue_id in issue_ids:
            _write_manual_log(
                issue_id, "rejected_to_pending",
                f"Candidate {candidate_id} rejected by reviewer — issue returned to classification queue",
            )

    try:
        weaviate_service.delete_candidate(candidate_id)
    except Exception as e:
        logger.warning("Weaviate cleanup for rejected candidate %s failed: %s", candidate_id, e)

    execute("UPDATE taxonomy.emerging_candidates SET status = 'rejected' WHERE id = %s", (candidate_id,))
    logger.info("Rejected candidate %s → %d issues returned to pending", candidate_id, len(issue_ids))
    return {"candidate_id": candidate_id, "issues_returned_to_pending": len(issue_ids), "status": "rejected"}


def merge_candidate_into_candidate(source_candidate_id: int, target_candidate_id: int) -> dict:
    """Merge source candidate into target candidate — append issue IDs, reject source."""
    source = fetch_one("SELECT * FROM taxonomy.emerging_candidates WHERE id = %s", (source_candidate_id,))
    target = fetch_one("SELECT * FROM taxonomy.emerging_candidates WHERE id = %s", (target_candidate_id,))

    if not source:
        raise ValueError(f"Source candidate {source_candidate_id} not found")
    if not target:
        raise ValueError(f"Target candidate {target_candidate_id} not found")
    if source.get("status") != "pending":
        raise ValueError(f"Source candidate {source_candidate_id} is not pending")
    if target.get("status") != "pending":
        raise ValueError(f"Target candidate {target_candidate_id} is not pending")

    source_ids = _parse_issue_ids(source.get("issue_ids"))
    target_ids = _parse_issue_ids(target.get("issue_ids"))
    merged_ids = list(dict.fromkeys(target_ids + source_ids))  # dedup, target first

    execute(
        "UPDATE taxonomy.emerging_candidates SET issue_ids = %s, cluster_size = %s WHERE id = %s",
        (",".join(map(str, merged_ids)), len(merged_ids), target_candidate_id),
    )

    # Keep issues in under_review status — they now belong to the target candidate
    for issue_id in source_ids:
        _write_manual_log(
            issue_id, "merged_to_candidate",
            f"Merged from candidate {source_candidate_id} into candidate {target_candidate_id}: {target.get('suggested_subtopic_name')}",
        )

    try:
        weaviate_service.delete_candidate(source_candidate_id)
    except Exception as e:
        logger.warning("Weaviate cleanup for merged candidate %s failed: %s", source_candidate_id, e)

    execute("UPDATE taxonomy.emerging_candidates SET status = 'rejected' WHERE id = %s", (source_candidate_id,))
    logger.info("Merged candidate %s → %s (%d issues)", source_candidate_id, target_candidate_id, len(source_ids))
    return {
        "source_candidate_id": source_candidate_id,
        "target_candidate_id": target_candidate_id,
        "issues_merged": len(source_ids),
        "target_cluster_size": len(merged_ids),
    }


def merge_candidate_into_subtopic(candidate_id: int, subtopic_id: int) -> dict:
    """Merge a pending candidate into an approved subtopic — assign all issues to it."""
    candidate = fetch_one("SELECT * FROM taxonomy.emerging_candidates WHERE id = %s", (candidate_id,))
    if not candidate:
        raise ValueError(f"Candidate {candidate_id} not found")
    if candidate.get("status") != "pending":
        raise ValueError(f"Candidate {candidate_id} is not pending")

    target_subtopic = fetch_one(
        """SELECT st.id, st.name, st.topic_id, t.product_area_id
           FROM taxonomy.sub_topics st JOIN taxonomy.topics t ON st.topic_id = t.id
           WHERE st.id = %s""",
        (subtopic_id,),
    )
    if not target_subtopic:
        raise ValueError(f"Target subtopic {subtopic_id} not found")

    topic_id = target_subtopic["topic_id"]
    product_area_id = target_subtopic.get("product_area_id")
    issue_ids = _parse_issue_ids(candidate.get("issue_ids"))

    if issue_ids:
        placeholders = ",".join(["%s"] * len(issue_ids))
        execute(
            f"""UPDATE taxonomy.classified_issues
               SET sub_topic_id = %s, classification_status = 'matched',
                   match_method = 'new_subtopic', classified_at = GETDATE()
               WHERE id IN ({placeholders})""",
            [subtopic_id] + issue_ids,
        )
        execute(
            "UPDATE taxonomy.sub_topics SET match_count = match_count + %s WHERE id = %s",
            (len(issue_ids), subtopic_id),
        )
        for issue_id in issue_ids:
            try:
                weaviate_service.update_classified_issue_subtopic(
                    issue_id=issue_id, sub_topic_id=subtopic_id,
                    topic_id=topic_id, product_area_id=product_area_id,
                )
            except Exception as e:
                logger.warning("Weaviate update for issue %s failed: %s", issue_id, e)
            _write_manual_log(
                issue_id, "merged_to_subtopic",
                f"Merged from candidate {candidate_id} into approved subtopic {subtopic_id}: {target_subtopic.get('name')}",
            )

    try:
        weaviate_service.delete_candidate(candidate_id)
    except Exception as e:
        logger.warning("Weaviate cleanup for candidate %s failed: %s", candidate_id, e)

    execute("UPDATE taxonomy.emerging_candidates SET status = 'rejected' WHERE id = %s", (candidate_id,))
    logger.info("Merged candidate %s into subtopic %s (%d issues)", candidate_id, subtopic_id, len(issue_ids))
    return {"candidate_id": candidate_id, "subtopic_id": subtopic_id, "issues_merged": len(issue_ids)}


def reject_candidate(
    candidate_id: int,
    merge_into_subtopic_id: int,
) -> dict:
    """
    Reject an emerging candidate:
    1. Get candidate.
    2. UPDATE linked classified_issues to sub_topic_id=merge_into_subtopic_id, status=matched.
    3. Sync to Weaviate.
    4. UPDATE candidate status=rejected.

    Returns dict with updated counts.
    """
    candidate = fetch_one(
        "SELECT * FROM taxonomy.emerging_candidates WHERE id = %s",
        (candidate_id,),
    )
    if not candidate:
        raise ValueError(f"Candidate {candidate_id} not found")

    if candidate.get("status") != "pending":
        raise ValueError(f"Candidate {candidate_id} is not pending (status={candidate.get('status')})")

    # Verify the target subtopic exists
    target_subtopic = fetch_one(
        """
        SELECT st.id, st.topic_id, t.product_area_id
        FROM taxonomy.sub_topics st
        JOIN taxonomy.topics t ON st.topic_id = t.id
        WHERE st.id = %s
        """,
        (merge_into_subtopic_id,),
    )
    if not target_subtopic:
        raise ValueError(f"Target subtopic {merge_into_subtopic_id} not found")

    topic_id = target_subtopic["topic_id"]
    product_area_id = target_subtopic.get("product_area_id")

    issue_ids = _parse_issue_ids(candidate.get("issue_ids"))
    issues_updated = 0

    if issue_ids:
        placeholders = ",".join(["%s"] * len(issue_ids))
        execute(
            f"""
            UPDATE taxonomy.classified_issues
            SET
                sub_topic_id = %s,
                classification_status = 'matched',
                match_method = 'new_subtopic',
                classified_at = GETDATE()
            WHERE id IN ({placeholders})
            """,
            [merge_into_subtopic_id] + issue_ids,
        )
        issues_updated = len(issue_ids)

        # Update match_count on target subtopic
        execute(
            "UPDATE taxonomy.sub_topics SET match_count = match_count + %s WHERE id = %s",
            (issues_updated, merge_into_subtopic_id),
        )

        # Sync updated issues to Weaviate
        for issue_id in issue_ids:
            try:
                weaviate_service.update_classified_issue_subtopic(
                    issue_id=issue_id,
                    sub_topic_id=merge_into_subtopic_id,
                    topic_id=topic_id,
                    product_area_id=product_area_id,
                )
            except Exception as e:
                logger.warning("Weaviate update for issue %s failed: %s", issue_id, e)

    # Remove the pending Weaviate entry so it can't be matched by future classifications
    try:
        weaviate_service.delete_candidate(candidate_id)
    except Exception as e:
        logger.warning("Weaviate cleanup for rejected candidate %s failed: %s", candidate_id, e)

    # Mark candidate as rejected
    execute(
        "UPDATE taxonomy.emerging_candidates SET status = 'rejected' WHERE id = %s",
        (candidate_id,),
    )

    logger.info(
        "Rejected candidate %s → merged %d issues into subtopic %s",
        candidate_id, issues_updated, merge_into_subtopic_id,
    )

    return {
        "candidate_id": candidate_id,
        "merge_into_subtopic_id": merge_into_subtopic_id,
        "issues_updated": issues_updated,
        "status": "rejected",
    }
