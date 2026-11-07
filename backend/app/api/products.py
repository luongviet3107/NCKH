from __future__ import annotations

import pandas as pd
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.database.base import get_db
from app.schemas.requests import ProductDetailRequest, ProductForecastRequest
from app.services.data_service import get_context, resolve_dataset
from app.services.product_service import forecast_products, product_catalog, product_detail

router = APIRouter(prefix="/products", tags=["Product Intelligence"])


@router.get("")
def list_products(
    dataset_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str = Query(default="recent_revenue"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    dataset = resolve_dataset(db, dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(product_catalog(ctx, search, sort_by, limit, offset))


@router.post("/forecast")
def forecast(request: ProductForecastRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    end_date = pd.Timestamp(request.end_date) if request.end_date else None
    data = forecast_products(ctx, limit=request.limit, end_date=end_date)
    return ok(data)


@router.post("/detail-forecast")
def detail_forecast(request: ProductDetailRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(product_detail(ctx, request.product, request.horizon_days))
