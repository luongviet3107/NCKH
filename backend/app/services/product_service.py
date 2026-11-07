from __future__ import annotations

import math
import time
from datetime import timedelta
from typing import Any

import numpy as np
import pandas as pd

from app.core.errors import ApiError
from app.core.utils import json_safe, safe_div
from app.forecasting.engine import FAST_MODELS, auto_forecast, daily_aggregate
from app.services.data_service import DataContext

PRODUCT_CACHE: dict[str, tuple[float, dict]] = {}
CACHE_TTL_SECONDS = 300


def _cache_key(ctx: DataContext, suffix: str) -> str:
    updated = ctx.dataset.updated_at.isoformat() if ctx.dataset.updated_at else ""
    return f"{ctx.dataset.id}:{updated}:{ctx.date_max}:{suffix}"


def _cache_get(key: str) -> dict | None:
    cached = PRODUCT_CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]
    return None


def _cache_put(key: str, payload: dict) -> dict:
    PRODUCT_CACHE[key] = (time.time(), payload)
    return payload


def clear_product_cache() -> None:
    PRODUCT_CACHE.clear()


def product_history(ctx: DataContext) -> pd.DataFrame:
    ctx.require("products", "Product intelligence")
    frame = ctx.frame.dropna(subset=["_order_date", "_product", "_quantity"]).copy()
    frame = frame[frame["_quantity"] >= 0]
    if frame.empty:
        raise ApiError('Không có dòng dữ liệu bán sản phẩm hợp lệ.', 422, "empty_analysis")
    max_date = frame["_order_date"].max().normalize()
    recent_start = max_date - pd.Timedelta(days=29)
    previous_start = max_date - pd.Timedelta(days=59)

    def aggregate(part: pd.DataFrame, prefix: str) -> pd.DataFrame:
        if part.empty:
            return pd.DataFrame(columns=["_product"])
        order_ids = (
            part.groupby("_product")["_order_id"].nunique(dropna=True)
            if "_order_id" in part.columns and part["_order_id"].notna().any()
            else part.groupby("_product").size().rename("_orders")
        )
        grouped = part.groupby("_product").agg(
            units=("_quantity", "sum"),
            revenue=("_revenue", "sum"),
            last_sale=("_order_date", "max"),
            active_days=("_order_date", lambda values: values.dt.normalize().nunique()),
        )
        if isinstance(order_ids, pd.Series):
            grouped["orders"] = order_ids
        grouped = grouped.rename(
            columns={
                "units": f"{prefix}_units",
                "revenue": f"{prefix}_revenue",
                "last_sale": f"{prefix}_last_sale",
                "active_days": f"{prefix}_active_days",
                "orders": f"{prefix}_orders",
            }
        )
        return grouped

    all_time = aggregate(frame, "total")
    recent = aggregate(frame[frame["_order_date"] >= recent_start], "recent30")
    previous = aggregate(
        frame[(frame["_order_date"] >= previous_start) & (frame["_order_date"] < recent_start)],
        "prev30",
    )
    history = all_time.join(recent, how="left").join(previous, how="left")
    history = history.rename(
        columns={
            "total_units": "units",
            "total_revenue": "revenue",
            "total_orders": "orders",
            "total_last_sale": "last_sale",
            "total_active_days": "active_days",
        }
    )
    history = history.reset_index()

    product_meta = (
        frame.sort_values("_order_date")
        .groupby("_product")
        .agg(product_id=("_product_id", "last"), category=("_category", "last"))
        .reset_index()
    )
    history = history.merge(product_meta, on="_product", how="left")
    history = history.rename(columns={"_product": "product"})
    for column in history.columns:
        if column.startswith(("recent30_", "prev30_")):
            if column.endswith("_units") or column.endswith("_orders") or column.endswith("_active_days"):
                history[column] = history[column].fillna(0).astype(int)
            elif column.endswith("_revenue"):
                history[column] = history[column].fillna(0.0)
    history["units"] = history["units"].fillna(0)
    history["revenue"] = history["revenue"].fillna(0.0)

    if ctx.capabilities.get("inventory"):
        stock = (
            frame.dropna(subset=["_stock_quantity"])
            .sort_values("_order_date")
            .groupby("_product")
            .tail(1)[["_product", "_stock_quantity"]]
            .rename(columns={"_product": "product", "_stock_quantity": "current_stock"})
        )
        history = history.merge(stock, on="product", how="left")
    else:
        history["current_stock"] = np.nan

    history["days_since_last_sale"] = (max_date - history["last_sale"]).dt.days
    history["historical_growth_pct"] = np.where(
        history["prev30_units"] > 0,
        (history["recent30_units"] - history["prev30_units"]) / history["prev30_units"] * 100,
        np.nan,
    )
    history["product"] = history["product"].astype(str)
    history["category"] = history["category"].fillna("Uncategorized").astype(str)
    history.attrs["max_date"] = max_date
    return history


