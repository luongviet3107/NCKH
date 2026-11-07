"""Forecasting engine used by product, revenue, inventory and agent modules.

Models are fitted on calendar-week aggregates for stability. Daily projections are
created by distributing each weekly forecast using recent weekday shares. Every
reported validation metric comes from a chronological holdout; no random metrics
are generated.
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.holtwinters import ExponentialSmoothing

try:
    from xgboost import XGBRegressor
except Exception:  # pragma: no cover
    XGBRegressor = None

MODEL_LABELS = {
    "linear_regression": 'Hồi quy tuyến tính',
    "moving_average": 'Trung bình trượt',
    "holt": 'San bằng mũ (Holt)',
    "random_forest": 'Rừng ngẫu nhiên',
    "xgboost": "XGBoost",
    "arima": "ARIMA",
}

FAST_MODELS = ["moving_average", "linear_regression", "holt"]
ALL_MODELS = ["linear_regression", "random_forest", "xgboost", "arima", "holt", "moving_average"]


@dataclass
class ForecastOutcome:
    model: str
    model_label: str
    forecast: pd.Series
    lower: pd.Series
    upper: pd.Series
    metrics: dict
    candidates: list[dict] = field(default_factory=list)
    weekly_actual: pd.Series | None = None
    weekly_forecast: pd.Series | None = None
    validation_actual: pd.Series | None = None
    validation_forecast: pd.Series | None = None
    notes: list[str] = field(default_factory=list)

    def total(self, days: int) -> float:
        return float(self.forecast.iloc[:days].sum())


def _clean_daily(series: pd.Series) -> pd.Series:
    copied = series.copy()
    copied.index = pd.to_datetime(copied.index).normalize()
    copied = copied[~copied.index.isna()]
    copied = copied.groupby(level=0).sum().sort_index().astype(float)
    if copied.empty:
        return copied
    full_index = pd.date_range(copied.index.min(), copied.index.max(), freq="D")
    copied = copied.reindex(full_index, fill_value=0.0)
    return copied


def daily_aggregate(
    df: pd.DataFrame,
    date_col: str = "_order_date",
    value_col: str = "_revenue",
    start_date=None,
    end_date=None,
    fill_value: float = 0.0,
) -> pd.Series:
    frame = df[[date_col, value_col]].dropna(subset=[date_col, value_col]).copy()
    if frame.empty:
        return pd.Series(dtype=float)
    frame["_date"] = pd.to_datetime(frame[date_col]).dt.normalize()
    frame["_value"] = pd.to_numeric(frame[value_col], errors="coerce")
    frame = frame.dropna(subset=["_value"])
    if start_date is not None:
        frame = frame[frame["_date"] >= pd.Timestamp(start_date)]
    if end_date is not None:
        frame = frame[frame["_date"] <= pd.Timestamp(end_date)]
    if frame.empty:
        return pd.Series(dtype=float)
    daily = frame.groupby("_date")["_value"].sum().sort_index()
    full_index = pd.date_range(daily.index.min(), daily.index.max(), freq="D")
    return daily.reindex(full_index, fill_value=fill_value).astype(float)


def weekly_aggregate(daily: pd.Series) -> pd.Series:
    if daily.empty:
        return pd.Series(dtype=float)
    weekly = daily.resample("W-SUN").sum()
    return weekly[weekly.index <= daily.index.max()]


def _future_week_labels(last_weekly_date: pd.Timestamp, n_weeks: int) -> pd.DatetimeIndex:
    return pd.date_range(last_weekly_date + pd.Timedelta(days=7), periods=n_weeks, freq="W-SUN")


def _linear_forecast(history: np.ndarray, horizon: int, dates: pd.DatetimeIndex | None = None) -> np.ndarray:
    n = len(history)
    x = np.arange(n).reshape(-1, 1)
    model = LinearRegression()
    model.fit(x, history)
    future_x = np.arange(n, n + horizon).reshape(-1, 1)
    return np.asarray(model.predict(future_x), dtype=float)


def _moving_average_forecast(history: np.ndarray, horizon: int, window: int = 4) -> np.ndarray:
    k = max(1, min(window, len(history)))
    baseline = float(np.mean(history[-k:]))
    return np.repeat(baseline, horizon)


def _holt_forecast(history: np.ndarray, horizon: int) -> np.ndarray:
    if len(history) < 5:
        return _moving_average_forecast(history, horizon)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for trend, damped in (("add", True), ("add", False), (None, False)):
            try:
                model = ExponentialSmoothing(
                    history,
                    trend=trend,
                    damped_trend=damped if trend else False,
                    initialization_method="estimated",
                )
                fitted = model.fit(optimized=True, use_brute=False)
                values = np.asarray(fitted.forecast(horizon), dtype=float)
                if np.isfinite(values).all():
                    return values
            except Exception:
                continue
    return _linear_forecast(history, horizon)


def _lag_features(values: np.ndarray, n_lags: int) -> tuple[np.ndarray, np.ndarray]:
    X, y = [], []
    for index in range(n_lags, len(values)):
        X.append(values[index - n_lags : index])
        y.append(values[index])
    return np.asarray(X, dtype=float), np.asarray(y, dtype=float)


def _recursive_tree_forecast(history: np.ndarray, horizon: int, model_type: str) -> np.ndarray:
    n_lags = min(4, max(1, len(history) // 4))
    if len(history) <= n_lags + 2:
        return _moving_average_forecast(history, horizon)
    X, y = _lag_features(history, n_lags)
    if model_type == "random_forest":
        model = RandomForestRegressor(
            n_estimators=160,
            max_depth=5,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=1,
        )
    else:
        if XGBRegressor is None:
            raise ValueError('Chưa cài đặt XGBoost.')
        model = XGBRegressor(
            n_estimators=160,
            max_depth=3,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=1,
        )
    model.fit(X, y)
    window = list(history[-n_lags:])
    predictions: list[float] = []
    for _ in range(horizon):
        predicted = float(model.predict(np.asarray(window[-n_lags:]).reshape(1, -1))[0])
        predictions.append(predicted)
        window.append(predicted)
    return np.asarray(predictions, dtype=float)


def _arima_forecast(history: np.ndarray, horizon: int) -> np.ndarray:
    if len(history) < 16:
        return _holt_forecast(history, horizon)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            model = ARIMA(
                history,
                order=(1, 1, 1),
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            fitted = model.fit(method_kwargs={"maxiter": 120})
            values = np.asarray(fitted.forecast(steps=horizon), dtype=float)
            if np.isfinite(values).all():
                return values
        except Exception:
            pass
    return _holt_forecast(history, horizon)


def forecast_values(model_key: str, history: Iterable[float], horizon: int) -> np.ndarray:
    values = np.asarray(list(history), dtype=float)
    if len(values) == 0:
        raise ValueError('Không thể dự báo chuỗi dữ liệu trống.')
    if horizon <= 0:
        return np.asarray([], dtype=float)
    if model_key == "linear_regression":
        return _linear_forecast(values, horizon)
    if model_key == "moving_average":
        return _moving_average_forecast(values, horizon)
    if model_key == "holt":
        return _holt_forecast(values, horizon)
    if model_key in {"random_forest", "xgboost"}:
        return _recursive_tree_forecast(values, horizon, model_key)
    if model_key == "arima":
        return _arima_forecast(values, horizon)
    raise ValueError(f'Không nhận diện được mô hình dự báo: {model_key}')


def compute_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    mask = np.isfinite(actual) & np.isfinite(predicted)
    actual, predicted = actual[mask], predicted[mask]
    if len(actual) == 0:
        return {"mae": None, "mse": None, "rmse": None, "mape": None, "r2": None, "n": 0}
    mae = float(mean_absolute_error(actual, predicted))
    mse = float(mean_squared_error(actual, predicted))
    rmse = float(math.sqrt(mse))
    non_zero = np.abs(actual) > 1e-9
    mape = float(np.mean(np.abs((actual[non_zero] - predicted[non_zero]) / actual[non_zero])) * 100) if non_zero.any() else None
    r2 = float(r2_score(actual, predicted)) if len(actual) >= 2 and np.var(actual) > 0 else None
    return {
        "mae": round(mae, 4),
        "mse": round(mse, 4),
        "rmse": round(rmse, 4),
        "mape": round(mape, 4) if mape is not None else None,
        "r2": round(r2, 4) if r2 is not None else None,
        "n": int(len(actual)),
    }


def _weekday_shares(daily: pd.Series) -> np.ndarray:
    recent = daily.tail(56)
    if recent.empty or recent.sum() <= 0:
        return np.repeat(1 / 7, 7)
    by_weekday = recent.groupby(recent.index.weekday).sum().reindex(range(7), fill_value=0.0)
    shares = by_weekday / by_weekday.sum() if by_weekday.sum() > 0 else pd.Series(np.repeat(1 / 7, 7))
    return np.asarray(shares, dtype=float)


def expand_weekly_to_daily(
    weekly_prediction: np.ndarray,
    start_date: pd.Timestamp,
    horizon: int,
    weekday_shares: np.ndarray,
    uncertainty_per_week: np.ndarray | None = None,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    index = pd.date_range(start_date, periods=horizon, freq="D")
    values = np.zeros(horizon)
    lowers = np.zeros(horizon)
    uppers = np.zeros(horizon)
    shares = weekday_shares / weekday_shares.sum()
    for position, day in enumerate(index):
        week_index = position // 7
        if week_index >= len(weekly_prediction):
            week_index = len(weekly_prediction) - 1
        share = shares[day.weekday()]
        prediction = max(0.0, float(weekly_prediction[week_index])) * share
        values[position] = prediction
        if uncertainty_per_week is not None and week_index < len(uncertainty_per_week):
            uncertainty = max(0.0, float(uncertainty_per_week[week_index])) * share
        else:
            uncertainty = 0.0
        lowers[position] = max(0.0, prediction - 1.96 * uncertainty)
        uppers[position] = prediction + 1.96 * uncertainty
    return (
        pd.Series(values, index=index),
        pd.Series(lowers, index=index),
        pd.Series(uppers, index=index),
    )


def auto_forecast(
    series: pd.Series,
    horizon_days: int,
    candidate_models: list[str] | None = None,
    non_negative: bool = True,
) -> ForecastOutcome:
    """Backtest candidate models on a chronological holdout, then refit the best model."""
    daily = _clean_daily(series)
    if len(daily) < 14:
        raise ValueError('Cần ít nhất 14 ngày dữ liệu lịch sử để dự báo đáng tin cậy.')
    weekly = weekly_aggregate(daily)
    if len(weekly) < 5:
        raise ValueError('Cần ít nhất năm tuần dữ liệu đầy đủ để dự báo đáng tin cậy.')

    models = candidate_models or FAST_MODELS
    n_weeks = len(weekly)
    validation_weeks = max(2, min(12, math.ceil(horizon_days / 7) + 1, max(2, n_weeks // 4)))
    if n_weeks - validation_weeks < 5:
        validation_weeks = max(1, n_weeks // 5)
    train = weekly.iloc[: n_weeks - validation_weeks].to_numpy(dtype=float)
    validation_actual = weekly.iloc[n_weeks - validation_weeks :].to_numpy(dtype=float)

    candidates: list[dict] = []
    best_key = "moving_average"
    best_metrics = {"mae": float("inf")}
    best_residuals: np.ndarray | None = None
    best_validation_prediction: np.ndarray | None = None
    for model_key in models:
        try:
            predictions = forecast_values(model_key, train, validation_weeks)
            if non_negative:
                predictions = np.clip(predictions, 0, None)
            metrics = compute_metrics(validation_actual, predictions)
            candidates.append(
                {
                    "model": model_key,
                    "label": MODEL_LABELS.get(model_key, model_key),
                    "metrics": metrics,
                    "status": "ok",
                }
            )
            if metrics["mae"] is not None and metrics["mae"] < best_metrics["mae"]:
                best_metrics = metrics
                best_key = model_key
                best_residuals = validation_actual - predictions
                best_validation_prediction = predictions
        except Exception as exc:
            candidates.append(
                {
                    "model": model_key,
                    "label": MODEL_LABELS.get(model_key, model_key),
                    "metrics": None,
                    "status": "failed",
                    "reason": str(exc)[:180],
                }
            )

    weekly_horizon = max(1, math.ceil(horizon_days / 7) + 1)
    full_history = weekly.to_numpy(dtype=float)
    try:
        weekly_prediction = forecast_values(best_key, full_history, weekly_horizon)
    except Exception:
        best_key = "moving_average"
        weekly_prediction = forecast_values(best_key, full_history, weekly_horizon)
    if non_negative:
        weekly_prediction = np.clip(weekly_prediction, 0, None)

    if best_residuals is not None and len(best_residuals) > 1:
        weekly_sigma = float(np.std(best_residuals, ddof=1))
        uncertainty = weekly_sigma * np.sqrt(np.arange(1, weekly_horizon + 1))
    else:
        weekly_sigma = float(np.std(full_history[-min(12, len(full_history)) :])) * 0.25
        uncertainty = weekly_sigma * np.sqrt(np.arange(1, weekly_horizon + 1))

    start = daily.index.max() + pd.Timedelta(days=1)
    daily_forecast, lower, upper = expand_weekly_to_daily(
        weekly_prediction,
        start,
        horizon_days,
        _weekday_shares(daily),
        uncertainty,
    )
    weekly_dates = _future_week_labels(weekly.index.max(), weekly_horizon)
    weekly_series = pd.Series(weekly_prediction, index=weekly_dates[: len(weekly_prediction)])
    validation_index = weekly.index[-validation_weeks:]
    validation_actual_series = pd.Series(validation_actual, index=validation_index)
    validation_forecast_series = (
        pd.Series(best_validation_prediction, index=validation_index)
        if best_validation_prediction is not None
        else None
    )

    notes = [
        'Kiểm định dùng tập kiểm thử độc lập theo thời gian trên dữ liệu tổng hợp hàng tuần; mô hình được chọn sẽ được huấn luyện lại trên toàn bộ lịch sử.',
        'Giá trị hàng ngày được phân bổ từ dự báo hàng tuần theo tỷ trọng từng ngày trong tuần.',
    ]
    if best_metrics.get("mae") is None:
        notes.append('Lịch sử dữ liệu ngắn làm hạn chế độ tin cậy của các chỉ số kiểm định mô hình.')
    return ForecastOutcome(
        model=best_key,
        model_label=MODEL_LABELS.get(best_key, best_key),
        forecast=daily_forecast,
        lower=lower,
        upper=upper,
        metrics=best_metrics,
        candidates=candidates,
        weekly_actual=weekly,
        weekly_forecast=weekly_series,
        validation_actual=validation_actual_series,
        validation_forecast=validation_forecast_series,
        notes=notes,
    )


def forecast_weekly_series(
    weekly: pd.Series,
    horizon_weeks: int,
    models: list[str] | None = None,
    non_negative: bool = True,
) -> tuple[str, np.ndarray, list[dict], dict]:
    """Used by benchmark services: validate on the final chronological section."""
    values = weekly.to_numpy(dtype=float)
    if len(values) < 8:
        raise ValueError('Cần ít nhất tám quan sát hàng tuần để đánh giá mô hình.')
    validation = max(2, min(8, len(values) // 5))
    train = values[:-validation]
    actual = values[-validation:]
    results: list[dict] = []
    for model_key in models or ALL_MODELS:
        if model_key == "xgboost" and XGBRegressor is None:
            continue
        try:
            preds = forecast_values(model_key, train, validation)
            if non_negative:
                preds = np.clip(preds, 0, None)
            results.append(
                {
                    "model": model_key,
                    "label": MODEL_LABELS.get(model_key, model_key),
                    "metrics": compute_metrics(actual, preds),
                    "validation_forecast": [round(float(v), 4) for v in preds],
                }
            )
        except Exception as exc:
            results.append(
                {
                    "model": model_key,
                    "label": MODEL_LABELS.get(model_key, model_key),
                    "metrics": None,
                    "reason": str(exc)[:180],
                    "validation_forecast": [],
                }
            )
    successful = [row for row in results if row.get("metrics") and row["metrics"].get("mae") is not None]
    if not successful:
        raise ValueError('Không có mô hình ứng viên nào hoàn tất kiểm định.')
    best = min(successful, key=lambda row: row["metrics"]["mae"])
    best_pred = forecast_values(best["model"], values, horizon_weeks)
    if non_negative:
        best_pred = np.clip(best_pred, 0, None)
    return best["model"], np.asarray(best_pred, dtype=float), results, best["metrics"]
