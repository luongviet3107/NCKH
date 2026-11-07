from __future__ import annotations

from app.core.localization import label as vi_label

import time
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from app.core.errors import ApiError
from app.core.utils import json_safe, pct_change, safe_div
from app.forecasting.engine import FAST_MODELS, auto_forecast, daily_aggregate
from app.services.data_service import DataContext
from app.services.mapping import mapped_column

REVENUE_CACHE: dict[str, tuple[float, dict]] = {}
FORECAST_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_TTL_SECONDS = 300
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def clear_revenue_cache() -> None:
    REVENUE_CACHE.clear()
    FORECAST_CACHE.clear()


def _parse_timestamp(value: date | str | None) -> pd.Timestamp | None:
    if value is None:
        return None
    return pd.Timestamp(value).normalize()


def resolve_period(
    ctx: DataContext,
    start_date: date | str | None = None,
    end_date: date | str | None = None,
    default_days: int = 365,
) -> tuple[pd.Timestamp, pd.Timestamp]:
    if ctx.date_min is None or ctx.date_max is None:
        raise ApiError('Bộ dữ liệu không có ngày đặt hàng hợp lệ.', 422, "capability_unavailable")
    data_start = pd.Timestamp(ctx.date_min)
    data_end = pd.Timestamp(ctx.date_max)
    end = _parse_timestamp(end_date) or data_end
    start = _parse_timestamp(start_date) or max(data_start, end - pd.Timedelta(days=default_days))
    if start > end:
        raise ApiError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.', 422, "invalid_date_range")
    if end < data_start or start > data_end:
        raise ApiError('Kỳ đã chọn nằm ngoài khoảng thời gian của bộ dữ liệu.', 422, "empty_analysis")
    return max(start, data_start), min(end, data_end)


def _order_count(part: pd.DataFrame, context_has_orders: bool) -> int:
    if context_has_orders:
        ids = part["_order_id"].dropna()
        if not ids.empty:
            return int(ids.nunique())
    return int(len(part))


def _group_label_series(dates: pd.Series, granularity: str) -> pd.Series:
    normalized = dates.dt.normalize()
    if granularity == "day":
        return normalized
    if granularity == "week":
        return normalized.dt.to_period("W").dt.start_time
    return normalized.dt.to_period("M").dt.start_time


def _auto_granularity(start: pd.Timestamp, end: pd.Timestamp) -> str:
    days = (end - start).days
    if days <= 60:
        return "day"
    if days <= 240:
        return "week"
    return "month"


def _stock_value(ctx: DataContext) -> tuple[float | None, str | None, bool]:
    if not ctx.capabilities.get("inventory"):
        return None, None, False
    frame = ctx.frame.dropna(subset=["_product", "_stock_quantity"]).copy()
    if frame.empty:
        return None, None, False
    latest = (
        frame.sort_values("_order_date").groupby("_product").tail(1)[["_product", "_stock_quantity"]]
    )
    cost_map = (
        frame.dropna(subset=["_unit_cost"]).groupby("_product")["_unit_cost"].median()
        if "_unit_cost" in frame.columns
        else pd.Series(dtype=float)
    )
    total = 0.0
    basis = "retail_price"
    has_cost = not cost_map.empty and cost_map.notna().any()
    if has_cost:
        basis = "unit_cost"
    for _, row in latest.iterrows():
        if pd.isna(row["_stock_quantity"]):
            continue
        unit_value = cost_map.get(row["_product"])
        if unit_value is None or pd.isna(unit_value):
            product_rows = frame[frame["_product"] == row["_product"]]
            revenue = product_rows["_revenue"].sum()
            units = product_rows["_quantity"].sum()
            if units > 0:
                unit_value = revenue / units
            else:
                continue
        total += float(row["_stock_quantity"]) * float(unit_value)
    return round(total, 2), basis if total else basis, has_cost