def _potential_band(score: float | None) -> str:
    if score is None:
        return "Unrated"
    if score >= 0.66:
        return "High"
    if score >= 0.4:
        return "Medium"
    return "Low"


def _reliability(mape: float | None) -> str:
    if mape is None:
        return "Limited"
    if mape <= 25:
        return "High"
    if mape <= 50:
        return "Moderate"
    return "Low"


def _trend(growth: float | None) -> str:
    if growth is None:
        return "No baseline"
    if growth > 10:
        return "Rising"
    if growth < -10:
        return "Declining"
    return "Stable"


def forecast_products(ctx: DataContext, limit: int = 100, end_date: pd.Timestamp | None = None) -> dict:
    suffix = f"forecast:{limit}:{end_date.isoformat() if end_date else ctx.date_max}"
    key = _cache_key(ctx, suffix)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    history = product_history(ctx)
    frame = ctx.frame.dropna(subset=["_order_date", "_product", "_quantity"])
    if end_date is not None:
        frame = frame[frame["_order_date"] <= end_date]
        history_max = frame["_order_date"].max() if not frame.empty else ctx.frame["_order_date"].max()
        history = history.copy()
        history["days_since_last_sale"] = (history_max.normalize() - history["last_sale"]).dt.days

    if frame.empty:
        raise ApiError('Không có giao dịch bán sản phẩm trong kỳ đã chọn.', 422, "empty_analysis")

    ranked = history.sort_values(["recent30_revenue", "revenue", "units"], ascending=False)
    selected = ranked.head(limit).copy()
    products: list[dict[str, Any]] = []
    model_counts: dict[str, int] = {}
    for _, row in selected.iterrows():
        product_frame = frame[frame["_product"] == row["product"]]
        series = daily_aggregate(product_frame, value_col="_quantity")
        item: dict[str, Any] = {
            "product": row["product"],
            "product_id": row.get("product_id"),
            "category": row.get("category") or "Uncategorized",
            "units_sold": int(row["units"]),
            "revenue": round(float(row["revenue"]), 2),
            "recent_30_units": int(row["recent30_units"]),
            "previous_30_units": int(row["prev30_units"]),
            "recent_30_revenue": round(float(row["recent30_revenue"]), 2),
            "growth_pct": round(float(row["historical_growth_pct"]), 2)
            if pd.notna(row.get("historical_growth_pct"))
            else None,
            "current_stock": int(row["current_stock"]) if pd.notna(row.get("current_stock")) else None,
            "days_since_last_sale": int(row["days_since_last_sale"]),
            "forecast_7d": None,
            "forecast_30d": None,
            "forecast_60d": None,
            "forecast_90d": None,
            "forecast_30_growth_pct": None,
            "model": None,
            "metrics": None,
            "validation_quality": "Unavailable",
            "potential": "Unrated",
            "potential_score": None,
            "trend": _trend(
                float(row["historical_growth_pct"]) if pd.notna(row.get("historical_growth_pct")) else None
            ),
            "explanation": "",
            "status": "ok",
        }
        try:
            outcome = auto_forecast(series, horizon_days=90, candidate_models=FAST_MODELS)
            f7, f30, f60, f90 = outcome.total(7), outcome.total(30), outcome.total(60), outcome.total(90)
            recent = float(row["recent30_units"])
            forecast_growth = None if recent <= 0 else (f30 - recent) / recent * 100
            item.update(
                {
                    "forecast_7d": round(f7, 1),
                    "forecast_30d": round(f30, 1),
                    "forecast_60d": round(f60, 1),
                    "forecast_90d": round(f90, 1),
                    "forecast_30_growth_pct": round(forecast_growth, 2) if forecast_growth is not None else None,
                    "model": outcome.model_label,
                    "metrics": {
                        **outcome.metrics,
                        "validation_weeks": len(outcome.validation_actual)
                        if outcome.validation_actual is not None
                        else 0,
                    },
                    "validation_quality": _reliability(outcome.metrics.get("mape")),
                    "trend": _trend(forecast_growth),
                }
            )
            model_counts[outcome.model_label] = model_counts.get(outcome.model_label, 0) + 1
            item["explanation"] = (
                f"{row['product']} bán được {int(row['recent30_units']):,} đơn vị trong 30 ngày gần nhất. Mô hình {outcome.model_label} dự báo {f30:,.0f} đơn vị trong 30 ngày tới"
                + (
                    f' ({forecast_growth:+.1f}% so với 30 ngày gần nhất)'
                    if forecast_growth is not None
                    else ' (chưa có dữ liệu cơ sở gần đây đủ tin cậy)'
                )
                + f". MAE trên tập kiểm thử độc lập theo thời gian là {outcome.metrics.get('mae')} đơn vị"
                + (
                    f" và MAPE là {outcome.metrics.get('mape'):.1f}%."
                    if outcome.metrics.get("mape") is not None
                    else "."
                )
            )
        except Exception as exc:
            item.update(
                {
                    "status": "insufficient_history",
                    "validation_quality": "Unavailable",
                    "explanation": f'Không thể dự báo sản phẩm này: {str(exc)[:160]}',
                }
            )
        products.append(item)

    forecastable = [item for item in products if item["forecast_30d"] is not None]
    if forecastable:
        scores = pd.Series([item["forecast_30d"] for item in forecastable])
        forecast_pct = scores.rank(pct=True, method="average").to_numpy()
        revenue_series = pd.Series([item["recent_30_revenue"] for item in forecastable])
        revenue_pct = revenue_series.rank(pct=True, method="average").to_numpy()
        for index, item in enumerate(forecastable):
            growth = item["forecast_30_growth_pct"]
            growth_score = 0.5 if growth is None else float(np.clip((growth + 25) / 100, 0, 1))
            mape = (item["metrics"] or {}).get("mape")
            quality_score = 0.5 if mape is None else float(np.clip(1 - mape / 100, 0, 1))
            score = 0.45 * forecast_pct[index] + 0.25 * growth_score + 0.2 * revenue_pct[index] + 0.1 * quality_score
            item["potential_score"] = round(float(score), 3)
            item["potential"] = _potential_band(score)
            if growth is not None and growth < -10:
                item["potential"] = "Low" if score < 0.7 else "Medium"
        forecastable.sort(key=lambda item: item["forecast_30d"], reverse=True)
        for rank, item in enumerate(forecastable, start=1):
            item["rank"] = rank
    elif products:
        for item in products:
            item["rank"] = None

    products.sort(
        key=lambda item: (
            item["forecast_30d"] is not None,
            item["forecast_30d"] or 0,
            item["recent_30_revenue"],
        ),
        reverse=True,
    )
    top_future = sorted(forecastable, key=lambda item: item["forecast_30d"], reverse=True)[:10]
    growth_candidates = sorted(products, key=lambda item: item["recent_30_revenue"], reverse=True)[:10]
    summary = {
        "total_products": int(len(history)),
        "products_in_list": int(len(products)),
        "forecasted_products": int(len(forecastable)),
        "total_forecast_30d": round(sum(item["forecast_30d"] or 0 for item in forecastable), 1),
        "rising_products": int(sum(1 for item in forecastable if item["trend"] == "Rising")),
        "declining_products": int(sum(1 for item in forecastable if item["trend"] == "Declining")),
        "high_potential_products": int(sum(1 for item in forecastable if item["potential"] == "High")),
        "model_mix": [{"model": key, "count": value} for key, value in model_counts.items()],
        "training_window": {
            "start": ctx.date_min,
            "end": (end_date.date().isoformat() if end_date is not None else ctx.date_max),
        },
    }
    payload = {
        "products": json_safe(products),
        "summary": summary,
        "chart_data": {
            "top_future_best_sellers": [
                {
                    "product": item["product"],
                    "forecast_30d": item["forecast_30d"],
                    "recent_30_units": item["recent_30_units"],
                }
                for item in top_future
            ],
            "growth_comparison": [
                {
                    "product": item["product"],
                    "recent_30_units": item["recent_30_units"],
                    "forecast_30d": item["forecast_30d"],
                    "growth_pct": item["forecast_30_growth_pct"],
                }
                for item in growth_candidates
            ],
        },
        "notes": [
            'Dự báo được tạo từ giao dịch thực tế và kiểm định bằng cách chia dữ liệu theo thời gian.',
            'Tiềm năng là thứ hạng tương đối dựa trên sản lượng dự báo, tăng trưởng dự báo, doanh thu gần đây và chất lượng kiểm định.',
            'Một số ít sản phẩm có thể chưa được xếp hạng khi lịch sử quá ngắn để xây dựng mô hình đáng tin cậy.',
        ],
        "data_context": {
            "revenue_derived": ctx.revenue_derived,
            "data_through": ctx.date_max,
            "total_products": int(len(history)),
        },
    }
    return _cache_put(key, payload)


