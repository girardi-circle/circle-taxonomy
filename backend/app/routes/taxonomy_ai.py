import json
import math
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from shared.services.redshift import fetch_all, fetch_one, execute
from shared.services import weaviate as weaviate_service
from shared.services.anthropic import call_claude
from shared.prompts.taxonomy_review import build_taxonomy_review_prompt
from shared.pipeline.extraction import _strip_fences
from shared.pipeline.taxonomy_management import (
    merge_subtopic, merge_topic, move_subtopic,
    update_topic, update_subtopic, _run_centroid_for_subtopic,
)
from shared import config

router = APIRouter()

BATCH_SIZE = config.AI_REVIEW_BATCH_SIZE


class AIReviewRequest(BaseModel):
    topic_ids: list[int] = []
    subtopic_ids: list[int] = []  # if provided, only review these specific subtopics
    restrict_to_pa: bool = False  # if true, reference lists are filtered to the PA(s) of selected items


# ── Data fetching helpers ─────────────────────────────────────────────────────

def _fetch_topics(topic_ids: list[int]) -> list[dict]:
    placeholders = ",".join(["%s"] * len(topic_ids))
    return fetch_all(
        f"""SELECT t.id, t.name, t.description, pa.name AS product_area_name
            FROM taxonomy.topics t
            LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
            WHERE t.id IN ({placeholders}) AND t.is_active = TRUE
            ORDER BY t.name""",
        topic_ids,
    )


def _fetch_subtopics_for_topics(topic_ids: list[int]) -> list[dict]:
    placeholders = ",".join(["%s"] * len(topic_ids))
    return fetch_all(
        f"""SELECT id, topic_id, name, canonical_description, match_count
            FROM taxonomy.sub_topics
            WHERE topic_id IN ({placeholders}) AND is_active = TRUE
            ORDER BY topic_id, name""",
        topic_ids,
    )


def _fetch_examples(subtopic_ids: list[int]) -> dict:
    if not subtopic_ids:
        return {}
    placeholders = ",".join(["%s"] * len(subtopic_ids))
    rows = fetch_all(
        f"""SELECT sub_topic_id, segment_description
            FROM taxonomy.classified_issues
            WHERE sub_topic_id IN ({placeholders})
              AND classification_status = 'matched'
              AND segment_description IS NOT NULL
            ORDER BY sub_topic_id, classified_at DESC""",
        subtopic_ids,
    )
    result: dict = {}
    for row in rows:
        sid = row["sub_topic_id"]
        if sid not in result:
            result[sid] = []
        if len(result[sid]) < 2:
            result[sid].append(row["segment_description"])
    return result


def _fetch_all_subtopics_reference() -> list[dict]:
    """Top N subtopics by match_count for move context. Capped to prevent prompt bloat."""
    return fetch_all(
        """SELECT st.id AS subtopic_id, st.name AS subtopic_name, st.match_count,
                  t.id AS topic_id, t.name AS topic_name,
                  pa.name AS product_area_name
           FROM taxonomy.sub_topics st
           JOIN taxonomy.topics t ON st.topic_id = t.id
           LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
           WHERE st.is_active = TRUE AND t.is_active = TRUE
           ORDER BY st.match_count DESC, t.name, st.name
           LIMIT %s""",
        (config.AI_REVIEW_SUBTOPICS_REF_LIMIT,),
    )


def _fetch_all_topics_reference() -> list[dict]:
    """Top N topics by subtopic count for merge context. Capped to prevent prompt bloat."""
    return fetch_all(
        """SELECT t.id, t.name, t.description,
                  pa.name AS product_area_name,
                  COUNT(st.id) AS subtopic_count
           FROM taxonomy.topics t
           LEFT JOIN taxonomy.product_areas pa ON t.product_area_id = pa.id
           LEFT JOIN taxonomy.sub_topics st ON st.topic_id = t.id AND st.is_active = TRUE
           WHERE t.is_active = TRUE
           GROUP BY t.id, t.name, t.description, pa.name
           ORDER BY subtopic_count DESC, t.name
           LIMIT %s""",
        (config.AI_REVIEW_TOPICS_REF_LIMIT,),
    )


