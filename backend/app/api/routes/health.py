from __future__ import annotations

from fastapi import APIRouter

from backend.app.core.config import get_settings
from backend.app.workflows.client import check_openrouter_model

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def get_health() -> dict[str, str | bool | None]:
    settings = get_settings()
    model_status = check_openrouter_model(settings)
    return {
        "status": "ok",
        "app": settings.app_name,
        "model": settings.openrouter_model,
        "model_available": model_status.model_available,
        "model_status": model_status.model_status,
        "model_error": model_status.model_error,
        "database": settings.database_kind,
        "storage": "local",
    }