def product_detail(ctx: DataContext, product_name: str, horizon_days: int = 90) -> dict:
    history = product_history(ctx)
    matches = history[history["product"].str.lower() == product_name.lower()]
    if matches.empty:
        raise ApiError('Không tìm thấy sản phẩm trong bộ dữ liệu này.', 404, "product_not_found")
    row = matches.iloc[0]
    frame = ctx.frame[(ctx.frame["_product"] == row["product"]) & ctx.frame["_order_date"].notna()]
    if frame.empty:
        raise ApiError('Chưa có lịch sử bán hàng cho sản phẩm này.', 422, "empty_analysis")
    series = daily_aggregate(frame, value_col="_quantity")
    try:
        outcome = auto_forecast(series, horizon_days=horizon_days, candidate_models=FAST_MODELS)
    except Exception as exc:
        raise ApiError(f'Không thể dự báo: {exc}', 422, "forecast_failed") from exc

    history_daily = series.tail(max(90, horizon_days)).reset_index()
    history_daily.columns = ["date", "value"]
    history_points = [
        {"date": row["date"].date().isoformat(), "actual": round(float(row["value"]), 2), "forecast": None, "lower": None, "upper": None}
        for _, row in history_daily.iterrows()
    ]
    forecast_points = [
        {
            "date": date.date().isoformat(),
            "actual": None,
            "forecast": round(float(outcome.forecast.loc[date]), 2),
            "lower": round(float(outcome.lower.loc[date]), 2),
            "upper": round(float(outcome.upper.loc[date]), 2),
        }
        for date in outcome.forecast.index
    ]
    validation_points = []
    if outcome.validation_actual is not None and outcome.validation_forecast is not None:
        for date in outcome.validation_actual.index:
            validation_points.append(
                {
                    "week_ending": date.date().isoformat(),
                    "actual": round(float(outcome.validation_actual.loc[date]), 2),
                    "predicted": round(float(outcome.validation_forecast.loc[date]), 2),
                }
            )

    recent_revenue = float(row["recent30_revenue"])
    forecast_30 = outcome.total(30)
    recent_units = float(row["recent30_units"])
    growth = None if recent_units <= 0 else (forecast_30 - recent_units) / recent_units * 100
    direction_factors = []
    if growth is not None:
        direction_factors.append(
            f'Nhu cầu dự báo 30 ngày là {forecast_30:,.0f} đơn vị, so với {recent_units:,.0f} đơn vị trong 30 ngày gần nhất ({growth:+.1f}%).'
        )
    direction_factors.append(
        f"Mô hình {outcome.model_label} được chọn đạt MAE {outcome.metrics.get('mae')} và MAPE {outcome.metrics.get('mape')}% trên tập kiểm thử độc lập theo thời gian gồm {(len(outcome.validation_actual) if outcome.validation_actual is not None else 0)} tuần."
    )
    if row.get("days_since_last_sale") is not None:
        direction_factors.append(
            f"Lần bán được ghi nhận gần nhất cách ngày kết thúc bộ dữ liệu {int(row['days_since_last_sale'])} ngày."
        )
    if ctx.capabilities.get("category"):
        direction_factors.append(f"Category: {row['category']}.")

    return {
        "product": {
            "product": row["product"],
            "product_id": row.get("product_id"),
            "category": row["category"],
            "units_sold": int(row["units"]),
            "revenue": round(float(row["revenue"]), 2),
            "recent_30_units": int(row["recent30_units"]),
            "recent_30_revenue": round(recent_revenue, 2),
            "current_stock": int(row["current_stock"]) if pd.notna(row.get("current_stock")) else None,
        },
        "forecast": {
            "model": outcome.model,
            "model_label": outcome.model_label,
            "metrics": outcome.metrics,
            "forecast_7d": round(outcome.total(7), 2),
            "forecast_30d": round(outcome.total(30), 2),
            "forecast_90d": round(outcome.total(90), 2),
            "growth_30_pct": round(growth, 2) if growth is not None else None,
            "validation_quality": _reliability(outcome.metrics.get("mape")),
            "candidates": outcome.candidates,
            "notes": outcome.notes,
        },
        "series": history_points + forecast_points,
        "validation": validation_points,
        "factors": direction_factors,
    }


