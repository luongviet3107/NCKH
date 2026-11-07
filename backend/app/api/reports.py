from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.responses import ok
from app.core.utils import json_safe
from app.database.base import get_db
from app.models import Dataset, Report
from app.schemas.requests import ReportCreateRequest, ReportExportRequest
from app.services.data_service import get_context, resolve_dataset
from app.services.report_service import (
    build_report,
    export_report_excel,
    export_report_pdf,
    safe_report_filename,
)

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("")
def list_reports(
    dataset_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(Report)
    if dataset_id:
        query = query.filter(Report.dataset_id == dataset_id)
    reports = query.order_by(Report.created_at.desc()).limit(limit).all()
    dataset_ids = {report.dataset_id for report in reports}
    datasets = {dataset.id: dataset.name for dataset in db.query(Dataset).filter(Dataset.id.in_(dataset_ids)).all()}
    return ok(
        {
            "items": [
                {
                    "id": report.id,
                    "dataset_id": report.dataset_id,
                    "dataset_name": datasets.get(report.dataset_id),
                    "title": report.title,
                    "summary": report.summary,
                    "created_at": report.created_at.isoformat() if report.created_at else None,
                }
                for report in reports
            ],
            "total": len(reports),
        }
    )


@router.post("")
def create_report(request: ReportCreateRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    report = build_report(ctx, request.title, request.include_forecast, db)
    return ok(
        {
            "id": report.id,
            "title": report.title,
            "summary": report.summary,
            "created_at": report.created_at.isoformat() if report.created_at else None,
        },
        'Đã tạo báo cáo từ kết quả phân tích thực tế.',
    )


@router.get("/{report_id}")
def get_report(report_id: str, db: Session = Depends(get_db)):
    report = db.get(Report, report_id)
    if not report:
        raise ApiError('Không tìm thấy báo cáo.', 404, "report_not_found")
    return ok(
        json_safe(
            {
                "id": report.id,
                "dataset_id": report.dataset_id,
                "title": report.title,
                "summary": report.summary,
                "content": report.content,
                "created_at": report.created_at.isoformat() if report.created_at else None,
            }
        )
    )


@router.delete("/{report_id}")
def delete_report(report_id: str, db: Session = Depends(get_db)):
    report = db.get(Report, report_id)
    if not report:
        raise ApiError('Không tìm thấy báo cáo.', 404, "report_not_found")
    db.delete(report)
    db.commit()
    return ok({"id": report_id}, 'Đã xóa báo cáo.')


@router.post("/export")
def export_report(request: ReportExportRequest, db: Session = Depends(get_db)):
    report = db.get(Report, request.report_id)
    if not report:
        raise ApiError('Không tìm thấy báo cáo.', 404, "report_not_found")
    if request.format == "pdf":
        path = export_report_pdf(report)
        media_type = "application/pdf"
        suffix = "pdf"
    else:
        path = export_report_excel(report)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        suffix = "xlsx"
    filename = safe_report_filename(report.title, suffix)
    return FileResponse(path=str(path), media_type=media_type, filename=filename)
