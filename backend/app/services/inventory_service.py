from __future__ import annotations

import math
import time
from datetime import timedelta
from statistics import NormalDist
from typing import Any

import numpy as np
import pandas as pd

from app.core.errors import ApiError
from app.core.utils import json_safe
from app.services.data_service import DataContext, get_context
from app.services.mapping import missing_data_guidance
from app.services.product_service import forecast_products

INVENTORY_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_TTL_SECONDS = 300
STATUS_ORDER = {
    "Critical Stock": 0,
    "Low Stock": 1,
    "Dead Stock": 2,
    "Overstock": 3,
    "Review Required": 4,
    "Optimal Stock": 5,
}


def clear_inventory_cache() -> None:
    INVENTORY_CACHE.clear()


def _abc_class(cumulative_share: float) -> str:
    if cumulative_share <= 0.70:
        return "A"
    if cumulative_share <= 0.90:
        return "B"
    return "C"


def inventory_analysis(
    ctx: DataContext,
    lead_time_days: int = 7,
    service_level: float = 0.95,
    ordering_cost: float = 500.0,
    holding_rate: float = 0.20,
    limit: int = 150,
) -> dict:
    if not ctx.capabilities.get("inventory"):
        return {
            "available": False,
            "reason": 'Phân tích tồn kho cần cột số lượng tồn kho hiện tại và mã sản phẩm.',
            "missing_fields": ["stock_quantity"],
            "guidance": missing_data_guidance(ctx.mapping),
            "assumptions": None,
            "summary": None,
            "items": [],
            "recommendations": [],
        }
    if not ctx.capabilities.get("products"):
        return {
            "available": False,
            "reason": 'Dự báo tồn kho còn cần ngày đặt hàng và số lượng đã bán.',
            "missing_fields": ["order_date", "quantity"],
            "guidance": missing_data_guidance(ctx.mapping),
            "assumptions": None,
            "summary": None,
            "items": [],
            "recommendations": [],
        }

    key = (
        f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{lead_time_days}:{service_level}:"
        f"{ordering_cost}:{holding_rate}:{limit}:{ctx.date_max}"
    )
    cached = INVENTORY_CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    product_payload = forecast_products(ctx, limit=limit)
    products = product_payload["products"]
    frame = ctx.frame.dropna(subset=["_order_date", "_product", "_quantity"]).copy()
    max_date = frame["_order_date"].max().normalize()
    recent_window = frame[frame["_order_date"] >= max_date - pd.Timedelta(days=89)]

    revenue_by_product = frame.groupby("_product")["_revenue"].sum().fillna(0).sort_values(ascending=False)
    total_revenue = float(revenue_by_product.sum()) or 1.0
    cumulative = revenue_by_product.cumsum() / total_revenue
    abc_map = {product: _abc_class(float(share)) for product, share in cumulative.items()}

    cost_map = (
        frame.dropna(subset=["_unit_cost"]).groupby("_product")["_unit_cost"].median().to_dict()
        if "_unit_cost" in frame.columns
        else {}
    )
    z_value = NormalDist().inv_cdf(service_level)
    items: list[dict[str, Any]] = []
    recommendation_items: list[dict[str, Any]] = []

    for product in products:
        stock = product.get("current_stock")
        if stock is None:
            continue
        stock = int(stock)
        avg_unit_cost = cost_map.get(product["product"])
        recent_product = recent_window[recent_window["_product"] == product["product"]]
        daily_demand = recent_product.groupby(recent_product["_order_date"].dt.normalize())["_quantity"].sum()
        if not daily_demand.empty:
            daily_demand = daily_demand.reindex(
                pd.date_range(daily_demand.index.min(), daily_demand.index.max(), freq="D"),
                fill_value=0.0,
            )
        demand_std = float(daily_demand.std(ddof=0)) if len(daily_demand) > 1 else 0.0
        forecast_30 = product.get("forecast_30d")
        forecast_60 = product.get("forecast_60d")
        forecast_90 = product.get("forecast_90d")
        status = "Optimal Stock"
        coverage_days: float | None = None
        average_daily_forecast: float | None = None
        days_since = product.get("days_since_last_sale")
        if forecast_30 is not None and forecast_30 >= 0:
            average_daily_forecast = float(forecast_30) / 30.0
            if average_daily_forecast > 0:
                coverage_days = stock / average_daily_forecast
        if days_since is not None and days_since > 90:
            status = "Dead Stock" if stock > 0 else "Review Required"
        elif forecast_30 is None:
            status = "Review Required" if stock > 0 else "Critical Stock"
        elif stock <= 0 or (coverage_days is not None and coverage_days <= lead_time_days):
            status = "Critical Stock"
        elif coverage_days is not None and coverage_days <= max(21, lead_time_days * 2):
            status = "Low Stock"
        elif coverage_days is not None and coverage_days > 90:
            status = "Overstock"
        elif coverage_days is None and stock > 0:
            status = "Review Required"

        safety_stock = z_value * demand_std * math.sqrt(lead_time_days)
        daily_avg_actual = float(daily_demand.mean()) if not daily_demand.empty else 0.0
        reorder_point = daily_avg_actual * lead_time_days + safety_stock
        annual_demand = float(forecast_30) * (365 / 30) if forecast_30 is not None else None
        holding_cost = float(avg_unit_cost) * holding_rate if avg_unit_cost is not None else None
        eoq = None
        eoq_note = None
        if annual_demand and holding_cost and holding_cost > 0 and ordering_cost > 0:
            eoq = math.sqrt((2 * annual_demand * ordering_cost) / holding_cost)
        else:
            eoq_note = 'Tính lượng đặt hàng kinh tế (EOQ) cần chi phí đơn vị và nhu cầu lớn hơn không.'

        suggested_order = 0
        if status in {"Critical Stock", "Low Stock"}:
            shortage_to_rop = max(0.0, reorder_point - stock)
            suggested_order = int(math.ceil(max(eoq or 0.0, shortage_to_rop)))
            if suggested_order == 0 and forecast_30:
                suggested_order = int(math.ceil(max(1.0, float(forecast_30) * lead_time_days / 30)))
        excess_units = max(0.0, stock - (float(forecast_60) if forecast_60 is not None else 0.0))
        projected_stock = {
            "day_30": round(stock - float(forecast_30), 1) if forecast_30 is not None else None,
            "day_60": round(stock - float(forecast_60), 1) if forecast_60 is not None else None,
            "day_90": round(stock - float(forecast_90), 1) if forecast_90 is not None else None,
        }
        stockout_date = None
        if coverage_days is not None and math.isfinite(coverage_days) and coverage_days < 3650:
            stockout_date = (max_date + pd.Timedelta(days=float(coverage_days))).date().isoformat()

        value_basis = "unit_cost" if avg_unit_cost is not None else "unit_price"
        unit_value = avg_unit_cost if avg_unit_cost is not None else None
        if unit_value is None and product.get("revenue") and product.get("units_sold"):
            unit_value = float(product["revenue"]) / max(1, int(product["units_sold"]))
        inventory_value = round(stock * float(unit_value), 2) if unit_value is not None else None

        item = {
            "product": product["product"],
            "product_id": product.get("product_id"),
            "category": product.get("category"),
            "abc_class": abc_map.get(product["product"], "C"),
            "current_stock": stock,
            "recent_30_units": product.get("recent_30_units"),
            "forecast_30d": round(float(forecast_30), 1) if forecast_30 is not None else None,
            "forecast_60d": round(float(forecast_60), 1) if forecast_60 is not None else None,
            "forecast_90d": round(float(forecast_90), 1) if forecast_90 is not None else None,
            "average_daily_forecast": round(average_daily_forecast, 2) if average_daily_forecast is not None else None,
            "coverage_days": round(coverage_days, 1) if coverage_days is not None and math.isfinite(coverage_days) else None,
            "stockout_date": stockout_date,
            "status": status,
            "days_since_last_sale": days_since,
            "reorder_point": round(reorder_point, 1),
            "safety_stock": round(safety_stock, 1),
            "eoq": round(eoq, 1) if eoq is not None else None,
            "eoq_note": eoq_note,
            "suggested_order_qty": suggested_order,
            "excess_units_vs_60d": round(excess_units, 1),
            "projected_stock": projected_stock,
            "inventory_value": inventory_value,
            "unit_value": round(float(unit_value), 2) if unit_value is not None else None,
            "value_basis": value_basis,
            "recent_30_revenue": product.get("recent_30_revenue"),
        }
        items.append(item)
        recommendation = _build_recommendation(item, lead_time_days)
        if recommendation:
            recommendation_items.append(recommendation)

    items.sort(key=lambda item: (STATUS_ORDER.get(item["status"], 9), -(item["forecast_30d"] or 0)))
    recommendations = sorted(
        recommendation_items,
        key=lambda row: ({"urgent": 0, "high": 1, "medium": 2, "low": 3}.get(row["priority"], 4), -row["impact_rank"]),
    )
    status_counts = {status: 0 for status in STATUS_ORDER}
    for item in items:
        status_counts[item["status"]] = status_counts.get(item["status"], 0) + 1
    inventory_value = sum(item["inventory_value"] or 0 for item in items)
    critical_revenue = sum(
        (item["recent_30_revenue"] or 0) for item in items if item["status"] in {"Critical Stock", "Low Stock"}
    )
    dead_value = sum((item["inventory_value"] or 0) for item in items if item["status"] == "Dead Stock")
    high_priority = [
        item for item in items if item["status"] in {"Critical Stock", "Low Stock", "Dead Stock"}
    ]
    coverage_values = [item["coverage_days"] for item in items if item["coverage_days"] is not None]
    summary = {
        "products_analyzed": len(items),
        "total_inventory_value": round(inventory_value, 2),
        "status_counts": status_counts,
        "critical_low_count": int(status_counts.get("Critical Stock", 0) + status_counts.get("Low Stock", 0)),
        "dead_stock_count": int(status_counts.get("Dead Stock", 0)),
        "overstock_count": int(status_counts.get("Overstock", 0)),
        "optimal_count": int(status_counts.get("Optimal Stock", 0)),
        "review_required_count": int(status_counts.get("Review Required", 0)),
        "critical_low_recent_revenue": round(critical_revenue, 2),
        "dead_stock_value": round(dead_value, 2),
        "average_coverage_days": round(float(np.mean(coverage_values)), 1) if coverage_values else None,
        "health_score": round(
            max(0.0, 100 - (critical_revenue / max(total_revenue, 1)) * 40 - (dead_value / max(inventory_value, 1)) * 30),
            1,
        ),
        "high_priority_products": [
            {
                "product": item["product"],
                "status": item["status"],
                "coverage_days": item["coverage_days"],
                "stock": item["current_stock"],
            }
            for item in high_priority[:8]
        ],
    }
    assumptions = {
        "lead_time_days": lead_time_days,
        "service_level": service_level,
        "z_value": round(z_value, 3),
        "ordering_cost_per_order": ordering_cost,
        "annual_holding_rate_on_unit_cost": holding_rate,
        "safety_stock_formula": 'z × độ lệch chuẩn nhu cầu hàng ngày trong 90 ngày qua × căn bậc hai thời gian chờ',
        "reorder_point_formula": 'nhu cầu trung bình ngày × thời gian chờ + tồn kho an toàn',
        "eoq_formula": 'căn bậc hai của (2 × nhu cầu năm dự báo × chi phí đặt hàng / chi phí lưu kho năm trên mỗi đơn vị)',
        "coverage_formula": 'tồn kho hiện tại / nhu cầu dự báo trung bình ngày',
        "notes": [
            'Trường tồn kho được xem là số liệu hiện tại lặp lại trên các giao dịch.',
            'EOQ và điểm đặt hàng lại hỗ trợ lập kế hoạch theo các giả định được công bố, không phải cam kết kết quả.',
            'Chưa ước tính khoản tiết kiệm vì bộ dữ liệu thiếu chi phí lưu kho, thiếu hàng và giảm giá.',
        ],
    }
    payload = {
        "available": True,
        "reason": None,
        "missing_fields": [],
        "guidance": [],
        "assumptions": assumptions,
        "summary": summary,
        "items": json_safe(items),
        "recommendations": json_safe(recommendations),
        "chart_data": {
            "status_distribution": [
                {"status": key, "count": value} for key, value in status_counts.items() if value > 0
            ],
            "abc_distribution": [
                {"class": abc_class, "count": sum(1 for item in items if item["abc_class"] == abc_class)}
                for abc_class in ["A", "B", "C"]
            ],
            "coverage_vs_stock": [
                {
                    "product": item["product"],
                    "stock": item["current_stock"],
                    "forecast_30d": item["forecast_30d"],
                    "status": item["status"],
                }
                for item in items[:20]
            ],
        },
        "data_context": {
            "data_through": ctx.date_max,
            "stock_value_basis": (
                "Unit cost" if any(item["value_basis"] == "unit_cost" for item in items) else "Average selling price"
            ),
            "forecast_model_notes": 'Dự báo nhu cầu sử dụng bộ máy dự báo của chức năng phân tích sản phẩm.',
        },
    }
    INVENTORY_CACHE[key] = (time.time(), payload)
    return payload