def _build_insights(
    total_revenue: float,
    growth: float | None,
    top_category: dict | None,
    top_product: dict | None,
    peak: dict | None,
    monthly: list[dict],
    margin: float | None,
    product_revenue_share: float,
) -> list[dict]:
    insights: list[dict] = []
    if growth is not None:
        direction = "tăng nhanh" if growth > 5 else "chậm lại" if growth < -5 else "tương đối ổn định"
        insights.append(
            {
                "type": "positive" if growth >= 0 else "warning",
                "title": f'Diễn biến doanh thu: {direction}',
                "detail": f'Doanh thu trong 30 ngày gần nhất thay đổi {growth:+.1f}% so với 30 ngày liền trước.',
                "evidence": f'Doanh thu 30 ngày gần nhất thay đổi {growth:+.1f}% so với kỳ liền trước.',
                "action": (
                    'Bảo đảm tồn kho và năng lực tiếp thị cho các danh mục có hiệu quả cao nhất.'
                    if growth > 5
                    else 'Kiểm tra các yếu tố thúc đẩy nhu cầu, giá bán và cơ cấu kênh trước khi tăng tồn kho.'
                ),
            }
        )
    if top_category:
        insights.append(
            {
                "type": "opportunity",
                "title": f"{top_category['category']} dẫn đầu doanh thu theo danh mục",
                "detail": f"{top_category['category']} đóng góp {top_category['share_pct']:.1f}% doanh thu trong kỳ đã chọn.",
                "evidence": f"Doanh thu danh mục: {top_category['revenue']:,.0f}",
                "action": 'Kiểm tra khả năng đáp ứng của tồn kho và hỗ trợ chiến dịch có phù hợp với đóng góp của danh mục này hay không.',
            }
        )
    if top_product:
        insights.append(
            {
                "type": "opportunity",
                "title": f"{top_product['product']} là sản phẩm chủ lực về doanh thu",
                "detail": (
                    f"Sản phẩm này tạo ra {top_product['revenue']:,.0f}, chiếm {product_revenue_share:.1f}% tổng doanh thu trong kỳ đã chọn."
                ),
                "evidence": f"Số đơn vị đã bán: {top_product['units']:,}",
                "action": 'Kiểm tra khả năng đáp ứng của tồn kho và đưa sản phẩm vào gói bán kèm, tránh tập trung khuyến mại quá mức.',
            }
        )
    if peak:
        insights.append(
            {
                "type": "info",
                "title": f"Tháng cao điểm: {peak['label']}",
                "detail": f"Doanh thu đạt {peak['revenue']:,.0f} trong {peak['label']}.",
                "evidence": 'Doanh thu tháng cao nhất trong kỳ đã chọn.',
                "action": 'Dùng giai đoạn này làm cơ sở lập kế hoạch tồn kho và nhân sự theo mùa.',
            }
        )
    declining = [row for row in monthly if row.get("growth_pct") is not None and row["growth_pct"] < -5]
    if declining:
        latest_decline = declining[-1]
        insights.append(
            {
                "type": "warning",
                "title": 'Một tháng gần đây có doanh thu giảm',
                "detail": f"Doanh thu {latest_decline['label']} giảm {latest_decline['growth_pct']:.1f}% so với tháng trước.",
                "evidence": f"Doanh thu: {latest_decline['revenue']:,.0f}",
                "action": 'Kiểm tra tác động của khuyến mại, danh mục và mùa vụ trong tháng trước khi thay đổi kế hoạch cả năm.',
            }
        )
    if margin is not None:
        insights.append(
            {
                "type": "info",
                "title": f'Biên lợi nhuận gộp là {margin:.1f}%',
                "detail": 'Biên lợi nhuận gộp được tính từ doanh thu và dữ liệu chi phí đơn vị hiện có.',
                "evidence": 'Chỉ những giao dịch có trường chi phí đã ánh xạ mới được dùng để tính biên lợi nhuận.',
                "action": 'Xem xét biên lợi nhuận của từng sản phẩm cùng với nhu cầu trước khi ưu tiên khuyến mại.',
            }
        )
    if total_revenue == 0:
        insights.append(
            {
                "type": "warning",
                "title": 'Không có doanh thu trong kỳ đã chọn',
                "detail": 'Bộ lọc tìm được giao dịch nhưng không có doanh thu dương.',
                "evidence": 'Tổng doanh thu sau khi lọc bằng không.',
                "action": 'Điều chỉnh bộ lọc ngày hoặc kiểm tra cột doanh thu.',
            }
        )
    return insights[:6]


