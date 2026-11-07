from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.database.base import get_db
from app.schemas.requests import RevenueAnalyzeRequest, RevenueForecastRequest
from app.services.data_service import get_context, resolve_dataset
from app.services.revenue_service import revenue_analysis, revenue_forecast

router = APIRouter(prefix="/revenue", tags=["Revenue Analytics"])


@router.post("/analyze")
def analyze(request: RevenueAnalyzeRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(revenue_analysis(ctx, request.start_date, request.end_date, request.granularity))


@router.post("/forecast")
def forecast(request: RevenueForecastRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(revenue_forecast(ctx, request.horizon_days))
