from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.responses import ok
from app.core.utils import json_safe
from app.database.base import get_db
from app.models import Dataset
from app.schemas.requests import DataCleanRequest
from app.services.data_service import (
    activate_dataset,
    clean_dataset,
    dataset_summary,
    delete_dataset,
    ensure_demo_dataset,
    preview_dataset,
    resolve_dataset,
    save_upload,
)
from app.services.mapping import capabilities, capabilities_view

router = APIRouter(prefix="/data", tags=["Data Management"])


@router.get("/datasets")
def list_datasets(db: Session = Depends(get_db)):
    datasets = db.query(Dataset).order_by(Dataset.created_at.desc()).all()
    active = next((dataset for dataset in datasets if dataset.is_active), datasets[0] if datasets else None)
    return ok(
        {
            "items": [dataset_summary(dataset, active.id if active else None) for dataset in datasets],
            "active_dataset_id": active.id if active else None,
            "total": len(datasets),
        }
    )


@router.post("/upload")
async def upload_dataset(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    if not content:
        raise ApiError('Tệp tải lên bị trống.', 422, "empty_file")
    result = save_upload(file.filename or "dataset.csv", content, db)
    return ok(json_safe(result), 'Đã tải lên bộ dữ liệu. Hãy xem hồ sơ dữ liệu rồi thực hiện làm sạch.')


@router.post("/demo")
def load_demo(db: Session = Depends(get_db)):
    dataset = ensure_demo_dataset(db)
    from app.services.data_service import _activate

    _activate(dataset, db)
    return ok(dataset_summary(dataset, dataset.id), 'Đã tải bộ dữ liệu mẫu. Dữ liệu được gắn nhãn minh họa rõ ràng và không được coi là dữ liệu kinh doanh thực tế.')


@router.get("/preview")
def dataset_preview(
    dataset_id: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    raw: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    dataset = resolve_dataset(db, dataset_id)
    return ok(json_safe(preview_dataset(dataset.id, db, limit, offset, raw)))


@router.get("/{dataset_id}/profile")
def dataset_profile(dataset_id: str, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, dataset_id)
    return ok(
        {
            "dataset": dataset_summary(dataset, dataset.id),
            "profile": dataset.quality_report,
            "cleaning_report": dataset.cleaning_report,
            "mapping": dataset.column_mapping,
        }
    )


@router.post("/{dataset_id}/clean")
def clean(
    dataset_id: str,
    request: DataCleanRequest,
    db: Session = Depends(get_db),
):
    result = clean_dataset(dataset_id, request.model_dump(), db)
    return ok(json_safe(result), 'Đã làm sạch và lưu bộ dữ liệu.')


@router.post("/{dataset_id}/activate")
def activate(dataset_id: str, db: Session = Depends(get_db)):
    return ok(activate_dataset(dataset_id, db), 'Đã cập nhật bộ dữ liệu đang dùng.')


@router.delete("/{dataset_id}")
def delete(dataset_id: str, db: Session = Depends(get_db)):
    delete_dataset(dataset_id, db)
    return ok({"id": dataset_id}, 'Đã xóa bộ dữ liệu.')


@router.get("/{dataset_id}/capabilities")
def dataset_capabilities(dataset_id: str, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, dataset_id)
    return ok(
        {
            "capabilities": capabilities_view(dataset.column_mapping or {}),
            "raw": capabilities(dataset.column_mapping or {}),
        }
    )