def product_catalog(
    ctx: DataContext,
    search: str | None = None,
    sort_by: str = "recent_revenue",
    limit: int = 100,
    offset: int = 0,
) -> dict:
    history = product_history(ctx)
    if search:
        needle = search.strip().lower()
        history = history[
            history["product"].str.lower().str.contains(needle, na=False)
            | history["category"].str.lower().str.contains(needle, na=False)
        ]
    sort_map = {
        "recent_revenue": "recent30_revenue",
        "revenue": "revenue",
        "units": "units",
        "recent_units": "recent30_units",
        "growth": "historical_growth_pct",
        "name": "product",
    }
    sort_column = sort_map.get(sort_by, "recent30_revenue")
    ascending = sort_by == "name"
    history = history.sort_values(sort_column, ascending=ascending, na_position="last")
    total = len(history)
    window = history.iloc[offset : offset + limit]
    items = []
    for _, row in window.iterrows():
        items.append(
            {
                "product": row["product"],
                "product_id": row.get("product_id"),
                "category": row.get("category"),
                "units_sold": int(row["units"]),
                "revenue": round(float(row["revenue"]), 2),
                "orders": int(row["orders"] or 0),
                "recent_30_units": int(row["recent30_units"]),
                "previous_30_units": int(row["prev30_units"]),
                "recent_30_revenue": round(float(row["recent30_revenue"]), 2),
                "growth_pct": round(float(row["historical_growth_pct"]), 2)
                if pd.notna(row.get("historical_growth_pct"))
                else None,
                "days_since_last_sale": int(row["days_since_last_sale"]),
                "current_stock": int(row["current_stock"]) if pd.notna(row.get("current_stock")) else None,
            }
        )
    return {
        "items": json_safe(items),
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "categories": sorted(history["category"].dropna().unique().tolist()),
        "data_context": {"data_through": ctx.date_max},
    }
