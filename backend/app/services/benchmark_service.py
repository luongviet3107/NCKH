from __future__ import annotations

import math
import time
import uuid
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    davies_bouldin_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    silhouette_score,
)
from sklearn.model_selection import TimeSeriesSplit, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.localization import label as vi_label
from app.core.utils import json_safe
from app.forecasting.engine import (
    ALL_MODELS,
    MODEL_LABELS,
    compute_metrics,
    daily_aggregate,
    forecast_values,
    weekly_aggregate,
)
from app.models import BenchmarkRun
from app.services.customer_service import _churn_feature_frame, _features
from app.services.data_service import DataContext

try:
    from xgboost import XGBClassifier
except Exception:  # pragma: no cover
    XGBClassifier = None


def _test_size(n: int, ratio: float) -> int:
    return max(4, min(int(round(n * ratio)), n - 12))


def _fit_and_forecast(model_key: str, train: np.ndarray, horizon: int) -> tuple[np.ndarray, float]:
    started = time.perf_counter()
    predictions = forecast_values(model_key, train, horizon)
    predictions = np.clip(predictions, 0, None)
    runtime = time.perf_counter() - started
    return np.asarray(predictions, dtype=float), runtime


def _validation_scores(train: np.ndarray, candidates: list[str]) -> list[dict]:
    n = len(train)
    n_splits = 2 if n >= 20 else 1
    results = []
    for model_key in candidates:
        fold_metrics = []
        folds_info = []
        try:
            if n_splits == 2:
                splitter = TimeSeriesSplit(n_splits=n_splits)
                for train_indices, test_indices in splitter.split(train):
                    history = train[train_indices]
                    validation_horizon = len(test_indices)
                    preds, _ = _fit_and_forecast(model_key, history, validation_horizon)
                    actual = train[test_indices]
                    metrics = compute_metrics(actual, preds)
                    fold_metrics.append(metrics)
                    folds_info.append(
                        {
                            "train_end": int(train_indices[-1]),
                            "validation_start": int(test_indices[0]),
                            "metrics": metrics,
                        }
                    )
            else:
                split = max(2, n // 4)
                history = train[:-split]
                preds, _ = _fit_and_forecast(model_key, history, split)
                metrics = compute_metrics(train[-split:], preds)
                fold_metrics.append(metrics)
                folds_info.append({"train_end": int(len(history) - 1), "validation_start": int(len(history)), "metrics": metrics})
            valid = [row for row in fold_metrics if row.get("mae") is not None]
            mean_mae = float(np.mean([row["mae"] for row in valid])) if valid else None
            mean_rmse = float(np.mean([row["rmse"] for row in valid])) if valid else None
            results.append(
                {
                    "model": model_key,
                    "label": MODEL_LABELS.get(model_key, model_key),
                    "validation_mae": round(mean_mae, 4) if mean_mae is not None else None,
                    "validation_rmse": round(mean_rmse, 4) if mean_rmse is not None else None,
                    "folds": folds_info,
                    "status": "ok",
                }
            )
        except Exception as exc:
            results.append(
                {
                    "model": model_key,
                    "label": MODEL_LABELS.get(model_key, model_key),
                    "validation_mae": None,
                    "validation_rmse": None,
                    "folds": [],
                    "status": "failed",
                    "reason": str(exc)[:180],
                }
            )
    return results


def _forecast_benchmark(
    ctx: DataContext,
    task: str,
    human_model: str,
    test_ratio: float,
    db: Session,
) -> dict:
    if task == "revenue_forecast":
        ctx.require("revenue", 'Đánh giá mô hình doanh thu')
        series = daily_aggregate(ctx.frame, value_col="_revenue")
        target_label = 'Doanh thu hàng tuần'
        unit = "currency"
    else:
        ctx.require("products", 'Đánh giá mô hình nhu cầu')
        series = daily_aggregate(ctx.frame, value_col="_quantity")
        target_label = 'Số đơn vị bán hàng tuần'
        unit = "units"
    weekly = weekly_aggregate(series)
    if len(weekly) < 16:
        raise ApiError('Cần ít nhất 16 quan sát hàng tuần để so sánh công bằng các mô hình chuỗi thời gian.', 422, "insufficient_history")
    test_observations = _test_size(len(weekly), test_ratio)
    if test_observations < 4:
        raise ApiError('Không đủ quan sát để tạo tập kiểm thử.', 422, "insufficient_history")
    train = weekly.iloc[:-test_observations].to_numpy(dtype=float)
    test = weekly.iloc[-test_observations:].to_numpy(dtype=float)
    test_dates = weekly.index[-test_observations:]
    available_models = [model for model in ALL_MODELS if model != "xgboost" or XGBClassifier is not None]
    if human_model not in available_models:
        raise ApiError(
            f"Mô hình do người dùng chọn '{human_model}' không được hỗ trợ. Các mô hình khả dụng: {', '.join(available_models)}.",
            422,
            "unsupported_model",
        )

    validation = _validation_scores(train, available_models)
    valid = [
        row
        for row in validation
        if row["status"] == "ok" and row["validation_mae"] is not None
    ]
    if not valid:
        raise ApiError('Không có mô hình ứng viên nào hoàn tất kiểm định.', 422, "model_validation_failed")
    ai_choice = min(valid, key=lambda row: row["validation_mae"])
    ai_model = ai_choice["model"]

    human_pred, human_runtime = _fit_and_forecast(human_model, train, test_observations)
    ai_pred, ai_runtime = _fit_and_forecast(ai_model, train, test_observations)
    human_metrics = compute_metrics(test, human_pred)
    ai_metrics = compute_metrics(test, ai_pred)
    comparison = [
        {"criterion": "Algorithm", "human": MODEL_LABELS.get(human_model, human_model), "ai": MODEL_LABELS.get(ai_model, ai_model)},
        {"criterion": "MAE", "human": human_metrics["mae"], "ai": ai_metrics["mae"], "better": "lower"},
        {"criterion": "RMSE", "human": human_metrics["rmse"], "ai": ai_metrics["rmse"], "better": "lower"},
        {"criterion": "MAPE", "human": human_metrics["mape"], "ai": ai_metrics["mape"], "better": "lower"},
        {"criterion": "R²", "human": human_metrics["r2"], "ai": ai_metrics["r2"], "better": "higher"},
        {"criterion": 'Thời gian chạy (giây)', "human": round(human_runtime, 4), "ai": round(ai_runtime, 4), "better": "lower"},
    ]
    duration = human_runtime + ai_runtime
    result = {
        "task": task,
        "task_label": 'Dự báo doanh thu' if task == "revenue_forecast" else 'Dự báo nhu cầu',
        "target": target_label,
        "unit": unit,
        "frequency": 'Tuần',
        "human_model": human_model,
        "ai_model": ai_model,
        "ai_validation_metrics": {
            "validation_mae": ai_choice["validation_mae"],
            "validation_rmse": ai_choice["validation_rmse"],
            "method": 'Kiểm định TimeSeriesSplit với cửa sổ mở rộng trên tập huấn luyện',
        },
        "human": {
            "model": human_model,
            "label": MODEL_LABELS.get(human_model, human_model),
            "metrics": human_metrics,
            "runtime_seconds": round(human_runtime, 4),
        },
        "ai": {
            "model": ai_model,
            "label": MODEL_LABELS.get(ai_model, ai_model),
            "metrics": ai_metrics,
            "runtime_seconds": round(ai_runtime, 4),
        },
        "comparison_table": comparison,
        "candidates": validation,
        "split": {
            "method": 'Kiểm thử độc lập theo thời gian kết hợp kiểm định TimeSeriesSplit',
            "train_observations": int(len(train)),
            "test_observations": int(test_observations),
            "train_start": weekly.index[0].date().isoformat(),
            "train_end": weekly.index[-test_observations - 1].date().isoformat(),
            "test_start": test_dates[0].date().isoformat(),
            "test_end": test_dates[-1].date().isoformat(),
            "test_ratio": test_ratio,
        },
        "chart_data": [
            {
                "week_ending": date.date().isoformat(),
                "actual": round(float(actual), 2),
                "human_prediction": round(float(human_pred[index]), 2),
                "ai_prediction": round(float(ai_pred[index]), 2),
            }
            for index, (date, actual) in enumerate(zip(test_dates, test))
        ],
        "duration_seconds": round(duration, 4),
        "metric_notes": [
            'Hai mô hình sử dụng cùng các dòng huấn luyện, bước tiền xử lý và tập kiểm thử cuối cùng theo thời gian chưa từng dùng để chọn mô hình.',
            'AI chỉ chọn mô hình bằng kiểm định cửa sổ mở rộng trên tập huấn luyện; tập kiểm thử không được dùng để chọn mô hình.',
            'MAPE loại các giá trị thực tế bằng không khỏi mẫu số nên chỉ được báo cáo khi có giá trị khác không.',
        ],
    }
    return result


def _classification_metrics(y_true, probabilities, threshold: float = 0.5) -> dict:
    predictions = (probabilities >= threshold).astype(int)
    auc = float(roc_auc_score(y_true, probabilities)) if len(set(y_true)) > 1 else None
    return {
        "accuracy": round(float(accuracy_score(y_true, predictions)), 4),
        "precision": round(float(precision_score(y_true, predictions, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, predictions, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, predictions, zero_division=0)), 4),
        "roc_auc": round(auc, 4) if auc is not None else None,
    }


def _churn_supervised_benchmark(ctx: DataContext, human_model: str, test_ratio: float, db: Session) -> dict:
    ctx.require("customers", 'Đánh giá mô hình rời bỏ')
    customers, _ = _features(ctx)
    if len(customers) < 60:
        raise ApiError('Cần ít nhất 60 khách hàng để đánh giá mô hình rời bỏ.', 422, "insufficient_history")
    inactive_days = 90
    customers["churn_label"] = (customers["recency_days"] > inactive_days).astype(int)
    if customers["churn_label"].nunique() < 2 or customers["churn_label"].sum() < 8:
        raise ApiError(
            'Bộ dữ liệu không có đủ khách hàng rời bỏ theo ngưỡng 90 ngày.',
            422,
            "insufficient_classes",
        )
    X, feature_names = _churn_feature_frame(customers)
    y = customers["churn_label"].to_numpy()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_ratio, random_state=42, stratify=y
    )

    factories = {
        "logistic_regression": lambda: Pipeline(
            [
                ("scaler", StandardScaler()),
                ("model", LogisticRegression(max_iter=2000, class_weight="balanced", random_state=42)),
            ]
        ),
        "random_forest": lambda: RandomForestClassifier(
            n_estimators=260,
            max_depth=7,
            min_samples_leaf=2,
            class_weight="balanced_subsample",
            random_state=42,
            n_jobs=1,
        ),
    }
    if XGBClassifier is not None:
        factories["xgboost"] = lambda: XGBClassifier(
            n_estimators=200,
            max_depth=3,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            eval_metric="logloss",
            random_state=42,
            n_jobs=1,
        )
    if human_model not in factories:
        raise ApiError(
            f"Bộ phân loại do người dùng chọn '{human_model}' không được hỗ trợ. Các bộ phân loại khả dụng: {', '.join(factories)}.",
            422,
            "unsupported_model",
        )
    candidate_validation = []
    ai_model = "logistic_regression"
    best_cv = -float("inf")
    min_class = int(np.bincount(y_train).min())
    folds = max(2, min(4, min_class))
    for name in factories:
        try:
            cv = cross_val_score(
                factories[name](),
                X_train,
                y_train,
                cv=StratifiedKFoldCompat(folds),
                scoring="roc_auc",
                n_jobs=1,
            )
            mean_score = float(np.mean(cv))
            candidate_validation.append(
                {"model": name, "validation_roc_auc": round(mean_score, 4), "folds": folds}
            )
            if mean_score > best_cv:
                best_cv = mean_score
                ai_model = name
        except Exception as exc:
            candidate_validation.append(
                {"model": name, "validation_roc_auc": None, "reason": str(exc)[:160]}
            )

    def fit_eval(name: str):
        estimator = factories[name]()
        started = time.perf_counter()
        estimator.fit(X_train, y_train)
        runtime = time.perf_counter() - started
        probabilities = estimator.predict_proba(X_test)[:, 1]
        return probabilities, runtime, estimator

    human_prob, human_runtime, human_estimator = fit_eval(human_model)
    ai_prob, ai_runtime, ai_estimator = fit_eval(ai_model)
    human_metrics = _classification_metrics(y_test, human_prob)
    ai_metrics = _classification_metrics(y_test, ai_prob)
    comparison = [
        {"criterion": "Thuật toán", "human": vi_label(human_model), "ai": vi_label(ai_model)},
        {"criterion": 'Độ chính xác', "human": human_metrics["accuracy"], "ai": ai_metrics["accuracy"], "better": "higher"},
        {"criterion": 'Độ chính xác dương', "human": human_metrics["precision"], "ai": ai_metrics["precision"], "better": "higher"},
        {"criterion": 'Độ phủ dương', "human": human_metrics["recall"], "ai": ai_metrics["recall"], "better": "higher"},
        {"criterion": "F1-score", "human": human_metrics["f1"], "ai": ai_metrics["f1"], "better": "higher"},
        {"criterion": "ROC-AUC", "human": human_metrics["roc_auc"], "ai": ai_metrics["roc_auc"], "better": "higher"},
        {"criterion": 'Thời gian chạy (giây)', "human": round(human_runtime, 4), "ai": round(ai_runtime, 4), "better": "lower"},
    ]
    fpr_h, tpr_h, _ = roc_curve(y_test, human_prob)
    fpr_a, tpr_a, _ = roc_curve(y_test, ai_prob)
    sample_size = 40
    def roc_points(fpr, tpr):
        indices = np.linspace(0, len(fpr) - 1, num=min(sample_size, len(fpr)), dtype=int)
        return [{"fpr": round(float(fpr[i]), 4), "tpr": round(float(tpr[i]), 4)} for i in indices]

    return {
        "task": "churn_classification",
        "task_label": 'Phân loại rời bỏ khách hàng',
        "target": 'Không hoạt động quá 90 ngày',
        "human_model": human_model,
        "ai_model": ai_model,
        "human": {
            "model": human_model,
            "label": vi_label(human_model.replace("_", " ").title()),
            "metrics": human_metrics,
            "runtime_seconds": round(human_runtime, 4),
        },
        "ai": {
            "model": ai_model,
            "label": vi_label(ai_model.replace("_", " ").title()),
            "metrics": ai_metrics,
            "runtime_seconds": round(ai_runtime, 4),
            "validation_roc_auc": round(best_cv, 4),
        },
        "comparison_table": comparison,
        "candidates": candidate_validation,
        "split": {
            "method": 'Tập kiểm thử độc lập được phân tầng',
            "test_ratio": test_ratio,
            "train_observations": int(len(y_train)),
            "test_observations": int(len(y_test)),
            "churn_label_rate_test": round(float(y_test.mean()), 4),
        },
        "chart_data": {
            "roc_human": roc_points(fpr_h, tpr_h),
            "roc_ai": roc_points(fpr_a, tpr_a),
            "metric_comparison": [
                {"metric": 'Độ chính xác', "human": human_metrics["accuracy"], "ai": ai_metrics["accuracy"]},
                {"metric": 'Độ chính xác dương', "human": human_metrics["precision"], "ai": ai_metrics["precision"]},
                {"metric": 'Độ phủ dương', "human": human_metrics["recall"], "ai": ai_metrics["recall"]},
                {"metric": "F1", "human": human_metrics["f1"], "ai": ai_metrics["f1"]},
                {"metric": "ROC-AUC", "human": human_metrics["roc_auc"], "ai": ai_metrics["roc_auc"]},
            ],
        },
        "duration_seconds": round(human_runtime + ai_runtime, 4),
        "metric_notes": [
            'Nhãn rời bỏ được xác định theo thời gian không hoạt động, vì vậy đặc trưng thời gian kể từ lần mua gần nhất được loại khỏi mô hình để tránh rò rỉ nhãn.',
            'Hai bộ phân loại sử dụng cùng tập kiểm thử phân tầng và quy trình tiền xử lý.',
            'AI chỉ chọn mô hình bằng ROC-AUC kiểm định chéo trên tập huấn luyện.',
            'Nhãn rời bỏ là chỉ báo hành vi, chưa phải xác nhận khách hàng đã ngừng sử dụng dịch vụ.',
        ],
    }


