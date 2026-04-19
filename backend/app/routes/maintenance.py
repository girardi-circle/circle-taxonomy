from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from shared.pipeline.maintenance import run_centroid_maintenance, run_duplicate_detection

router = APIRouter()


class CentroidRequest(BaseModel):
    min_new_matches: Optional[int] = 5


@router.post("/centroids")
def trigger_centroids(request: CentroidRequest = CentroidRequest()):
    """Trigger centroid regeneration for subtopics with enough matched issues."""
    try:
        result = run_centroid_maintenance(min_new_matches=request.min_new_matches or 5)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result


@router.post("/duplicates")
def trigger_duplicate_detection():
    """Trigger duplicate subtopic detection. Returns list of near-duplicate pairs."""
    try:
        result = run_duplicate_detection()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return result
