from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from shared.services.redshift import fetch_all, fetch_one

router = APIRouter()


def _build_where(
    status: str | None,
    transcript_id: int | None,
    executed_from: str | None,
    executed_to: str | None,
    model: str | None,
    triggered_by: str | None,
    min_input_tokens: int | None,
    max_input_tokens: int | None,
    min_output_tokens: int | None,
    max_output_tokens: int | None,
    min_cost: float | None,
    max_cost: float | None,
    min_issues: int | None,
    max_issues: int | None,
) -> tuple[str, list]:
    conditions = []
    params: list = []

    if status:
        conditions.append("el.status = %s")
        params.append(status)
    if triggered_by:
        conditions.append("el.triggered_by = %s")
        params.append(triggered_by)
    if transcript_id:
        conditions.append("el.transcript_id = %s")
        params.append(transcript_id)
    if executed_from:
        conditions.append("el.executed_at >= %s")
        params.append(executed_from)
    if executed_to:
        conditions.append("el.executed_at <= %s")
        params.append(executed_to)
    if model:
        conditions.append("el.model = %s")
        params.append(model)
    if min_input_tokens is not None:
        conditions.append("el.input_tokens >= %s")
        params.append(min_input_tokens)
    if max_input_tokens is not None:
        conditions.append("el.input_tokens <= %s")
        params.append(max_input_tokens)
    if min_output_tokens is not None:
        conditions.append("el.output_tokens >= %s")
        params.append(min_output_tokens)
    if max_output_tokens is not None:
        conditions.append("el.output_tokens <= %s")
        params.append(max_output_tokens)
    if min_cost is not None:
        conditions.append("el.cost_usd >= %s")
        params.append(min_cost)
    if max_cost is not None:
        conditions.append("el.cost_usd <= %s")
        params.append(max_cost)
    if min_issues is not None:
        conditions.append("el.issues_created >= %s")
        params.append(min_issues)
    if max_issues is not None:
        conditions.append("el.issues_created <= %s")
        params.append(max_issues)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    return where, params


# Must be defined before /{log_id} to avoid route shadowing
@router.get("/models")
def list_models():
    rows = fetch_all(
        "SELECT DISTINCT model FROM taxonomy.extraction_logs ORDER BY model"
    )
    return [r["model"] for r in rows]


@router.get("")
def list_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    transcript_id: Optional[int] = None,
    executed_from: Optional[str] = None,
    executed_to: Optional[str] = None,
    model: Optional[str] = None,
    triggered_by: Optional[str] = None,
    min_input_tokens: Optional[int] = None,
    max_input_tokens: Optional[int] = None,
    min_output_tokens: Optional[int] = None,
    max_output_tokens: Optional[int] = None,
    min_cost: Optional[float] = None,
    max_cost: Optional[float] = None,
    min_issues: Optional[int] = None,
    max_issues: Optional[int] = None,
):
    offset = (page - 1) * limit
    where, params = _build_where(
        status, transcript_id, executed_from, executed_to, model, triggered_by,
        min_input_tokens, max_input_tokens, min_output_tokens, max_output_tokens,
        min_cost, max_cost, min_issues, max_issues,
    )

    total_row = fetch_all(
        f"SELECT COUNT(*) AS count FROM taxonomy.extraction_logs el {where}",
        params or None,
    )[0]

    rows = fetch_all(
        f"""
        SELECT el.id, el.transcript_id, el.model, el.status, el.issues_created,
               el.error_message, el.executed_at,
               el.input_tokens, el.output_tokens, el.cost_usd,
               t.title AS transcript_title
        FROM taxonomy.extraction_logs el
        JOIN taxonomy.transcripts t ON el.transcript_id = t.id
        {where}
        ORDER BY el.executed_at DESC
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )

    stats_row = fetch_all(
        f"""
        SELECT
            COUNT(*) AS total_runs,
            COALESCE(SUM(cost_usd), 0) AS total_cost,
            AVG(cost_usd) AS avg_cost,
            COALESCE(SUM(issues_created), 0) AS total_issues,
            AVG(issues_created) AS avg_issues,
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            AVG(input_tokens) AS avg_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
            AVG(output_tokens) AS avg_output_tokens
        FROM taxonomy.extraction_logs el
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
def get_log(log_id: int):
    log = fetch_one(
        """
        SELECT el.*, t.title AS transcript_title
        FROM taxonomy.extraction_logs el
        JOIN taxonomy.transcripts t ON el.transcript_id = t.id
        WHERE el.id = %s
        """,
        (log_id,),
    )
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return log
