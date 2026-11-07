from __future__ import annotations

import io
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.config import DEMO_DIR, UPLOAD_DIR, settings
from app.core.errors import ApiError
from app.core.localization import label as vi_label
from app.core.utils import dataframe_records
from app.models import Dataset
from app.services.demo_data import DEMO_FILENAME, build_demo_dataset
from app.services.mapping import (
    capabilities,
    capabilities_view,
    detect_mapping,
    field_mapping_view,
    mapped_column,
    missing_data_guidance,
)

ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
FRAME_CACHE: dict[str, tuple[float, pd.DataFrame]] = {}
CONTEXT_CACHE: dict[str, tuple[str, int, dict]] = {}

CANONICAL_FIELDS = [
    "order_id",
    "customer_id",
    "product_id",
    "product_name",
    "category",
    "order_date",
    "quantity",
    "unit_price",
    "revenue",
    "discount",
    "stock_quantity",
    "cost",
    "profit",
    "region",
]


@dataclass
class DataContext:
    dataset: Dataset
    frame: pd.DataFrame
    mapping: dict
    capabilities: dict
    revenue_derived: bool
    uses_raw_file: bool
    date_min: str | None
    date_max: str | None

    def require(self, capability: str, feature: str) -> None:
        if not self.capabilities.get(capability):
            raise ApiError(
                f'Không thể sử dụng {vi_label(feature)} vì bộ dữ liệu thiếu các trường bắt buộc.',
                422,
                "capability_unavailable",
                {"capability": capability, "guidance": missing_data_guidance(self.mapping)},
            )


def _invalidate_cache(dataset_id: str) -> None:
    FRAME_CACHE.pop(dataset_id, None)
    CONTEXT_CACHE.pop(dataset_id, None)


def _read_csv(path: Path) -> pd.DataFrame:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-8", "cp1258", "latin-1"):
        try:
            return pd.read_csv(path, encoding=encoding, sep=None, engine="python", on_bad_lines="skip")
        except Exception as exc:  # pragma: no cover - encoding fallback
            last_error = exc
    raise ApiError(f'Không thể đọc tệp CSV: {last_error}', 422, "invalid_file")


def read_dataframe(path: str | Path) -> pd.DataFrame:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        df = _read_csv(file_path)
    elif suffix in {".xlsx", ".xls"}:
        try:
            df = pd.read_excel(file_path)
        except Exception as exc:
            raise ApiError(f'Không thể đọc tệp Excel: {exc}', 422, "invalid_file") from exc
    else:
        raise ApiError(f'Định dạng tệp không được hỗ trợ: {suffix}', 415, "unsupported_file")
    df.columns = [str(column).strip() for column in df.columns]
    if df.empty:
        raise ApiError('Tệp tải lên không chứa dòng dữ liệu nào.', 422, "empty_dataset")
    if len(df.columns) < 2:
        raise ApiError('Bộ dữ liệu phải có ít nhất hai cột.', 422, "invalid_dataset")
    return df