def _build_recommendation(item: dict, lead_time_days: int) -> dict | None:
    status = item["status"]
    if status == "Optimal Stock":
        return None
    base = {
        "product": item["product"],
        "status": status,
        "current_stock": item["current_stock"],
        "forecast_30d": item["forecast_30d"],
        "coverage_days": item["coverage_days"],
        "priority": "medium",
        "impact_rank": 0,
    }
    if status == "Critical Stock":
        base.update(
            {
                "issue": f"{item['product']} có tồn kho ở mức nguy cấp và có thể hết hàng trong thời gian chờ bổ sung.",
                "cause": (
                    f"Tồn kho hiện tại có {item['current_stock']} đơn vị so với nhu cầu dự báo {item['forecast_30d'] or 0:.0f} đơn vị trong 30 ngày. Ước tính đáp ứng được {item['coverage_days']} ngày, với thời gian chờ bổ sung {lead_time_days} ngày."
                ),
                "evidence": [
                    f"Tồn kho hiện tại: {item['current_stock']} đơn vị",
                    f"Nhu cầu dự báo 30 ngày: {item['forecast_30d'] or 0:.1f} đơn vị",
                    f"Điểm đặt hàng lại: {item['reorder_point']:.1f} đơn vị",
                    f"Số lượng đề xuất đặt hàng: {item['suggested_order_qty']} đơn vị",
                ],
                "actions": [
                    f"Đặt bổ sung khoảng {item['suggested_order_qty']} đơn vị sau khi xác nhận thời gian giao hàng của nhà cung cấp.",
                    'Ưu tiên phân bổ hàng có sẵn cho mã sản phẩm này và theo dõi hàng ngày.',
                    'Thông báo cho bộ phận bán hàng và vận hành về nguy cơ thiếu hàng tạm thời.',
                ],
                "priority": "urgent",
                "expected_impact": (
                    'Giảm nguy cơ hết hàng trong thời gian chờ nhập. Chưa định lượng tác động tài chính vì bộ dữ liệu thiếu chi phí mất doanh số và giao hàng khẩn cấp.'
                ),
                "impact_rank": int((item["forecast_30d"] or 0) + item["recent_30_revenue"] or 0),
            }
        )
    elif status == "Low Stock":
        base.update(
            {
                "issue": f"Tồn kho của {item['product']} chỉ đáp ứng được thời gian ngắn so với nhu cầu dự báo.",
                "cause": (
                    f"Tồn kho đáp ứng được {item['coverage_days']} ngày và đang bằng hoặc thấp hơn điểm đặt hàng lại là {item['reorder_point']:.1f} đơn vị."
                ),
                "evidence": [
                    f"Tồn kho hiện tại: {item['current_stock']} đơn vị",
                    f"Lượng đặt hàng kinh tế (EOQ): {(item['eoq'] if item['eoq'] is not None else 'not available')}",
                    f"Số lượng đề xuất đặt hàng: {item['suggested_order_qty']} đơn vị",
                ],
                "actions": [
                    f"Lên lịch đặt bổ sung khoảng {item['suggested_order_qty']} đơn vị.",
                    'Tăng tần suất theo dõi cho đến khi số ngày đáp ứng của tồn kho vượt thời gian chờ bổ sung.',
                    'Đối chiếu dự báo nhu cầu với các chương trình khuyến mại hoặc đơn hàng mới đã biết.',
                ],
                "priority": "high",
                "expected_impact": 'Giúp duy trì phục vụ liên tục trong chu kỳ bổ sung tiếp theo; chưa ước tính khoản tiết kiệm.',
                "impact_rank": int((item["forecast_30d"] or 0) + item["recent_30_revenue"] or 0),
            }
        )
    elif status == "Dead Stock":
        base.update(
            {
                "issue": f"{item['product']} còn tồn kho nhưng không có hoạt động bán hàng gần đây.",
                "cause": (
                    f"Lần bán gần nhất cách ngày kết thúc bộ dữ liệu {item['days_since_last_sale']} ngày và nhu cầu dự báo 30 ngày là {item['forecast_30d'] or 0:.1f} đơn vị."
                ),
                "evidence": [
                    f"Tồn kho hiện tại: {item['current_stock']} đơn vị",
                    f"Số ngày từ lần bán gần nhất: {item['days_since_last_sale']}",
                    f"Giá trị tồn kho theo cơ sở giá vốn hoặc giá bán hiện có: {item['inventory_value']}",
                ],
                "actions": [
                    'Tạm dừng đơn mua mới cho mã sản phẩm này.',
                    'Bán theo gói hoặc thanh lý với mức giảm giá được kiểm soát sau khi kiểm tra giới hạn biên lợi nhuận.',
                    'Rà soát danh mục, giá bán và vị trí trưng bày trước khi đặt hàng lại.',
                ],
                "priority": "high" if (item["inventory_value"] or 0) > 0 else "medium",
                "expected_impact": (
                    'Hạn chế tích lũy thêm hàng bán chậm. Khả năng thu hồi phụ thuộc vào chính sách giảm giá và phản ứng nhu cầu mà bộ dữ liệu chưa cung cấp.'
                ),
                "impact_rank": int(item["inventory_value"] or 0),
            }
        )
    elif status == "Overstock":
        base.update(
            {
                "issue": f"{item['product']} có tồn kho vượt mức nhu cầu dự báo.",
                "cause": (
                    f"Tồn kho đáp ứng được {item['coverage_days']} ngày so với nhu cầu dự báo 30 ngày là {item['forecast_30d'] or 0:.1f} đơn vị. Lượng dư so với nhu cầu 60 ngày khoảng {item['excess_units_vs_60d']:.0f} đơn vị."
                ),
                "evidence": [
                    f"Tồn kho hiện tại: {item['current_stock']} đơn vị",
                    f"Tồn kho dự kiến sau 90 ngày: {item['projected_stock']['day_90']}",
                    f"Giá trị tồn kho: {item['inventory_value']}",
                ],
                "actions": [
                    'Tạm dừng hoặc giảm số lượng trong đơn bổ sung tiếp theo.',
                    'Tạo gói bán kèm các sản phẩm bổ trợ có tốc độ bán nhanh hơn.',
                    'Chỉ thử nghiệm giảm giá 10–15% có kiểm soát khi biên lợi nhuận gộp cho phép.',
                    'Phân bổ lại hàng cho các kênh hoặc khu vực có nhu cầu cao hơn.',
                ],
                "priority": "medium",
                "expected_impact": (
                    'Giảm áp lực lưu kho và giải phóng vốn lưu động; tác động thực tế cần dữ liệu giảm giá và chi phí lưu kho hiện chưa có.'
                ),
                "impact_rank": int(item["inventory_value"] or 0),
            }
        )
    else:
        base.update(
            {
                "issue": f"Cần kiểm tra thủ công {item['product']} vì lịch sử tồn kho hoặc nhu cầu chưa đầy đủ.",
                "cause": 'Chưa thể tự động xác định trạng thái một cách đáng tin cậy từ các trường và lịch sử hiện có.',
                "evidence": [
                    f"Tồn kho hiện tại: {item['current_stock']} đơn vị",
                    f"Khả năng dự báo: {('yes' if item['forecast_30d'] is not None else 'no')}",
                ],
                "actions": ['Kiểm tra hồ sơ tồn kho và giao dịch gần đây trước khi quyết định mua hàng.'],
                "priority": "low",
                "expected_impact": 'Cải thiện độ tin cậy dữ liệu cho các quyết định bổ sung hàng tiếp theo.',
                "impact_rank": 0,
            }
        )
    return base


def inventory_recommendations(
    ctx: DataContext,
    lead_time_days: int = 7,
    service_level: float = 0.95,
    ordering_cost: float = 500.0,
    holding_rate: float = 0.20,
    limit: int = 150,
    priority: str | None = None,
    product: str | None = None,
) -> dict:
    analysis = inventory_analysis(ctx, lead_time_days, service_level, ordering_cost, holding_rate, limit)
    recommendations = analysis.get("recommendations", [])
    if priority:
        recommendations = [row for row in recommendations if row["priority"] == priority]
    if product:
        recommendations = [row for row in recommendations if row["product"].lower() == product.lower()]
    return {
        "available": analysis["available"],
        "assumptions": analysis.get("assumptions"),
        "summary": analysis.get("summary"),
        "recommendations": recommendations,
    }
