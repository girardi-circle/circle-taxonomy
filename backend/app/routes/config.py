from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from shared.prompts import store as prompt_store

router = APIRouter()


class UpdatePromptRequest(BaseModel):
    system: str
    user_template: str


@router.get("/prompts")
def list_prompts():
    return prompt_store.get_all()


@router.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: str):
    p = prompt_store.get_one(prompt_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Prompt '{prompt_id}' not found")
    return p


@router.put("/prompts/{prompt_id}")
def update_prompt(prompt_id: str, request: UpdatePromptRequest):
    try:
        prompt_store.update(prompt_id, request.system, request.user_template)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"updated": True, "prompt_id": prompt_id}


@router.delete("/prompts/{prompt_id}/reset")
def reset_prompt(prompt_id: str):
    prompt_store.reset(prompt_id)
    return {"reset": True, "prompt_id": prompt_id}