def _to_numeric(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")
    text = series.astype(str).str.strip()
    text = text.str.replace(r"[^0-9,.\-]", "", regex=True)
    text = text.replace({"": None, "-": None, "nan": None, "None": None})

    def parse_value(value: Any) -> float | None:
        if value is None or pd.isna(value):
            return None
        raw = str(value)
        if "," in raw and "." in raw:
            if raw.rfind(",") > raw.rfind("."):
                raw = raw.replace(".", "").replace(",", ".")
            else:
                raw = raw.replace(",", "")
        elif "," in raw:
            parts = raw.split(",")
            if len(parts) > 1 and len(parts[-1]) == 3 and raw.count(",") >= 1:
                raw = raw.replace(",", "")
            else:
                raw = raw.replace(",", ".")
        try:
            return float(raw)
        except ValueError:
            return None

    return text.map(parse_value).astype(float)


def _parse_dates(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        numeric = pd.to_numeric(series, errors="coerce")
        if numeric.dropna().between(20000, 80000).all():
            return pd.to_datetime(numeric, unit="D", origin="1899-12-30", errors="coerce")
    text = series.astype(str).str.strip()
    try:
        parsed = pd.to_datetime(text, errors="coerce", format="mixed")
    except TypeError:
        parsed = pd.to_datetime(text, errors="coerce")
    return parsed


def prepare_analysis_frame(df: pd.DataFrame, mapping: dict) -> pd.DataFrame:
    frame = df.copy()
    for field in CANONICAL_FIELDS:
        frame[f"_{field}"] = np.nan

    context_keys = {
        "order_id": "_order_id",
        "customer_id": "_customer_id",
        "product_id": "_product_id",
        "product_name": "_product_name",
        "category": "_category",
        "region": "_region",
    }
    for field, target in context_keys.items():
        column = mapped_column(mapping, field)
        if column and column in frame.columns:
            frame[target] = frame[column].astype("object")
            frame.loc[frame[column].isna(), target] = np.nan

    date_column = mapped_column(mapping, "order_date")
    if date_column and date_column in frame.columns:
        frame["_order_date"] = _parse_dates(frame[date_column])

    for field in ("quantity", "unit_price", "revenue", "discount", "stock_quantity", "cost", "profit"):
        column = mapped_column(mapping, field)
        if column and column in frame.columns:
            frame[f"_{field}"] = _to_numeric(frame[column])

    frame["_product"] = frame["_product_name"].where(frame["_product_name"].notna(), frame["_product_id"])
    frame["_product"] = frame["_product"].apply(lambda value: str(value).strip() if pd.notna(value) else np.nan)
    frame["_customer_id"] = frame["_customer_id"].apply(
        lambda value: str(value).strip() if pd.notna(value) else np.nan
    )
    frame["_order_id"] = frame["_order_id"].apply(
        lambda value: str(value).strip() if pd.notna(value) else np.nan
    )
    if frame["_category"].notna().any():
        frame["_category"] = frame["_category"].fillna("Uncategorized").astype(str)
    else:
        frame["_category"] = "Uncategorized"
    if frame["_region"].notna().any():
        frame["_region"] = frame["_region"].fillna("Unknown").astype(str)

    qty = frame["_quantity"].fillna(0)
    price = frame["_unit_price"]
    discount = frame["_discount"]
    derived = False
    if mapped_column(mapping, "revenue") is None:
        if mapped_column(mapping, "quantity") and mapped_column(mapping, "unit_price"):
            revenue = qty * price
            if discount.notna().any():
                discount_fraction = discount.where(discount <= 1, discount / 100.0)
                revenue = revenue * (1 - discount_fraction.fillna(0).clip(lower=0, upper=1))
            frame["_revenue"] = revenue
            derived = True
        else:
            frame["_revenue"] = np.nan
    else:
        frame["_revenue"] = frame["_revenue"].fillna(qty * price)

    if mapped_column(mapping, "cost") is None:
        frame["_unit_cost"] = np.nan
    else:
        frame["_unit_cost"] = frame["_cost"]
    if mapped_column(mapping, "profit") is None and frame["_unit_cost"].notna().any():
        frame["_profit_calc"] = frame["_revenue"] - qty * frame["_unit_cost"]
    elif mapped_column(mapping, "profit"):
        frame["_profit_calc"] = frame["_profit"]
    else:
        frame["_profit_calc"] = np.nan

    frame.attrs["revenue_derived"] = derived
    frame["_row_number"] = np.arange(1, len(frame) + 1)
    return frame


def _dataset_path(dataset: Dataset) -> tuple[Path, bool]:
    if dataset.cleaned_path and Path(dataset.cleaned_path).exists():
        return Path(dataset.cleaned_path), False
    if Path(dataset.original_path).exists():
        return Path(dataset.original_path), True
    raise ApiError('Không tìm thấy tệp dữ liệu trên ổ đĩa.', 404, "dataset_file_missing")


def get_context(dataset_id: str, db: Session) -> DataContext:
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise ApiError('Không tìm thấy bộ dữ liệu.', 404, "dataset_not_found")
    path, uses_raw = _dataset_path(dataset)
    stat = path.stat()
    cache_key = f"{path.resolve()}::{stat.st_mtime_ns}"
    cached = CONTEXT_CACHE.get(dataset_id)
    if cached and cached[0] == cache_key:
        frame = cached[2]["frame"].copy(deep=False)
        mapping = cached[2]["mapping"]
    else:
        frame = read_dataframe(path)
        mapping = dataset.column_mapping or detect_mapping(list(frame.columns))
        prepared = prepare_analysis_frame(frame, mapping)
        CONTEXT_CACHE[dataset_id] = (cache_key, stat.st_mtime_ns, {"frame": prepared, "mapping": mapping})
        frame = prepared
        mapping = mapping

    frame = frame.copy(deep=False)
    revenue_derived = bool(frame.attrs.get("revenue_derived", False))
    if mapped_column(mapping, "revenue") and isinstance(mapping.get("revenue"), dict):
        revenue_derived = bool(mapping["revenue"].get("derived"))
    valid_dates = frame["_order_date"].dropna()
    return DataContext(
        dataset=dataset,
        frame=frame,
        mapping=mapping,
        capabilities=capabilities(mapping),
        revenue_derived=revenue_derived,
        uses_raw_file=uses_raw,
        date_min=valid_dates.min().date().isoformat() if not valid_dates.empty else None,
        date_max=valid_dates.max().date().isoformat() if not valid_dates.empty else None,
    )


def _column_profile(df: pd.DataFrame) -> list[dict]:
    info = []
    for column in df.columns:
        series = df[column]
        missing = int(series.isna().sum())
        non_null = int(series.notna().sum())
        samples = series.dropna().astype(str).head(3).tolist()
        if pd.api.types.is_numeric_dtype(series):
            dtype = "number"
        elif pd.api.types.is_datetime64_any_dtype(series):
            dtype = "datetime"
        else:
            dtype = "text"
        unique = int(series.nunique(dropna=True))
        info.append(
            {
                "name": str(column),
                "dtype": dtype,
                "pandas_dtype": str(series.dtype),
                "missing": missing,
                "missing_pct": round(missing / len(df) * 100, 2) if len(df) else 0,
                "non_null": non_null,
                "unique": unique,
                "sample": samples,
            }
        )
    return info


def profile_dataframe(df: pd.DataFrame, mapping: dict) -> dict:
    columns = _column_profile(df)
    duplicate_rows = int(df.duplicated().sum())
    missing_cells = int(df.isna().sum().sum())
    total_cells = int(df.shape[0] * df.shape[1]) or 1
    numeric_outliers: list[dict] = []
    for column in df.select_dtypes(include=[np.number]).columns:
        series = pd.to_numeric(df[column], errors="coerce").dropna()
        if len(series) < 20:
            continue
        q1, q3 = series.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr <= 0:
            continue
        low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        count = int(((series < low) | (series > high)).sum())
        if count:
            numeric_outliers.append(
                {"column": str(column), "count": count, "lower_bound": float(low), "upper_bound": float(high)}
            )

    invalid_dates = 0
    date_column = mapped_column(mapping, "order_date")
    if date_column and date_column in df.columns:
        parsed = _parse_dates(df[date_column])
        invalid_dates = int((df[date_column].notna() & parsed.isna()).sum())
    date_min = date_max = None
    if date_column and date_column in df.columns:
        parsed = _parse_dates(df[date_column]).dropna()
        if not parsed.empty:
            date_min = parsed.min().date().isoformat()
            date_max = parsed.max().date().isoformat()

    missing_pct = missing_cells / total_cells * 100
    duplicate_pct = duplicate_rows / len(df) * 100 if len(df) else 0
    invalid_pct = invalid_dates / len(df) * 100 if len(df) else 0
    quality_score = round(max(0, 100 - min(35, missing_pct * 0.8) - min(25, duplicate_pct) - min(20, invalid_pct * 2)), 1)

    return {
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "missing_cells": missing_cells,
        "missing_pct": round(missing_pct, 2),
        "duplicate_rows": duplicate_rows,
        "duplicate_pct": round(duplicate_pct, 2),
        "invalid_dates": invalid_dates,
        "quality_score": quality_score,
        "numeric_outliers": numeric_outliers,
        "column_info": columns,
        "date_min": date_min,
        "date_max": date_max,
        "mapping": field_mapping_view(mapping),
        "capabilities": capabilities_view(mapping),
        "missing_data_guidance": missing_data_guidance(mapping),
    }


def dataset_summary(dataset: Dataset, active_id: str | None = None) -> dict:
    return {
        "id": dataset.id,
        "name": "Dữ liệu bán lẻ mẫu AutoDS" if dataset.is_demo and dataset.name == "AutoDS Demo Retail" else dataset.name,
        "original_filename": dataset.original_filename,
        "status": dataset.status,
        "rows": dataset.rows,
        "columns": dataset.columns,
        "is_demo": dataset.is_demo,
        "is_active": dataset.id == active_id or dataset.is_active,
        "created_at": dataset.created_at.isoformat() if dataset.created_at else None,
        "updated_at": dataset.updated_at.isoformat() if dataset.updated_at else None,
        "quality_score": (dataset.quality_report or {}).get("quality_score"),
        "date_min": (dataset.quality_report or {}).get("date_min"),
        "date_max": (dataset.quality_report or {}).get("date_max"),
        "capabilities": capabilities(dataset.column_mapping or {}),
    }


def _activate(dataset: Dataset, db: Session) -> None:
    db.query(Dataset).update({Dataset.is_active: False})
    dataset.is_active = True
    db.commit()


def save_upload(filename: str, content: bytes, db: Session) -> dict:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ApiError('Chỉ hỗ trợ tệp CSV, XLSX và XLS.', 415, "unsupported_file")
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise ApiError(
            f'Tệp vượt quá giới hạn tải lên {settings.max_upload_mb} MB.',
            413,
            "file_too_large",
        )
    dataset_id = str(uuid.uuid4())
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).name)
    path = UPLOAD_DIR / f"{dataset_id}_{safe_name}"
    path.write_bytes(content)
    try:
        df = read_dataframe(path)
        mapping = detect_mapping(list(df.columns))
        quality = profile_dataframe(df, mapping)
    except Exception:
        path.unlink(missing_ok=True)
        raise

    dataset = Dataset(
        id=dataset_id,
        name=Path(filename).stem,
        original_filename=filename,
        original_path=str(path),
        status="uploaded",
        rows=len(df),
        columns=len(df.columns),
        column_mapping=mapping,
        quality_report=quality,
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    _activate(dataset, db)
    return {
        "dataset": dataset_summary(dataset, dataset.id),
        "profile": quality,
        "preview": dataframe_records(df, 20),
    }


def clean_dataset(dataset_id: str, options: dict, db: Session) -> dict:
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise ApiError('Không tìm thấy bộ dữ liệu.', 404, "dataset_not_found")
    raw_path = Path(dataset.original_path)
    df = read_dataframe(raw_path)
    mapping = dataset.column_mapping or detect_mapping(list(df.columns))
    original_rows = len(df)
    report: dict[str, Any] = {
        "original_rows": original_rows,
        "duplicates_removed": 0,
        "invalid_rows_removed": 0,
        "missing_dates_removed": 0,
        "filled_category_values": 0,
        "derived_fields": [],
        "transformations": [],
    }

    if options.get("drop_duplicates", True):
        before = len(df)
        df = df.drop_duplicates().reset_index(drop=True)
        report["duplicates_removed"] = before - len(df)
        if before != len(df):
            report["transformations"].append('Đã xóa các dòng trùng lặp hoàn toàn')

    date_column = mapped_column(mapping, "order_date")
    if date_column and date_column in df.columns:
        parsed_dates = _parse_dates(df[date_column])
        if options.get("drop_missing_dates", True):
            invalid = df[date_column].notna() & parsed_dates.isna()
            before = len(df)
            missing = df[date_column].isna()
            df = df.loc[~(invalid | missing)].reset_index(drop=True)
            report["invalid_rows_removed"] += int(invalid.sum())
            report["missing_dates_removed"] = int(missing.sum())
            if len(df) != before:
                report["transformations"].append('Đã xóa các dòng không có ngày đặt hàng hợp lệ')

    if options.get("drop_invalid_values", True):
        numeric_fields = ["quantity", "unit_price", "revenue", "cost", "stock_quantity"]
        before = len(df)
        mask = pd.Series(False, index=df.index)
        for field in numeric_fields:
            column = mapped_column(mapping, field)
            if not column or column not in df.columns:
                continue
            original_non_null = df[column].notna()
            parsed = _to_numeric(df[column])
            mask |= original_non_null & parsed.isna()
        if mask.any():
            df = df.loc[~mask].reset_index(drop=True)
        report["invalid_rows_removed"] += before - len(df)
        if before != len(df):
            report["transformations"].append('Đã xóa các dòng có giá trị không phải số trong trường số đã ánh xạ')

    category_column = mapped_column(mapping, "category")
    if options.get("fill_missing_category", False) and category_column and category_column in df.columns:
        missing = int(df[category_column].isna().sum())
        df[category_column] = df[category_column].fillna("Uncategorized")
        report["filled_category_values"] = missing
        if missing:
            report["transformations"].append("Đã điền nhãn 'Chưa phân loại' cho danh mục bị thiếu")

    revenue_column = mapped_column(mapping, "revenue")
    qty_column = mapped_column(mapping, "quantity")
    price_column = mapped_column(mapping, "unit_price")
    if not revenue_column and qty_column and price_column:
        derived_name = "Revenue (derived)"
        qty = _to_numeric(df[qty_column]).fillna(0)
        price = _to_numeric(df[price_column])
        revenue = qty * price
        discount_column = mapped_column(mapping, "discount")
        if discount_column and discount_column in df.columns:
            discounts = _to_numeric(df[discount_column])
            fraction = discounts.where(discounts <= 1, discounts / 100.0).fillna(0).clip(0, 1)
            revenue = revenue * (1 - fraction)
        df[derived_name] = revenue
        mapping["revenue"] = {
            "column": derived_name,
            "confidence": 100,
            "method": "derived",
            "derived": True,
        }
        report["derived_fields"].append(
            {
                "field": "revenue",
                "column": derived_name,
                "formula": "Quantity x Unit Price x (1 - Discount)",
                "note": 'Được tính toán phục vụ phân tích; số lượng và giá gốc được giữ nguyên.',
            }
        )
    elif revenue_column and revenue_column in df.columns:
        parsed_revenue = _to_numeric(df[revenue_column])
        if parsed_revenue.isna().all() and qty_column and price_column:
            derived_name = "Revenue (derived)"
            df[derived_name] = _to_numeric(df[qty_column]).fillna(0) * _to_numeric(df[price_column])
            mapping["revenue"] = {
                "column": derived_name,
                "confidence": 100,
                "method": "derived",
                "derived": True,
            }
            report["derived_fields"].append(
                {"field": "revenue", "column": derived_name, "formula": "Quantity x Unit Price"}
            )

    quality = profile_dataframe(df, mapping)
    if not options.get("drop_missing_dates", True):
        quality["invalid_dates"] = 0

    cleaned_path = UPLOAD_DIR / f"{dataset.id}_cleaned.csv"
    df.to_csv(cleaned_path, index=False, encoding="utf-8-sig")
    report["saved_rows"] = int(len(df))
    report["removed_rows"] = original_rows - int(len(df))
    report["saved_columns"] = int(len(df.columns))
    report["transformations"].append(f'Đã lưu {len(df):,} dòng dữ liệu đã làm sạch')

    dataset.cleaned_path = str(cleaned_path)
    dataset.status = "cleaned"
    dataset.rows = len(df)
    dataset.columns = len(df.columns)
    dataset.column_mapping = mapping
    dataset.quality_report = quality
    dataset.cleaning_report = report
    db.commit()
    db.refresh(dataset)
    _invalidate_cache(dataset.id)
    _activate(dataset, db)
    return {
        "dataset": dataset_summary(dataset, dataset.id),
        "cleaning_report": report,
        "profile": quality,
        "preview": dataframe_records(df, 20),
    }


def preview_dataset(dataset_id: str, db: Session, limit: int = 25, offset: int = 0, raw: bool = False) -> dict:
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise ApiError('Không tìm thấy bộ dữ liệu.', 404, "dataset_not_found")
    path = Path(dataset.original_path if raw or not dataset.cleaned_path else dataset.cleaned_path)
    if not path.exists():
        raise ApiError('Không tìm thấy tệp dữ liệu.', 404, "dataset_file_missing")
    df = read_dataframe(path)
    total = len(df)
    window = df.iloc[offset : offset + limit]
    columns = _column_profile(df)
    return {
        "items": dataframe_records(window),
        "total": total,
        "limit": limit,
        "offset": offset,
        "columns": columns,
        "mapping": field_mapping_view(dataset.column_mapping or detect_mapping(list(df.columns))),
        "source": "original" if raw or not dataset.cleaned_path else "cleaned",
    }


def activate_dataset(dataset_id: str, db: Session) -> dict:
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise ApiError('Không tìm thấy bộ dữ liệu.', 404, "dataset_not_found")
    _activate(dataset, db)
    return dataset_summary(dataset, dataset.id)


def delete_dataset(dataset_id: str, db: Session) -> None:
    dataset = db.get(Dataset, dataset_id)
    if not dataset:
        raise ApiError('Không tìm thấy bộ dữ liệu.', 404, "dataset_not_found")
    for path in (dataset.original_path, dataset.cleaned_path):
        if path:
            Path(path).unlink(missing_ok=True)
    _invalidate_cache(dataset_id)
    db.delete(dataset)
    db.commit()
    active = db.query(Dataset).filter(Dataset.is_active.is_(True)).first()
    if not active:
        fallback = db.query(Dataset).order_by(Dataset.created_at.desc()).first()
        if fallback:
            fallback.is_active = True
            db.commit()


def ensure_demo_dataset(db: Session) -> Dataset:
    existing = db.query(Dataset).filter(Dataset.is_demo.is_(True)).first()
    if existing:
        return existing
    path = DEMO_DIR / DEMO_FILENAME
    if not path.exists():
        build_demo_dataset(path)
    df = read_dataframe(path)
    mapping = detect_mapping(list(df.columns))
    quality = profile_dataframe(df, mapping)
    dataset = Dataset(
        id=str(uuid.uuid4()),
        name="Dữ liệu bán lẻ mẫu AutoDS",
        original_filename=DEMO_FILENAME,
        original_path=str(path),
        cleaned_path=str(path),
        status="cleaned",
        rows=len(df),
        columns=len(df.columns),
        column_mapping=mapping,
        quality_report=quality,
        cleaning_report={"saved_rows": len(df), "transformations": ['Đã tạo bộ dữ liệu mẫu có nhãn minh họa'], "is_demo": True},
        is_demo=True,
        is_active=True,
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


def get_llm_availability() -> dict:
    return {
        "configured": settings.llm_configured,
        "model": settings.llm_model if settings.llm_configured else None,
        "provider": settings.llm_base_url if settings.llm_configured else None,
        "message": (
            'Đã bật chức năng tạo diễn giải bằng mô hình ngôn ngữ.'
            if settings.llm_configured
            else 'Chưa cấu hình khóa API cho mô hình ngôn ngữ. Các chức năng phân tích và diễn giải dựa trên bằng chứng vẫn khả dụng.'
        ),
    }


def resolve_dataset(db: Session, dataset_id: str | None) -> Dataset:
    if dataset_id:
        dataset = db.get(Dataset, dataset_id)
        if not dataset:
            raise ApiError('Không tìm thấy bộ dữ liệu.', 404, "dataset_not_found")
        return dataset
    dataset = db.query(Dataset).filter(Dataset.is_active.is_(True)).first()
    if dataset is None:
        dataset = db.query(Dataset).order_by(Dataset.created_at.desc()).first()
    if dataset is None:
        raise ApiError('Chưa có bộ dữ liệu. Hãy tải lên dữ liệu hoặc dùng bộ dữ liệu mẫu.', 404, "no_dataset")
    return dataset