def StratifiedKFoldCompat(folds: int):
    from sklearn.model_selection import StratifiedKFold

    return StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)


def _clustering_benchmark(ctx: DataContext, human_model: str, test_ratio: float, db: Session) -> dict:
    ctx.require("customers", 'Đánh giá mô hình phân cụm')
    customers, _ = _features(ctx)
    if len(customers) < 20:
        raise ApiError('Cần ít nhất 20 khách hàng để đánh giá phân cụm.', 422, "insufficient_history")
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
    scaled = StandardScaler().fit_transform(features)
    human_k = 4
    if human_model.startswith("kmeans_"):
        try:
            human_k = int(human_model.split("_", 1)[1])
        except ValueError:
            human_k = 4
    if human_k < 2 or human_k >= len(customers):
        raise ApiError('Số cụm do người dùng chọn không phù hợp với số lượng khách hàng hiện tại.', 422, "invalid_k")
    human_start = time.perf_counter()
    human_model_obj = KMeans(n_clusters=human_k, random_state=42, n_init=12).fit(scaled)
    human_runtime = time.perf_counter() - human_start
    human_labels = human_model_obj.labels_
    human_silhouette = float(silhouette_score(scaled, human_labels))
    human_dbi = float(davies_bouldin_score(scaled, human_labels))

    candidate_validation = []
    best_k = 2
    best_score = -float("inf")
    best_obj = None
    best_labels = None
    best_runtime = 0.0
    for k in range(2, min(7, len(customers))):
        started = time.perf_counter()
        model = KMeans(n_clusters=k, random_state=42, n_init=12).fit(scaled)
        runtime = time.perf_counter() - started
        try:
            score = float(silhouette_score(scaled, model.labels_))
        except Exception:
            continue
        candidate_validation.append(
            {"model": f"kmeans_{k}", "label": f"K-Means (k={k})", "silhouette_score": round(score, 4)}
        )
        if score > best_score:
            best_score = score
            best_k = k
            best_obj = model
            best_labels = model.labels_
            best_runtime = runtime
    ai_silhouette = float(best_score)
    ai_dbi = float(davies_bouldin_score(scaled, best_labels))
    comparison = [
        {"criterion": "Algorithm", "human": f"K-Means (k={human_k})", "ai": f"K-Means (k={best_k})"},
        {"criterion": 'Điểm silhouette', "human": round(human_silhouette, 4), "ai": round(ai_silhouette, 4), "better": "higher"},
        {"criterion": 'Chỉ số Davies-Bouldin', "human": round(human_dbi, 4), "ai": round(ai_dbi, 4), "better": "lower"},
        {"criterion": "Inertia", "human": round(float(human_model_obj.inertia_), 2), "ai": round(float(best_obj.inertia_), 2), "better": "lower"},
        {"criterion": 'Thời gian chạy (giây)', "human": round(human_runtime, 4), "ai": round(best_runtime, 4), "better": "lower"},
    ]
    return {
        "task": "customer_clustering",
        "task_label": 'Phân cụm khách hàng',
        "target": 'Các đặc trưng RFM, giá trị đơn hàng trung bình, tần suất và thời gian gắn bó',
        "human_model": f"kmeans_{human_k}",
        "ai_model": f"kmeans_{best_k}",
        "human": {
            "model": f"kmeans_{human_k}",
            "label": f"K-Means (k={human_k})",
            "metrics": {
                "silhouette_score": round(human_silhouette, 4),
                "davies_bouldin_index": round(human_dbi, 4),
                "inertia": round(float(human_model_obj.inertia_), 2),
            },
            "runtime_seconds": round(human_runtime, 4),
        },
        "ai": {
            "model": f"kmeans_{best_k}",
            "label": f"K-Means (k={best_k})",
            "metrics": {
                "silhouette_score": round(ai_silhouette, 4),
                "davies_bouldin_index": round(ai_dbi, 4),
                "inertia": round(float(best_obj.inertia_), 2),
            },
            "runtime_seconds": round(best_runtime, 4),
        },
        "comparison_table": comparison,
        "candidates": candidate_validation,
        "split": {
            "method": 'Đánh giá không giám sát trên toàn bộ khách hàng bằng ma trận đặc trưng chuẩn hóa cố định',
            "human_k": human_k,
            "ai_k": best_k,
            "observations": int(len(customers)),
        },
        "chart_data": {
            "metric_comparison": [
                {"metric": "Silhouette", "human": round(human_silhouette, 4), "ai": round(ai_silhouette, 4)},
                {"metric": "Davies-Bouldin", "human": round(human_dbi, 4), "ai": round(ai_dbi, 4)},
            ],
            "k_scores": candidate_validation,
        },
        "duration_seconds": round(human_runtime + best_runtime, 4),
        "metric_notes": [
            'Cả hai phương án sử dụng cùng ma trận đặc trưng chuẩn hóa.',
            'AI chọn số cụm k có điểm silhouette cao nhất trong khoảng từ 2 đến 6.',
            'Silhouette và Davies-Bouldin là các chỉ số đánh giá không giám sát, không phải kết quả kinh doanh.',
        ],
    }


def run_benchmark(
    ctx: DataContext,
    task: str,
    human_model: str,
    test_ratio: float,
    db: Session,
) -> dict:
    if task in {"revenue_forecast", "demand_forecast"}:
        result = _forecast_benchmark(ctx, task, human_model, test_ratio, db)
    elif task == "churn_classification":
        result = _churn_supervised_benchmark(ctx, human_model, test_ratio, db)
    elif task == "customer_clustering":
        result = _clustering_benchmark(ctx, human_model, test_ratio, db)
    else:
        raise ApiError('Nhiệm vụ đánh giá không được hỗ trợ.', 422, "unsupported_task")
    result = json_safe(result)
    run = BenchmarkRun(
        id=str(uuid.uuid4()),
        dataset_id=ctx.dataset.id,
        task=task,
        human_model=result["human_model"],
        ai_model=result.get("ai_model"),
        results=result,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    result["benchmark_id"] = run.id
    result["created_at"] = run.created_at.isoformat()
    return result