def _enrich_with_weaviate_similarity(
    subtopic_ids: list[int],
    selected_subtopics: list[dict],
    all_id_to_name: dict,
) -> dict:
    """
    For each subtopic under review, find Weaviate neighbours with distance < 0.25
    across ALL active subtopics.
    - Single query to fetch all stored vectors (avoids N re-embeddings)
    - Parallel near_vector queries (avoids N sequential round trips)
    Returns {subtopic_id: [{subtopic_id, name, distance}, ...]}
    """
    if not subtopic_ids:
        return {}

    # One round trip to retrieve all stored vectors
    vectors = weaviate_service.fetch_subtopic_vectors(subtopic_ids)

    def _query_one(sid: int) -> tuple[int, list]:
        vector = vectors.get(sid)
        if not vector:
            return sid, []
        try:
            neighbours = weaviate_service.find_similar_subtopics_by_vector(
                vector=vector,
                exclude_subtopic_id=sid,
                limit=config.AI_REVIEW_WEAVIATE_NEIGHBORS,
            )
            close = [
                {"subtopic_id": n["subtopic_id"], "name": n.get("name", ""), "distance": round(n["distance"], 3)}
                for n in neighbours
                if n["distance"] < 0.25 and n["subtopic_id"] in all_id_to_name
            ]
            return sid, close
        except Exception:
            return sid, []

    similarity_map: dict = {}
    with ThreadPoolExecutor(max_workers=min(len(subtopic_ids), 8)) as executor:
        for sid, close in executor.map(_query_one, subtopic_ids):
            if close:
                similarity_map[sid] = close

    return similarity_map


# ── Persistence helpers ───────────────────────────────────────────────────────

