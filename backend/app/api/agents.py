from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from app.agents.runner import (
    _step_blueprint,
    available_tasks,
    create_run,
    execute_agent_run,
    run_to_dict,
)
from app.agents.proposal import TASK_CATALOG
from app.core.errors import ApiError
from app.core.responses import ok
from app.database.base import get_db
from app.models import AgentRun, Dataset
from app.schemas.requests import AgentApprovalRequest, AgentRunRequest
from app.services.data_service import get_context, resolve_dataset

router = APIRouter(prefix="/agents", tags=["AI Agent Center"])


@router.post("/run")
def start_agent_run(
    request: AgentRunRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    dataset = resolve_dataset(db, request.dataset_id)
    ctx = get_context(dataset.id, db)
    tasks = request.agents
    if tasks is not None:
        allowed = set(available_tasks(ctx))
        requested = [task for task in tasks if task in allowed]
        if not requested:
            raise ApiError('Bộ dữ liệu này không hỗ trợ tác nhân nào trong danh sách được yêu cầu.', 422, "capability_unavailable")
        tasks = requested
    run = create_run(db, ctx, request.mode, request.objective, tasks)
    if request.mode == "auto":
        background_tasks.add_task(execute_agent_run, run.id)
    return ok(run_to_dict(run), 'Đã bắt đầu chạy tác nhân.' if request.mode == "auto" else 'Đang chờ người dùng phê duyệt.')


@router.get("/runs")
def list_runs(
    dataset_id: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(AgentRun)
    if dataset_id:
        query = query.filter(AgentRun.dataset_id == dataset_id)
    runs = query.order_by(AgentRun.created_at.desc()).limit(limit).all()
    dataset_ids = {run.dataset_id for run in runs}
    datasets = {dataset.id: dataset.name for dataset in db.query(Dataset).filter(Dataset.id.in_(dataset_ids)).all()}
    return ok(
        {
            "items": [
                {
                    "id": run.id,
                    "dataset_id": run.dataset_id,
                    "dataset_name": datasets.get(run.dataset_id),
                    "mode": run.mode,
                    "objective": run.objective,
                    "status": run.status,
                    "created_at": run.created_at.isoformat() if run.created_at else None,
                    "completed_at": run.completed_at.isoformat() if run.completed_at else None,
                    "duration_seconds": run.duration_seconds,
                    "llm_used": run.llm_used,
                }
                for run in runs
            ],
            "total": len(runs),
        }
    )


@router.get("/runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(AgentRun, run_id)
    if not run:
        raise ApiError('Không tìm thấy lần chạy tác nhân.', 404, "agent_run_not_found")
    return ok(run_to_dict(run))


@router.post("/approve")
def approve_run(
    request: AgentApprovalRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    run = db.get(AgentRun, request.run_id)
    if not run:
        raise ApiError('Không tìm thấy lần chạy tác nhân.', 404, "agent_run_not_found")
    if run.status != "awaiting_approval":
        raise ApiError('Chỉ có thể phê duyệt những lần chạy đang chờ phê duyệt.', 409, "invalid_run_state")
    run.notes = request.notes
    if not request.approved:
        run.status = "rejected"
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(run)
        return ok(run_to_dict(run), 'Đã từ chối khuyến nghị. Chưa thực hiện nhiệm vụ phân tích nào.')

    proposal_tasks = {
        task["id"]: task for task in (run.proposal or {}).get("proposed_tasks", []) if task.get("available")
    }
    selected = request.selected_tasks or [task for task, meta in proposal_tasks.items() if meta.get("selected")]
    selected = [task for task in selected if task in proposal_tasks and task in TASK_CATALOG]
    if not selected:
        raise ApiError('Chọn ít nhất một nhiệm vụ phân tích được hỗ trợ trước khi phê duyệt.', 422, "no_tasks_selected")
    run.selected_tasks = selected
    run.status = "running"
    run.steps = _step_blueprint(selected)
    run.error = None
    db.commit()
    background_tasks.add_task(execute_agent_run, run.id)
    db.refresh(run)
    return ok(run_to_dict(run), 'Đã phê duyệt. Các tác nhân đang chạy trong nền.')


@router.post("/reject")
def reject_run(request: AgentApprovalRequest, db: Session = Depends(get_db)):
    run = db.get(AgentRun, request.run_id)
    if not run:
        raise ApiError('Không tìm thấy lần chạy tác nhân.', 404, "agent_run_not_found")
    if run.status not in {"awaiting_approval", "running"}:
        raise ApiError('Không thể từ chối lần chạy ở trạng thái hiện tại.', 409, "invalid_run_state")
    run.status = "rejected"
    run.notes = request.notes
    run.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return ok(run_to_dict(run), 'Đã từ chối lần chạy tác nhân.')


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(AgentRun, run_id)
    if not run:
        raise ApiError('Không tìm thấy lần chạy tác nhân.', 404, "agent_run_not_found")
    if run.status in {"completed", "failed", "rejected", "cancelled"}:
        raise ApiError('Lần chạy này đã kết thúc.', 409, "invalid_run_state")
    run.status = "cancelled"
    run.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return ok(run_to_dict(run), 'Đã yêu cầu hủy. Quy trình sẽ dừng trước bước tác nhân tiếp theo.')
