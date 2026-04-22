"""
Taxonomy governance operations — merge, move, rename, deactivate, reassign.

Phase 2 additions:
- Soft-delete with merged_into_id (never hard-delete topics/subtopics)
- taxonomy_changes audit log for every structural operation
- Centroid update on surviving subtopic after merge (optional, default ON)
"""
import json
import logging
from typing import Optional
from shared.services.redshift import fetch_all, fetch_one, execute
from shared.services import weaviate as weaviate_service

logger = logging.getLogger(__name__)


# ── Audit helpers ─────────────────────────────────────────────────────────────

def _log_manual(issue_id: int, decision: str, notes: str) -> None:
    """Write an issue-level manual action to classification_logs."""
    try:
        execute(
            "INSERT INTO taxonomy.classification_logs (issue_id, band, decision, error_message) VALUES (%s, 'manual', %s, %s)",
            (issue_id, decision, notes),
        )
    except Exception as e:
        logger.warning("Failed to write classification log for issue %s: %s", issue_id, e)


def _log_taxonomy_change(
    action_type: str,
    entity_type: str,
    source_id: int,
    source_name: Optional[str],
    target_id: Optional[int] = None,
    target_name: Optional[str] = None,
    notes: Optional[str] = None,
) -> None:
    """Write a structural taxonomy change to taxonomy_changes."""
    try:
        execute(
            """INSERT INTO taxonomy.taxonomy_changes
               (action_type, entity_type, source_id, source_name, target_id, target_name, notes)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (action_type, entity_type, source_id, source_name, target_id, target_name, notes),
        )
    except Exception as e:
        logger.warning("Failed to write taxonomy_change for %s %s: %s", entity_type, source_id, e)


# ── Centroid maintenance ──────────────────────────────────────────────────────

def _run_centroid_for_subtopic(subtopic_id: int, min_issues: int = 3) -> bool:
    """
    Run centroid update (Prompt 4) on a single subtopic.
    Called automatically after merge operations.
    Returns True if the description was updated.
    """
    from shared.services.anthropic import call_claude
    from shared.prompts.centroid_update import build_centroid_update_prompt
    from shared.pipeline.extraction import _strip_fences
    from shared import config

    subtopic = fetch_one(
        "SELECT name, canonical_description, match_count FROM taxonomy.sub_topics WHERE id = %s",
        (subtopic_id,),
    )
    if not subtopic or (subtopic["match_count"] or 0) < min_issues:
        logger.debug("Skipping centroid for subtopic %s (match_count=%s)", subtopic_id, subtopic and subtopic["match_count"])
        return False

    issues = fetch_all(
        """SELECT segment_description FROM taxonomy.classified_issues
           WHERE sub_topic_id = %s AND classification_status = 'matched'
             AND segment_description IS NOT NULL
           LIMIT 50""",
        (subtopic_id,),
    )
    if len(issues) < min_issues:
        return False

    descriptions = [i["segment_description"] for i in issues]
    system, user = build_centroid_update_prompt(
        subtopic["name"],
        subtopic["canonical_description"] or "",
        subtopic["match_count"],
        descriptions,
    )

    try:
        text, _ = call_claude(
            system=system, user=user,
            model=config.MODEL_CENTROID_UPDATE,
            temperature=0.2, max_tokens=512,
        )
        result = json.loads(_strip_fences(text))
        new_desc = (result.get("canonical_description") or "").strip()
        if not new_desc:
            return False

        execute(
            "UPDATE taxonomy.sub_topics SET canonical_description = %s WHERE id = %s",
            (new_desc, subtopic_id),
        )
        try:
            weaviate_service.update_subtopic_description(subtopic_id, new_desc)
        except Exception as e:
            logger.warning("Weaviate centroid sync failed for subtopic %s: %s", subtopic_id, e)

        logger.info("Centroid updated for subtopic %s after merge", subtopic_id)
        return True
    except Exception as e:
        logger.warning("Centroid update failed for subtopic %s: %s", subtopic_id, e)
        return False


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_topic_product_area(topic_id: int) -> Optional[int]:
    row = fetch_one("SELECT product_area_id FROM taxonomy.topics WHERE id = %s", (topic_id,))
    return row["product_area_id"] if row else None


def _get_topic_name(topic_id: int) -> Optional[str]:
    row = fetch_one("SELECT name FROM taxonomy.topics WHERE id = %s", (topic_id,))
    return row["name"] if row else None


def _get_subtopic_name(subtopic_id: int) -> Optional[str]:
    row = fetch_one("SELECT name FROM taxonomy.sub_topics WHERE id = %s", (subtopic_id,))
    return row["name"] if row else None


# ── Health ────────────────────────────────────────────────────────────────────

def get_taxonomy_health() -> dict:
    total_topics = fetch_one("SELECT COUNT(*) AS n FROM taxonomy.topics WHERE is_active = TRUE")["n"]
    total_subtopics = fetch_one("SELECT COUNT(*) AS n FROM taxonomy.sub_topics WHERE is_active = TRUE")["n"]
    one_subtopic = fetch_one("""
        SELECT COUNT(*) AS n FROM (
            SELECT topic_id FROM taxonomy.sub_topics WHERE is_active = TRUE
            GROUP BY topic_id HAVING COUNT(*) = 1
        ) t
    """)["n"]
    few_issues = fetch_one(
        "SELECT COUNT(*) AS n FROM taxonomy.sub_topics WHERE is_active = TRUE AND match_count < 3"
    )["n"]
    no_issues = fetch_one(
        "SELECT COUNT(*) AS n FROM taxonomy.sub_topics WHERE is_active = TRUE AND match_count = 0"
    )["n"]
    return {
        "total_topics": total_topics,
        "total_subtopics": total_subtopics,
        "topics_with_one_subtopic": one_subtopic,
        "subtopics_with_few_issues": few_issues,
        "subtopics_with_no_issues": no_issues,
    }


# ── Topic operations ──────────────────────────────────────────────────────────

def update_topic(
    topic_id: int,
    name: Optional[str],
    description: Optional[str],
    product_area_id: Optional[int],
) -> dict:
    current = fetch_one("SELECT name, description, product_area_id FROM taxonomy.topics WHERE id = %s", (topic_id,))
    if not current:
        raise ValueError(f"Topic {topic_id} not found")

    fields, params = [], []
    if name is not None:
        fields.append("name = %s"); params.append(name)
    if description is not None:
        fields.append("description = %s"); params.append(description)
    if product_area_id is not None:
        fields.append("product_area_id = %s"); params.append(product_area_id)
    if not fields:
        return {"updated": False}

    execute(f"UPDATE taxonomy.topics SET {', '.join(fields)} WHERE id = %s", params + [topic_id])

    # Log rename
    if name is not None and name != current["name"]:
        _log_taxonomy_change(
            "rename_topic", "topic", topic_id, current["name"],
            notes=f"Renamed to: {name}",
        )

    # Re-sync Weaviate if product_area changed
    sync_warnings = []
    if product_area_id is not None and product_area_id != current["product_area_id"]:
        subtopics = fetch_all(
            "SELECT id FROM taxonomy.sub_topics WHERE topic_id = %s AND is_active = TRUE", (topic_id,)
        )
        for st in subtopics:
            try:
                weaviate_service.update_subtopic_topic_assignment(st["id"], topic_id, product_area_id)
            except Exception as e:
                logger.warning("Weaviate subtopic update failed for %s: %s", st["id"], e)
                sync_warnings.append(f"subtopic {st['id']}: {e}")
            for iss in fetch_all("SELECT id FROM taxonomy.classified_issues WHERE sub_topic_id = %s", (st["id"],)):
                try:
                    weaviate_service.update_classified_issue_subtopic(iss["id"], st["id"], topic_id, product_area_id)
                except Exception as e:
                    logger.warning("Weaviate issue update failed for %s: %s", iss["id"], e)
                    sync_warnings.append(f"issue {iss['id']}: {e}")

    return {"updated": True, "topic_id": topic_id, "sync_warnings": sync_warnings}


def merge_topic(
    source_topic_id: int,
    target_topic_id: int,
    run_centroid: bool = True,
) -> dict:
    """
    Move all subtopics from source into target.
    Soft-deletes source with merged_into_id = target.
    Optionally runs centroid update on surviving subtopics.
    """
    source = fetch_one(
        "SELECT id, name FROM taxonomy.topics WHERE id = %s AND is_active = TRUE",
        (source_topic_id,),
    )
    target = fetch_one(
        "SELECT id, name, product_area_id FROM taxonomy.topics WHERE id = %s AND is_active = TRUE",
        (target_topic_id,),
    )
    if not source:
        raise ValueError(f"Source topic {source_topic_id} not found or already inactive")
    if not target:
        raise ValueError(f"Target topic {target_topic_id} not found")

    subtopics = fetch_all(
        "SELECT id FROM taxonomy.sub_topics WHERE topic_id = %s AND is_active = TRUE",
        (source_topic_id,),
    )
    new_pa = target["product_area_id"]

    # Move all subtopics
    execute(
        "UPDATE taxonomy.sub_topics SET topic_id = %s WHERE topic_id = %s",
        (target_topic_id, source_topic_id),
    )

    # Sync Weaviate for each moved subtopic + its issues
    sync_warnings = []
    for st in subtopics:
        try:
            weaviate_service.update_subtopic_topic_assignment(st["id"], target_topic_id, new_pa)
        except Exception as e:
            logger.warning("Weaviate subtopic update failed for %s: %s", st["id"], e)
            sync_warnings.append(f"subtopic {st['id']}: {e}")
        for iss in fetch_all("SELECT id FROM taxonomy.classified_issues WHERE sub_topic_id = %s", (st["id"],)):
            try:
                weaviate_service.update_classified_issue_subtopic(iss["id"], st["id"], target_topic_id, new_pa)
            except Exception as e:
                logger.warning("Weaviate issue update failed for %s: %s", iss["id"], e)
                sync_warnings.append(f"issue {iss['id']}: {e}")
            _log_manual(iss["id"], "topic_merged", f"Topic '{source['name']}' merged into '{target['name']}'")

    # Soft-delete source with lineage
    execute(
        "UPDATE taxonomy.topics SET is_active = FALSE, merged_into_id = %s WHERE id = %s",
        (target_topic_id, source_topic_id),
    )

    _log_taxonomy_change(
        "merge_topic", "topic",
        source_topic_id, source["name"],
        target_topic_id, target["name"],
        notes=f"Merged {len(subtopics)} subtopics into target topic",
    )

    # Centroid update on all surviving subtopics
    centroid_updated = 0
    if run_centroid:
        for st in subtopics:
            if _run_centroid_for_subtopic(st["id"]):
                centroid_updated += 1

    logger.info("Merged topic '%s' into '%s' (%d subtopics, %d centroids updated)",
                source["name"], target["name"], len(subtopics), centroid_updated)
    return {
        "subtopics_moved": len(subtopics),
        "source_deactivated": True,
        "merged_into_id": target_topic_id,
        "centroids_updated": centroid_updated,
        "sync_warnings": sync_warnings,
    }


def delete_topic(topic_id: int) -> dict:
    """Soft-delete a topic — only allowed when it has 0 active subtopics."""
    count = fetch_one(
        "SELECT COUNT(*) AS n FROM taxonomy.sub_topics WHERE topic_id = %s AND is_active = TRUE",
        (topic_id,),
    )["n"]
    if count > 0:
        raise ValueError(f"Cannot deactivate topic {topic_id}: it still has {count} active subtopics")

    name = _get_topic_name(topic_id)
    execute("UPDATE taxonomy.topics SET is_active = FALSE WHERE id = %s", (topic_id,))
    _log_taxonomy_change("deactivate_topic", "topic", topic_id, name)
    return {"deactivated": True, "topic_id": topic_id}


# ── Subtopic operations ───────────────────────────────────────────────────────

def update_subtopic(
    subtopic_id: int,
    name: Optional[str],
    canonical_description: Optional[str],
) -> dict:
    """Update subtopic name/description. Logs rename to taxonomy_changes."""
    current = fetch_one(
        "SELECT name, canonical_description FROM taxonomy.sub_topics WHERE id = %s", (subtopic_id,)
    )
    if not current:
        raise ValueError(f"Subtopic {subtopic_id} not found")

    fields, params = [], []
    if name is not None:
        fields.append("name = %s"); params.append(name)
    if canonical_description is not None:
        fields.append("canonical_description = %s"); params.append(canonical_description)
    if not fields:
        return {"updated": False}

    execute(
        f"UPDATE taxonomy.sub_topics SET {', '.join(fields)} WHERE id = %s",
        params + [subtopic_id],
    )

    if name is not None and name != current["name"]:
        _log_taxonomy_change(
            "rename_subtopic", "subtopic", subtopic_id, current["name"],
            notes=f"Renamed to: {name}",
        )

    # Re-sync Weaviate description if it changed
    sync_warnings = []
    if canonical_description is not None and canonical_description != current["canonical_description"]:
        try:
            weaviate_service.update_subtopic_description(subtopic_id, canonical_description)
        except Exception as e:
            logger.warning("Weaviate description sync failed for subtopic %s: %s", subtopic_id, e)
            sync_warnings.append(f"subtopic {subtopic_id}: {e}")

    return {"updated": True, "subtopic_id": subtopic_id, "sync_warnings": sync_warnings}


def move_subtopic(subtopic_id: int, target_topic_id: int) -> dict:
    """Move a subtopic to a different topic. Logs to taxonomy_changes."""
    current = fetch_one(
        "SELECT st.name, st.topic_id, t.name AS topic_name FROM taxonomy.sub_topics st JOIN taxonomy.topics t ON st.topic_id = t.id WHERE st.id = %s",
        (subtopic_id,),
    )
    if not current:
        raise ValueError(f"Subtopic {subtopic_id} not found")

    target_topic = fetch_one(
        "SELECT id, name, product_area_id FROM taxonomy.topics WHERE id = %s AND is_active = TRUE",
        (target_topic_id,),
    )
    if not target_topic:
        raise ValueError(f"Target topic {target_topic_id} not found")

    new_pa = target_topic["product_area_id"]
    execute("UPDATE taxonomy.sub_topics SET topic_id = %s WHERE id = %s", (target_topic_id, subtopic_id))

    sync_warnings = []
    try:
        weaviate_service.update_subtopic_topic_assignment(subtopic_id, target_topic_id, new_pa)
    except Exception as e:
        logger.warning("Weaviate subtopic move failed for %s: %s", subtopic_id, e)
        sync_warnings.append(f"subtopic {subtopic_id}: {e}")

    issues = fetch_all("SELECT id FROM taxonomy.classified_issues WHERE sub_topic_id = %s", (subtopic_id,))
    for iss in issues:
        try:
            weaviate_service.update_classified_issue_subtopic(iss["id"], subtopic_id, target_topic_id, new_pa)
        except Exception as e:
            logger.warning("Weaviate issue update failed for %s: %s", iss["id"], e)
            sync_warnings.append(f"issue {iss['id']}: {e}")
        _log_manual(iss["id"], "subtopic_moved", f"Subtopic moved from topic '{current['topic_name']}' to '{target_topic['name']}'")

    _log_taxonomy_change(
        "move_subtopic", "subtopic",
        subtopic_id, current["name"],
        target_topic_id, target_topic["name"],
        notes=f"Moved from topic '{current['topic_name']}' (id={current['topic_id']})",
    )
    return {"moved": True, "issues_updated": len(issues), "sync_warnings": sync_warnings}


def merge_subtopic(
    source_subtopic_id: int,
    target_subtopic_id: int,
    run_centroid: bool = True,
) -> dict:
    """
    Merge source subtopic into target.
    Reassigns all issues, soft-deletes source with merged_into_id = target.
    Optionally runs centroid update on target.
    """
    source = fetch_one("SELECT name FROM taxonomy.sub_topics WHERE id = %s", (source_subtopic_id,))
    target = fetch_one(
        """SELECT st.id, st.name, st.topic_id, t.product_area_id
           FROM taxonomy.sub_topics st JOIN taxonomy.topics t ON st.topic_id = t.id
           WHERE st.id = %s""",
        (target_subtopic_id,),
    )
    if not source:
        raise ValueError(f"Source subtopic {source_subtopic_id} not found")
    if not target:
        raise ValueError(f"Target subtopic {target_subtopic_id} not found")

    issues = fetch_all(
        "SELECT id FROM taxonomy.classified_issues WHERE sub_topic_id = %s", (source_subtopic_id,)
    )
    issue_ids = [i["id"] for i in issues]

    sync_warnings = []
    if issue_ids:
        placeholders = ",".join(["%s"] * len(issue_ids))
        execute(
            f"UPDATE taxonomy.classified_issues SET sub_topic_id = %s WHERE id IN ({placeholders})",
            [target_subtopic_id] + issue_ids,
        )
        for issue_id in issue_ids:
            try:
                weaviate_service.update_classified_issue_subtopic(
                    issue_id, target_subtopic_id, target["topic_id"], target["product_area_id"]
                )
            except Exception as e:
                logger.warning("Weaviate issue update failed for %s: %s", issue_id, e)
                sync_warnings.append(f"issue {issue_id}: {e}")
            _log_manual(issue_id, "subtopic_merged",
                        f"Subtopic '{source['name']}' merged into '{target['name']}'")

    # Recalculate match_count on target
    execute(
        """UPDATE taxonomy.sub_topics
           SET match_count = (SELECT COUNT(*) FROM taxonomy.classified_issues
                              WHERE sub_topic_id = %s AND classification_status = 'matched')
           WHERE id = %s""",
        (target_subtopic_id, target_subtopic_id),
    )

    # Soft-delete source with lineage
    execute(
        "UPDATE taxonomy.sub_topics SET match_count = 0, is_active = FALSE, merged_into_id = %s WHERE id = %s",
        (target_subtopic_id, source_subtopic_id),
    )

    # Remove from Weaviate
    try:
        weaviate_service.delete_subtopic(source_subtopic_id)
    except Exception as e:
        logger.warning("Weaviate subtopic delete failed for %s: %s", source_subtopic_id, e)
        sync_warnings.append(f"subtopic delete {source_subtopic_id}: {e}")

    _log_taxonomy_change(
        "merge_subtopic", "subtopic",
        source_subtopic_id, source["name"],
        target_subtopic_id, target["name"],
        notes=f"Merged {len(issue_ids)} issues into target subtopic",
    )

    # Centroid update on surviving subtopic
    centroid_updated = False
    if run_centroid:
        centroid_updated = _run_centroid_for_subtopic(target_subtopic_id)

    logger.info("Merged subtopic '%s' into '%s' (%d issues, centroid=%s)",
                source["name"], target["name"], len(issue_ids), centroid_updated)
    return {
        "issues_reassigned": len(issue_ids),
        "source_deactivated": True,
        "merged_into_id": target_subtopic_id,
        "centroid_updated": centroid_updated,
        "sync_warnings": sync_warnings,
    }


def delete_subtopic_record(subtopic_id: int) -> dict:
    """Soft-delete a subtopic — only allowed when it has 0 matched issues."""
    count = fetch_one(
        """SELECT COUNT(*) AS n FROM taxonomy.classified_issues
           WHERE sub_topic_id = %s AND classification_status = 'matched'""",
        (subtopic_id,),
    )["n"]
    if count > 0:
        raise ValueError(f"Cannot deactivate subtopic {subtopic_id}: it still has {count} matched issues")

    name = _get_subtopic_name(subtopic_id)
    execute("UPDATE taxonomy.sub_topics SET is_active = FALSE WHERE id = %s", (subtopic_id,))
    sync_warnings = []
    try:
        weaviate_service.delete_subtopic(subtopic_id)
    except Exception as e:
        logger.warning("Weaviate subtopic delete failed for %s: %s", subtopic_id, e)
        sync_warnings.append(f"subtopic delete {subtopic_id}: {e}")

    _log_taxonomy_change("deactivate_subtopic", "subtopic", subtopic_id, name)
    return {"deactivated": True, "subtopic_id": subtopic_id, "sync_warnings": sync_warnings}


# ── Issue reassignment ────────────────────────────────────────────────────────

def _do_reassign(issue_id: int, target_subtopic_id: int) -> None:
    old = fetch_one("SELECT sub_topic_id FROM taxonomy.classified_issues WHERE id = %s", (issue_id,))
    old_subtopic_id = old["sub_topic_id"] if old else None

    target = fetch_one(
        """SELECT st.id, st.topic_id, t.product_area_id
           FROM taxonomy.sub_topics st JOIN taxonomy.topics t ON st.topic_id = t.id
           WHERE st.id = %s""",
        (target_subtopic_id,),
    )
    if not target:
        raise ValueError(f"Target subtopic {target_subtopic_id} not found")

    execute(
        "UPDATE taxonomy.classified_issues SET sub_topic_id = %s, classification_status = 'matched', match_method = 'new_subtopic' WHERE id = %s",
        (target_subtopic_id, issue_id),
    )
    if old_subtopic_id and old_subtopic_id != target_subtopic_id:
        execute(
            "UPDATE taxonomy.sub_topics SET match_count = GREATEST(0, match_count - 1) WHERE id = %s",
            (old_subtopic_id,),
        )
    execute(
        "UPDATE taxonomy.sub_topics SET match_count = match_count + 1 WHERE id = %s",
        (target_subtopic_id,),
    )
    sync_warning = None
    try:
        weaviate_service.update_classified_issue_subtopic(
            issue_id, target_subtopic_id, target["topic_id"], target["product_area_id"]
        )
    except Exception as e:
        logger.warning("Weaviate issue update failed for %s: %s", issue_id, e)
        sync_warning = str(e)
    _log_manual(issue_id, "issue_reassigned",
                f"Reassigned from subtopic {old_subtopic_id} to {target_subtopic_id}")
    return sync_warning


def reassign_issue(issue_id: int, target_subtopic_id: int) -> dict:
    sync_warning = _do_reassign(issue_id, target_subtopic_id)
    return {
        "reassigned": True,
        "issue_id": issue_id,
        "target_subtopic_id": target_subtopic_id,
        "sync_warnings": [sync_warning] if sync_warning else [],
    }


def bulk_reassign_issues(issue_ids: list[int], target_subtopic_id: int) -> dict:
    errors = 0
    sync_warnings = []
    for issue_id in issue_ids:
        try:
            warning = _do_reassign(issue_id, target_subtopic_id)
            if warning:
                sync_warnings.append(f"issue {issue_id}: {warning}")
        except Exception as e:
            logger.error("Failed to reassign issue %s: %s", issue_id, e)
            errors += 1
    return {
        "reassigned": len(issue_ids) - errors,
        "errors": errors,
        "target_subtopic_id": target_subtopic_id,
        "sync_warnings": sync_warnings,
    }
