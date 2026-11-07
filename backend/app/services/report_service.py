from __future__ import annotations

import re
import uuid
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

import pandas as pd
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app.config import REPORTS_DIR
from app.core.errors import ApiError
from app.core.localization import label as vi_label, payload as vi_payload, text as vi_text
from app.core.utils import json_safe
from app.models import BenchmarkRun, Report
from app.services.customer_service import churn_analysis, segment_customers
from app.services.data_service import DataContext
from app.services.inventory_service import inventory_analysis
from app.services.mapping import field_mapping_view
from app.services.product_service import forecast_products
from app.services.revenue_service import revenue_analysis, revenue_forecast


def _fmt_number(value: Any, decimals: int = 0) -> str:
    if value is None:
        return "Không có dữ liệu"
    try:
        formatted = f"{float(value):,.{decimals}f}"
        return formatted.translate(str.maketrans({",": ".", ".": ","}))
    except (TypeError, ValueError):
        return str(value)


def build_report(ctx: DataContext, title: str | None, include_forecast: bool, db: Session) -> Report:
    dataset = ctx.dataset
    generated_at = datetime.now(timezone.utc)
    revenue = revenue_analysis(ctx, granularity="month")
    forecast = revenue_forecast(ctx, 90) if include_forecast else None
    products = forecast_products(ctx, limit=30)
    inventory = inventory_analysis(ctx, limit=100)
    segmentation = segment_customers(ctx, limit=25)
    churn = churn_analysis(ctx, 90)
    latest_benchmark = (
        db.query(BenchmarkRun)
        .filter(BenchmarkRun.dataset_id == dataset.id)
        .order_by(BenchmarkRun.created_at.desc())
        .first()
    )

    product_rows = products.get("products", [])[:10]
    inventory_recommendations = inventory.get("recommendations", [])[:5] if inventory.get("available") else []
    recommendations = _build_report_recommendations(
        revenue, products, inventory, churn, segmentation
    )
    revenue_section = {
        "available": True,
        "period": revenue["period"],
        "kpis": revenue["kpis"],
        "top_categories": revenue["categories"][:5],
        "top_products": revenue["products"][:10],
        "insights": revenue["insights"],
        "forecast_summary": forecast["summary"] if forecast else None,
        "forecast_validation": forecast["validation"] if forecast else None,
    }
    product_section = {
        "available": True,
        "summary": products["summary"],
        "top_products": product_rows,
        "chart_data": products["chart_data"],
        "notes": products["notes"],
    }
    inventory_section = {
        "available": inventory.get("available", False),
        "reason": inventory.get("reason"),
        "summary": inventory.get("summary"),
        "assumptions": inventory.get("assumptions"),
        "recommendations": inventory_recommendations,
        "top_items": inventory.get("items", [])[:20],
    }
    customer_section = {
        "segmentation_available": segmentation.get("available", False),
        "segmentation_reason": segmentation.get("reason"),
        "segmentation_metrics": segmentation.get("metrics"),
        "clusters": segmentation.get("clusters", []),
        "segment_distribution": segmentation.get("segment_distribution", []),
        "churn_available": churn.get("available", False),
        "churn_reason": churn.get("reason"),
        "churn_metrics": churn.get("metrics"),
        "risk_distribution": churn.get("risk_distribution", []),
        "top_risk_customers": churn.get("customers", [])[:10],
    }
    if latest_benchmark:
        model_evaluation = {
            "status": "benchmark_available",
            "benchmark_id": latest_benchmark.id,
            "task": latest_benchmark.task,
            "created_at": latest_benchmark.created_at.isoformat(),
            "results": latest_benchmark.results,
        }
    else:
        model_evaluation = {
            "status": "forecast_validation_only",
            "benchmark_id": None,
            "message": 'Chưa có kết quả so sánh mô hình được lưu cho bộ dữ liệu này. Các chỉ số kiểm định thực tế theo thời gian của mô hình dự báo đang dùng được trình bày bên dưới.',
            "deployed_forecast_model": forecast["summary"] if forecast else None,
            "product_forecast_examples": [
                {
                    "product": row["product"],
                    "model": row["model"],
                    "metrics": row["metrics"],
                }
                for row in product_rows
                if row.get("metrics")
            ][:5],
            "note": 'Mở trang Đánh giá mô hình để so sánh trực tiếp mô hình do người dùng chọn với mô hình AI chọn.',
        }
    conclusion = _build_conclusion(revenue, inventory, churn, products, recommendations)
    overview = {
        "name": dataset.name,
        "filename": dataset.original_filename,
        "is_demo": dataset.is_demo,
        "rows": len(ctx.frame),
        "columns": int(ctx.frame.shape[1]),
        "date_range": {"start": ctx.date_min, "end": ctx.date_max},
        "quality_score": (dataset.quality_report or {}).get("quality_score"),
        "quality_report": {
            "missing_pct": (dataset.quality_report or {}).get("missing_pct"),
            "duplicate_rows": (dataset.quality_report or {}).get("duplicate_rows"),
            "invalid_dates": (dataset.quality_report or {}).get("invalid_dates"),
            "numeric_outliers": (dataset.quality_report or {}).get("numeric_outliers"),
        },
        "column_mapping": field_mapping_view(ctx.mapping),
        "capabilities": ctx.capabilities,
        "revenue_derived": ctx.revenue_derived,
        "data_source_label": 'DỮ LIỆU MẪU — bộ dữ liệu minh họa được gắn nhãn rõ ràng' if dataset.is_demo else 'Bộ dữ liệu do người dùng tải lên',
    }
    summary = (
        f"Báo cáo AutoDS cho {dataset.name}: {len(ctx.frame):,} dòng, doanh thu {_fmt_number(revenue['kpis']['total_revenue'])}, {len(recommendations)} khuyến nghị ưu tiên. Các chỉ số được tính từ bộ dữ liệu đã chọn; chưa ước tính tác động tài chính khi thiếu dữ liệu chi phí."
    )
    report_title = title or f'Báo cáo hỗ trợ quyết định kinh doanh AutoDS — {dataset.name} — {generated_at.date().isoformat()}'
    content = {
        "generated_at": generated_at.isoformat(),
        "dataset_overview": overview,
        "revenue_analysis": revenue_section,
        "product_forecast": product_section,
        "inventory_forecast": inventory_section,
        "customer_intelligence": customer_section,
        "model_evaluation": model_evaluation,
        "recommendations": recommendations,
        "conclusion": conclusion,
        "limitations": [
            'Kết quả phụ thuộc vào các trường có trong bộ dữ liệu tải lên; những chức năng không được hỗ trợ sẽ được đánh dấu rõ ràng.',
            'EOQ tồn kho và điểm đặt hàng lại dựa trên các giả định có thể cấu hình.',
            'Nhãn rời bỏ là chỉ báo dựa trên hành vi không hoạt động.',
            'Chưa ước tính lợi ích tài chính hoặc khoản tiết kiệm nếu thiếu bằng chứng về chi phí và thử nghiệm.',
        ],
    }
    report = Report(
        id=str(uuid.uuid4()),
        dataset_id=dataset.id,
        title=report_title,
        summary=summary,
        content=json_safe(content),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def _build_report_recommendations(
    revenue: dict, products: dict, inventory: dict, churn: dict, segmentation: dict
) -> list[dict]:
    recommendations: list[dict] = []
    if inventory.get("available"):
        for row in inventory.get("recommendations", [])[:4]:
            recommendations.append(
                {
                    "priority": row.get("priority", "medium"),
                    "area": 'Tồn kho',
                    "title": f"{row['product']} — {vi_label(row['status'])}",
                    "evidence": row.get("evidence", []),
                    "action": (row.get("actions") or ['Xem xét tình hình tồn kho.'])[0],
                    "rationale": row.get("cause"),
                    "expected_impact": row.get("expected_impact"),
                }
            )
    if churn.get("available"):
        high = next((row["count"] for row in churn.get("risk_distribution", []) if row["risk"] == "High Risk"), 0)
        if high:
            recommendations.append(
                {
                    "priority": "high",
                    "area": 'Giữ chân khách hàng',
                    "title": f'Hành động giữ chân {high} khách hàng có rủi ro cao',
                    "evidence": [
                        f"Mô hình rời bỏ {churn.get('metrics', {}).get('model')} có độ bao phủ {churn.get('metrics', {}).get('recall')} trên tập kiểm thử độc lập.",
                        f"ROC-AUC {churn.get('metrics', {}).get('roc_auc')}.",
                    ],
                    "action": 'Triển khai chiến dịch cá nhân hóa thu hút khách hàng quay lại và đo mức tăng giữ chân so với nhóm đối chứng.',
                    "rationale": 'Phân loại rủi ro cao dựa trên mô hình có giám sát được huấn luyện bằng nhãn hành vi không hoạt động.',
                    "expected_impact": 'Hỗ trợ chọn khách hàng cần giữ chân; hiệu quả tăng thêm cần được xác nhận bằng thử nghiệm có đối chứng.',
                }
            )
    growth = revenue.get("kpis", {}).get("growth_pct")
    if growth is not None:
        recommendations.append(
            {
                "priority": "high" if growth < -10 else "medium",
                "area": 'Doanh thu',
                "title": 'Điều chỉnh hoạt động kinh doanh theo diễn biến doanh thu',
                "evidence": [f'Tăng trưởng doanh thu trong kỳ gần nhất: {growth:+.1f}%.', revenue["kpis"].get("growth_basis")],
                "action": (
                    'Bảo đảm nguồn cung và năng lực triển khai chiến dịch cho các danh mục dẫn đầu.'
                    if growth >= 0
                    else 'Phân tích nguyên nhân sụt giảm theo danh mục, sản phẩm và phân khúc khách hàng.'
                ),
                "rationale": 'Diễn biến được tính từ giao dịch thực tế trong bộ dữ liệu đã chọn.',
                "expected_impact": 'Mục tiêu là rút ngắn thời gian ra quyết định; không bảo đảm mức tăng doanh thu.',
            }
        )
    forecastable = [
        row
        for row in products.get("products", [])
        if row.get("forecast_30_growth_pct") is not None and row["forecast_30_growth_pct"] > 0
    ]
    if forecastable:
        fastest = max(forecastable, key=lambda row: row["forecast_30_growth_pct"])
        recommendations.append(
            {
                "priority": "medium",
                "area": 'Sản phẩm',
                "title": f"Chuẩn bị nguồn cung cho {fastest['product']}",
                "evidence": [
                    f"Nhu cầu dự báo 30 ngày: {fastest['forecast_30d']} đơn vị.",
                    f"Tăng trưởng dự báo: {fastest['forecast_30_growth_pct']:+.1f}%.",
                ],
                "action": 'Xác nhận số ngày tồn kho đáp ứng và thời gian giao hàng của nhà cung cấp trước kỳ dự báo.',
                "rationale": 'Sản phẩm có dự báo dương và các chỉ số kiểm định được công bố.',
                "expected_impact": 'Giảm rủi ro mất cân đối cung cầu.',
            }
        )
    if segmentation.get("available"):
        clusters = segmentation.get("clusters", [])
        vip = next((row for row in clusters if row["segment"] == "VIP Customers"), None)
        if vip:
            recommendations.append(
                {
                    "priority": "medium",
                    "area": 'Giá trị khách hàng',
                    "title": f"Duy trì chăm sóc {vip['count']} khách hàng VIP",
                    "evidence": [f"Giá trị chi tiêu trung bình của nhóm VIP: {_fmt_number(vip['avg_monetary'], 2)}."],
                    "action": 'Duy trì danh mục sản phẩm cá nhân hóa và chất lượng phục vụ cho phân khúc VIP.',
                    "rationale": 'Nhóm VIP được xác định bằng phân khúc K-Means trên các đặc trưng khách hàng đã chuẩn hóa.',
                    "expected_impact": 'Hỗ trợ bảo vệ giá trị khách hàng; chưa ước tính hiệu quả tăng thêm.',
                }
            )
    order = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
    recommendations.sort(key=lambda row: order.get(row.get("priority"), 4))
    return recommendations[:8]


def _build_conclusion(
    revenue: dict, inventory: dict, churn: dict, products: dict, recommendations: list[dict]
) -> str:
    kpis = revenue.get("kpis", {})
    parts = [
        f"Doanh thu trong kỳ phân tích là {_fmt_number(kpis.get('total_revenue'))} từ {_fmt_number(kpis.get('total_orders'))} đơn hàng."
    ]
    if kpis.get("growth_pct") is not None:
        parts.append(f"Doanh thu kỳ gần nhất thay đổi {kpis['growth_pct']:+.1f}%.")
    if inventory.get("available") and inventory.get("summary"):
        summary = inventory["summary"]
        parts.append(
            f"Đã rà soát tồn kho của {summary.get('products_analyzed', 0)} sản phẩm, trong đó có {summary.get('critical_low_count', 0)} sản phẩm tồn kho nguy cấp hoặc thấp và {summary.get('dead_stock_count', 0)} sản phẩm tồn chết."
        )
    if churn.get("available"):
        high = next((row["count"] for row in churn.get("risk_distribution", []) if row["risk"] == "High Risk"), 0)
        parts.append(f'Mô hình rời bỏ đánh dấu {high} khách hàng có rủi ro cao.')
    if products.get("summary"):
        parts.append(
            f"Đã dự báo nhu cầu cho {products['summary'].get('forecasted_products', 0)} sản phẩm, trong đó {products['summary'].get('high_potential_products', 0)} sản phẩm được đánh giá có tiềm năng cao."
        )
    if recommendations:
        parts.append(
            f"Hành động ưu tiên cao nhất là: {recommendations[0]['title']}. Các thay đổi vận hành cần được đối chiếu với chi phí, năng lực đáp ứng và thử nghiệm có đối chứng."
        )
    return " ".join(parts)


_FONT_CANDIDATES = [
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
]


def _register_pdf_fonts() -> tuple[str, str]:
    for regular, bold in _FONT_CANDIDATES:
        if Path(regular).exists():
            try:
                pdfmetrics.registerFont(TTFont("AutoDS", regular))
                pdfmetrics.registerFont(TTFont("AutoDS-Bold", bold if Path(bold).exists() else regular))
                return "AutoDS", "AutoDS-Bold"
            except Exception:
                continue
    raise ApiError("Không tìm thấy phông chữ hỗ trợ tiếng Việt. Hãy cài Arial hoặc DejaVu Sans trên máy chủ.", 500, "pdf_font_missing")


def export_report_pdf(report: Report) -> Path:
    regular, bold = _register_pdf_fonts()
    path = REPORTS_DIR / f"AutoDS_{report.id[:8]}.pdf"
    doc = SimpleDocTemplate(
        str(path),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=vi_text(report.title),
        author="AutoDS",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "AutoDSTitle",
        parent=styles["Title"],
        fontName=bold,
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#0B1F3A"),
        spaceAfter=8,
        alignment=TA_LEFT,
    )
    subtitle = ParagraphStyle(
        "AutoDSSubtitle",
        parent=styles["Normal"],
        fontName=regular,
        fontSize=8.5,
        textColor=colors.HexColor("#64748B"),
        leading=12,
    )
    heading = ParagraphStyle(
        "AutoDSHeading",
        parent=styles["Heading2"],
        fontName=bold,
        fontSize=13,
        textColor=colors.HexColor("#1E3A8A"),
        spaceBefore=14,
        spaceAfter=7,
        leading=16,
    )
    body = ParagraphStyle(
        "AutoDSBody",
        parent=styles["BodyText"],
        fontName=regular,
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#1E293B"),
    )
    small = ParagraphStyle("AutoDSSmall", parent=body, fontSize=7.5, leading=10, textColor=colors.HexColor("#475569"))
    content = vi_payload(report.content or {})
    overview = content.get("dataset_overview", {})
    revenue = content.get("revenue_analysis", {})
    kpis = revenue.get("kpis", {})
    product = content.get("product_forecast", {})
    inventory = content.get("inventory_forecast", {})
    customers = content.get("customer_intelligence", {})
    models = content.get("model_evaluation", {})
    recommendations = content.get("recommendations", [])

    story: list = [
        Paragraph(escape("AutoDS"), ParagraphStyle("Brand", parent=subtitle, textColor=colors.HexColor("#0891B2"), fontSize=9, spaceAfter=4)),
        Paragraph(escape(vi_text(report.title)), title_style),
        Paragraph(
            escape(
                f"Ngày tạo {content.get('generated_at', 'Kh?ng c? d? li?u')} · {overview.get('data_source_label', 'Dataset')} · {overview.get('rows', 0):,} dòng × {overview.get('columns', 0)} cột"
            ),
            subtitle,
        ),
        Spacer(1, 9),
    ]

    def section(title_text: str, paragraphs: list[tuple[str, str]]):
        story.append(Paragraph(escape(vi_label(title_text)), heading))
        for label, text in paragraphs:
            rendered = str(text) if label == 'Bộ dữ liệu' else vi_text(str(text))
            story.append(Paragraph(f"<b>{escape(vi_label(label))}:</b> {escape(rendered)}", body))
            story.append(Spacer(1, 3))

    def add_table(rows: list[list[Any]], widths: list[float] | None = None):
        if not rows:
            return
        display_columns = {'Trạng thái', 'Tiềm năng', 'Phân khúc', 'Rủi ro', 'Tiêu chí', 'Người dùng chọn', 'AI tự chọn'}
        escaped = [
            [Paragraph(escape(vi_text(str(cell)) if index == 0 or rows[0][column] in display_columns
                              else str(cell if cell is not None else "Không có dữ liệu")), small)
             for column, cell in enumerate(row)]
            for index, row in enumerate(rows)
        ]
        table = Table(escaped, colWidths=widths, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E0E7FF")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
                    ("FONTNAME", (0, 0), (-1, 0), bold),
                    ("FONTNAME", (0, 1), (-1, -1), regular),
                    ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CBD5E1")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 5))

    story.append(Paragraph('Tóm tắt điều hành', heading))
    story.append(Paragraph(escape(vi_text(report.summary)), body))
    story.append(Spacer(1, 5))
    story.extend(_paragraphs_for_text(body, content.get("conclusion", "")))

    section(
        "1. Dataset Overview",
        [
            ('Bộ dữ liệu', overview.get("name")),
            ('Nguồn', overview.get("data_source_label")),
            ('Khoảng thời gian', f"{overview.get('date_range', {}).get('start')} ??n {overview.get('date_range', {}).get('end')}"),
            ('Điểm chất lượng', f"{overview.get('quality_score')}/100"),
            ('Số dòng / số cột', f"{overview.get('rows', 0):,} / {overview.get('columns', 0)}"),
            ('Doanh thu được tính toán', 'Có — số lượng × giá × hệ số sau giảm giá' if overview.get("revenue_derived") else 'Không — sử dụng trường doanh thu gốc'),
        ],
    )

    section(
        "2. Revenue Analytics",
        [
            ('Kỳ phân tích', f"{revenue.get('period', {}).get('start')} ??n {revenue.get('period', {}).get('end')}"),
            ('Tổng doanh thu', _fmt_number(kpis.get("total_revenue"), 2)),
            ('Đơn hàng', _fmt_number(kpis.get("total_orders"))),
            ('Giá trị đơn hàng trung bình', _fmt_number(kpis.get("average_order_value"), 2)),
            ('Tăng trưởng doanh thu', f"{kpis.get('growth_pct')}%" if kpis.get("growth_pct") is not None else "Kh?ng c? d? li?u"),
            ('Biên lợi nhuận gộp', f"{kpis.get('gross_margin_pct')}%" if kpis.get("gross_margin_pct") is not None else 'Không có dữ liệu (thiếu chi phí)'),
        ],
    )
    category_rows = [['Danh mục', 'Doanh thu', 'Đơn vị', 'Tỷ trọng']]
    for row in revenue.get("top_categories", []):
        category_rows.append([row["category"], _fmt_number(row["revenue"], 2), _fmt_number(row["units"]), f"{row['share_pct']:.1f}%"])
    add_table(category_rows, [70 * mm, 40 * mm, 35 * mm, 25 * mm])
    for insight in revenue.get("insights", [])[:4]:
        story.append(Paragraph(f"<b>{escape(insight['title'])}.</b> {escape(insight['detail'])}", body))
        story.append(Spacer(1, 3))
    if revenue.get("forecast_summary"):
        forecast_summary = revenue["forecast_summary"]
        story.append(
            Paragraph(
                escape(
                    f"Dự báo doanh thu: {_fmt_number(forecast_summary.get('forecast_30d'), 2)} trong 30 ngày và {_fmt_number(forecast_summary.get('forecast_90d'), 2)} trong 90 ngày bằng mô hình {forecast_summary.get('model_label')}. MAE kiểm định {forecast_summary.get('metrics', {}).get('mae')}, MAPE {forecast_summary.get('metrics', {}).get('mape')}%."
                ),
                body,
            )
        )

    story.append(PageBreak())
    story.append(Paragraph("3. D? b?o nhu c?u s?n ph?m", heading))
    product_summary = product.get("summary", {})
    section(
        'Dự báo danh mục sản phẩm',
        [
            ('Sản phẩm đã dự báo', f"{product_summary.get('forecasted_products', 0)} tr?n {product_summary.get('total_products', 0)}"),
            ('Sản phẩm tiềm năng cao', product_summary.get("high_potential_products", 0)),
            ('Tổng số đơn vị dự báo 30 ngày', _fmt_number(product_summary.get("total_forecast_30d"), 1)),
        ],
    )
    product_rows = [['Sản phẩm', '30 ngày gần nhất', 'Dự báo 30 ngày', 'Dự báo 90 ngày', 'Tăng trưởng', 'Tiềm năng']]
    for row in product.get("top_products", [])[:10]:
        product_rows.append(
            [
                row["product"],
                _fmt_number(row.get("recent_30_units")),
                _fmt_number(row.get("forecast_30d"), 1),
                _fmt_number(row.get("forecast_90d"), 1),
                f"{row['forecast_30_growth_pct']:+.1f}%" if row.get("forecast_30_growth_pct") is not None else "Kh?ng c? d? li?u",
                row.get("potential"),
            ]
        )
    add_table(product_rows, [55 * mm, 25 * mm, 25 * mm, 25 * mm, 22 * mm, 22 * mm])

    story.append(Paragraph("4. D? b?o t?n kho", heading))
    if inventory.get("available"):
        inventory_summary = inventory.get("summary", {})
        section(
            'Tình hình tồn kho',
            [
                ('Sản phẩm đã phân tích', inventory_summary.get("products_analyzed")),
                ('Giá trị tồn kho', _fmt_number(inventory_summary.get("total_inventory_value"), 2)),
                ('Tồn kho nguy cấp / thấp', inventory_summary.get("critical_low_count")),
                ("Overstock", inventory_summary.get("overstock_count")),
                ('Hàng tồn chết', inventory_summary.get("dead_stock_count")),
            ],
        )
        inv_rows = [['Sản phẩm', 'Trạng thái', 'Tồn kho', 'Dự báo 30 ngày', 'Số ngày đáp ứng', 'Đề xuất đặt hàng']]
        for row in inventory.get("top_items", [])[:12]:
            inv_rows.append(
                [
                    row["product"],
                    row["status"],
                    row["current_stock"],
                    _fmt_number(row.get("forecast_30d"), 1),
                    _fmt_number(row.get("coverage_days"), 1),
                    row.get("suggested_order_qty"),
                ]
            )
        add_table(inv_rows, [50 * mm, 30 * mm, 18 * mm, 25 * mm, 23 * mm, 25 * mm])
        for assumption in (inventory.get("assumptions") or {}).get("notes", []):
            story.append(Paragraph(escape("• " + assumption), small))
    else:
        story.append(Paragraph(escape(inventory.get("reason") or 'Không thể phân tích tồn kho.'), body))

    story.append(PageBreak())
    story.append(Paragraph("5. Ph?n t?ch kh?ch h?ng", heading))
    if customers.get("segmentation_available"):
        section(
            'Phân khúc K-Means',
            [
                ('Khách hàng', (customers.get("segmentation_metrics") or {}).get("customers")),
                ('Điểm Silhouette', (customers.get("segmentation_metrics") or {}).get("silhouette_score")),
                ('Chỉ số Davies-Bouldin', (customers.get("segmentation_metrics") or {}).get("davies_bouldin_index")),
            ],
        )
        segment_rows = [['Phân khúc', 'Khách hàng', 'Số ngày từ lần mua gần nhất trung bình', 'Tần suất trung bình', 'Chi tiêu trung bình']]
        for row in customers.get("clusters", []):
            segment_rows.append(
                [
                    row["segment"],
                    row["count"],
                    _fmt_number(row.get("avg_recency_days"), 1),
                    _fmt_number(row.get("avg_frequency"), 2),
                    _fmt_number(row.get("avg_monetary"), 2),
                ]
            )
        add_table(segment_rows, [50 * mm, 25 * mm, 30 * mm, 30 * mm, 35 * mm])
    else:
        story.append(Paragraph(escape(customers.get("segmentation_reason") or 'Không thể phân khúc khách hàng.'), body))
    if customers.get("churn_available"):
        churn_metrics = customers.get("churn_metrics") or {}
        section(
            'Dự đoán rời bỏ',
            [
                ('Mô hình', churn_metrics.get("model")),
                ('Độ chính xác', churn_metrics.get("accuracy")),
                ('Độ phủ dương', churn_metrics.get("recall")),
                ("F1", churn_metrics.get("f1")),
                ("ROC-AUC", churn_metrics.get("roc_auc")),
                ('Định nghĩa nhãn', churn_metrics.get("label_definition")),
            ],
        )
    else:
        story.append(Paragraph(escape(customers.get("churn_reason") or 'Chưa có mô hình rời bỏ phù hợp.'), body))

    story.append(Paragraph("6. ??nh gi? m? h?nh", heading))
    if models.get("status") == "benchmark_available":
        results = models.get("results", {})
        section(
            'Kết quả đánh giá được lưu gần nhất',
            [
                ('Nhiệm vụ', results.get("task_label")),
                ('Mô hình người dùng chọn', results.get("human_model")),
                ('Mô hình AI chọn', results.get("ai_model")),
            ],
        )
        bench_rows = [['Tiêu chí', 'Người dùng chọn', 'AI tự chọn']]
        for row in results.get("comparison_table", []):
            bench_rows.append([row.get("criterion"), row.get("human"), row.get("ai")])
        add_table(bench_rows, [60 * mm, 55 * mm, 55 * mm])
    else:
        section(
            'Kiểm định dự báo',
            [
                ('Trạng thái', 'Chưa có kết quả so sánh mô hình người dùng và AI được lưu'),
                ('Mô hình doanh thu đang dùng', (models.get("deployed_forecast_model") or {}).get("model_label")),
                ('MAE kiểm định', (models.get("deployed_forecast_model") or {}).get("metrics", {}).get("mae")),
                ('MAPE kiểm định', (models.get("deployed_forecast_model") or {}).get("metrics", {}).get("mape")),
            ],
        )
        story.append(Paragraph(escape(models.get("note", "")), small))

    story.append(PageBreak())
    story.append(Paragraph("7. Khuy?n ngh? ?u ti?n", heading))
    if not recommendations:
        story.append(Paragraph('Không thể tạo khuyến nghị từ dữ liệu hiện có.', body))
    for index, row in enumerate(recommendations, start=1):
        story.append(
            Paragraph(
                f"<b>{index}. [{escape(vi_label(row.get('priority', 'medium')).upper())}] {escape(row.get('title', ''))}</b>",
                body,
            )
        )
        story.append(Paragraph(escape(f"Lĩnh vực: {row.get('area')}"), small))
        for evidence in row.get("evidence", []):
            if evidence:
                story.append(Paragraph(escape(f'Bằng chứng: {evidence}'), small))
        story.append(Paragraph(escape(f"Hành động: {row.get('action')}"), small))
        story.append(Paragraph(escape(f"Tác động kỳ vọng: {row.get('expected_impact')}"), small))
        story.append(Spacer(1, 5))

    story.append(Paragraph("8. Gi?i h?n ph?n t?ch", heading))
    for limitation in content.get("limitations", []):
        story.append(Paragraph(escape("• " + limitation), small))
        story.append(Spacer(1, 2))

    doc.build(story)
    return path


def _paragraphs_for_text(style: ParagraphStyle, text: str) -> list:
    if not text:
        return []
    return [Paragraph(escape(text), style), Spacer(1, 4)]


def _export_frame(rows: list[dict]) -> pd.DataFrame:
    """Translate export headings and application labels, preserving business names and numbers."""
    raw_fields = {"product", "product_id", "category", "customer_id", "column", "name", "id"}

    def display(value: Any, field: str = "") -> Any:
        if field in raw_fields:
            return value
        if isinstance(value, dict):
            return {vi_label(key): display(item, key) for key, item in value.items()}
        if isinstance(value, list):
            return [display(item, field) for item in value]
        return vi_text(value) if isinstance(value, str) else value

    import json

    result = []
    for row in rows:
        rendered = {}
        for key, value in row.items():
            value = display(value, key)
            rendered[vi_label(key)] = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
        result.append(rendered)
    return pd.DataFrame(result)


def export_report_excel(report: Report) -> Path:
    path = REPORTS_DIR / f"AutoDS_{report.id[:8]}.xlsx"
    content = vi_payload(report.content or {})
    overview = content.get("dataset_overview", {})
    revenue = content.get("revenue_analysis", {})
    products = content.get("product_forecast", {})
    inventory = content.get("inventory_forecast", {})
    customers = content.get("customer_intelligence", {})
    models = content.get("model_evaluation", {})
    recommendations = content.get("recommendations", [])

    summary_rows = [
        {"Section": 'Báo cáo', "Metric": "Title", "Value": vi_text(report.title)},
        {"Section": 'Báo cáo', "Metric": 'Thời điểm tạo', "Value": content.get("generated_at")},
        {"Section": 'Bộ dữ liệu', "Metric": 'Nguồn', "Value": overview.get("data_source_label")},
        {"Section": 'Bộ dữ liệu', "Metric": 'Dòng', "Value": overview.get("rows")},
        {"Section": 'Bộ dữ liệu', "Metric": 'Cột', "Value": overview.get("columns")},
        {"Section": 'Bộ dữ liệu', "Metric": 'Điểm chất lượng', "Value": overview.get("quality_score")},
        {"Section": 'Bộ dữ liệu', "Metric": 'Ngày bắt đầu', "Value": overview.get("date_range", {}).get("start")},
        {"Section": 'Bộ dữ liệu', "Metric": 'Ngày kết thúc', "Value": overview.get("date_range", {}).get("end")},
        {"Section": 'Tóm tắt điều hành', "Metric": "Summary", "Value": vi_text(report.summary)},
        {"Section": 'Kết luận', "Metric": 'Kết luận', "Value": content.get("conclusion")},
    ]
    kpi_rows = [{"Metric": key, "Value": value} for key, value in (revenue.get("kpis") or {}).items()]
    product_rows = products.get("top_products", [])
    inventory_rows = inventory.get("top_items", []) if inventory.get("available") else []
    segment_rows = customers.get("clusters", []) if customers.get("segmentation_available") else []
    model_rows = []
    if models.get("status") == "benchmark_available":
        model_rows = models.get("results", {}).get("comparison_table", [])
    else:
        forecast = models.get("deployed_forecast_model") or {}
        model_rows = [
            {"criterion": 'Mô hình đang dùng', "human": forecast.get("model_label"), "ai": None},
            {"criterion": 'MAE kiểm định', "human": (forecast.get("metrics") or {}).get("mae"), "ai": None},
            {"criterion": 'MAPE kiểm định', "human": (forecast.get("metrics") or {}).get("mape"), "ai": None},
        ]

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        _export_frame(summary_rows).to_excel(writer, sheet_name=vi_label("Summary"), index=False)
        _export_frame(kpi_rows).to_excel(writer, sheet_name=vi_label('Chỉ số doanh thu'), index=False)
        _export_frame(product_rows).to_excel(writer, sheet_name=vi_label('Dự báo sản phẩm'), index=False)
        _export_frame(inventory_rows).to_excel(writer, sheet_name=vi_label('Tồn kho'), index=False)
        _export_frame(segment_rows).to_excel(writer, sheet_name=vi_label('Phân khúc khách hàng'), index=False)
        _export_frame(model_rows).to_excel(writer, sheet_name=vi_label('Đánh giá mô hình'), index=False)
        _export_frame(recommendations).to_excel(writer, sheet_name=vi_label("Recommendations"), index=False)
        mapping = _export_frame(overview.get("column_mapping", []))
        mapping.to_excel(writer, sheet_name=vi_label('Ánh xạ cột'), index=False)
        workbook = writer.book
        for worksheet in workbook.worksheets:
            worksheet.freeze_panes = "A2"
            for column in worksheet.columns:
                length = max((len(str(cell.value)) if cell.value is not None else 0) for cell in column)
                letter = column[0].column_letter
                worksheet.column_dimensions[letter].width = min(max(12, length + 2), 55)
            for cell in worksheet[1]:
                cell.font = cell.font.copy(bold=True, color="FFFFFF")
                cell.fill = cell.fill.copy(fgColor="1E3A8A")
    return path


def safe_report_filename(title: str, suffix: str) -> str:
    normalized = unicodedata.normalize("NFC", vi_text(title))
    slug = re.sub(r"[^\w-]+", "_", normalized, flags=re.UNICODE).strip("_")[:80] or "Bao_cao_AutoDS"
    return f"{slug}.{suffix}"