def _save_session(topic_ids: list[int], model: str, input_tokens: int,
                  output_tokens: int, cost_usd: float, batches: int) -> int:
    execute(
        """INSERT INTO taxonomy.ai_review_sessions
           (topic_ids, model, input_tokens, output_tokens, cost_usd, batches)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (",".join(map(str, topic_ids)), model, input_tokens, output_tokens, cost_usd, batches),
    )
    row = fetch_one("SELECT MAX(id) AS id FROM taxonomy.ai_review_sessions")
    return row["id"] if row else None


def _save_suggestions(session_id: int, suggestions: list[dict]) -> None:
    for idx, s in enumerate(suggestions):
        execute(
            """INSERT INTO taxonomy.ai_review_suggestions
               (session_id, suggestion_idx, suggestion_type, title, payload)
               VALUES (%s, %s, %s, %s, %s)""",
            (session_id, idx, s.get("type"), s.get("title"), json.dumps(s)),
        )


def _load_session_with_suggestions(session_id: int) -> Optional[dict]:
    session = fetch_one(
        "SELECT * FROM taxonomy.ai_review_sessions WHERE id = %s",
        (session_id,),
    )
    if not session:
        return None
    suggestions = fetch_all(
        """SELECT id, suggestion_idx, suggestion_type, title, payload, status, applied_at, skipped_at
           FROM taxonomy.ai_review_suggestions WHERE session_id = %s ORDER BY suggestion_idx""",
        (session_id,),
    )
    result_suggestions = []
    for s in suggestions:
        payload = json.loads(s["payload"]) if s["payload"] else {}
        result_suggestions.append({
            **payload,
            "_db_id": s["id"],
            "_idx": s["suggestion_idx"],
            "_status": s["status"],
            "_applied_at": s["applied_at"],
            "_skipped_at": s["skipped_at"],
        })
    pending = sum(1 for s in suggestions if s["status"] == "pending")
    return {**session, "suggestions": result_suggestions, "pending_count": pending}


# ── Claude call ───────────────────────────────────────────────────────────────

def _call_batch(
    topics_for_unit_review: list[dict],
    subtopics_for_detail_review: list[dict],
    all_topics_reference: list[dict],
    all_subtopics_reference: list[dict],
    batch_label: str,
):
    system, user = build_taxonomy_review_prompt(
        topics_for_unit_review,
        subtopics_for_detail_review,
        all_topics_reference,
        all_subtopics_reference,
        batch_label,
    )
    text, usage = call_claude(system=system, user=user, model=config.MODEL_NEW_SUBTOPIC, max_tokens=16000)
    result = json.loads(_strip_fences(text))
    cost = config.compute_cost(config.MODEL_NEW_SUBTOPIC, usage.get("input_tokens", 0), usage.get("output_tokens", 0))
    return result, usage, cost


def _dedup_looks_good(items: list) -> list:
    """Deduplicate looks_good items across batches. Handles both string (legacy) and dict formats."""
    seen: set = set()
    result = []
    for item in items:
        if isinstance(item, dict):
            key = (item.get("type"), item.get("topic_id"), item.get("subtopic_id"), item.get("name"))
        else:
            key = item
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


# ── Main review endpoint ──────────────────────────────────────────────────────

@router.post("/ai-review")
def ai_review(request: AIReviewRequest):
    if not request.topic_ids and not request.subtopic_ids:
        raise HTTPException(status_code=400, detail="Provide topic_ids or subtopic_ids")

    # ── Build topics_for_unit_review (topics evaluated as units → merge/rename topic) ──
    topics_for_unit: list[dict] = []
    if request.topic_ids:
        if len(request.topic_ids) > config.AI_REVIEW_TOPIC_REQUEST_LIMIT:
            raise HTTPException(status_code=400, detail=f"Max {config.AI_REVIEW_TOPIC_REQUEST_LIMIT} topics per review")
        topics = _fetch_topics(request.topic_ids)
        if not topics:
            raise HTTPException(status_code=400, detail="No valid topics found for the given topic_ids")
        st_by_topic: dict = {}
        for st in _fetch_subtopics_for_topics(request.topic_ids):
            st_by_topic.setdefault(st["topic_id"], []).append(st)
        for t in topics:
            topics_for_unit.append({**t, "subtopics": st_by_topic.get(t["id"], [])})

    # ── Shared reference data (fetched early so similarity search can cover all subtopics) ──
    all_topics_ref = _fetch_all_topics_reference()
    all_subtopics_ref = _fetch_all_subtopics_reference()
    all_st_id_to_name = {row["subtopic_id"]: row["subtopic_name"] for row in all_subtopics_ref}

    # ── Build subtopics_for_detail_review (subtopics evaluated in detail → merge/move/rename) ──
    subtopics_for_detail: list[dict] = []
    if request.subtopic_ids:
        if len(request.subtopic_ids) > config.AI_REVIEW_SUBTOPIC_REQUEST_LIMIT:
            raise HTTPException(status_code=400, detail=f"Max {config.AI_REVIEW_SUBTOPIC_REQUEST_LIMIT} subtopics per review")
        placeholders = ",".join(["%s"] * len(request.subtopic_ids))
        selected_subtopics = fetch_all(
            f"""SELECT st.id, st.topic_id, st.name, st.canonical_description, st.match_count,
                       t.name AS topic_name
                FROM taxonomy.sub_topics st
                JOIN taxonomy.topics t ON st.topic_id = t.id
                WHERE st.id IN ({placeholders}) AND st.is_active = TRUE
                ORDER BY st.topic_id, st.name""",
            request.subtopic_ids,
        )
        if not selected_subtopics:
            raise HTTPException(status_code=400, detail="No valid subtopics found for the given subtopic_ids")
        examples_map = _fetch_examples([st["id"] for st in selected_subtopics])
        similarity_map = _enrich_with_weaviate_similarity(
            [st["id"] for st in selected_subtopics], selected_subtopics, all_st_id_to_name
        )
        for st in selected_subtopics:
            subtopics_for_detail.append({
                **st,
                "examples": examples_map.get(st["id"], []),
                "similar_subtopics": similarity_map.get(st["id"], []),
            })

    # ── Restrict reference lists to involved PA(s) if requested ──
    if request.restrict_to_pa:
        topic_pa_lookup = {t["id"]: t.get("product_area_name") for t in all_topics_ref}
        involved_pas: set = set()
        for t in topics_for_unit:
            pa = t.get("product_area_name")
            if pa:
                involved_pas.add(pa)
        for st in subtopics_for_detail:
            pa = topic_pa_lookup.get(st["topic_id"])
            if pa:
                involved_pas.add(pa)
        if involved_pas:
            all_topics_ref = [t for t in all_topics_ref if t.get("product_area_name") in involved_pas]
            all_subtopics_ref = [s for s in all_subtopics_ref if s.get("product_area_name") in involved_pas]

    # ── Batching — both lists sliced independently per batch ──
    num_batches = max(
        math.ceil(len(topics_for_unit) / BATCH_SIZE) if topics_for_unit else 0,
        math.ceil(len(subtopics_for_detail) / BATCH_SIZE) if subtopics_for_detail else 0,
        1,
    )

    all_suggestions: list[dict] = []
    all_looks_good: list[str] = []
    total_input_tokens = 0
    total_output_tokens = 0
    total_cost = 0.0

    batch_args = [
        (
            topics_for_unit[i * BATCH_SIZE: (i + 1) * BATCH_SIZE],
            subtopics_for_detail[i * BATCH_SIZE: (i + 1) * BATCH_SIZE],
            all_topics_ref,
            all_subtopics_ref,
            f"Batch {i + 1}/{num_batches}" if num_batches > 1 else "",
        )
        for i in range(num_batches)
    ]

    try:
        workers = min(num_batches, config.AI_REVIEW_PARALLEL_BATCHES)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            for result, usage, cost in executor.map(lambda args: _call_batch(*args), batch_args):
                all_suggestions.extend(result.get("suggestions") or [])
                all_looks_good.extend(result.get("looks_good") or [])
                total_input_tokens += usage.get("input_tokens", 0)
                total_output_tokens += usage.get("output_tokens", 0)
                total_cost += cost or 0.0
    except json.JSONDecodeError:
        total_items = len(topics_for_unit) + len(subtopics_for_detail)
        raise HTTPException(
            status_code=500,
            detail=f"Claude's response was truncated. Try selecting fewer items (currently {total_items}, recommended max {BATCH_SIZE * 3})."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # ── Enrich suggestions with PA > Topic > Subtopic context ──
    topic_pa_map = {t["id"]: (t.get("product_area_name") or "Unassigned") for t in all_topics_ref}
    st_ctx_map = {
        row["subtopic_id"]: {
            "topic_name": row["topic_name"],
            "pa_name": row.get("product_area_name") or "Unassigned",
        }
        for row in all_subtopics_ref
    }

    for s in all_suggestions:
        t = s.get("type")

        if t == "merge_topics":
            s["topic_product_areas"] = {
                str(tid): topic_pa_map.get(tid, "Unassigned")
                for tid in (s.get("topic_ids") or [])
            }
            s["surviving_topic_pa"] = topic_pa_map.get(s.get("surviving_topic_id"), "Unassigned")

        elif t == "rename_topic":
            s["topic_pa"] = topic_pa_map.get(s.get("topic_id"), "Unassigned")

        elif t == "merge_subtopics":
            s["subtopic_contexts"] = {
                str(sid): st_ctx_map.get(sid, {})
                for sid in (s.get("subtopic_ids") or [])
            }
            survivor_id = s.get("surviving_subtopic_id")
            if survivor_id and survivor_id in st_ctx_map:
                ctx = st_ctx_map[survivor_id]
                s["surviving_subtopic_topic_name"] = ctx.get("topic_name", "")
                s["surviving_subtopic_pa"] = ctx.get("pa_name", "Unassigned")

        elif t == "move_subtopic":
            s["from_topic_pa"] = topic_pa_map.get(s.get("from_topic_id"), "Unassigned")
            s["to_topic_pa"] = topic_pa_map.get(s.get("to_topic_id"), "Unassigned")

        elif t == "rename_subtopic":
            ctx = st_ctx_map.get(s.get("subtopic_id"), {})
            s["subtopic_topic_name"] = ctx.get("topic_name", "")
            s["subtopic_pa"] = ctx.get("pa_name", "Unassigned")

    # ── Enrich looks_good items with PA context ──
    for item in all_looks_good:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "topic":
            item["pa_name"] = topic_pa_map.get(item.get("topic_id"), "Unassigned")
        elif item.get("type") == "subtopic":
            ctx = st_ctx_map.get(item.get("subtopic_id"), {})
            item["pa_name"] = ctx.get("pa_name", "Unassigned")
            if not item.get("topic_name"):
                item["topic_name"] = ctx.get("topic_name", "")

    # ── Persist session ──
    used_topic_ids = list({
        *request.topic_ids,
        *(st["topic_id"] for st in subtopics_for_detail),
    })
    session_id = None
    try:
        session_id = _save_session(
            used_topic_ids, config.MODEL_NEW_SUBTOPIC,
            total_input_tokens, total_output_tokens, round(total_cost, 6), num_batches,
        )
        if session_id:
            _save_suggestions(session_id, all_suggestions)
    except Exception:
        pass

    summary = (
        f"Reviewed {len(topics_for_unit)} topic{'s' if len(topics_for_unit) != 1 else ''} "
        f"and {len(subtopics_for_detail)} subtopic{'s' if len(subtopics_for_detail) != 1 else ''} "
        f"across {num_batches} batch{'es' if num_batches != 1 else ''}. "
        f"Found {len(all_suggestions)} suggestion{'s' if len(all_suggestions) != 1 else ''}."
    )

    return {
        "session_id": session_id,
        "summary": summary,
        "suggestions": all_suggestions,
        "looks_good": _dedup_looks_good(all_looks_good),
        "_meta": {
            "model": config.MODEL_NEW_SUBTOPIC,
            "batches": num_batches,
            "topics_reviewed": len(topics_for_unit),
            "subtopics_reviewed": len(subtopics_for_detail),
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "cost_usd": round(total_cost, 6),
        },
    }


# ── Session management endpoints ──────────────────────────────────────────────

@router.get("/ai-reviews/incomplete")
def get_incomplete_reviews():
    """Sessions with at least one pending suggestion — for the warning banner."""
    rows = fetch_all(
        """SELECT s.id, s.topic_ids, s.created_at, s.model, s.cost_usd,
                  COUNT(sg.id) AS total_suggestions,
                  SUM(CASE WHEN sg.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
           FROM taxonomy.ai_review_sessions s
           JOIN taxonomy.ai_review_suggestions sg ON sg.session_id = s.id
           GROUP BY s.id, s.topic_ids, s.created_at, s.model, s.cost_usd
           HAVING SUM(CASE WHEN sg.status = 'pending' THEN 1 ELSE 0 END) > 0
           ORDER BY s.created_at DESC"""
    )
    return rows


@router.get("/ai-reviews")
def list_reviews(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100)):
    offset = (page - 1) * limit
    rows = fetch_all(
        """SELECT s.id, s.topic_ids, s.created_at, s.model, s.batches,
                  s.input_tokens, s.output_tokens, s.cost_usd,
                  COUNT(sg.id) AS total_suggestions,
                  SUM(CASE WHEN sg.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
                  SUM(CASE WHEN sg.status = 'applied' THEN 1 ELSE 0 END) AS applied_count,
                  SUM(CASE WHEN sg.status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count
           FROM taxonomy.ai_review_sessions s
           LEFT JOIN taxonomy.ai_review_suggestions sg ON sg.session_id = s.id
           GROUP BY s.id, s.topic_ids, s.created_at, s.model, s.batches,
                    s.input_tokens, s.output_tokens, s.cost_usd
           ORDER BY s.created_at DESC
           LIMIT %s OFFSET %s""",
        [limit, offset],
    )
    total = fetch_one("SELECT COUNT(*) AS n FROM taxonomy.ai_review_sessions")["n"]
    return {"items": rows, "total": total, "page": page, "limit": limit}


@router.get("/ai-reviews/{session_id}")
def get_review(session_id: int):
    session = _load_session_with_suggestions(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/ai-reviews/{session_id}/suggestions/{suggestion_idx}/apply")
def apply_suggestion(session_id: int, suggestion_idx: int, run_centroid: bool = True):
    """Apply one suggestion from a saved session."""
    row = fetch_one(
        "SELECT * FROM taxonomy.ai_review_suggestions WHERE session_id = %s AND suggestion_idx = %s",
        (session_id, suggestion_idx),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    if row["status"] == "applied":
        raise HTTPException(status_code=400, detail="Suggestion already applied")

    s = json.loads(row["payload"])
    t = s.get("type")

    try:
        if t == "merge_subtopics":
            others = [id_ for id_ in s["subtopic_ids"] if id_ != s["surviving_subtopic_id"]]
            for id_ in others:
                merge_subtopic(id_, s["surviving_subtopic_id"], run_centroid=run_centroid)
            if s.get("proposed_name") or s.get("proposed_description"):
                update_subtopic(s["surviving_subtopic_id"], s.get("proposed_name"), s.get("proposed_description"))

        elif t == "merge_topics":
            others = [id_ for id_ in s["topic_ids"] if id_ != s["surviving_topic_id"]]
            for id_ in others:
                merge_topic(id_, s["surviving_topic_id"], run_centroid=run_centroid)
            if s.get("proposed_name") or s.get("proposed_description"):
                update_topic(s["surviving_topic_id"], s.get("proposed_name"), s.get("proposed_description"), None)

        elif t == "move_subtopic":
            move_subtopic(s["subtopic_id"], s["to_topic_id"])

        elif t == "rename_topic":
            update_topic(s["topic_id"], s.get("proposed_name"), s.get("proposed_description"), None)

        elif t == "rename_subtopic":
            update_subtopic(s["subtopic_id"], s.get("proposed_name"), s.get("proposed_description"))

        else:
            raise HTTPException(status_code=400, detail=f"Unknown suggestion type: {t}")

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    execute(
        "UPDATE taxonomy.ai_review_suggestions SET status = 'applied', applied_at = GETDATE() WHERE id = %s",
        (row["id"],),
    )
    return {"applied": True, "suggestion_idx": suggestion_idx, "session_id": session_id}


@router.post("/ai-reviews/{session_id}/suggestions/{suggestion_idx}/skip")
def skip_suggestion(session_id: int, suggestion_idx: int):
    row = fetch_one(
        "SELECT id, status FROM taxonomy.ai_review_suggestions WHERE session_id = %s AND suggestion_idx = %s",
        (session_id, suggestion_idx),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    execute(
        "UPDATE taxonomy.ai_review_suggestions SET status = 'skipped', skipped_at = GETDATE() WHERE id = %s",
        (row["id"],),
    )
    return {"skipped": True, "suggestion_idx": suggestion_idx}


@router.post("/ai-reviews/{session_id}/dismiss")
def dismiss_session(session_id: int):
    """Mark all remaining pending suggestions as skipped."""
    execute(
        """UPDATE taxonomy.ai_review_suggestions
           SET status = 'skipped', skipped_at = GETDATE()
           WHERE session_id = %s AND status = 'pending'""",
        (session_id,),
    )
    return {"dismissed": True, "session_id": session_id}


class RunCentroidsRequest(BaseModel):
    suggestion_indices: Optional[list[int]] = None  # if provided, only run for these specific indices


@router.post("/ai-reviews/{session_id}/run-centroids")
def run_session_centroids(session_id: int, request: RunCentroidsRequest = RunCentroidsRequest()):
    """Run centroid updates for surviving entities from applied merge suggestions.
    Pass suggestion_indices to limit to the current bulk run only — avoids re-running
    centroids for suggestions applied in previous sessions."""
    conditions = [
        "session_id = %s",
        "status = 'applied'",
        "suggestion_type IN ('merge_subtopics', 'merge_topics')",
    ]
    params: list = [session_id]
    if request.suggestion_indices:
        placeholders = ",".join(["%s"] * len(request.suggestion_indices))
        conditions.append(f"suggestion_idx IN ({placeholders})")
        params.extend(request.suggestion_indices)

    applied_merges = fetch_all(
        f"SELECT payload FROM taxonomy.ai_review_suggestions WHERE {' AND '.join(conditions)}",
        params,
    )

    subtopic_ids: set = set()
    for row in applied_merges:
        s = json.loads(row["payload"])
        if s.get("type") == "merge_subtopics":
            subtopic_ids.add(s["surviving_subtopic_id"])
        elif s.get("type") == "merge_topics":
            rows = fetch_all(
                "SELECT id FROM taxonomy.sub_topics WHERE topic_id = %s AND is_active = TRUE",
                (s["surviving_topic_id"],),
            )
            for r in rows:
                subtopic_ids.add(r["id"])

    if not subtopic_ids:
        return {"updated": 0, "skipped": 0, "total": 0}

    updated = 0
    skipped = 0
    with ThreadPoolExecutor(max_workers=min(len(subtopic_ids), 8)) as executor:
        for result in executor.map(_run_centroid_for_subtopic, subtopic_ids):
            if result:
                updated += 1
            else:
                skipped += 1

    return {"updated": updated, "skipped": skipped, "total": len(subtopic_ids)}
