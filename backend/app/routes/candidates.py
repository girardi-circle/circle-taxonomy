from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from shared.services.redshift import fetch_all, fetch_one
from shared.pipeline.review import (
    approve_candidate,
    reject_candidate_to_pending,
    merge_candidate_into_candidate,
    merge_candidate_into_subtopic,
)

router = APIRouter()


class ApproveRequest(BaseModel):
    topic_name: Optional[str] = None
    subtopic_name: Optional[str] = None
    canonical_description: Optional[str] = None


class MergeRequest(BaseModel):
    type: str           # "candidate" or "subtopic"
    target_id: int      # candidate_id or subtopic_id


@router.get("")
def list_candidates(
    status: str = Query("pending"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=200),
    product_area_id: Optional[int] = None,
):
    offset = (page - 1) * limit
    conditions = ["ec.status = %s"]
    params: list = [status]

    if product_area_id is not None:
        conditions.append("ec.suggested_product_area_id = %s")
        params.append(product_area_id)

    where = "WHERE " + " AND ".join(conditions)

    total_row = fetch_one(
        f"SELECT COUNT(*) AS total FROM taxonomy.emerging_candidates ec {where}",
        params,
    )
    total = total_row["total"] if total_row else 0

    rows = fetch_all(
        f"""
        SELECT
            ec.id, ec.suggested_topic_name, ec.suggested_subtopic_name,
            ec.canonical_description, ec.cluster_size, ec.avg_similarity,
            ec.status, ec.created_at, ec.issue_ids,
            ec.suggested_product_area_id,
            pa.name AS suggested_product_area_name
        FROM taxonomy.emerging_candidates ec
        LEFT JOIN taxonomy.product_areas pa ON ec.suggested_product_area_id = pa.id
        {where}
        ORDER BY ec.suggested_topic_name ASC, ec.suggested_subtopic_name ASC
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )

    result = []
    for row in rows:
        issue_ids_str = row.get("issue_ids") or ""
        issue_count = len([x for x in issue_ids_str.split(",") if x.strip().isdigit()])
        result.append({**{k: v for k, v in row.items() if k != "issue_ids"}, "issue_count": issue_count})

    return {"items": result, "total": total, "page": page, "limit": limit,
            "pages": (total + limit - 1) // limit if total else 0}


@router.get("/{candidate_id}")
def get_candidate(candidate_id: int):
    candidate = fetch_one(
        "SELECT * FROM taxonomy.emerging_candidates WHERE id = %s",
        (candidate_id,),
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    issue_ids_str = candidate.get("issue_ids") or ""
    issue_ids = [int(x.strip()) for x in issue_ids_str.split(",") if x.strip().isdigit()]

    issues = []
    if issue_ids:
        placeholders = ",".join(["%s"] * len(issue_ids))
        issues = fetch_all(
            f"""
            SELECT ci.id, ci.segment_description, ci.verbatim_excerpt,
                   ci.sentiment, ci.classification_status,
                   n.name AS nature, i.name AS intent
            FROM taxonomy.classified_issues ci
            JOIN taxonomy.natures n ON ci.nature_id = n.id
            JOIN taxonomy.intents i ON ci.intent_id = i.id
            WHERE ci.id IN ({placeholders})
            ORDER BY ci.id
            """,
            issue_ids,
        )

    return {**{k: v for k, v in candidate.items()}, "issue_ids_parsed": issue_ids, "issues": issues}


@router.post("/{candidate_id}/approve")
def approve(candidate_id: int, request: ApproveRequest = ApproveRequest()):
    try:
        return approve_candidate(
            candidate_id,
            subtopic_name=request.subtopic_name,
            canonical_description=request.canonical_description,
            topic_name_override=request.topic_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{candidate_id}/reject")
def reject(candidate_id: int):
    """Return all linked issues to pending status for re-classification."""
    try:
        return reject_candidate_to_pending(candidate_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{candidate_id}/merge")
def merge(candidate_id: int, request: MergeRequest):
    """Merge candidate into another pending candidate or an approved subtopic."""
    try:
        if request.type == "candidate":
            return merge_candidate_into_candidate(candidate_id, request.target_id)
        elif request.type == "subtopic":
            return merge_candidate_into_subtopic(candidate_id, request.target_id)
        else:
            raise HTTPException(status_code=400, detail="type must be 'candidate' or 'subtopic'")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
