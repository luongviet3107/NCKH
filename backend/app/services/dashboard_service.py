from __future__ import annotations

from app.core.localization import label as vi_label

import time
from datetime import date

import pandas as pd

from app.core.errors import ApiError
from app.core.utils import json_safe
from app.services.customer_service import segment_customers
from app.services.data_service import DataContext
from app.services.inventory_service import inventory_analysis
from app.services.product_service import forecast_products
from app.services.revenue_service import (
    _order_count,
    resolve_period,
    revenue_analysis,
    revenue_forecast,
)

DASHBOARD_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_TTL_SECONDS = 240


def clear_dashboard_cache() -> None:
    DASHBOARD_CACHE.clear()


def dashboard_overview(
    ctx: DataContext,
    start_date: date | str | None = None,
    end_date: date | str | None = None,
) -> dict:
    ctx.require("overview", "The overview dashboard")
    start, end = resolve_period(ctx, start_date, end_date)
    key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{start.date()}:{end.date()}"
    cached = DASHBOARD_CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    revenue = revenue_analysis(ctx, start.date(), end.date(), granularity="month")
    forecast = revenue_forecast(ctx, 90)
    product_payload = forecast_products(ctx, limit=10)
    inventory = inventory_analysis(ctx, limit=100)
    try:
        segments = segment_customers(ctx, limit=10)
    except Exception:
        segments = {"available": False, "segment_distribution": [], "clusters": [], "reason": 'Không thể phân khúc khách hàng.'}

    frame = ctx.frame.dropna(subset=["_order_date", "_revenue"])
    filtered = frame[(frame["_order_date"] >= start) & (frame["_order_date"] <= end)]
    top_sellers = (
        filtered.groupby("_product")
        .agg(units=("_quantity", "sum"), revenue=("_revenue", "sum"))
        .reset_index()
        .sort_values("units", ascending=False)
        .head(10)
    )
    top_seller_chart = [
        {
            "product": row["_product"],
            "units": round(float(row["units"]), 1) if pd.notna(row["units"]) else 0,
            "revenue": round(float(row["revenue"]), 2),
        }
        for _, row in top_sellers.iterrows()
    ]

    forecast_series = []
    actual_points = [point for point in forecast["series"] if point["actual"] is not None][-30:]
    forecast_points = [point for point in forecast["series"] if point["forecast"] is not None][:30]
    forecast_series = actual_points + forecast_points

    inventory_status = inventory.get("chart_data", {}).get("status_distribution", []) if inventory.get("available") else []
    bestseller_definition = revenue["kpis"].get("bestseller_definition")
    product_forecast_map = {row["product"]: row for row in product_payload.get("products", [])}
    fastest = None
    rising = [
        row
        for row in product_payload.get("products", [])
        if row.get("forecast_30_growth_pct") is not None
        and row["forecast_30_growth_pct"] > 0
        and (row.get("recent_30_units") or 0) >= 1
    ]
    if rising:
        fastest = max(rising, key=lambda row: row["forecast_30_growth_pct"])

    inventory_priority = None
    if inventory.get("available"):
        risky = [
            item
            for item in inventory["items"]
            if item["status"] in {"Critical Stock", "Low Stock", "Dead Stock"}
        ]
        if risky:
            inventory_priority = max(
                risky,
                key=lambda item: (item.get("inventory_value") or 0) + (item.get("recent_30_revenue") or 0),
            )

    insights = list(revenue.get("insights", []))[:3]
    if fastest:
        insights.append(
            {
                "type": "positive",
                "title": f"{fastest['product']} có mức tăng trưởng dự báo cao nhất",
                "detail": (
                    f"Nhu cầu dự báo 30 ngày là {fastest['forecast_30d']:,.0f} đơn vị, thay đổi {fastest['forecast_30_growth_pct']:+.1f}% so với 30 ngày gần nhất. Chất lượng kiểm định mô hình: {vi_label(fastest['validation_quality'])}."
                ),
                "evidence": f"Mô hình dự báo: {fastest['model']}; tiềm năng: {vi_label(fastest['potential'])}.",
                "action": 'Kiểm tra khả năng đáp ứng của tồn kho và năng lực khuyến mại trước khi nhu cầu tăng nhanh.',
            }
        )
    if inventory_priority:
        insights.append(
            {
                "type": "warning",
                "title": f"Cần xử lý tồn kho cho {inventory_priority['product']}",
                "detail": (
                    f"Trạng thái: {vi_label(inventory_priority['status'])}. Tồn kho có {inventory_priority['current_stock']} đơn vị, đủ đáp ứng nhu cầu dự báo trong {(inventory_priority['coverage_days'] if inventory_priority['coverage_days'] is not None else 'unavailable')} ngày."
                ),
                "evidence": f"Dự báo 30 ngày: {inventory_priority['forecast_30d']} đơn vị; điểm đặt hàng lại: {inventory_priority['reorder_point']}.",
                "action": 'Xem xét khuyến nghị tồn kho và phê duyệt hành động vận hành bên ngoài hệ thống.',
            }
        )
    if segments.get("available") and segments.get("clusters"):
        top_segment = max(segments["clusters"], key=lambda row: row["avg_monetary"])
        insights.append(
            {
                "type": "opportunity",
                "title": f"{vi_label(top_segment['segment'])} có giá trị khách hàng trung bình cao nhất",
                "detail": (
                    f"Có {top_segment['count']} khách hàng với chi tiêu trung bình {top_segment['avg_monetary']:,.0f}; thời gian từ lần mua gần nhất trung bình là {top_segment['avg_recency_days']:.1f} ngày."
                ),
                "evidence": f"Điểm silhouette của K-Means: {segments.get('metrics', {}).get('silhouette_score')}",
                "action": 'Ưu tiên giữ chân và cá nhân hóa danh mục sản phẩm cho phân khúc này.',
            }
        )
    insights = insights[:5]

    kpis = revenue["kpis"]
    payload = {
        "period": revenue["period"],
        "kpis": {
            "total_revenue": kpis["total_revenue"],
            "total_orders": kpis["total_orders"],
            "units_sold": kpis["units_sold"],
            "total_customers": kpis["customers"],
            "average_order_value": kpis["average_order_value"],
            "inventory_value": inventory.get("summary", {}).get("total_inventory_value")
            if inventory.get("available")
            else kpis.get("inventory_value"),
            "revenue_growth_pct": kpis["growth_pct"],
            "growth_basis": kpis["growth_basis"],
            "bestseller_rate_pct": kpis["bestseller_rate_pct"],
            "bestseller_definition": bestseller_definition,
            "gross_margin_pct": kpis.get("gross_margin_pct"),
            "profit_available": kpis.get("profit_available"),
            "period_growth_pct": kpis.get("period_growth_pct"),
            "revenue_derived": kpis.get("revenue_derived"),
        },
        "charts": {
            "revenue_trend": revenue["trend"],
            "monthly_comparison": revenue["monthly_comparison"],
            "top_products": top_seller_chart,
            "category_revenue": revenue["categories"][:8],
            "inventory_status": inventory_status,
            "customer_segments": segments.get("segment_distribution", []) if segments.get("available") else [],
            "actual_vs_forecast": forecast_series,
        },
        "forecast": {
            "summary": forecast["summary"],
            "actual_vs_forecast": forecast_series,
            "validation": forecast["validation"],
        },
        "inventory": {
            "available": inventory.get("available"),
            "summary": inventory.get("summary"),
            "top_risks": inventory.get("summary", {}).get("high_priority_products", [])
            if inventory.get("available")
            else [],
            "reason": inventory.get("reason"),
        },
        "customers": {
            "available": segments.get("available"),
            "metrics": segments.get("metrics"),
            "clusters": segments.get("clusters", []) if segments.get("available") else [],
            "reason": segments.get("reason"),
        },
        "products": {
            "summary": product_payload.get("summary"),
            "top_future_best_sellers": product_payload.get("chart_data", {}).get(
                "top_future_best_sellers", []
            ),
            "fastest_growing": {
                "product": fastest["product"],
                "growth_pct": fastest["forecast_30_growth_pct"],
                "forecast_30d": fastest["forecast_30d"],
            }
            if fastest
            else None,
        },
        "insights": insights,
        "priority_actions": _priority_actions(kpis, inventory_priority, fastest, segments),
        "data_context": {
            "data_through": ctx.date_max,
            "revenue_derived": ctx.revenue_derived,
            "inventory_point_in_time": 'Tồn kho hiện tại là số liệu tại ngày kết thúc bộ dữ liệu và không thay đổi theo bộ lọc thời gian.',
            "notes": [
                'Tất cả chỉ số kinh doanh, trừ giá trị tồn kho, được tính theo kỳ đã chọn.',
                'Giá trị dự báo được tính từ lịch sử thực tế và kiểm định độc lập theo thời gian, không dùng số liệu gán sẵn.',
            ],
        },
    }
    result = json_safe(payload)
    DASHBOARD_CACHE[key] = (time.time(), result)
    return result


