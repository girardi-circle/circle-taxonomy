from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from shared.services.redshift import fetch_all, fetch_one

router = APIRouter()


def _build_where(status: str | None, source_type: str | None) -> tuple[str, list]:
    conditions = []
    params: list = []

    if status == "processed":
        conditions.append("summary IS NOT NULL")
    elif status == "unprocessed":
        conditions.append("summary IS NULL")

    if source_type:
        conditions.append("source_type = %s")
        params.append(source_type)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where, params


@router.get("")
def list_transcripts(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    source_type: Optional[str] = None,
):
    offset = (page - 1) * limit
    where, params = _build_where(status, source_type)

    total_row = fetch_all(
        f"SELECT COUNT(*) AS count FROM taxonomy.transcripts {where}",
        params or None,
    )[0]

    rows = fetch_all(
        f"""
        SELECT t.id, t.source_id, t.source_type, t.title, t.source_url,
               t.summary, t.ingested_at,
               COUNT(ci.id) AS issue_count
        FROM taxonomy.transcripts t
        LEFT JOIN taxonomy.classified_issues ci ON ci.transcript_id = t.id
        {where}
        GROUP BY t.id, t.source_id, t.source_type, t.title, t.source_url,
                 t.summary, t.ingested_at
        ORDER BY t.ingested_at DESC
        LIMIT %s OFFSET %s
        """,
        (params + [limit, offset]) or None,
    )

    return {
        "total": total_row["count"],
        "page": page,
        "limit": limit,
        "items": rows,
    }


@router.get("/{transcript_id}")
def get_transcript(transcript_id: int):
    transcript = fetch_one(
        "SELECT * FROM taxonomy.transcripts WHERE id = %s",
        (transcript_id,),
    )
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")

    issues = fetch_all(
        """
        SELECT ci.id, ci.segment_description, ci.verbatim_excerpt, ci.sentiment,
               ci.classification_status, ci.confidence_score, ci.classified_at,
               n.name AS nature, i.name AS intent
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        WHERE ci.transcript_id = %s
        ORDER BY ci.classified_at
        """,
        (transcript_id,),
    )

    transcript["issues"] = issues
    return transcript
