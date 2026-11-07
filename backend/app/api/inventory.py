from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.database.base import get_db
from app.schemas.requests import InventoryRecommendationRequest, InventoryRequest
from app.services.data_service import get_context, resolve_dataset
from app.services.inventory_service import inventory_analysis, inventory_recommendations

router = APIRouter(prefix="/inventory", tags=["Inventory Forecast"])


@router.post("/forecast")
def forecast(request: InventoryRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(
        inventory_analysis(
            ctx,
            request.lead_time_days,
            request.service_level,
            request.ordering_cost,
            request.holding_rate,
            request.limit,
        )
    )


@router.post("/recommendations")
def recommendations(request: InventoryRecommendationRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(
        inventory_recommendations(
            ctx,
            request.lead_time_days,
            request.service_level,
            request.ordering_cost,
            request.holding_rate,
            request.limit,
            request.priority,
            request.product,
        )
    )
