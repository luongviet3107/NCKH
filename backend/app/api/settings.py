from __future__ import annotations

import importlib.metadata

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.agents.llm import llm_status
from app.config import settings
from app.core.responses import ok
from app.database.base import get_db
from app.forecasting.engine import MODEL_LABELS
from app.services.customer_service import clear_customer_cache
from app.services.dashboard_service import clear_dashboard_cache
from app.services.data_service import get_llm_availability
from app.services.inventory_service import clear_inventory_cache
from app.services.product_service import clear_product_cache
from app.services.revenue_service import clear_revenue_cache

router = APIRouter(prefix="/settings", tags=["System Settings"])


def _version(package: str) -> str | None:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    from app.models import Dataset

    dataset_count = db.query(Dataset).count()
    return ok(
        {
            "app": {
                "name": settings.app_name,
                "version": settings.app_version,
                "environment": settings.environment,
            },
            "llm": {**llm_status(), **get_llm_availability()},
            "database": {
                "backend": "PostgreSQL" if settings.database_url.startswith("postgres") else "SQLite",
                "configured": not settings.database_url.startswith("sqlite"),
                "dataset_count": dataset_count,
            },
            "limits": {
                "max_upload_mb": settings.max_upload_mb,
                "max_agent_runtime_seconds": settings.max_agent_runtime_seconds,
                "api_key_enabled": bool(settings.api_key),
            },
            "models": {
                "available": MODEL_LABELS,
                "xgboost": _version("xgboost") is not None,
                "langgraph": _version("langgraph") is not None,
                "prophet": _version("prophet") is not None,
            },
            "sandbox": {
                "mode": "isolated-analysis-services",
                "arbitrary_code_execution": False,
                "description": (
                    'Các tác nhân gọi những dịch vụ phân tích Python đã được kiểm chứng. Hệ thống không thực thi mã do người dùng cung cấp. Khi triển khai bằng Docker Compose, tầng API và giao diện web có thể được cách ly với máy chủ.'
                ),
            },
            "langsmith": {
                "configured": bool(settings.langsmith_api_key),
                "tracing_enabled": bool(settings.langsmith_tracing and settings.langsmith_api_key),
                "project": settings.langsmith_project if settings.langsmith_api_key else None,
            },
        }
    )


@router.post("/cache/clear")
def clear_cache():
    clear_product_cache()
    clear_inventory_cache()
    clear_customer_cache()
    clear_revenue_cache()
    clear_dashboard_cache()
    return ok({"cleared": True}, 'Đã xóa bộ nhớ đệm phân tích.')
