from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.responses import ok
from app.core.utils import json_safe
from app.database.base import get_db
from app.models import BenchmarkRun, Dataset
from app.schemas.requests import BenchmarkRequest
from app.services.benchmark_service import run_benchmark
from app.services.data_service import get_context, resolve_dataset

router = APIRouter(prefix="/models", tags=["Model Evaluation"])


@router.post("/benchmark")
def benchmark(request: BenchmarkRequest, db: Session = Depends(get_db)):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    result = run_benchmark(ctx, request.task, request.human_model, request.test_ratio, db)
    return ok(result, 'Đã hoàn tất đánh giá bằng tập kiểm thử độc lập theo thời gian hoặc phân tầng với các chỉ số thực tế.')


@router.get("/benchmarks")
def list_benchmarks(
    dataset_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(BenchmarkRun)
    if dataset_id:
        query = query.filter(BenchmarkRun.dataset_id == dataset_id)
    runs = query.order_by(BenchmarkRun.created_at.desc()).limit(limit).all()
    dataset_ids = {run.dataset_id for run in runs}
    datasets = {dataset.id: dataset.name for dataset in db.query(Dataset).filter(Dataset.id.in_(dataset_ids)).all()}
    return ok(
        {
            "items": [
                {
                    "id": run.id,
                    "dataset_id": run.dataset_id,
                    "dataset_name": datasets.get(run.dataset_id),
                    "task": run.task,
                    "human_model": run.human_model,
                    "ai_model": run.ai_model,
                    "results": run.results,
                    "created_at": run.created_at.isoformat() if run.created_at else None,
                }
                for run in runs
            ],
            "total": len(runs),
        }
    )


@router.get("/benchmarks/{benchmark_id}")
def get_benchmark(benchmark_id: str, db: Session = Depends(get_db)):
    run = db.get(BenchmarkRun, benchmark_id)
    if not run:
        raise ApiError('Không tìm thấy kết quả đánh giá.', 404, "benchmark_not_found")
    return ok(
        json_safe(
            {
                "id": run.id,
                "dataset_id": run.dataset_id,
                "task": run.task,
                "human_model": run.human_model,
                "ai_model": run.ai_model,
                "results": run.results,
                "created_at": run.created_at.isoformat() if run.created_at else None,
            }
        )
    )
