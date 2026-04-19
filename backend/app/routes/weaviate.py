from fastapi import APIRouter
from shared.pipeline.vectorize import vectorize_issues, vectorize_transcripts
from shared.services.weaviate import get_collection_counts, create_collections, migrate_subtopic_schema
from shared.services.redshift import fetch_one

router = APIRouter()


@router.post("/migrate/subtopic-status")
def migrate_subtopic_status():
    """Add status + candidate_id to SubTopic schema and backfill existing objects as approved."""
    result = migrate_subtopic_schema()
    return {"status": "ok", **result}


@router.post("/setup")
def setup():
    """Create all three Weaviate collections if they don't already exist."""
    create_collections()
    return {"status": "ok", "message": "Collections created (or already existed)"}


@router.get("/collections/status")
def collections_status():
    """Stats for all three Weaviate collections vs Redshift source tables."""
    weaviate_counts = get_collection_counts()

    issues_row = fetch_one("SELECT COUNT(*) AS total FROM taxonomy.classified_issues")
    transcripts_row = fetch_one("SELECT COUNT(*) AS total FROM taxonomy.transcripts")
    subtopics_row = fetch_one("SELECT COUNT(*) AS total FROM taxonomy.sub_topics WHERE is_active = TRUE")

    issues_total = issues_row["total"] if issues_row else 0
    transcripts_total = transcripts_row["total"] if transcripts_row else 0
    subtopics_total = subtopics_row["total"] if subtopics_row else 0

    ci = weaviate_counts.get("ClassifiedIssue", 0)
    tr = weaviate_counts.get("Transcript", 0)
    st = weaviate_counts.get("SubTopic", 0)

    return {
        "ClassifiedIssue": {
            "redshift": issues_total,
            "weaviate": ci,
            "unsynced": max(0, issues_total - ci),
            "description": "Classified issues — vectorized for RAG chat",
        },
        "Transcript": {
            "redshift": transcripts_total,
            "weaviate": tr,
            "unsynced": max(0, transcripts_total - tr),
            "description": "Transcripts — vectorized for conversation-level search",
        },
        "SubTopic": {
            "redshift": subtopics_total,
            "weaviate": st,
            "unsynced": max(0, subtopics_total - st),
            "description": "Subtopics — vectorized for classification matching",
        },
    }


@router.get("/issues/status")
def issues_status():
    weaviate_counts = get_collection_counts()
    row = fetch_one("""
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN sub_topic_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS classified,
            COALESCE(SUM(CASE WHEN sub_topic_id IS NULL THEN 1 ELSE 0 END), 0) AS pending_classification,
            COALESCE(SUM(CASE WHEN sentiment = 'frustrated' THEN 1 ELSE 0 END), 0) AS frustrated,
            COALESCE(SUM(CASE WHEN classified_at >= DATEADD(day, -7, GETDATE()) THEN 1 ELSE 0 END), 0) AS last_7_days
        FROM taxonomy.classified_issues
    """)
    synced = weaviate_counts.get("ClassifiedIssue", 0)
    total = row["total"] if row else 0
    return {
        "total_redshift": total,
        "synced_weaviate": synced,
        "unsynced": max(0, total - synced),
        "classified": row["classified"] if row else 0,
        "pending_classification": row["pending_classification"] if row else 0,
        "frustrated": row["frustrated"] if row else 0,
        "last_7_days": row["last_7_days"] if row else 0,
    }


@router.get("/transcripts/status")
def transcripts_status():
    weaviate_counts = get_collection_counts()
    row = fetch_one("""
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END), 0) AS processed,
            COALESCE(SUM(CASE WHEN summary IS NULL THEN 1 ELSE 0 END), 0) AS unprocessed,
            COUNT(DISTINCT source_type) AS source_types,
            COALESCE(SUM(CASE WHEN ingested_at >= DATEADD(day, -7, GETDATE()) THEN 1 ELSE 0 END), 0) AS last_7_days
        FROM taxonomy.transcripts
    """)
    synced = weaviate_counts.get("Transcript", 0)
    total = row["total"] if row else 0
    return {
        "total_redshift": total,
        "synced_weaviate": synced,
        "unsynced": max(0, total - synced),
        "processed": row["processed"] if row else 0,
        "unprocessed": row["unprocessed"] if row else 0,
        "last_7_days": row["last_7_days"] if row else 0,
    }


@router.post("/sync/issues")
def sync_issues():
    count = vectorize_issues()
    return {"synced": count}


@router.post("/sync/transcripts")
def sync_transcripts():
    count = vectorize_transcripts()
    return {"synced": count}
