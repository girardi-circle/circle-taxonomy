from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from shared.services.redshift import fetch_all, fetch_one

router = APIRouter()


@router.get("")
def list_taxonomy_log(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    action_type: Optional[str] = None,
    entity_type: Optional[str] = None,
):
    offset = (page - 1) * limit
    conditions = []
    params: list = []

    if action_type:
        conditions.append("action_type = %s")
        params.append(action_type)
    if entity_type:
        conditions.append("entity_type = %s")
        params.append(entity_type)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    total_row = fetch_one(
        f"SELECT COUNT(*) AS n FROM taxonomy.taxonomy_changes {where}",
        params or None,
    )
    total = total_row["n"] if total_row else 0

    rows = fetch_all(
        f"""SELECT id, action_type, entity_type, source_id, source_name,
                   target_id, target_name, notes, performed_at
            FROM taxonomy.taxonomy_changes
            {where}
            ORDER BY performed_at DESC
            LIMIT %s OFFSET %s""",
        params + [limit, offset],
    )

    return {"items": rows, "total": total, "page": page, "limit": limit}


@router.get("/{log_id}")
def get_taxonomy_log_entry(log_id: int):
    row = fetch_one(
        "SELECT * FROM taxonomy.taxonomy_changes WHERE id = %s",
        (log_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return row
