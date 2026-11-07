from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.database.base import get_db
from app.schemas.requests import (
    ChurnRequest,
    CustomerListRequest,
    CustomerRecommendRequest,
    CustomerSegmentRequest,
)
from app.services.customer_service import (
    churn_analysis,
    customer_directory,
    recommend_products,
    segment_customers,
)
from app.services.data_service import get_context, resolve_dataset

router = APIRouter(prefix="/customers", tags=["Customer Intelligence"])


@router.post("/segment")
def segment(request: CustomerSegmentRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(segment_customers(ctx, request.limit))


@router.post("/list")
def list_customers(request: CustomerListRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(
        customer_directory(
            ctx,
            limit=request.limit,
            offset=request.offset,
            segment=request.segment,
            search=request.search,
        )
    )


@router.post("/recommend")
def recommend(request: CustomerRecommendRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(recommend_products(ctx, request.customer_id, request.top_n))


@router.post("/churn")
def churn(request: ChurnRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(churn_analysis(ctx, request.inactive_days))
