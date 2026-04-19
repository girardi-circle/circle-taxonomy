from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from shared.services.redshift import fetch_all, fetch_one
from shared.pipeline.reprocess import reprocess_segment_descriptions

router = APIRouter()


def _build_where(
    nature: str | None,
    intent: str | None,
    sentiment: str | None,
    status: str | None,
) -> tuple[str, list]:
    conditions = []
    params: list = []

    if nature:
        conditions.append("LOWER(n.name) = %s")
        params.append(nature.lower())
    if intent:
        conditions.append("LOWER(i.name) = %s")
        params.append(intent.lower())
    if sentiment:
        conditions.append("ci.sentiment = %s")
        params.append(sentiment.lower())
    if status:
        conditions.append("ci.classification_status = %s")
        params.append(status)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where, params


@router.get("")
def list_issues(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    nature: Optional[str] = None,
    intent: Optional[str] = None,
    sentiment: Optional[str] = None,
    status: Optional[str] = None,
):
    offset = (page - 1) * limit
    where, params = _build_where(nature, intent, sentiment, status)

    total_row = fetch_all(
        f"""
        SELECT COUNT(*) AS count
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        {where}
        """,
        params or None,
    )[0]

    rows = fetch_all(
        f"""
        SELECT ci.id, ci.transcript_id, ci.segment_description, ci.verbatim_excerpt,
               ci.sentiment, ci.classification_status, ci.confidence_score, ci.classified_at,
               n.name AS nature, i.name AS intent,
               t.title AS transcript_title, t.source_url AS transcript_url
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        JOIN taxonomy.transcripts t ON ci.transcript_id = t.id
        {where}
        ORDER BY ci.classified_at DESC
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


class ReprocessRequest(BaseModel):
    issue_ids: list[int]


@router.post("/reprocess")
def reprocess_issues(body: ReprocessRequest):
    if not body.issue_ids:
        raise HTTPException(status_code=400, detail="No issue IDs provided")
    return reprocess_segment_descriptions(body.issue_ids)


@router.get("/reprocess-logs")
def list_reprocess_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    issue_id: Optional[int] = None,
):
    offset = (page - 1) * limit
    conditions = []
    params: list = []
    if issue_id:
        conditions.append("rl.issue_id = %s")
        params.append(issue_id)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    total_row = fetch_all(
        f"SELECT COUNT(*) AS count FROM taxonomy.issue_reprocess_logs rl {where}",
        params or None,
    )[0]

    rows = fetch_all(
        f"""
        SELECT rl.id, rl.issue_id, rl.model,
               rl.old_segment_description, rl.new_segment_description,
               rl.verbatim_excerpt, rl.input_tokens, rl.output_tokens,
               rl.cost_usd, rl.reprocessed_at
        FROM taxonomy.issue_reprocess_logs rl
        {where}
        ORDER BY rl.reprocessed_at DESC
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )

    return {"total": total_row["count"], "page": page, "limit": limit, "items": rows}


@router.get("/{issue_id}")
def get_issue(issue_id: int):
    issue = fetch_one(
        """
        SELECT ci.*, n.name AS nature, i.name AS intent,
               t.title AS transcript_title, t.source_url AS transcript_url,
               t.summary AS transcript_summary
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        JOIN taxonomy.transcripts t ON ci.transcript_id = t.id
        WHERE ci.id = %s
        """,
        (issue_id,),
    )
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue
