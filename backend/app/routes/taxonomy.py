from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from shared.services.redshift import fetch_all, fetch_one, execute
from shared.services import weaviate as weaviate_service
from shared.pipeline.taxonomy_management import (
    get_taxonomy_health, update_topic, merge_topic, delete_topic,
    move_subtopic, merge_subtopic, delete_subtopic_record,
    update_subtopic as _update_subtopic_record,
)

router = APIRouter()


class UpdateSubtopicRequest(BaseModel):
    name: Optional[str] = None
    canonical_description: Optional[str] = None


class UpdateTopicRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    product_area_id: Optional[int] = None


class MergeTopicRequest(BaseModel):
    target_topic_id: int
    run_centroid: bool = True


class MoveSubtopicRequest(BaseModel):
    target_topic_id: int


class MergeSubtopicRequest(BaseModel):
    target_subtopic_id: int
    run_centroid: bool = True


@router.get("/tree")
def get_taxonomy_tree(product_area_id: Optional[int] = None):
    """
    Return full hierarchy: product_area > topics > subtopics with issue counts.
    """
    pa_filter = "WHERE t.product_area_id = %s" if product_area_id else ""
    pa_params = [product_area_id] if product_area_id else []

    # Load product areas
    product_areas = fetch_all("SELECT id, name, description FROM taxonomy.product_areas ORDER BY name")

    # Load topics with subtopic counts
    topics = fetch_all(
        f"""
        SELECT
            t.id,
            t.name,
            t.description,
            t.product_area_id,
            COUNT(DISTINCT st.id) AS subtopic_count
        FROM taxonomy.topics t
        LEFT JOIN taxonomy.sub_topics st ON st.topic_id = t.id AND st.is_active = TRUE
        {pa_filter}
        WHERE t.is_active = TRUE
        GROUP BY t.id, t.name, t.description, t.product_area_id
        ORDER BY t.name
        """,
        pa_params or None,
    )

    # Load subtopics with issue counts
    subtopics = fetch_all(
        """
        SELECT
            st.id,
            st.topic_id,
            st.name,
            st.canonical_description,
            st.match_count,
            COUNT(ci.id) AS issue_count
        FROM taxonomy.sub_topics st
        LEFT JOIN taxonomy.classified_issues ci
            ON ci.sub_topic_id = st.id AND ci.classification_status = 'matched'
        WHERE st.is_active = TRUE
        GROUP BY st.id, st.topic_id, st.name, st.canonical_description, st.match_count
        ORDER BY st.name
        """
    )

    # Build lookup maps
    subtopics_by_topic: dict = {}
    for st in subtopics:
        tid = st["topic_id"]
        if tid not in subtopics_by_topic:
            subtopics_by_topic[tid] = []
        subtopics_by_topic[tid].append(st)

    topics_by_pa: dict = {}
    for t in topics:
        pa_id = t["product_area_id"]
        if pa_id not in topics_by_pa:
            topics_by_pa[pa_id] = []
        topics_by_pa[pa_id].append({
            **t,
            "subtopics": subtopics_by_topic.get(t["id"], []),
        })

    # Assemble tree — include a catch-all for topics with no product area
    tree = []
    for pa in product_areas:
        tree.append({
            **pa,
            "topics": topics_by_pa.get(pa["id"], []),
        })

    unassigned_topics = topics_by_pa.get(None, [])
    if unassigned_topics:
        tree.append({
            "id": None,
            "name": "Unassigned",
            "description": "Topics not yet assigned to a product area",
            "topics": unassigned_topics,
            "topic_count": len(unassigned_topics),
            "subtopic_count": sum(len(t["subtopics"]) for t in unassigned_topics),
            "issue_count": sum(t.get("subtopic_count", 0) for t in unassigned_topics),
        })

    return tree


@router.get("/topics")
def list_topics(
    product_area_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    """List topics with subtopic_count and issue_count."""
    offset = (page - 1) * limit
    conditions = ["t.is_active = TRUE"]
    params: list = []

    if product_area_id is not None:
        conditions.append("t.product_area_id = %s")
        params.append(product_area_id)

    where = "WHERE " + " AND ".join(conditions)

    rows = fetch_all(
        f"""
        SELECT
            t.id,
            t.name,
            t.description,
            t.product_area_id,
            pa.name AS product_area_name,
            COUNT(DISTINCT st.id)   AS subtopic_count,
            COUNT(DISTINCT ci.id)   AS issue_count
        FROM taxonomy.topics t
        LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
        LEFT JOIN taxonomy.sub_topics st ON st.topic_id = t.id AND st.is_active = TRUE
        LEFT JOIN taxonomy.classified_issues ci
            ON ci.sub_topic_id = st.id AND ci.classification_status = 'matched'
        {where}
        GROUP BY t.id, t.name, t.description, t.product_area_id, pa.name
        ORDER BY t.name
        LIMIT %s OFFSET %s
        """,
        params + [limit, offset],
    )

    total_row = fetch_one(
        f"SELECT COUNT(*) AS total FROM taxonomy.topics t {where}",
        params or None,
    )
    total = total_row["total"] if total_row else 0

    return {
        "items": rows,
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.get("/topics/lookup")
def lookup_topic_by_name(name: str):
    """Look up a topic by name and return its existing approved subtopics.
    Used by the review queue to show context before approving a candidate.
    Returns null topic field if not found."""
    topic = fetch_one(
        """
        SELECT t.id, t.name, t.description,
               pa.name AS product_area_name
        FROM taxonomy.topics t
        LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
        WHERE LOWER(t.name) = LOWER(%s) AND t.is_active = TRUE
        """,
        (name,),
    )

    if not topic:
        return {"topic": None, "subtopics": []}

    subtopics = fetch_all(
        """
        SELECT st.id, st.name, st.canonical_description, st.match_count
        FROM taxonomy.sub_topics st
        WHERE st.topic_id = %s AND st.is_active = TRUE
        ORDER BY st.name
        """,
        (topic["id"],),
    )

    return {"topic": topic, "subtopics": subtopics}


@router.get("/topics/{topic_id}")
def get_topic(topic_id: int):
    """Get topic detail with its subtopics."""
    topic = fetch_one(
        """
        SELECT
            t.id,
            t.name,
            t.description,
            t.product_area_id,
            pa.name AS product_area_name,
            t.created_at,
            t.is_active
        FROM taxonomy.topics t
        LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
        WHERE t.id = %s
        """,
        (topic_id,),
    )
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")

    subtopics = fetch_all(
        """
        SELECT
            st.id,
            st.name,
            st.canonical_description,
            st.match_count,
            COUNT(ci.id) AS issue_count
        FROM taxonomy.sub_topics st
        LEFT JOIN taxonomy.classified_issues ci
            ON ci.sub_topic_id = st.id AND ci.classification_status = 'matched'
        WHERE st.topic_id = %s AND st.is_active = TRUE
        GROUP BY st.id, st.name, st.canonical_description, st.match_count
        ORDER BY st.name
        """,
        (topic_id,),
    )

    return {**topic, "subtopics": subtopics}


@router.get("/subtopics/search")
def search_subtopics(q: str = "", limit: int = Query(20, ge=1, le=100)):
    """Search approved subtopics by name for the merge modal."""
    rows = fetch_all(
        """
        SELECT st.id, st.name, st.canonical_description, st.match_count,
               t.name AS topic_name
        FROM taxonomy.sub_topics st
        JOIN taxonomy.topics t ON st.topic_id = t.id
        WHERE st.is_active = TRUE AND LOWER(st.name) LIKE LOWER(%s)
        ORDER BY st.name
        LIMIT %s
        """,
        (f"%{q}%", limit),
    )
    return rows


@router.get("/subtopics/{subtopic_id}")
def get_subtopic(subtopic_id: int):
    """Get subtopic detail with nature/intent/sentiment breakdown."""
    subtopic = fetch_one(
        """
        SELECT
            st.id,
            st.topic_id,
            st.name,
            st.canonical_description,
            st.match_count,
            st.created_at,
            st.is_active,
            t.name AS topic_name,
            t.product_area_id,
            pa.name AS product_area_name
        FROM taxonomy.sub_topics st
        JOIN taxonomy.topics t ON st.topic_id = t.id
        LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
        WHERE st.id = %s
        """,
        (subtopic_id,),
    )
    if not subtopic:
        raise HTTPException(status_code=404, detail="Subtopic not found")

    # Nature breakdown
    natures = fetch_all(
        """
        SELECT n.name, COUNT(*) AS count
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        WHERE ci.sub_topic_id = %s AND ci.classification_status = 'matched'
        GROUP BY n.name
        ORDER BY count DESC
        """,
        (subtopic_id,),
    )

    # Intent breakdown
    intents = fetch_all(
        """
        SELECT i.name, COUNT(*) AS count
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        WHERE ci.sub_topic_id = %s AND ci.classification_status = 'matched'
        GROUP BY i.name
        ORDER BY count DESC
        """,
        (subtopic_id,),
    )

    # Sentiment breakdown
    sentiments = fetch_all(
        """
        SELECT sentiment, COUNT(*) AS count
        FROM taxonomy.classified_issues
        WHERE sub_topic_id = %s AND classification_status = 'matched'
        GROUP BY sentiment
        ORDER BY count DESC
        """,
        (subtopic_id,),
    )

    return {
        **subtopic,
        "breakdown": {
            "natures": natures,
            "intents": intents,
            "sentiments": sentiments,
        },
    }


@router.get("/subtopics/{subtopic_id}/issues")
def get_subtopic_issues(
    subtopic_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort_by: str = Query("classified_at", regex="^(classified_at|nature|sentiment)$"),
):
    """Paginated issues for a subtopic."""
    # Verify subtopic exists
    exists = fetch_one("SELECT id FROM taxonomy.sub_topics WHERE id = %s", (subtopic_id,))
    if not exists:
        raise HTTPException(status_code=404, detail="Subtopic not found")

    offset = (page - 1) * limit

    order_map = {
        "classified_at": "ci.classified_at DESC",
        "nature": "n.name ASC",
        "sentiment": "ci.sentiment ASC",
    }
    order_clause = order_map.get(sort_by, "ci.classified_at DESC")

    rows = fetch_all(
        f"""
        SELECT
            ci.id,
            ci.segment_description,
            ci.verbatim_excerpt,
            ci.sentiment,
            ci.confidence_score,
            ci.match_method,
            ci.classification_status,
            ci.classified_at,
            n.name AS nature,
            i.name AS intent,
            tr.title AS transcript_title,
            tr.source_url
        FROM taxonomy.classified_issues ci
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        JOIN taxonomy.intents i ON ci.intent_id = i.id
        LEFT JOIN taxonomy.transcripts tr ON ci.transcript_id = tr.id
        WHERE ci.sub_topic_id = %s AND ci.classification_status = 'matched'
        ORDER BY {order_clause}
        LIMIT %s OFFSET %s
        """,
        (subtopic_id, limit, offset),
    )

    total_row = fetch_one(
        "SELECT COUNT(*) AS total FROM taxonomy.classified_issues WHERE sub_topic_id = %s AND classification_status = 'matched'",
        (subtopic_id,),
    )
    total = total_row["total"] if total_row else 0

    return {
        "items": rows,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total else 0,
    }


@router.put("/subtopics/{subtopic_id}")
def update_subtopic(subtopic_id: int, request: UpdateSubtopicRequest):
    """Update subtopic name and/or canonical_description. Logs rename. Syncs Weaviate."""
    try:
        result = _update_subtopic_record(subtopic_id, request.name, request.canonical_description)
        return {"id": subtopic_id, **result}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/uncategorized")
def get_uncategorized(
    nature_names: Optional[str] = None,
    intent_names: Optional[str] = None,
    sentiments: Optional[str] = None,
    source_types: Optional[str] = None,
    timeframe_start: Optional[str] = None,
    timeframe_end: Optional[str] = None,
):
    """Count issues with classification_status = 'pending' (not yet processed), with optional name-based filters."""
    conditions = ["ci.classification_status = 'pending'"]
    params: list = []
    need_transcripts = bool(source_types)

    if nature_names:
        names = [x.strip() for x in nature_names.split(",") if x.strip()]
        if names:
            placeholders = ",".join(["%s"] * len(names))
            conditions.append(f"LOWER(n.name) IN ({placeholders})")
            params.extend([n.lower() for n in names])

    if intent_names:
        names = [x.strip() for x in intent_names.split(",") if x.strip()]
        if names:
            placeholders = ",".join(["%s"] * len(names))
            conditions.append(f"LOWER(i.name) IN ({placeholders})")
            params.extend([n.lower() for n in names])

    if sentiments:
        vals = [x.strip() for x in sentiments.split(",") if x.strip()]
        if vals:
            placeholders = ",".join(["%s"] * len(vals))
            conditions.append(f"ci.sentiment IN ({placeholders})")
            params.extend(vals)

    if source_types:
        vals = [x.strip() for x in source_types.split(",") if x.strip()]
        if vals:
            placeholders = ",".join(["%s"] * len(vals))
            conditions.append(f"t.source_type IN ({placeholders})")
            params.extend(vals)

    if timeframe_start:
        conditions.append("ci.classified_at >= %s")
        params.append(timeframe_start)

    if timeframe_end:
        conditions.append("ci.classified_at <= %s")
        params.append(timeframe_end)

    where = "WHERE " + " AND ".join(conditions)
    join = """
        JOIN taxonomy.natures n ON ci.nature_id = n.id
        JOIN taxonomy.intents i ON ci.intent_id = i.id
    """
    if need_transcripts:
        join += " LEFT JOIN taxonomy.transcripts t ON ci.transcript_id = t.id"

    row = fetch_one(
        f"SELECT COUNT(*) AS count FROM taxonomy.classified_issues ci {join} {where}",
        params or None,
    )
    return {"count": row["count"] if row else 0}


# ── Taxonomy governance endpoints ─────────────────────────────────────────────

@router.get("/health")
def taxonomy_health():
    return get_taxonomy_health()


@router.put("/topics/{topic_id}")
def update_topic_endpoint(topic_id: int, request: UpdateTopicRequest):
    try:
        return update_topic(topic_id, request.name, request.description, request.product_area_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/topics/{topic_id}/merge")
def merge_topic_endpoint(topic_id: int, request: MergeTopicRequest):
    try:
        return merge_topic(topic_id, request.target_topic_id, run_centroid=request.run_centroid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/topics/{topic_id}")
def delete_topic_endpoint(topic_id: int):
    try:
        return delete_topic(topic_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/subtopics/{subtopic_id}/move")
def move_subtopic_endpoint(subtopic_id: int, request: MoveSubtopicRequest):
    try:
        return move_subtopic(subtopic_id, request.target_topic_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/subtopics/{subtopic_id}/merge")
def merge_subtopic_endpoint(subtopic_id: int, request: MergeSubtopicRequest):
    try:
        return merge_subtopic(subtopic_id, request.target_subtopic_id, run_centroid=request.run_centroid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/subtopics/{subtopic_id}")
def delete_subtopic_endpoint(subtopic_id: int):
    try:
        return delete_subtopic_record(subtopic_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
