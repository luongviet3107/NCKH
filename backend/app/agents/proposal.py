from __future__ import annotations

from app.services.data_service import DataContext
from app.services.mapping import missing_data_guidance

TASK_CATALOG = {
    "product_forecast": {
        "label": 'Dự báo Nhu cầu Sản phẩm',
        "description": 'Dự báo nhu cầu 7/30/90 ngày, xếp hạng sản phẩm bán chạy tương lai và giải thích yếu tố tăng trưởng.',
        "capability": "products",
        "reason": 'Đã có các trường sản phẩm, ngày và số lượng.',
    },
    "inventory": {
        "label": 'Tối ưu tồn kho',
        "description": 'Phân loại trạng thái tồn kho, dự báo độ phủ, tính EOQ/điểm đặt hàng lại và đưa ra khuyến nghị.',
        "capability": "inventory",
        "reason": 'Đã có tồn kho hiện tại và mã sản phẩm.',
    },
    "customers": {
        "label": 'Phân tích khách hàng',
        "description": 'Chạy phân khúc K-Means và dự đoán rời bỏ có giám sát với hành động dựa trên bằng chứng.',
        "capability": "customers",
        "reason": 'Đã có mã khách hàng, ngày giao dịch và giá trị tiền.',
    },
    "revenue": {
        "label": 'Chẩn đoán & Dự báo Doanh thu',
        "description": 'Phân tích yếu tố thúc đẩy doanh thu, biên lợi nhuận (khi có thể), tăng trưởng kỳ và dự báo doanh thu tương lai.',
        "capability": "revenue",
        "reason": 'Doanh thu có thể đo từ ngày và giá trị.',
    },
}


def build_proposal(ctx: DataContext, objective: str) -> dict:
    profile = ctx.dataset.quality_report or {}
    capabilities = ctx.capabilities
    tasks = []
    for key, meta in TASK_CATALOG.items():
        available = bool(capabilities.get(meta["capability"]))
        tasks.append(
            {
                "id": key,
                "label": meta["label"],
                "description": meta["description"],
                "reason": meta["reason"] if available else 'Bộ dữ liệu này không có các trường bắt buộc.',
                "available": available,
                "selected": available,
            }
        )
    issues = []
    if profile.get("duplicate_rows", 0):
        issues.append(f"Phát hiện {profile['duplicate_rows']} dòng trùng lặp trước khi làm sạch.")
    if profile.get("missing_pct", 0) > 0:
        issues.append(f"Bộ dữ liệu hiện tại thiếu {profile.get('missing_pct')}% số ô.")
    if profile.get("invalid_dates", 0):
        issues.append(f"Có {profile.get('invalid_dates')} dòng chứa ngày đặt hàng không hợp lệ.")
    if profile.get("numeric_outliers"):
        issues.append(f"Có {len(profile['numeric_outliers'])} cột số chứa giá trị ngoại lệ thống kê (phương pháp IQR).")
    if not issues:
        issues.append('Không phát hiện vấn đề lớn về cấu trúc hoặc chất lượng của bộ dữ liệu hiện tại.')

    return {
        "objective": objective,
        "dataset": {
            "id": ctx.dataset.id,
            "name": ctx.dataset.name,
            "rows": len(ctx.frame),
            "quality_score": profile.get("quality_score"),
            "date_range": {"start": ctx.date_min, "end": ctx.date_max},
            "is_demo": ctx.dataset.is_demo,
        },
        "data_quality_findings": issues,
        "capabilities": ctx.capabilities,
        "missing_fields": missing_data_guidance(ctx.mapping),
        "proposed_tasks": tasks,
        "human_checkpoint": (
            'Phê duyệt các nhiệm vụ trên để bắt đầu phân tích đa tác nhân. Dữ liệu nguồn và hồ sơ kinh doanh được giữ nguyên.'
        ),
    }
