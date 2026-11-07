from __future__ import annotations

import math
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


def json_safe(value: Any) -> Any:
    """Convert pandas/numpy structures to strict JSON-compatible Python values."""
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, (datetime, date, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    if isinstance(value, pd.Series):
        return [json_safe(v) for v in value.tolist()]
    if isinstance(value, pd.DataFrame):
        return json_safe(value.to_dict(orient="records"))
    if pd.isna(value) if not isinstance(value, (list, dict)) else False:
        return None
    return str(value)


def dataframe_records(df: pd.DataFrame, limit: int | None = None) -> list[dict]:
    frame = df.head(limit) if limit is not None else df
    return json_safe(frame.to_dict(orient="records"))


def pct_change(current: float, previous: float) -> float | None:
    if previous is None or previous == 0 or not math.isfinite(float(previous)):
        return None
    return float((current - previous) / abs(previous) * 100)


def safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    if denominator in (0, 0.0) or denominator is None:
        return default
    return float(numerator / denominator)


def normalize_colname(value: str) -> str:
    return (
        str(value)
        .strip()
        .lower()
        .replace("đ", "d")
        .replace("_", " ")
        .replace("-", " ")
        .replace(".", " ")
    )


def fmt_currency(value: float) -> str:
    return f"${value:,.0f}"


def ensure_date_string(value: date | datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value[:10]
    return value.isoformat()[:10]
