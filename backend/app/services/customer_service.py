from __future__ import annotations

import itertools
import math
import time
from typing import Any

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    davies_bouldin_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    silhouette_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.core.errors import ApiError
from app.core.utils import json_safe
from app.services.data_service import DataContext
from app.services.mapping import missing_data_guidance

try:
    from xgboost import XGBClassifier
except Exception:  # pragma: no cover
    XGBClassifier = None

CUSTOMER_CACHE: dict[str, tuple[float, dict]] = {}
CHURN_CACHE: dict[str, tuple[float, dict]] = {}
CUSTOMER_FRAMES: dict[str, pd.DataFrame] = {}
CHURN_FRAMES: dict[str, pd.DataFrame] = {}
CACHE_TTL_SECONDS = 300
SEGMENT_LABELS = [
    "VIP Customers",
    "Loyal Customers",
    "Potential Customers",
    "New Customers",
    "At-risk Customers",
    "Lost Customers",
]
PROTOTYPES = {
    "VIP Customers": [0.90, 0.90, 1.00, 0.70],
    "Loyal Customers": [0.80, 0.82, 0.65, 0.80],
    "Potential Customers": [0.70, 0.38, 0.38, 0.45],
    "New Customers": [0.82, 0.18, 0.25, 0.05],
    "At-risk Customers": [0.30, 0.58, 0.68, 0.82],
    "Lost Customers": [0.05, 0.18, 0.28, 0.80],
}


def clear_customer_cache() -> None:
    CUSTOMER_CACHE.clear()
    CHURN_CACHE.clear()
    CUSTOMER_FRAMES.clear()
    CHURN_FRAMES.clear()


def _features(ctx: DataContext) -> tuple[pd.DataFrame, pd.DataFrame]:
    ctx.require("customers", 'Trí tuệ khách hàng')
    frame = ctx.frame.dropna(subset=["_customer_id", "_order_date"]).copy()
    frame = frame[frame["_revenue"].notna()]
    if frame.empty:
        raise ApiError('Không có giao dịch khách hàng hợp lệ.', 422, "empty_analysis")
    max_date = frame["_order_date"].max().normalize()
    has_order_ids = "_order_id" in frame.columns and frame["_order_id"].notna().any()

    if has_order_ids:
        orders = frame.dropna(subset=["_order_id"]).groupby("_customer_id")["_order_id"].nunique()
    else:
        orders = frame.groupby("_customer_id").size()
    grouped = frame.groupby("_customer_id").agg(
        last_purchase=("_order_date", "max"),
        first_purchase=("_order_date", "min"),
        monetary=("_revenue", "sum"),
        units=("_quantity", "sum") if "_quantity" in frame.columns else ("_revenue", "size"),
        distinct_products=("_product", "nunique"),
        distinct_categories=("_category", "nunique"),
    )
    grouped["frequency"] = orders.reindex(grouped.index).fillna(1).astype(int)
    grouped = grouped.reset_index().rename(columns={"_customer_id": "customer_id"})
    grouped["recency_days"] = (max_date - grouped["last_purchase"]).dt.days.clip(lower=0)
    grouped["tenure_days"] = (max_date - grouped["first_purchase"]).dt.days.clip(lower=1)
    grouped["average_order_value"] = grouped["monetary"] / grouped["frequency"].clip(lower=1)
    grouped["purchase_frequency_30d"] = grouped["frequency"] / (grouped["tenure_days"] / 30.0).clip(lower=1)
    grouped["average_days_between_purchases"] = grouped["tenure_days"] / grouped["frequency"].clip(lower=1)
    grouped["monetary"] = grouped["monetary"].astype(float)
    grouped = grouped.sort_values("monetary", ascending=False).reset_index(drop=True)
    return grouped, frame


