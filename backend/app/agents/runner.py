from __future__ import annotations

from app.core.localization import label as vi_label

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, TypedDict

from sqlalchemy.orm import Session

from app.agents.llm import generate_grounded_narrative
from app.agents.proposal import TASK_CATALOG, build_proposal
from app.config import settings
from app.core.utils import json_safe
from app.database.base import SessionLocal
from app.models import AgentRun
from app.services.customer_service import churn_analysis, segment_customers
from app.services.data_service import DataContext, get_context
from app.services.inventory_service import inventory_analysis
from app.services.mapping import missing_data_guidance
from app.services.product_service import forecast_products
from app.services.revenue_service import revenue_analysis, revenue_forecast

logger = logging.getLogger("autods.agents")

TASK_STEP_LABELS = {
    "data_audit": 'Tác nhân Phân tích Dữ liệu',
    "product_forecast": 'Tác nhân Dự báo Sản phẩm',
    "inventory": 'Tác nhân Tồn kho',
    "customers": 'Tác nhân Khách hàng',
    "revenue": 'Tác nhân Doanh thu',
    "decision_support": 'Tác nhân Hỗ trợ Quyết định',
}
DEFAULT_STEP_ORDER = ["data_audit", "product_forecast", "inventory", "customers", "revenue", "decision_support"]


class RunCancelled(Exception):
    pass


class AgentState(TypedDict, total=False):
    results: dict


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StepLogger:
    def __init__(self, run_id: str, db: Session):
        self.run_id = run_id
        self.db = db

    def _run(self) -> AgentRun:
        run = self.db.get(AgentRun, self.run_id)
        if run is None:
            raise RuntimeError('Không tìm thấy lần chạy tác nhân.')
        return run

    def check_cancelled(self, started_at: float | None = None) -> None:
        self.db.expire_all()
        run = self._run()
        if run.status == "cancelled":
            raise RunCancelled('Người dùng đã hủy lần chạy.')
        if started_at is not None and time.perf_counter() - started_at > settings.max_agent_runtime_seconds:
            raise RunCancelled('Lần chạy đã vượt quá giới hạn thời gian được cấu hình.')

    def start(self, key: str) -> None:
        run = self._run()
        steps = [dict(step) for step in (run.steps or [])]
        for step in steps:
            if step["key"] == key:
                step["status"] = "running"
                step["started_at"] = _now()
                step["error"] = None
        run.steps = steps
        self.db.commit()

    def complete(self, key: str, summary: str, result_summary: dict | None = None) -> None:
        run = self._run()
        steps = [dict(step) for step in (run.steps or [])]
        for step in steps:
            if step["key"] == key:
                step["status"] = "completed"
                step["completed_at"] = _now()
                step["summary"] = summary[:1200]
                if result_summary:
                    step["result_summary"] = json_safe(result_summary)
        run.steps = steps
        self.db.commit()

    def fail(self, key: str, error: str) -> None:
        run = self._run()
        steps = [dict(step) for step in (run.steps or [])]
        for step in steps:
            if step["key"] == key:
                step["status"] = "failed"
                step["completed_at"] = _now()
                step["error"] = error[:1500]
        run.steps = steps
        self.db.commit()

    def set_result(self, result: dict) -> None:
        run = self._run()
        run.result = json_safe(result)
        self.db.commit()


def _step_blueprint(tasks: list[str]) -> list[dict]:
    keys = ["data_audit", *tasks, "decision_support"]
    return [
        {
            "key": key,
            "label": TASK_STEP_LABELS.get(key, key),
            "status": "queued",
            "started_at": None,
            "completed_at": None,
            "summary": None,
            "error": None,
        }
        for key in keys
    ]


def available_tasks(ctx: DataContext) -> list[str]:
    tasks = []
    if ctx.capabilities.get("products"):
        tasks.append("product_forecast")
    if ctx.capabilities.get("inventory"):
        tasks.append("inventory")
    if ctx.capabilities.get("customers"):
        tasks.append("customers")
    if ctx.capabilities.get("revenue"):
        tasks.append("revenue")
    return tasks


