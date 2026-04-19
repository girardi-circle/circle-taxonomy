import json
import os
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from shared.pipeline.extraction import run_extraction, stream_extraction, count_unprocessed, _LOG_DIR
from shared.pipeline.classification import stream_classification
from shared.services.redshift import fetch_all as _db_fetch

router = APIRouter()


class ExtractRequest(BaseModel):
    limit: int | None = None


@router.post("/extract")
def extract(request: ExtractRequest = ExtractRequest()):
    return run_extraction(limit=request.limit)


@router.get("/unprocessed-count")
def get_unprocessed_count(
    source_id_min: Optional[str] = None,
    source_id_max: Optional[str] = None,
    community_id: Optional[int] = None,
    source_type: Optional[str] = None,
):
    return {"count": count_unprocessed(source_id_min, source_id_max, community_id, source_type)}


@router.get("/extract/stream")
def extract_stream(
    limit: int = Query(10, ge=1, le=99999),
    source_id_min: Optional[str] = None,
    source_id_max: Optional[str] = None,
    community_id: Optional[int] = None,
    source_type: Optional[str] = None,
):
    def generate():
        try:
            for event in stream_extraction(limit, source_id_min, source_id_max, community_id, source_type):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'batch_error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _names_to_ids(table: str, names: list[str]) -> list[int]:
    """Convert a list of dimension names to their Redshift IDs."""
    if not names:
        return []
    placeholders = ",".join(["%s"] * len(names))
    rows = _db_fetch(
        f"SELECT id FROM taxonomy.{table} WHERE LOWER(name) IN ({placeholders})",
        [n.lower() for n in names],
    )
    return [r["id"] for r in rows]


@router.get("/classify/stream")
def classify_stream(
    auto_create: bool = Query(False),
    limit: Optional[int] = Query(None),
    nature_names: Optional[str] = Query(None),    # comma-separated names sent by the frontend
    intent_names: Optional[str] = Query(None),
    sentiments: Optional[str] = Query(None),
    source_types: Optional[str] = Query(None),
    timeframe_start: Optional[str] = Query(None),
    timeframe_end: Optional[str] = Query(None),
):
    """SSE stream for the classification pipeline (Step 2)."""
    filters: dict = {}

    if nature_names:
        names = [x.strip() for x in nature_names.split(",") if x.strip()]
        ids = _names_to_ids("natures", names)
        if ids:
            filters["nature_ids"] = ids

    if intent_names:
        names = [x.strip() for x in intent_names.split(",") if x.strip()]
        ids = _names_to_ids("intents", names)
        if ids:
            filters["intent_ids"] = ids

    if sentiments:
        vals = [x.strip() for x in sentiments.split(",") if x.strip()]
        if vals:
            filters["sentiments"] = vals

    if source_types:
        vals = [x.strip() for x in source_types.split(",") if x.strip()]
        if vals:
            filters["source_types"] = vals

    if timeframe_start:
        filters["timeframe_start"] = timeframe_start

    if timeframe_end:
        filters["timeframe_end"] = timeframe_end

    def generate():
        try:
            for event in stream_classification(
                filters=filters or None,
                auto_create=auto_create,
                limit=limit,
            ):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'classify_error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )




@router.get("/log")
def get_pipeline_log(lines: int = Query(2000, ge=1, le=20000)):
    log_path = os.path.join(_LOG_DIR, "pipeline.log")
    if not os.path.exists(log_path):
        return {"events": [], "file_exists": False}
    try:
        with open(log_path) as f:
            raw = f.readlines()
        raw = raw[-lines:]
        events = []
        for line in raw:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return {"events": events, "file_exists": True}
    except Exception as e:
        return {"events": [], "file_exists": True, "error": str(e)}