def _assign_segment_labels(cluster_profiles: pd.DataFrame, k: int) -> dict[int, str]:
    recency_score = 1 - cluster_profiles["recency_days"].rank(pct=True)
    frequency_score = cluster_profiles["frequency"].rank(pct=True)
    monetary_score = cluster_profiles["monetary"].rank(pct=True)
    tenure_score = cluster_profiles["tenure_days"].rank(pct=True)
    profiles = np.column_stack(
        [
            recency_score.to_numpy(),
            frequency_score.to_numpy(),
            monetary_score.to_numpy(),
            tenure_score.to_numpy(),
        ]
    )
    label_matrix = np.asarray([[PROTOTYPES[label][i] for i in range(4)] for label in SEGMENT_LABELS])
    best_mapping: dict[int, str] | None = None
    best_cost = float("inf")
    for subset in itertools.combinations(range(len(SEGMENT_LABELS)), k):
        prototype_subset = label_matrix[list(subset)]
        cost_matrix = ((profiles[:, None, :] - prototype_subset[None, :, :]) ** 2).sum(axis=2)
        rows, cols = linear_sum_assignment(cost_matrix)
        total_cost = float(cost_matrix[rows, cols].sum())
        if total_cost < best_cost:
            best_cost = total_cost
            best_mapping = {int(row): SEGMENT_LABELS[subset[int(col)]] for row, col in zip(rows, cols)}
    return best_mapping or {index: SEGMENT_LABELS[index] for index in range(k)}


