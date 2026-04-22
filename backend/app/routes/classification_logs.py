from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from shared.services.redshift import fetch_all, fetch_one

router = APIRouter()


@router.get("")
def list_classification_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    band: Optional[str] = None,
    decision: Optional[str] = None,
    issue_id: Optional[int] = None,
    triggered_by: Optional[str] = None,
):
    offset = (page - 1) * limit
    conditions = []
    params: list = []

    if band:
        conditions.append("cl.band = %s")
        params.append(band.upper())
    if decision:
        conditions.append("cl.decision = %s")
        params.append(decision)
    if issue_id:
        conditions.append("cl.issue_id = %s")
        params.append(issue_id)
    if triggered_by:
        conditions.append("cl.triggered_by = %s")
        params.append(triggered_by)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    total_row = fetch_all(
        f"SELECT COUNT(*) AS count FROM taxonomy.classification_logs cl {where}",
        params or None,
    )[0]

    rows = fetch_all(
        f"""
        SELECT cl.id, cl.issue_id, cl.band, cl.decision,
               cl.matched_subtopic_id, cl.matched_subtopic_name,
               cl.confidence_score, cl.model_used,
               cl.input_tokens, cl.output_tokens, cl.cost_usd,
               cl.auto_create, cl.error_message, cl.triggered_by,
               cl.classified_at, ci.segment_description
        FROM taxonomy.classification_logs cl
        LEFT JOIN taxonomy.classified_issues ci ON cl.issue_id = ci.id
        {where}
        ORDER BY cl.classified_at DESC
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )

    stats_row = fetch_all(
        f"""
        SELECT
            COUNT(*) AS total_runs,
            COALESCE(SUM(CASE WHEN band = 'A' THEN 1 ELSE 0 END), 0) AS band_a,
            COALESCE(SUM(CASE WHEN band = 'B' THEN 1 ELSE 0 END), 0) AS band_b,
            COALESCE(SUM(CASE WHEN band = 'C' THEN 1 ELSE 0 END), 0) AS band_c,
            COALESCE(SUM(CASE WHEN decision = 'matched' THEN 1 ELSE 0 END), 0) AS matched,
            COALESCE(SUM(CASE WHEN decision = 'auto_created' THEN 1 ELSE 0 END), 0) AS auto_created,
            COALESCE(SUM(CASE WHEN decision = 'unmatched' THEN 1 ELSE 0 END), 0) AS unmatched,
            COALESCE(SUM(CASE WHEN decision = 'error' THEN 1 ELSE 0 END), 0) AS errors,
            COALESCE(SUM(cost_usd), 0) AS total_cost,
            AVG(cost_usd) AS avg_cost,
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens
        FROM taxonomy.classification_logs cl
        {where}
        """,
        params or None,
    )[0]

    return {
        "total": total_row["count"],
        "page": page,
        "limit": limit,
        "items": rows,
        "stats": stats_row,
    }


@router.get("/{log_id}")
def get_classification_log(log_id: int):
    row = fetch_one(
        """
        SELECT cl.*, ci.segment_description, ci.verbatim_excerpt, ci.sentiment
        FROM taxonomy.classification_logs cl
        LEFT JOIN taxonomy.classified_issues ci ON cl.issue_id = ci.id
        WHERE cl.id = %s
        """,
        (log_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return row
