from fastapi import APIRouter
from shared.services.redshift import fetch_all

router = APIRouter()


@router.get("/overview")
def overview():
    counts = fetch_all("""
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END), 0) AS processed,
            COALESCE(SUM(CASE WHEN summary IS NULL THEN 1 ELSE 0 END), 0) AS unprocessed
        FROM taxonomy.transcripts
    """)[0]

    issues_total_row = fetch_all(
        "SELECT COUNT(*) AS total FROM taxonomy.classified_issues"
    )[0]

    by_status_rows = fetch_all("""
        SELECT classification_status, COUNT(*) AS count
        FROM taxonomy.classified_issues
        GROUP BY classification_status
    """)

    by_nature_rows = fetch_all("""
        SELECT LOWER(n.name) AS name, COUNT(*) AS count
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        GROUP BY n.name
    """)

    by_intent_rows = fetch_all("""
        SELECT LOWER(i.name) AS name, COUNT(*) AS count
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        GROUP BY i.name
    """)

    by_sentiment_rows = fetch_all("""
        SELECT sentiment, COUNT(*) AS count
        FROM taxonomy.classified_issues
        GROUP BY sentiment
    """)

    return {
        "transcripts_total": counts["total"],
        "transcripts_processed": counts["processed"],
        "transcripts_unprocessed": counts["unprocessed"],
        "issues_total": issues_total_row["total"],
        "issues_by_status": {r["classification_status"]: r["count"] for r in by_status_rows},
        "issues_by_nature": {r["name"]: r["count"] for r in by_nature_rows},
        "issues_by_intent": {r["name"]: r["count"] for r in by_intent_rows},
        "issues_by_sentiment": {r["sentiment"]: r["count"] for r in by_sentiment_rows if r["sentiment"]},
    }