def segment_customers(ctx: DataContext, limit: int = 100) -> dict:
    ctx.require("customers", 'Phân khúc khách hàng')
    key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{ctx.date_max}:{limit}"
    cached = CUSTOMER_CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    customers, frame = _features(ctx)
    n_customers = len(customers)
    if n_customers < 8:
        return {
            "available": False,
            "reason": 'Cần ít nhất tám khách hàng để phân khúc bằng K-Means.',
            "clusters": [],
            "customers": [],
            "metrics": None,
            "guidance": missing_data_guidance(ctx.mapping),
        }
    k = 6 if n_customers >= 60 else min(4, max(2, n_customers // 3))
    features = pd.DataFrame(
        {
            "recency": customers["recency_days"],
            "frequency": np.log1p(customers["frequency"]),
            "monetary": np.log1p(customers["monetary"].clip(lower=0)),
            "average_order_value": np.log1p(customers["average_order_value"].clip(lower=0)),
            "frequency_30d": np.log1p(customers["purchase_frequency_30d"].clip(lower=0)),
            "tenure": np.log1p(customers["tenure_days"]),
        }
    )
    scaler = StandardScaler()
    scaled = scaler.fit_transform(features)
    model = KMeans(n_clusters=k, random_state=42, n_init=12)
    labels = model.fit_predict(scaled)
    customers["cluster"] = labels
    if k > 1 and len(set(labels)) > 1:
        silhouette = float(silhouette_score(scaled, labels))
        dbi = float(davies_bouldin_score(scaled, labels))
    else:
        silhouette = None
        dbi = None

    profiles = customers.groupby("cluster").agg(
        count=("customer_id", "size"),
        avg_recency=("recency_days", "mean"),
        avg_frequency=("frequency", "mean"),
        avg_monetary=("monetary", "mean"),
        avg_order_value=("average_order_value", "mean"),
        avg_tenure=("tenure_days", "mean"),
    )
    scoring_profiles = profiles.rename(
        columns={
            "avg_recency": "recency_days",
            "avg_frequency": "frequency",
            "avg_monetary": "monetary",
            "avg_tenure": "tenure_days",
        }
    )
    mapping = _assign_segment_labels(scoring_profiles, k)
    customers["segment"] = customers["cluster"].map(mapping)
    profiles["segment"] = profiles.index.map(mapping)
    clusters = []
    for cluster_id, row in profiles.iterrows():
        clusters.append(
            {
                "cluster": int(cluster_id),
                "segment": row["segment"],
                "count": int(row["count"]),
                "share_pct": round(row["count"] / n_customers * 100, 1),
                "avg_recency_days": round(float(row["avg_recency"]), 1),
                "avg_frequency": round(float(row["avg_frequency"]), 2),
                "avg_monetary": round(float(row["avg_monetary"]), 2),
                "avg_order_value": round(float(row["avg_order_value"]), 2),
                "avg_tenure_days": round(float(row["avg_tenure"]), 1),
            }
        )
    clusters.sort(key=lambda item: SEGMENT_LABELS.index(item["segment"]) if item["segment"] in SEGMENT_LABELS else 99)
    segment_counts = customers.groupby("segment").size().to_dict()
    top_customers = customers.sort_values("monetary", ascending=False).head(limit)
    customer_payload = _customer_records(top_customers)
    payload = {
        "available": True,
        "reason": None,
        "method": 'K-Means (các đặc trưng RFM, giá trị đơn hàng trung bình, tần suất mua và thời gian gắn bó đã chuẩn hóa)',
        "k": k,
        "metrics": {
            "silhouette_score": round(silhouette, 4) if silhouette is not None else None,
            "davies_bouldin_index": round(dbi, 4) if dbi is not None else None,
            "inertia": round(float(model.inertia_), 2),
            "customers": n_customers,
            "features": [
                'Thời gian từ lần mua gần nhất (ngày)',
                'Tần suất (logarit)',
                'Giá trị chi tiêu (logarit)',
                'Giá trị đơn hàng trung bình (logarit)',
                'Tần suất mua mỗi 30 ngày (logarit)',
                'Thời gian gắn bó (logarit)',
            ],
        },
        "clusters": clusters,
        "segment_distribution": [
            {"segment": segment, "count": int(segment_counts.get(segment, 0))}
            for segment in SEGMENT_LABELS
            if segment_counts.get(segment, 0)
        ],
        "customers": json_safe(customer_payload),
        "chart_data": {
            "scatter": [
                {
                    "customer_id": row["customer_id"],
                    "recency_days": int(row["recency_days"]),
                    "monetary": round(float(row["monetary"]), 2),
                    "frequency": int(row["frequency"]),
                    "segment": row["segment"],
                }
                for _, row in customers.head(400).iterrows()
            ],
            "segment_value": [
                {
                    "segment": cluster["segment"],
                    "count": cluster["count"],
                    "avg_monetary": cluster["avg_monetary"],
                }
                for cluster in clusters
            ],
        },
        "guidance": [],
        "data_context": {"data_through": ctx.date_max, "as_of": ctx.date_max},
    }
    CUSTOMER_CACHE[key] = (time.time(), payload)
    CUSTOMER_FRAMES[key] = customers
    return payload


def _customer_records(customers: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in customers.iterrows():
        rows.append(
            {
                "customer_id": row["customer_id"],
                "segment": row.get("segment"),
                "cluster": int(row.get("cluster", -1)) if pd.notna(row.get("cluster", np.nan)) else None,
                "recency_days": int(row["recency_days"]),
                "frequency": int(row["frequency"]),
                "monetary": round(float(row["monetary"]), 2),
                "average_order_value": round(float(row["average_order_value"]), 2),
                "tenure_days": int(row["tenure_days"]),
                "distinct_products": int(row["distinct_products"]),
                "last_purchase": row["last_purchase"].date().isoformat() if pd.notna(row["last_purchase"]) else None,
            }
        )
    return rows


def _churn_feature_frame(customers: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    features = pd.DataFrame(
        {
            "frequency": customers["frequency"].astype(float),
            "monetary": customers["monetary"].clip(lower=0),
            "average_order_value": customers["average_order_value"].clip(lower=0),
            "tenure_days": customers["tenure_days"].astype(float),
            "purchase_frequency_30d": customers["purchase_frequency_30d"],
            "average_days_between_purchases": customers["average_days_between_purchases"],
            "distinct_products": customers["distinct_products"].astype(float),
            "distinct_categories": customers["distinct_categories"].astype(float),
        }
    )
    columns = list(features.columns)
    features = features.replace([np.inf, -np.inf], np.nan).fillna(0)
    return features, columns


def _risk_band(probability: float) -> str:
    if probability >= 0.65:
        return "High Risk"
    if probability >= 0.35:
        return "Medium Risk"
    return "Low Risk"


def _churn_action(risk: str, segment: str) -> list[str]:
    if risk == "High Risk":
        return [
            'Gửi ưu đãi cá nhân hóa để thu hút khách hàng quay lại, kèm thời hạn rõ ràng.',
            'Phân công nhân viên chăm sóc và thu thập phản hồi của khách hàng.',
            'Gợi ý sản phẩm phù hợp với danh mục và mức giá khách hàng từng ưa thích.',
        ]
    if risk == "Medium Risk":
        return [
            'Triển khai chương trình khách hàng thân thiết hoặc nhắc mua bổ sung.',
            'Gợi ý sản phẩm bổ trợ từ các danh mục khách hàng ưa thích.',
            'Theo dõi thời điểm mua tiếp theo và tránh giảm giá quá mức.',
        ]
    return ['Duy trì chăm sóc thông thường và gợi ý sản phẩm.']


def churn_analysis(ctx: DataContext, inactive_days: int = 90) -> dict:
    ctx.require("customers", "Dự đoán khách hàng rời bỏ")
    key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{ctx.date_max}:{inactive_days}"
    cached = CHURN_CACHE.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    customers, _ = _features(ctx)
    if len(customers) < 40:
        return {
            "available": False,
            "reason": 'Cần ít nhất 40 khách hàng có lịch sử giao dịch để huấn luyện và đánh giá mô hình rời bỏ.',
            "metrics": None,
            "risk_distribution": [],
            "customers": [],
        }
    customers["churn_label"] = (customers["recency_days"] > inactive_days).astype(int)
    if customers["churn_label"].nunique() < 2 or customers["churn_label"].sum() < 6:
        return {
            "available": False,
            "reason": (
                f'Bộ dữ liệu không có đủ khách hàng không hoạt động theo ngưỡng {inactive_days} ngày để huấn luyện mô hình rời bỏ có giám sát.'
            ),
            "metrics": None,
            "risk_distribution": [],
            "customers": [],
        }

    X, feature_names = _churn_feature_frame(customers)
    y = customers["churn_label"].to_numpy()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )
    candidates: list[tuple[str, Any]] = [
        (
            "logistic_regression",
            Pipeline(
                [
                    ("scaler", StandardScaler()),
                    (
                        "model",
                        LogisticRegression(max_iter=2000, class_weight="balanced", random_state=42),
                    ),
                ]
            ),
        ),
        (
            "random_forest",
            RandomForestClassifier(
                n_estimators=240,
                max_depth=7,
                min_samples_leaf=2,
                class_weight="balanced_subsample",
                random_state=42,
                n_jobs=1,
            ),
        ),
    ]
    if XGBClassifier is not None:
        candidates.append(
            (
                "xgboost",
                XGBClassifier(
                    n_estimators=180,
                    max_depth=3,
                    learning_rate=0.05,
                    subsample=0.9,
                    colsample_bytree=0.9,
                    eval_metric="logloss",
                    random_state=42,
                    n_jobs=1,
                ),
            )
        )

    min_class_count = int(min(np.bincount(y_train)))
    cv_folds = 3 if min_class_count >= 3 else 2
    candidate_results = []
    best_name = None
    best_score = -float("inf")
    best_model = None
    for name, estimator in candidates:
        cv_score = None
        try:
            cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
            scores = cross_val_score(estimator, X_train, y_train, cv=cv, scoring="roc_auc", n_jobs=1)
            cv_score = float(np.mean(scores))
        except Exception:
            cv_score = None
        candidate_results.append({"model": name, "validation_roc_auc": round(cv_score, 4) if cv_score is not None else None})
        if cv_score is not None and cv_score > best_score:
            best_score = cv_score
            best_name = name
            best_model = estimator
    if best_model is None:
        best_name, best_model = candidates[0]
    best_model.fit(X_train, y_train)
    probabilities_test = best_model.predict_proba(X_test)[:, 1]
    predictions_test = (probabilities_test >= 0.5).astype(int)
    roc_auc = float(roc_auc_score(y_test, probabilities_test)) if len(set(y_test)) > 1 else None
    tn, fp, fn, tp = confusion_matrix(y_test, predictions_test, labels=[0, 1]).ravel()
    metrics = {
        "model": best_name,
        "accuracy": round(float(accuracy_score(y_test, predictions_test)), 4),
        "precision": round(float(precision_score(y_test, predictions_test, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, predictions_test, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, predictions_test, zero_division=0)), 4),
        "roc_auc": round(roc_auc, 4) if roc_auc is not None else None,
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "test_size": int(len(y_test)),
        "training_size": int(len(y_train)),
        "candidate_selection": candidate_results,
        "label_definition": f'Không hoạt động quá {inactive_days} ngày tính đến ngày kết thúc bộ dữ liệu.',
        "excludes_label_source": True,
    }
    best_model.fit(X, y)
    all_probabilities = best_model.predict_proba(X)[:, 1]
    customers["churn_probability"] = all_probabilities
    customers["churn_risk"] = [_risk_band(float(value)) for value in all_probabilities]
    try:
        segmentation = segment_customers(ctx, limit=500)
        segment_key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{ctx.date_max}:500"
        segment_frame = CUSTOMER_FRAMES.get(segment_key)
        if segmentation.get("available") and segment_frame is not None:
            segment_lookup = segment_frame.set_index("customer_id")["segment"]
            customers["segment"] = customers["customer_id"].map(segment_lookup)
        else:
            customers["segment"] = 'Chưa phân khúc'
    except Exception:
        customers["segment"] = 'Chưa phân khúc'
    customers["segment"] = customers["segment"].fillna('Chưa phân khúc')
    customers["churn_actions"] = [
        _churn_action(risk, segment) for risk, segment in zip(customers["churn_risk"], customers["segment"])
    ]
    risk_counts = customers["churn_risk"].value_counts().to_dict()
    importance = _feature_importance(best_model, feature_names)
    at_risk = customers.sort_values("churn_probability", ascending=False).head(120)
    payload = {
        "available": True,
        "reason": None,
        "metrics": metrics,
        "risk_thresholds": {"high": 0.65, "medium": 0.35},
        "risk_distribution": [
            {"risk": risk, "count": int(risk_counts.get(risk, 0))}
            for risk in ["High Risk", "Medium Risk", "Low Risk"]
        ],
        "feature_importance": importance,
        "customers": json_safe(
            [
                {
                    "customer_id": row["customer_id"],
                    "segment": row.get("segment"),
                    "recency_days": int(row["recency_days"]),
                    "frequency": int(row["frequency"]),
                    "monetary": round(float(row["monetary"]), 2),
                    "churn_probability": round(float(row["churn_probability"]), 4),
                    "churn_risk": row["churn_risk"],
                    "churn_label": int(row["churn_label"]),
                    "actions": row["churn_actions"],
                }
                for _, row in at_risk.iterrows()
            ]
        ),
        "churn_labels_count": {
            "churned": int(customers["churn_label"].sum()),
            "retained": int((1 - customers["churn_label"]).sum()),
        },
        "guidance": [],
        "data_context": {"data_through": ctx.date_max, "inactive_threshold_days": inactive_days},
    }
    CHURN_CACHE[key] = (time.time(), payload)
    CHURN_FRAMES[key] = customers
    return payload


def _feature_importance(model: Any, names: list[str]) -> list[dict]:
    try:
        estimator = model.named_steps["model"] if hasattr(model, "named_steps") else model
        if hasattr(estimator, "feature_importances_"):
            values = np.asarray(estimator.feature_importances_, dtype=float)
        elif hasattr(estimator, "coef_"):
            values = np.abs(np.asarray(estimator.coef_[0], dtype=float))
        else:
            return []
        total = values.sum() or 1.0
        rows = [
            {"feature": name, "importance": round(float(value / total), 4)}
            for name, value in zip(names, values)
        ]
        return sorted(rows, key=lambda row: row["importance"], reverse=True)
    except Exception:
        return []


def customer_directory(
    ctx: DataContext,
    limit: int = 100,
    offset: int = 0,
    segment: str | None = None,
    search: str | None = None,
) -> dict:
    segmentation = segment_customers(ctx, limit=500)
    if not segmentation.get("available"):
        return {"items": [], "total": 0, "segments": [], "churn_available": False, "reason": segmentation.get("reason")}
    segment_key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{ctx.date_max}:500"
    customer_frame = CUSTOMER_FRAMES.get(segment_key)
    if customer_frame is None:
        customers, _ = _features(ctx)
        customers["segment"] = None
        customer_frame = customers
    else:
        customer_frame = customer_frame.copy(deep=False)
    churn = churn_analysis(ctx)
    churn_key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{ctx.date_max}:90"
    churn_frame = CHURN_FRAMES.get(churn_key)
    if churn_frame is not None:
        churn_lookup = churn_frame.set_index("customer_id")[["churn_probability", "churn_risk", "churn_label"]]
        customer_frame = customer_frame.join(churn_lookup, on="customer_id", how="left")
    if segment:
        customer_frame = customer_frame[customer_frame["segment"] == segment]
    if search:
        needle = search.strip().lower()
        customer_frame = customer_frame[
            customer_frame["customer_id"].astype(str).str.lower().str.contains(needle, na=False)
        ]
    total = len(customer_frame)
    window = customer_frame.sort_values("monetary", ascending=False).iloc[offset : offset + limit]
    records = []
    for _, row in window.iterrows():
        records.append(
            {
                "customer_id": row["customer_id"],
                "segment": row.get("segment"),
                "recency_days": int(row["recency_days"]),
                "frequency": int(row["frequency"]),
                "monetary": round(float(row["monetary"]), 2),
                "average_order_value": round(float(row["average_order_value"]), 2),
                "tenure_days": int(row["tenure_days"]),
                "distinct_products": int(row["distinct_products"]),
                "last_purchase": row["last_purchase"].date().isoformat()
                if pd.notna(row["last_purchase"])
                else None,
                "churn_probability": round(float(row["churn_probability"]), 4)
                if "churn_probability" in row and pd.notna(row.get("churn_probability"))
                else None,
                "churn_risk": row.get("churn_risk") if "churn_risk" in row and pd.notna(row.get("churn_risk")) else None,
            }
        )
    return {
        "items": json_safe(records),
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "segments": [cluster["segment"] for cluster in segmentation["clusters"]],
        "churn_available": bool(churn.get("available")),
        "churn_metrics": churn.get("metrics"),
    }


def recommend_products(ctx: DataContext, customer_id: str, top_n: int = 5) -> dict:
    ctx.require("customers", 'Gợi ý sản phẩm phù hợp với khách hàng')
    ctx.require("products", 'Gợi ý sản phẩm phù hợp với khách hàng')
    customers, frame = _features(ctx)
    target = customers[customers["customer_id"].astype(str) == str(customer_id)]
    if target.empty:
        raise ApiError('Không tìm thấy khách hàng trong bộ dữ liệu này.', 404, "customer_not_found")
    customer = target.iloc[0]
    segmentation = segment_customers(ctx, limit=500)
    segment_name = None
    if segmentation.get("available"):
        segment_key = f"{ctx.dataset.id}:{ctx.dataset.updated_at}:{ctx.date_max}:500"
        segment_frame = CUSTOMER_FRAMES.get(segment_key)
        if segment_frame is not None:
            match = segment_frame[segment_frame["customer_id"].astype(str) == str(customer_id)]
            if not match.empty:
                segment_name = match.iloc[0].get("segment")

    target_frame = frame[frame["_customer_id"].astype(str) == str(customer_id)].copy()
    max_date = frame["_order_date"].max().normalize()
    recent = frame[frame["_order_date"] >= max_date - pd.Timedelta(days=89)]

    category_spend = target_frame.groupby("_category")["_revenue"].sum().clip(lower=0)
    category_total = float(category_spend.sum()) or 1.0
    category_affinity = (category_spend / category_total).to_dict()
    purchased_products = set(target_frame["_product"].dropna().unique())
    average_price = float(target_frame["_unit_price"].median()) if target_frame["_unit_price"].notna().any() else None

    product_stats = (
        recent.groupby("_product")
        .agg(
            category=("_category", "last"),
            median_price=("_unit_price", "median"),
            units=("_quantity", "sum"),
            revenue=("_revenue", "sum"),
        )
        .reset_index()
        .rename(columns={"_product": "product"})
    )
    if product_stats.empty:
        raise ApiError('Không có dữ liệu bán hàng gần đây để gợi ý sản phẩm.', 422, "empty_analysis")
    product_stats["popularity"] = product_stats["revenue"].rank(pct=True).fillna(0)

    binary = (
        frame[["_customer_id", "_product"]]
        .dropna()
        .drop_duplicates()
        .assign(value=1)
        .pivot(index="_customer_id", columns="_product", values="value")
        .fillna(0)
    )
    cooccurrence = pd.Series(0.0, index=binary.columns)
    target_items = [product for product in purchased_products if product in binary.columns]
    if target_items and not binary.empty:
        mask = binary[target_items].sum(axis=1) > 0
        peer_rows = binary.loc[mask]
        if len(peer_rows) > 0:
            cooccurrence = peer_rows.sum(axis=0) / max(1, len(peer_rows))
    cooccurrence = cooccurrence.reindex(product_stats["product"]).fillna(0)
    if cooccurrence.max() > 0:
        cooccurrence = cooccurrence / cooccurrence.max()

    def price_fit(row: pd.Series) -> float:
        if average_price is None or pd.isna(row["median_price"]) or row["median_price"] <= 0:
            return 0.5
        ratio = math.log(max(float(row["median_price"]), 1.0) / max(average_price, 1.0))
        return float(math.exp(-abs(ratio)))

    candidates = []
    for _, row in product_stats.iterrows():
        already_purchased = row["product"] in purchased_products
        affinity = float(category_affinity.get(row["category"], 0.0))
        co_score = float(cooccurrence.get(row["product"], 0.0))
        popularity = float(row["popularity"])
        fit = price_fit(row)
        if target_items:
            score = 0.40 * affinity + 0.28 * co_score + 0.20 * popularity + 0.12 * fit
        else:
            score = 0.50 * popularity + 0.25 * affinity + 0.25 * fit
        reasons = []
        if affinity > 0:
            reasons.append(f"Danh mục {row['category']} chiếm {affinity * 100:.0f}% chi tiêu theo danh mục của khách hàng này.")
        if co_score > 0.15:
            reasons.append('Thường được mua bởi những khách hàng có cơ cấu sản phẩm tương tự.')
        reasons.append(f'Phân vị nhu cầu gần đây của sản phẩm này là {popularity * 100:.0f}%.')
        if fit > 0.8 and average_price:
            reasons.append('Mức giá gần với khoảng chi tiêu mua hàng thông thường của khách hàng.')
        candidates.append(
            {
                "product": row["product"],
                "category": row["category"],
                "median_price": round(float(row["median_price"]), 2) if pd.notna(row["median_price"]) else None,
                "match_score": round(score * 100, 1),
                "already_purchased": already_purchased,
                "reasons": reasons,
                "components": {
                    "category_affinity": round(affinity, 3),
                    "co_purchase_affinity": round(co_score, 3),
                    "recent_popularity": round(popularity, 3),
                    "price_fit": round(fit, 3),
                },
            }
        )
    fresh_candidates = [row for row in candidates if not row["already_purchased"]]
    if fresh_candidates:
        candidates = fresh_candidates
    candidates = sorted(candidates, key=lambda row: row["match_score"], reverse=True)
    recommendations = candidates[:top_n]
    return {
        "customer": {
            "customer_id": customer["customer_id"],
            "segment": segment_name,
            "frequency": int(customer["frequency"]),
            "monetary": round(float(customer["monetary"]), 2),
            "recency_days": int(customer["recency_days"]),
            "average_order_value": round(float(customer["average_order_value"]), 2),
            "purchased_products": len(purchased_products),
        },
        "recommendations": recommendations,
        "method": 'Chấm điểm kết hợp nội dung, hành vi mua cùng và mức độ phổ biến',
        "score_note": 'Điểm phù hợp là điểm gợi ý tương đối, không phải xác suất đã được hiệu chỉnh.',
        "data_context": {"data_through": ctx.date_max},
    }
