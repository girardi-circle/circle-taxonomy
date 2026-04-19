"""
Weaviate sync functions — vectorize_all, vectorize_issues, vectorize_transcripts, reconcile.
"""

import logging
from typing import Optional

from shared.services.redshift import fetch_all
from shared.services import weaviate as weaviate_service

logger = logging.getLogger(__name__)


def vectorize_issues(issue_ids: Optional[list[int]] = None) -> int:
    """
    Sync specific issues (or all if issue_ids is None) to Weaviate ClassifiedIssue.
    Fetches full issue data from Redshift including joins for nature_id, intent_id,
    sub_topic_id, topic_id, product_area_id, and source_url.
    Returns count of issues synced.
    """
    if issue_ids:
        placeholders = ",".join(["%s"] * len(issue_ids))
        rows = fetch_all(
            f"""
            SELECT
                ci.id                  AS issue_id,
                ci.transcript_id,
                ci.sub_topic_id,
                COALESCE(st.topic_id, 0)          AS topic_id,
                COALESCE(t.product_area_id, 0)    AS product_area_id,
                ci.nature_id,
                ci.intent_id,
                ci.sentiment,
                CAST(ci.classified_at AS VARCHAR) AS classified_at,
                COALESCE(tr.source_url, '')       AS source_url,
                ci.segment_description,
                ci.verbatim_excerpt
            FROM taxonomy.classified_issues ci
            LEFT JOIN taxonomy.sub_topics st ON ci.sub_topic_id = st.id
            LEFT JOIN taxonomy.topics t ON st.topic_id = t.id
            LEFT JOIN taxonomy.transcripts tr ON ci.transcript_id = tr.id
            WHERE ci.id IN ({placeholders})
            """,
            issue_ids,
        )
    else:
        rows = fetch_all(
            """
            SELECT
                ci.id                  AS issue_id,
                ci.transcript_id,
                ci.sub_topic_id,
                COALESCE(st.topic_id, 0)          AS topic_id,
                COALESCE(t.product_area_id, 0)    AS product_area_id,
                ci.nature_id,
                ci.intent_id,
                ci.sentiment,
                CAST(ci.classified_at AS VARCHAR) AS classified_at,
                COALESCE(tr.source_url, '')       AS source_url,
                ci.segment_description,
                ci.verbatim_excerpt
            FROM taxonomy.classified_issues ci
            LEFT JOIN taxonomy.sub_topics st ON ci.sub_topic_id = st.id
            LEFT JOIN taxonomy.topics t ON st.topic_id = t.id
            LEFT JOIN taxonomy.transcripts tr ON ci.transcript_id = tr.id
            WHERE ci.segment_description IS NOT NULL
            """
        )

    if not rows:
        return 0

    synced = weaviate_service.bulk_upsert_classified_issues(rows)
    logger.info("vectorize_issues: synced %d issues to Weaviate", synced)
    return synced


def vectorize_transcripts(transcript_ids: Optional[list[int]] = None) -> int:
    """
    Sync specific transcripts (or all if transcript_ids is None) to Weaviate Transcript.
    Returns count of transcripts synced.
    """
    if transcript_ids:
        placeholders = ",".join(["%s"] * len(transcript_ids))
        rows = fetch_all(
            f"""
            SELECT
                id              AS transcript_id,
                source_id,
                source_type,
                community_id,
                title,
                source_url,
                summary,
                raw_text
            FROM taxonomy.transcripts
            WHERE id IN ({placeholders})
            """,
            transcript_ids,
        )
    else:
        rows = fetch_all(
            """
            SELECT
                id              AS transcript_id,
                source_id,
                source_type,
                community_id,
                title,
                source_url,
                summary,
                raw_text
            FROM taxonomy.transcripts
            WHERE raw_text IS NOT NULL
            """
        )

    if not rows:
        return 0

    synced = weaviate_service.bulk_upsert_transcripts(rows)
    logger.info("vectorize_transcripts: synced %d transcripts to Weaviate", synced)
    return synced


def vectorize_subtopics() -> int:
    """
    Sync all active subtopics to Weaviate SubTopic.
    Returns count of subtopics synced.
    """
    rows = fetch_all(
        """
        SELECT
            st.id               AS subtopic_id,
            st.topic_id,
            COALESCE(t.product_area_id, 0) AS product_area_id,
            st.name,
            st.canonical_description
        FROM taxonomy.sub_topics st
        JOIN taxonomy.topics t ON st.topic_id = t.id
        WHERE st.is_active = TRUE AND st.canonical_description IS NOT NULL
        """
    )

    if not rows:
        return 0

    synced = 0
    for row in rows:
        try:
            weaviate_service.upsert_subtopic(
                subtopic_id=row["subtopic_id"],
                topic_id=row["topic_id"],
                product_area_id=row.get("product_area_id"),
                name=row["name"],
                canonical_description=row["canonical_description"],
            )
            synced += 1
        except Exception as e:
            logger.error("Failed to upsert subtopic %s: %s", row["subtopic_id"], e)

    logger.info("vectorize_subtopics: synced %d subtopics to Weaviate", synced)
    return synced


