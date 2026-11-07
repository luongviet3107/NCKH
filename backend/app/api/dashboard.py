from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.database.base import get_db
from app.services.dashboard_service import dashboard_overview
from app.services.data_service import get_context, resolve_dataset

router = APIRouter(prefix="/dashboard", tags=["Overview"])


@router.get("/overview")
def overview(
    dataset_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    dataset = resolve_dataset(db, dataset_id)
    ctx = get_context(dataset.id, db)
    return ok(dashboard_overview(ctx, start_date, end_date))