def _priority_actions(
    kpis: dict,
    inventory_priority: dict | None,
    fastest: dict | None,
    segments: dict,
) -> list[dict]:
    actions = []
    if inventory_priority:
        actions.append(
            {
                "priority": "high",
                "area": "Inventory",
                "action": f"Kiểm tra tình trạng {vi_label(inventory_priority['status'])} của {inventory_priority['product']}.",
                "reason": 'Mã sản phẩm này có tổng mức ảnh hưởng về tồn kho và doanh thu gần đây cao nhất trong các vấn đề tồn kho cần ưu tiên.',
            }
        )
    growth = kpis.get("growth_pct")
    if growth is not None and growth < 0:
        actions.append(
            {
                "priority": "high" if growth < -10 else "medium",
                "area": "Revenue",
                "action": 'Phân tích nguyên nhân doanh thu giảm gần đây theo danh mục, sản phẩm và phân khúc khách hàng.',
                "reason": f'Doanh thu kỳ gần nhất thay đổi {growth:+.1f}%.',
            }
        )
    elif fastest:
        actions.append(
            {
                "priority": "medium",
                "area": "Product",
                "action": f"Kiểm tra khả năng đáp ứng của tồn kho cho {fastest['product']} trước chu kỳ nhu cầu tiếp theo.",
                "reason": f"Tăng trưởng nhu cầu dự báo trong 30 ngày tới là {fastest['forecast_30_growth_pct']:+.1f}%.",
            }
        )
    if segments.get("available"):
        clusters = segments.get("clusters", [])
        at_risk = next((row for row in clusters if row["segment"] == "At-risk Customers"), None)
        if at_risk:
            actions.append(
                {
                    "priority": "medium",
                    "area": "Customer",
                    "action": 'Rà soát và lập kế hoạch giữ chân nhóm khách hàng có nguy cơ rời bỏ.',
                    "reason": f"K-Means xếp {at_risk['count']} khách hàng vào phân khúc có nguy cơ rời bỏ.",
                }
            )
    if not actions:
        actions.append(
            {
                "priority": "low",
                "area": "Data",
                "action": 'Tiếp tục theo dõi và kiểm tra lần cập nhật dữ liệu tiếp theo.',
                "reason": 'Chưa phát hiện tín hiệu định lượng cần ưu tiên cao từ các trường dữ liệu hiện có.',
            }
        )
    return actions[:4]