def vectorize_all(incremental: bool = False) -> dict:
    """
    Sync all or new-only records from Redshift to Weaviate.

    If incremental=False (or Weaviate is empty), bulk-load all records.
    If incremental=True, only load records not yet in Weaviate (by comparing counts).

    Returns {classified_issues_synced, transcripts_synced, subtopics_synced}.
    """
    # Ensure collections exist
    try:
        weaviate_service.create_collections()
    except Exception as e:
        logger.error("Failed to create Weaviate collections: %s", e)
        raise

    weaviate_counts = weaviate_service.get_collection_counts()

    issues_already = weaviate_counts.get(weaviate_service.CLASSIFIED_ISSUE_COLLECTION) or 0
    transcripts_already = weaviate_counts.get(weaviate_service.TRANSCRIPT_COLLECTION) or 0
    subtopics_already = weaviate_counts.get(weaviate_service.SUBTOPIC_COLLECTION) or 0

    # Decide whether to do full or incremental sync
    force_full = not incremental or (issues_already == 0 and transcripts_already == 0)

    if force_full:
        logger.info("vectorize_all: full sync (incremental=%s, weaviate_issues=%d)", incremental, issues_already)
        issues_synced = vectorize_issues()
        transcripts_synced = vectorize_transcripts()
        subtopics_synced = vectorize_subtopics()
    else:
        # Incremental: only sync if Weaviate count is less than Redshift count
        from shared.services.redshift import fetch_one

        issues_synced = 0
        transcripts_synced = 0
        subtopics_synced = 0

        rs_issues = fetch_one("SELECT COUNT(*) AS cnt FROM taxonomy.classified_issues WHERE segment_description IS NOT NULL")
        rs_issues_count = rs_issues["cnt"] if rs_issues else 0
        if rs_issues_count > issues_already:
            issues_synced = vectorize_issues()

        rs_transcripts = fetch_one("SELECT COUNT(*) AS cnt FROM taxonomy.transcripts WHERE raw_text IS NOT NULL")
        rs_transcripts_count = rs_transcripts["cnt"] if rs_transcripts else 0
        if rs_transcripts_count > transcripts_already:
            transcripts_synced = vectorize_transcripts()

        rs_subtopics = fetch_one(
            "SELECT COUNT(*) AS cnt FROM taxonomy.sub_topics WHERE is_active = TRUE AND canonical_description IS NOT NULL"
        )
        rs_subtopics_count = rs_subtopics["cnt"] if rs_subtopics else 0
        if rs_subtopics_count > subtopics_already:
            subtopics_synced = vectorize_subtopics()

    return {
        "classified_issues_synced": issues_synced,
        "transcripts_synced": transcripts_synced,
        "subtopics_synced": subtopics_synced,
    }


def reconcile() -> dict:
    """
    Compare Redshift counts vs Weaviate counts.
    Returns {collection: {redshift: N, weaviate: N, diff: N}}.
    """
    from shared.services.redshift import fetch_one

    weaviate_counts = weaviate_service.get_collection_counts()

    rs_issues = fetch_one("SELECT COUNT(*) AS cnt FROM taxonomy.classified_issues")
    rs_transcripts = fetch_one("SELECT COUNT(*) AS cnt FROM taxonomy.transcripts")
    rs_subtopics = fetch_one("SELECT COUNT(*) AS cnt FROM taxonomy.sub_topics WHERE is_active = TRUE")

    rs_issues_count = rs_issues["cnt"] if rs_issues else 0
    rs_transcripts_count = rs_transcripts["cnt"] if rs_transcripts else 0
    rs_subtopics_count = rs_subtopics["cnt"] if rs_subtopics else 0

    wv_issues = weaviate_counts.get(weaviate_service.CLASSIFIED_ISSUE_COLLECTION) or 0
    wv_transcripts = weaviate_counts.get(weaviate_service.TRANSCRIPT_COLLECTION) or 0
    wv_subtopics = weaviate_counts.get(weaviate_service.SUBTOPIC_COLLECTION) or 0

    return {
        "ClassifiedIssue": {
            "redshift": rs_issues_count,
            "weaviate": wv_issues,
            "diff": rs_issues_count - wv_issues,
        },
        "Transcript": {
            "redshift": rs_transcripts_count,
            "weaviate": wv_transcripts,
            "diff": rs_transcripts_count - wv_transcripts,
        },
        "SubTopic": {
            "redshift": rs_subtopics_count,
            "weaviate": wv_subtopics,
            "diff": rs_subtopics_count - wv_subtopics,
        },
    }
