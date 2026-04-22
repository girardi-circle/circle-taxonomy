import sys
import os
import logging

# When running `uvicorn app.main:app` from the `backend/` directory,
# the project root (parent of backend/) must be on sys.path so that
# `shared.*` imports resolve correctly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import pipeline, status, transcripts, issues, logs, candidates, taxonomy, maintenance
from app.routes import weaviate as weaviate_routes
from app.routes import classification_logs
from app.routes import taxonomy_ai
from app.routes import taxonomy_log
from app.routes import config as config_routes

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Taxonomy API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline.router, prefix="/api/pipeline", tags=["pipeline"])
app.include_router(status.router, prefix="/api/status", tags=["status"])
app.include_router(transcripts.router, prefix="/api/transcripts", tags=["transcripts"])
app.include_router(issues.router, prefix="/api/issues", tags=["issues"])
app.include_router(logs.router, prefix="/api/logs", tags=["logs"])
app.include_router(candidates.router, prefix="/api/candidates", tags=["candidates"])
app.include_router(taxonomy.router, prefix="/api/taxonomy", tags=["taxonomy"])
app.include_router(maintenance.router, prefix="/api/maintenance", tags=["maintenance"])
app.include_router(weaviate_routes.router, prefix="/api/weaviate", tags=["weaviate"])
app.include_router(classification_logs.router, prefix="/api/classification-logs", tags=["classification-logs"])
app.include_router(taxonomy_ai.router, prefix="/api/taxonomy", tags=["taxonomy-ai"])
app.include_router(taxonomy_log.router, prefix="/api/taxonomy-log", tags=["taxonomy-log"])
app.include_router(config_routes.router, prefix="/api/config", tags=["config"])