def create_run(
    db: Session,
    ctx: DataContext,
    mode: str,
    objective: str,
    selected_tasks: list[str] | None = None,
) -> AgentRun:
    tasks = [task for task in (selected_tasks or available_tasks(ctx)) if task in TASK_CATALOG]
    if not tasks:
        tasks = []
    proposal = build_proposal(ctx, objective)
    run = AgentRun(
        id=str(uuid.uuid4()),
        dataset_id=ctx.dataset.id,
        mode=mode,
        objective=objective,
        status="awaiting_approval" if mode == "hitl" else "running",
        steps=_step_blueprint(tasks),
        proposal=proposal,
        selected_tasks=tasks,
        result={},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def _filtered_llm_payload(result: dict) -> dict:
    return {
        "objective": result.get("objective"),
        "data_audit": result.get("data_audit"),
        "product_forecast": result.get("product_forecast", {}).get("summary")
        if isinstance(result.get("product_forecast"), dict)
        else None,
        "inventory": result.get("inventory", {}).get("summary")
        if isinstance(result.get("inventory"), dict)
        else None,
        "customers": {
            "segmentation": result.get("customers", {}).get("segmentation", {}).get("metrics")
            if isinstance(result.get("customers"), dict)
            else None,
            "churn": result.get("customers", {}).get("churn", {}).get("metrics")
            if isinstance(result.get("customers"), dict)
            else None,
            "risk_distribution": result.get("customers", {}).get("churn", {}).get("risk_distribution")
            if isinstance(result.get("customers"), dict)
            else None,
        },
        "revenue": {
            "kpis": result.get("revenue", {}).get("kpis") if isinstance(result.get("revenue"), dict) else None,
            "forecast": result.get("revenue", {}).get("forecast", {}).get("summary")
            if isinstance(result.get("revenue"), dict)
            else None,
        },
        "decision_candidates": result.get("decisions"),
    }


def _build_decisions(results: dict) -> list[dict]:
    decisions: list[dict] = []
    inventory = results.get("inventory") or {}
    if isinstance(inventory, dict) and inventory.get("available"):
        for rec in inventory.get("recommendations", [])[:4]:
            decisions.append(
                {
                    "priority": rec.get("priority", "medium"),
                    "area": 'Tồn kho',
                    "title": f"{rec['product']}: {vi_label(rec['status'])}",
                    "action": rec.get("actions", [""])[0] if rec.get("actions") else 'Xem xét tình hình tồn kho.',
                    "evidence": rec.get("evidence", []),
                    "rationale": rec.get("cause"),
                    "expected_impact": rec.get("expected_impact"),
                    "source": 'Tác nhân Tồn kho',
                }
            )
    customers = results.get("customers") or {}
    if isinstance(customers, dict):
        churn = customers.get("churn") or {}
        if churn.get("available"):
            risk_rows = churn.get("risk_distribution", [])
            high_risk = next((row["count"] for row in risk_rows if row["risk"] == "High Risk"), 0)
            if high_risk:
                decisions.append(
                    {
                        "priority": "high" if high_risk > max(5, len(churn.get("customers", [])) * 0.1) else "medium",
                        "area": 'Giữ chân khách hàng',
                        "title": 'Ưu tiên nhóm khách hàng có nguy cơ rời bỏ cao',
                        "action": 'Triển khai chuỗi chăm sóc cá nhân hóa để thu hút khách hàng quay lại và hạn chế giảm giá đại trà không cần thiết.',
                        "evidence": [
                            f"Mô hình {churn.get('metrics', {}).get('model', 'churn')} xếp {high_risk} khách hàng vào nhóm rủi ro cao.",
                            f"Độ bao phủ trên tập kiểm thử độc lập: {churn.get('metrics', {}).get('recall')}; ROC-AUC: {churn.get('metrics', {}).get('roc_auc')}.",
                        ],
                        "rationale": f"Nhãn rời bỏ được xác định khi khách hàng không hoạt động quá ngưỡng cấu hình ({churn.get('data_context', {}).get('inactive_threshold_days')} ngày).",
                        "expected_impact": 'Giúp chọn đúng khách hàng cần giữ chân; hiệu quả thực tế cần được đo bằng chiến dịch thử nghiệm có đối chứng.',
                        "source": 'Tác nhân Khách hàng',
                    }
                )
        segmentation = customers.get("segmentation") or {}
        if segmentation.get("available"):
            clusters = segmentation.get("clusters", [])
            at_risk = next((row for row in clusters if row["segment"] == "At-risk Customers"), None)
            if at_risk:
                decisions.append(
                    {
                        "priority": "medium",
                        "area": 'Giá trị khách hàng',
                        "title": 'Bảo vệ giá trị của nhóm khách hàng có nguy cơ rời bỏ',
                        "action": 'Xem xét danh mục mua gần đây của nhóm khách hàng có nguy cơ rời bỏ và triển khai hoạt động tư vấn, chăm sóc phù hợp.',
                        "evidence": [
                            f"Có {at_risk['count']} khách hàng trong phân khúc có nguy cơ rời bỏ do K-Means xác định.",
                            f"Giá trị chi tiêu trung bình của phân khúc: {at_risk['avg_monetary']:.2f}.",
                        ],
                        "rationale": 'Phân khúc dựa trên các đặc trưng RFM, giá trị đơn hàng trung bình, tần suất mua và thời gian gắn bó đã được chuẩn hóa.',
                        "expected_impact": 'Hỗ trợ xác định ưu tiên giữ chân khách hàng; chưa ước tính lợi ích tài chính khi chưa có dữ liệu thử nghiệm.',
                        "source": 'Tác nhân Khách hàng',
                    }
                )
    revenue = results.get("revenue") or {}
    if isinstance(revenue, dict):
        kpis = revenue.get("kpis") or {}
        forecast = (revenue.get("forecast") or {}).get("summary") or {}
        growth = kpis.get("growth_pct")
        if growth is not None:
            decisions.append(
                {
                    "priority": "high" if growth < -10 else "medium",
                    "area": 'Doanh thu',
                    "title": 'Cần hành động theo diễn biến doanh thu',
                    "action": (
                        'Bảo đảm nguồn cung và năng lực triển khai chiến dịch cho các danh mục dẫn đầu.'
                        if growth >= 0
                        else 'Phân tích nguyên nhân sụt giảm theo danh mục, sản phẩm và phân khúc khách hàng trước khi điều chỉnh kế hoạch.'
                    ),
                    "evidence": [
                        f'Tăng trưởng doanh thu trong kỳ gần nhất: {growth:+.1f}%.',
                        f"Xu hướng dự báo doanh thu: {vi_label(forecast.get('trend'))}.",
                    ],
                    "rationale": kpis.get("growth_basis"),
                    "expected_impact": 'Giúp hoạt động kinh doanh phù hợp với diễn biến quan sát được; kết quả tài chính vẫn còn bất định.',
                    "source": 'Tác nhân Doanh thu',
                }
            )
    product = results.get("product_forecast") or {}
    if isinstance(product, dict):
        fastest = product.get("fastest_growing_product")
        if fastest:
            decisions.append(
                {
                    "priority": "medium",
                    "area": 'Sản phẩm',
                    "title": f"Chuẩn bị đáp ứng nhu cầu tăng của {fastest.get('product')}",
                    "action": 'Kiểm tra số ngày đáp ứng của tồn kho và thời gian bổ sung hàng theo mức tăng trưởng dự báo.',
                    "evidence": [
                        f"Tăng trưởng dự báo 30 ngày: {fastest.get('forecast_30_growth_pct'):+.1f}%." if fastest.get("forecast_30_growth_pct") is not None else 'Chưa có dữ liệu tăng trưởng dự báo.',
                        f"Chất lượng kiểm định: {vi_label(fastest.get('validation_quality'))}.",
                    ],
                    "rationale": 'Thứ hạng dựa trên dự báo thực tế của sản phẩm và điểm tiềm năng tương đối.',
                    "expected_impact": 'Giảm rủi ro mất cân đối cung cầu; chưa ước tính mức tăng doanh thu.',
                    "source": 'Tác nhân Dự báo Sản phẩm',
                }
            )
    data_audit = results.get("data_audit") or {}
    if data_audit.get("quality_score") is not None and data_audit["quality_score"] < 85:
        decisions.append(
            {
                "priority": "medium",
                "area": 'Chất lượng dữ liệu',
                "title": 'Cải thiện chất lượng dữ liệu trước khi triển khai vận hành',
                "action": 'Kiểm tra giá trị thiếu, dòng trùng lặp và ngày không hợp lệ được tác nhân phân tích dữ liệu phát hiện.',
                "evidence": [f"Điểm chất lượng dữ liệu: {data_audit['quality_score']}/100."],
                "rationale": 'Độ tin cậy của phân tích phụ thuộc vào các trường dữ liệu và quy tắc làm sạch được sử dụng.',
                "expected_impact": 'Nâng cao độ tin cậy của các khuyến nghị tiếp theo.',
                "source": 'Tác nhân Phân tích Dữ liệu',
            }
        )
    priority_order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
    decisions.sort(key=lambda row: priority_order.get(row.get("priority"), 4))
    return decisions[:8]


def _deterministic_summary(results: dict, decisions: list[dict]) -> str:
    data = results.get("data_audit") or {}
    revenue = results.get("revenue") or {}
    inventory = results.get("inventory") or {}
    customers = results.get("customers") or {}
    product = results.get("product_forecast") or {}
    kpis = revenue.get("kpis") or {}
    parts = []
    if data:
        parts.append(
            f"Bộ dữ liệu có {data.get('rows', 0):,} dòng và {data.get('columns', 0)} cột, với điểm chất lượng dữ liệu là {data.get('quality_score')}."
        )
    if kpis:
        parts.append(
            f"Doanh thu được phân tích là {kpis.get('total_revenue', 0):,.0f}, với mức tăng trưởng kỳ gần nhất là {kpis.get('growth_pct'):+.1f}%." if kpis.get("growth_pct") is not None else
            f"Doanh thu được phân tích là {kpis.get('total_revenue', 0):,.0f}; chưa có dữ liệu cơ sở để so sánh tăng trưởng."
        )
    if product.get("summary"):
        summary = product["summary"]
        parts.append(
            f"Tác nhân sản phẩm đã dự báo {summary.get('forecasted_products', 0)} sản phẩm và xác định {summary.get('high_potential_products', 0)} sản phẩm có tiềm năng cao."
        )
    if inventory.get("available") and inventory.get("summary"):
        summary = inventory["summary"]
        parts.append(
            f"Phân tích tồn kho phát hiện {summary.get('critical_low_count', 0)} sản phẩm tồn kho nguy cấp hoặc thấp và {summary.get('dead_stock_count', 0)} sản phẩm tồn chết."
        )
    churn = customers.get("churn") or {}
    if churn.get("available"):
        high = next((row["count"] for row in churn.get("risk_distribution", []) if row["risk"] == "High Risk"), 0)
        parts.append(f'Mô hình rời bỏ xác định {high} khách hàng có rủi ro cao.')
    if decisions:
        top = decisions[0]
        parts.append(f"Hành động ưu tiên cao nhất: {top.get('title')} — {top.get('action')}")
    return " ".join(parts)


def execute_agent_run(run_id: str) -> None:
    db = SessionLocal()
    started_perf = time.perf_counter()
    logger_obj = StepLogger(run_id, db)
    try:
        db.expire_all()
        run = db.get(AgentRun, run_id)
        if run is None:
            return
        if run.status not in {"running", "awaiting_approval"}:
            return
        if run.status == "awaiting_approval":
            return
        ctx = get_context(run.dataset_id, db)
        selected_tasks = [task for task in run.selected_tasks if task in TASK_CATALOG]
        run.status = "running"
        run.steps = _step_blueprint(selected_tasks)
        db.commit()
        started_at_dt = _utcnow()
        results: dict[str, Any] = {"objective": run.objective, "notes": run.notes or ""}

        def data_audit_node(state: AgentState) -> AgentState:
            logger_obj.check_cancelled(started_perf)
            logger_obj.start("data_audit")
            try:
                profile = ctx.dataset.quality_report or {}
                data = {
                    "rows": len(ctx.frame),
                    "columns": int(ctx.frame.shape[1]),
                    "quality_score": profile.get("quality_score"),
                    "duplicate_rows": profile.get("duplicate_rows"),
                    "missing_pct": profile.get("missing_pct"),
                    "invalid_dates": profile.get("invalid_dates"),
                    "date_start": ctx.date_min,
                    "date_end": ctx.date_max,
                    "is_demo": ctx.dataset.is_demo,
                    "capabilities": ctx.capabilities,
                    "missing_fields": missing_data_guidance(ctx.mapping),
                    "revenue_derived": ctx.revenue_derived,
                    "outlier_columns": [row["column"] for row in profile.get("numeric_outliers", [])],
                }
                results["data_audit"] = data
                logger_obj.complete(
                    "data_audit",
                    f"Đã lập hồ sơ {data['rows']:,} dòng trên {data['columns']} cột; điểm chất lượng {data['quality_score']}/100.",
                    {"quality_score": data["quality_score"], "date_range": [ctx.date_min, ctx.date_max]},
                )
            except Exception as exc:
                logger_obj.fail("data_audit", str(exc))
                results["data_audit"] = {"error": str(exc)}
            return {"results": results}

        def product_node(state: AgentState) -> AgentState:
            logger_obj.check_cancelled(started_perf)
            logger_obj.start("product_forecast")
            try:
                payload = forecast_products(ctx, limit=25)
                trimmed = {
                    "summary": payload["summary"],
                    "top_products": payload["products"][:8],
                    "notes": payload["notes"],
                }
                rising = [
                    row
                    for row in payload["products"]
                    if row.get("forecast_30_growth_pct") is not None
                    and row["forecast_30_growth_pct"] > 0
                    and (row.get("recent_30_units") or 0) > 0
                ]
                if rising:
                    trimmed["fastest_growing_product"] = max(
                        rising, key=lambda item: item["forecast_30_growth_pct"]
                    )
                results["product_forecast"] = trimmed
                logger_obj.complete(
                    "product_forecast",
                    f"Đã dự báo {payload['summary'].get('forecasted_products', 0)} sản phẩm; {payload['summary'].get('high_potential_products', 0)} sản phẩm có tiềm năng cao.",
                    payload["summary"],
                )
            except Exception as exc:
                logger_obj.fail("product_forecast", str(exc))
                results["product_forecast"] = {"error": str(exc)}
            return {"results": results}

        def inventory_node(state: AgentState) -> AgentState:
            logger_obj.check_cancelled(started_perf)
            logger_obj.start("inventory")
            try:
                payload = inventory_analysis(ctx, limit=150)
                trimmed = {
                    "available": payload["available"],
                    "reason": payload["reason"],
                    "summary": payload.get("summary"),
                    "assumptions": payload.get("assumptions"),
                    "recommendations": payload.get("recommendations", [])[:8],
                    "top_items": payload.get("items", [])[:12],
                }
                results["inventory"] = trimmed
                count = (
                    payload["summary"].get("critical_low_count", 0)
                    if payload.get("summary")
                    else 0
                )
                logger_obj.complete(
                    "inventory",
                    payload["reason"] or f'Đã kiểm tra tồn kho; có {count} sản phẩm tồn kho nguy cấp hoặc thấp.',
                    payload.get("summary"),
                )
            except Exception as exc:
                logger_obj.fail("inventory", str(exc))
                results["inventory"] = {"available": False, "error": str(exc)}
            return {"results": results}

        def customer_node(state: AgentState) -> AgentState:
            logger_obj.check_cancelled(started_perf)
            logger_obj.start("customers")
            try:
                customer_result: dict[str, Any] = {}
                try:
                    segment = segment_customers(ctx, limit=25)
                    customer_result["segmentation"] = {
                        "available": segment.get("available"),
                        "reason": segment.get("reason"),
                        "method": segment.get("method"),
                        "metrics": segment.get("metrics"),
                        "clusters": segment.get("clusters", []),
                        "segment_distribution": segment.get("segment_distribution", []),
                    }
                except Exception as exc:
                    customer_result["segmentation"] = {"available": False, "error": str(exc)}
                try:
                    churn = churn_analysis(ctx, 90)
                    customer_result["churn"] = {
                        "available": churn.get("available"),
                        "reason": churn.get("reason"),
                        "metrics": churn.get("metrics"),
                        "risk_distribution": churn.get("risk_distribution", []),
                        "feature_importance": churn.get("feature_importance", [])[:6],
                        "top_risk_customers": churn.get("customers", [])[:6],
                        "data_context": churn.get("data_context"),
                    }
                except Exception as exc:
                    customer_result["churn"] = {"available": False, "error": str(exc)}
                results["customers"] = customer_result
                segment_metrics = (customer_result.get("segmentation") or {}).get("metrics") or {}
                churn_metrics = (customer_result.get("churn") or {}).get("metrics") or {}
                logger_obj.complete(
                    "customers",
                    'Đã hoàn tất phân khúc khách hàng'
                    + (
                        f" (điểm silhouette {segment_metrics.get('silhouette_score')}); ROC-AUC của mô hình rời bỏ {churn_metrics.get('roc_auc')}."
                        if churn_metrics
                        else '. Chưa có mô hình rời bỏ phù hợp.'
                    ),
                    {
                        "segments": len((customer_result.get("segmentation") or {}).get("clusters", [])),
                        "churn_roc_auc": churn_metrics.get("roc_auc"),
                    },
                )
            except Exception as exc:
                logger_obj.fail("customers", str(exc))
                results["customers"] = {"error": str(exc)}
            return {"results": results}

        def revenue_node(state: AgentState) -> AgentState:
            logger_obj.check_cancelled(started_perf)
            logger_obj.start("revenue")
            try:
                analysis = revenue_analysis(ctx, granularity="month")
                forecast = revenue_forecast(ctx, 90)
                results["revenue"] = {
                    "period": analysis["period"],
                    "kpis": analysis["kpis"],
                    "categories": analysis["categories"][:5],
                    "products": analysis["products"][:5],
                    "insights": analysis["insights"],
                    "forecast": {
                        "summary": forecast["summary"],
                        "validation": forecast["validation"],
                        "insights": forecast["insights"],
                    },
                }
                logger_obj.complete(
                    "revenue",
                    f"Doanh thu {analysis['kpis']['total_revenue']:,.0f}; dự báo 30 ngày {forecast['summary']['forecast_30d']:,.0f} bằng mô hình {forecast['summary']['model_label']}.",
                    analysis["kpis"],
                )
            except Exception as exc:
                logger_obj.fail("revenue", str(exc))
                results["revenue"] = {"error": str(exc)}
            return {"results": results}

        def decision_node(state: AgentState) -> AgentState:
            logger_obj.check_cancelled(started_perf)
            logger_obj.start("decision_support")
            try:
                decisions = _build_decisions(results)
                results["decisions"] = decisions
                deterministic = _deterministic_summary(results, decisions)
                narrative, llm_used, llm_error = generate_grounded_narrative(_filtered_llm_payload(results))
                results["executive_summary"] = deterministic
                results["llm_narrative"] = narrative
                results["llm_used"] = llm_used
                results["llm_error"] = llm_error
                results["decision_basis"] = (
                    'Mức ưu tiên được xếp theo kết quả tính toán tồn kho, rời bỏ, doanh thu và sản phẩm. Mô hình ngôn ngữ tùy chọn chỉ tạo diễn giải dựa trên bằng chứng và giữ nguyên các chỉ số.'
                )
                logger_obj.complete(
                    "decision_support",
                    f'Đã tổng hợp {len(decisions)} khuyến nghị hỗ trợ quyết định.'
                    + (' Đã dùng diễn giải của mô hình ngôn ngữ.' if llm_used else ' Đã dùng diễn giải theo kết quả tính toán.'),
                    {"recommendations": len(decisions), "llm_used": llm_used},
                )
            except Exception as exc:
                logger_obj.fail("decision_support", str(exc))
                results["decisions"] = []
                results["executive_summary"] = 'Không thể tổng hợp quyết định: ' + str(exc)[:300]
                results["llm_used"] = False
            return {"results": results}

        node_map = {
            "data_audit": data_audit_node,
            "product_forecast": product_node,
            "inventory": inventory_node,
            "customers": customer_node,
            "revenue": revenue_node,
            "decision_support": decision_node,
        }
        sequence = ["data_audit", *selected_tasks, "decision_support"]
        try:
            from langgraph.graph import END, StateGraph

            graph = StateGraph(AgentState)
            for key in sequence:
                graph.add_node(key, node_map[key])
            graph.set_entry_point(sequence[0])
            for current, following in zip(sequence, sequence[1:]):
                graph.add_edge(current, following)
            graph.add_edge(sequence[-1], END)
            compiled = graph.compile()
            compiled.invoke({"results": results})
        except ImportError:
            state: AgentState = {"results": results}
            for key in sequence:
                state = node_map[key](state)
            results = state["results"]

        logger_obj.check_cancelled(started_perf)
        db.expire_all()
        run = db.get(AgentRun, run_id)
        if run is None:
            return
        if run.status == "cancelled":
            return
        run.result = json_safe(results)
        run.status = "completed"
        run.llm_used = bool(results.get("llm_used"))
        run.duration_seconds = round(time.perf_counter() - started_perf, 2)
        run.completed_at = _utcnow()
        run.error = None
        db.commit()
    except RunCancelled as exc:
        db.expire_all()
        run = db.get(AgentRun, run_id)
        if run and run.status != "cancelled":
            run.status = "cancelled"
            run.error = str(exc)
            run.completed_at = _utcnow()
            run.duration_seconds = round(time.perf_counter() - started_perf, 2)
            db.commit()
    except Exception as exc:
        logger.exception("Agent run failed: %s", exc)
        db.expire_all()
        run = db.get(AgentRun, run_id)
        if run:
            run.status = "failed"
            run.error = str(exc)[:2000]
            run.completed_at = _utcnow()
            run.duration_seconds = round(time.perf_counter() - started_perf, 2)
            db.commit()
    finally:
        db.close()


def run_to_dict(run: AgentRun) -> dict:
    return json_safe(
        {
            "id": run.id,
            "dataset_id": run.dataset_id,
            "mode": run.mode,
            "objective": run.objective,
            "status": run.status,
            "steps": run.steps,
            "proposal": run.proposal,
            "result": run.result,
            "selected_tasks": run.selected_tasks,
            "notes": run.notes,
            "error": run.error,
            "llm_used": run.llm_used,
            "duration_seconds": run.duration_seconds,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "updated_at": run.updated_at.isoformat() if run.updated_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        }
    )