def revenue_analysis(
    ctx: DataContext,
    start_date: date | str | None = None,
    end_date: date | str | None = None,
    granularity: str = "month",
) -> dict:
    ctx.require("revenue", "Revenue analytics")
    start, end = resolve_period(ctx, start_date, end_date)
    key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{start.date()}:{end.date()}:{granularity}"
    cached = REVENUE_CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    source = ctx.frame.dropna(subset=["_order_date", "_revenue"]).copy()
    frame = source[(source["_order_date"] >= start) & (source["_order_date"] <= end)]
    if frame.empty:
        raise ApiError('Không có giao dịch trong kỳ đã chọn.', 422, "empty_analysis")
    has_orders = bool(ctx.mapping.get("order_id"))
    total_revenue = float(frame["_revenue"].sum())
    orders = _order_count(frame, has_orders)
    units = float(frame["_quantity"].sum()) if "_quantity" in frame.columns else 0.0
    customers = int(frame["_customer_id"].dropna().nunique()) if "_customer_id" in frame.columns else 0
    average_order_value = safe_div(total_revenue, orders)
    has_profit = "_profit_calc" in frame.columns and frame["_profit_calc"].notna().any()
    profit = float(frame["_profit_calc"].sum()) if has_profit else None
    margin = safe_div(profit, total_revenue) * 100 if has_profit and total_revenue else None

    selected_days = max(1, (end - start).days + 1)
    if selected_days >= 60:
        latest_start = end - pd.Timedelta(days=29)
        previous_start = end - pd.Timedelta(days=59)
        latest_revenue = float(frame[frame["_order_date"] >= latest_start]["_revenue"].sum())
        previous_revenue = float(
            frame[(frame["_order_date"] >= previous_start) & (frame["_order_date"] < latest_start)]["_revenue"].sum()
        )
        growth_basis = 'So sánh 30 ngày gần nhất với 30 ngày liền trước trong kỳ đã chọn'
    else:
        midpoint = start + pd.Timedelta(days=selected_days // 2)
        latest_revenue = float(frame[frame["_order_date"] >= midpoint]["_revenue"].sum())
        previous_revenue = float(frame[frame["_order_date"] < midpoint]["_revenue"].sum())
        growth_basis = 'So sánh nửa sau với nửa đầu kỳ đã chọn (kỳ ngắn hơn 60 ngày)'
    growth = pct_change(latest_revenue, previous_revenue)

    period_prev_start = start - pd.Timedelta(days=selected_days)
    period_prev_end = start - pd.Timedelta(days=1)
    previous_period_frame = source[
        (source["_order_date"] >= period_prev_start) & (source["_order_date"] <= period_prev_end)
    ]
    previous_period_revenue = float(previous_period_frame["_revenue"].sum()) if not previous_period_frame.empty else None
    period_growth = pct_change(total_revenue, previous_period_revenue) if previous_period_revenue not in (None, 0) else None

    trend_granularity = granularity if granularity in {"day", "week", "month"} else "month"
    trend_frame = frame.copy()
    trend_frame["_group"] = _group_label_series(trend_frame["_order_date"], trend_granularity)
    trend_group = trend_frame.groupby("_group").agg(
        revenue=("_revenue", "sum"),
        orders=("_row_number", "size"),
        units=("_quantity", "sum"),
    )
    if has_orders:
        trend_group["orders"] = trend_frame.groupby("_group")["_order_id"].nunique()
    trend_group = trend_group.reset_index().sort_values("_group")
    trend = [
        {
            "date": row["_group"].date().isoformat(),
            "label": row["_group"].strftime("%d/%m") if trend_granularity == "day" else row["_group"].strftime("%m/%Y"),
            "revenue": round(float(row["revenue"]), 2),
            "orders": int(row["orders"]),
            "units": round(float(row["units"]), 1),
        }
        for _, row in trend_group.iterrows()
    ]

    monthly_source = source.copy()
    monthly_source["_month"] = monthly_source["_order_date"].dt.to_period("M").dt.start_time
    monthly_group = monthly_source.groupby("_month")["_revenue"].sum().sort_index()
    monthly_lookup = {period: float(value) for period, value in monthly_group.items()}
    months_in_period = frame["_order_date"].dt.to_period("M").dt.start_time.drop_duplicates().sort_values()
    monthly_rows = []
    for month_start in months_in_period:
        previous_year = month_start - pd.DateOffset(years=1)
        revenue = float(frame[frame["_order_date"].dt.to_period("M").dt.start_time == month_start]["_revenue"].sum())
        prior = monthly_lookup.get(previous_year)
        monthly_rows.append(
            {
                "date": month_start.date().isoformat(),
                "label": month_start.strftime("th?ng %m/%Y"),
                "year": int(month_start.year),
                "month": int(month_start.month),
                "revenue": round(revenue, 2),
                "previous_year_revenue": round(prior, 2) if prior is not None else None,
                "previous_year_label": previous_year.strftime("th?ng %m/%Y"),
            }
        )
    previous_values = {row["date"]: row["revenue"] for row in monthly_rows}
    for index, row in enumerate(monthly_rows):
        if index == 0:
            row["growth_pct"] = None
        else:
            previous_value = monthly_rows[index - 1]["revenue"]
            row["growth_pct"] = round(pct_change(row["revenue"], previous_value), 2) if previous_value else None
    peak = max(monthly_rows, key=lambda row: row["revenue"]) if monthly_rows else None

    category_group = (
        frame.groupby("_category").agg(revenue=("_revenue", "sum"), units=("_quantity", "sum")).reset_index()
    )
    category_group = category_group.sort_values("revenue", ascending=False)
    categories = [
        {
            "category": row["_category"],
            "revenue": round(float(row["revenue"]), 2),
            "units": round(float(row["units"]), 1),
            "share_pct": round(float(row["revenue"]) / total_revenue * 100, 2) if total_revenue else 0,
        }
        for _, row in category_group.iterrows()
    ]

    product_group = (
        frame.groupby("_product").agg(revenue=("_revenue", "sum"), units=("_quantity", "sum")).reset_index()
    )
    product_group = product_group.sort_values("revenue", ascending=False)
    products = [
        {
            "product": row["_product"],
            "revenue": round(float(row["revenue"]), 2),
            "units": round(float(row["units"]), 1),
            "share_pct": round(float(row["revenue"]) / total_revenue * 100, 2) if total_revenue else 0,
        }
        for _, row in product_group.iterrows()
    ]

    customer_group = (
        frame.dropna(subset=["_customer_id"])
        .groupby("_customer_id")
        .agg(revenue=("_revenue", "sum"), orders=("_row_number", "size"))
        .reset_index()
        .sort_values("revenue", ascending=False)
        .head(10)
    )
    customer_rows = [
        {
            "customer_id": row["_customer_id"],
            "revenue": round(float(row["revenue"]), 2),
            "orders": int(row["orders"]),
        }
        for _, row in customer_group.iterrows()
    ]

    stock_value, stock_basis, cost_available = _stock_value(ctx)
    top_category = categories[0] if categories else None
    top_product = products[0] if products else None
    product_share = top_product["share_pct"] if top_product else 0.0
    bestseller_threshold = product_group["revenue"].quantile(0.8) if not product_group.empty else 0
    bestseller_rate = (
        float((product_group["revenue"] >= bestseller_threshold).sum()) / len(product_group) * 100
        if len(product_group)
        else None
    )
    order_basis = 'Các mã đơn hàng duy nhất' if has_orders else 'Số dòng giao dịch (không có cột mã đơn hàng)'
    insights = _build_insights(
        total_revenue, growth, top_category, top_product, peak, monthly_rows, margin, product_share
    )

    payload = {
        "period": {
            "start": start.date().isoformat(),
            "end": end.date().isoformat(),
            "days": selected_days,
            "granularity": trend_granularity,
            "data_start": ctx.date_min,
            "data_end": ctx.date_max,
        },
        "kpis": {
            "total_revenue": round(total_revenue, 2),
            "total_orders": orders,
            "units_sold": round(units, 1),
            "customers": customers,
            "average_order_value": round(average_order_value, 2),
            "growth_pct": round(growth, 2) if growth is not None else None,
            "profit": round(profit, 2) if profit is not None else None,
            "gross_margin_pct": round(margin, 2) if margin is not None else None,
            "inventory_value": stock_value,
            "inventory_value_basis": stock_basis,
            "bestseller_rate_pct": round(bestseller_rate, 2) if bestseller_rate is not None else None,
            "bestseller_definition": 'Tỷ lệ sản phẩm đang hoạt động có doanh thu từ phân vị 80 trở lên trong kỳ đã chọn.',
            "period_growth_pct": round(period_growth, 2) if period_growth is not None else None,
            "growth_basis": growth_basis,
            "order_count_basis": order_basis,
            "revenue_derived": ctx.revenue_derived,
            "profit_available": has_profit,
        },
        "trend": trend,
        "monthly_comparison": monthly_rows,
        "categories": categories,
        "products": products[:20],
        "top_customers": customer_rows,
        "peak_period": {
            "label": peak["label"],
            "revenue": peak["revenue"],
            "date": peak["date"],
        }
        if peak
        else None,
        "declining_months": [
            {"label": row["label"], "growth_pct": row["growth_pct"]}
            for row in monthly_rows
            if row["growth_pct"] is not None and row["growth_pct"] < 0
        ][-6:],
        "insights": insights,
        "data_context": {
            "revenue_derived": ctx.revenue_derived,
            "cost_data_available": cost_available,
            "data_through": ctx.date_max,
            "notes": [
                'Doanh thu lấy từ trường doanh thu đã ánh xạ hoặc được tính minh bạch từ số lượng và giá khi thiếu trường doanh thu.',
                'Số đơn hàng được đếm theo mã đơn duy nhất nếu có; nếu không, hệ thống đếm số dòng giao dịch.',
                'So sánh năm trước sử dụng toàn bộ lịch sử hiện có của tháng tương ứng.',
            ],
        },
    }
    REVENUE_CACHE[key] = (time.time(), payload)
    return payload


def revenue_forecast(ctx: DataContext, horizon_days: int = 90) -> dict:
    ctx.require("revenue", "Revenue forecasting")
    key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{ctx.date_max}:{horizon_days}:revenue"
    cached = FORECAST_CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    frame = ctx.frame
    series = daily_aggregate(frame, value_col="_revenue")
    if series.empty:
        raise ApiError('Không có lịch sử doanh thu để dự báo.', 422, "empty_analysis")
    forecast_horizon = max(90, horizon_days)
    try:
        outcome = auto_forecast(series, horizon_days=forecast_horizon, candidate_models=FAST_MODELS + ["arima"])
    except Exception as exc:
        raise ApiError(f'Không thể dự báo doanh thu: {exc}', 422, "forecast_failed") from exc
    recent_start = series.index.max() - pd.Timedelta(days=29)
    recent_revenue = float(series[series.index >= recent_start].sum())
    growth_30 = pct_change(outcome.total(30), recent_revenue)
    history_tail = series.tail(75)
    series_points = [
        {
            "date": timestamp.date().isoformat(),
            "actual": round(float(value), 2),
            "forecast": None,
            "lower": None,
            "upper": None,
        }
        for timestamp, value in history_tail.items()
    ]
    for timestamp in outcome.forecast.index:
        series_points.append(
            {
                "date": timestamp.date().isoformat(),
                "actual": None,
                "forecast": round(float(outcome.forecast.loc[timestamp]), 2),
                "lower": round(float(outcome.lower.loc[timestamp]), 2),
                "upper": round(float(outcome.upper.loc[timestamp]), 2),
            }
        )
    validation_points = []
    if outcome.validation_actual is not None and outcome.validation_forecast is not None:
        for timestamp in outcome.validation_actual.index:
            validation_points.append(
                {
                    "week_ending": timestamp.date().isoformat(),
                    "actual": round(float(outcome.validation_actual.loc[timestamp]), 2),
                    "predicted": round(float(outcome.validation_forecast.loc[timestamp]), 2),
                }
            )
    weekly_history = []
    if outcome.weekly_actual is not None:
        for timestamp, value in outcome.weekly_actual.tail(26).items():
            weekly_history.append({"date": timestamp.date().isoformat(), "actual": round(float(value), 2)})
    weekly_forecast = []
    if outcome.weekly_forecast is not None:
        for timestamp, value in outcome.weekly_forecast.items():
            weekly_forecast.append({"date": timestamp.date().isoformat(), "forecast": round(float(value), 2)})

    if growth_30 is None:
        trend = "No baseline"
    elif growth_30 > 5:
        trend = "Rising"
    elif growth_30 < -5:
        trend = "Declining"
    else:
        trend = "Stable"
    insights = [
        {
            "type": "positive" if (growth_30 or 0) >= 0 else "warning",
            "title": f'Xu hướng dự báo doanh thu: {vi_label(trend.lower())}',
            "detail": (
                f'Mô hình {outcome.model_label} được chọn dự báo doanh thu {outcome.total(30):,.0f} trong 30 ngày, thay đổi {growth_30:+.1f}% so với 30 ngày thực tế gần nhất.' if growth_30 is not None else
                f'Mô hình {outcome.model_label} được chọn dự báo doanh thu {outcome.total(30):,.0f} trong 30 ngày. Chưa có dữ liệu thực tế của 30 ngày trước để so sánh.'
            ),
            "evidence": f"MAE trên tập kiểm thử độc lập theo thời gian: {outcome.metrics.get('mae')}; MAPE: {outcome.metrics.get('mape')}%.",
        },
        {
            "type": "info",
            "title": 'Lựa chọn mô hình dựa trên bằng chứng',
            "detail": f'Mô hình {outcome.model_label} có MAE kiểm định thấp nhất trong các ứng viên đã đánh giá.',
            "evidence": "; ".join(
                f"{row['label']}: MAE {row['metrics']['mae']}" for row in outcome.candidates if row.get("metrics")
            ),
        },
    ]
    payload = {
        "summary": {
            "horizon_days": forecast_horizon,
            "forecast_7d": round(outcome.total(7), 2),
            "forecast_30d": round(outcome.total(30), 2),
            "forecast_90d": round(outcome.total(90), 2),
            "recent_30d_actual": round(recent_revenue, 2),
            "growth_30_pct": round(growth_30, 2) if growth_30 is not None else None,
            "model": outcome.model,
            "model_label": outcome.model_label,
            "metrics": outcome.metrics,
            "candidates": outcome.candidates,
            "trend": trend,
            "validation_quality": (
                "High" if outcome.metrics.get("mape") is not None and outcome.metrics["mape"] <= 25
                else "Moderate" if outcome.metrics.get("mape") is not None and outcome.metrics["mape"] <= 50
                else "Limited"
            ),
        },
        "series": series_points,
        "weekly_history": weekly_history,
        "weekly_forecast": weekly_forecast,
        "validation": validation_points,
        "insights": insights,
        "notes": outcome.notes,
        "data_context": {"data_through": ctx.date_max, "history_start": ctx.date_min},
    }
    FORECAST_CACHE[key] = (time.time(), payload)
    return payload
