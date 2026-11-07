from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api import agents, customers, dashboard, data, inventory, models, products, reports, revenue, settings as settings_api
from app.config import settings
from app.core.errors import ApiError, error_payload
from app.core.responses import ok
from app.core.security import require_api_key
from app.database.base import SessionLocal, get_db, init_db
from app.services.data_service import ensure_demo_dataset

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("autods")


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.environ.setdefault("LANGCHAIN_PROJECT", settings.langsmith_project)
    if settings.langsmith_tracing and settings.langsmith_api_key:
        os.environ["LANGCHAIN_TRACING_V2"] = "true"
        os.environ["LANGCHAIN_API_KEY"] = settings.langsmith_api_key
    init_db()
    if settings.seed_demo_data:
        db = SessionLocal()
        try:
            from app.models import Dataset

            if db.query(Dataset).count() == 0:
                ensure_demo_dataset(db)
        except Exception as exc:
            logger.warning("Could not initialize demo dataset: %s", exc)
        finally:
            db.close()
    logger.info("AutoDS API %s ready", settings.app_version)
    yield


app = FastAPI(
    title="AutoDS — Hệ thống AI hỗ trợ quyết định kinh doanh",
    description=(
        "Nền tảng hỗ trợ quyết định với chức năng làm sạch dữ liệu, dự báo, tối ưu tồn kho, "
        "phân tích khách hàng, đánh giá mô hình và quy trình đa tác nhân LangGraph."
    ),
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(exc.code, exc.message, exc.details),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=error_payload(
            "validation_error",
            'Yêu cầu không đáp ứng các điều kiện dữ liệu đầu vào.',
            jsonable_encoder(exc.errors()),
        ),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled API error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content=error_payload("internal_error", 'Đã xảy ra lỗi máy chủ không mong muốn.', str(exc)[:500]),
    )


router_dependencies = [Depends(require_api_key)]
app.include_router(data.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(dashboard.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(products.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(inventory.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(customers.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(revenue.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(agents.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(models.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(reports.router, prefix=settings.api_prefix, dependencies=router_dependencies)
app.include_router(settings_api.router, prefix=settings.api_prefix, dependencies=router_dependencies)


@app.get(f"{settings.api_prefix}/health", tags=["System"])
def health(db: Session = Depends(get_db)):
    from app.models import Dataset

    return ok(
        {
            "status": "healthy",
            "version": settings.app_version,
            "datasets": db.query(Dataset).count(),
            "llm_configured": settings.llm_configured,
        }
    )


@app.get("/", include_in_schema=False)
def root():
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "api": settings.api_prefix,
    }
