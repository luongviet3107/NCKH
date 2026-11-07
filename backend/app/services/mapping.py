from __future__ import annotations

import re
import unicodedata
from typing import Any

FIELD_LABELS = {
    "order_id": 'Mã đơn hàng',
    "customer_id": 'Mã khách hàng',
    "product_id": 'Mã sản phẩm',
    "product_name": "Product Name",
    "category": 'Danh mục',
    "order_date": 'Ngày đặt hàng',
    "quantity": 'Số lượng',
    "unit_price": 'Đơn giá',
    "revenue": 'Doanh thu',
    "discount": 'Giảm giá',
    "stock_quantity": 'Số lượng tồn kho',
    "cost": 'Chi phí đơn vị',
    "profit": 'Lợi nhuận',
    "region": 'Khu vực',
}

ALIASES: dict[str, list[str]] = {
    "order_id": [
        "order id", "orderid", "order no", "order number", "invoice id", "invoice no",
        "invoice number", "transaction id", "transaction no", "ma don", "ma don hang",
        "ma hoa don", "so hoa don", "ma giao dich",
    ],
    "customer_id": [
        "customer id", "customerid", "customer code", "client id", "client code",
        "customer number", "ma khach hang", "ma khach", "ma kh", "khach hang id",
        "buyer id", "account id",
    ],
    "product_id": [
        "product id", "productid", "sku", "sku id", "item id", "item code",
        "product code", "ma san pham", "ma sp", "ma hang",
    ],
    "product_name": [
        "product name", "product", "item name", "item", "description", "product title",
        "ten san pham", "ten sp", "ten hang", "san pham", "hang hoa",
    ],
    "category": [
        "category", "categories", "product category", "category name", "department",
        "danh muc", "danh muc san pham", "loai san pham", "nhom san pham", "nganh hang",
    ],
    "order_date": [
        "order date", "orderdate", "date", "purchase date", "invoice date", "created at",
        "order created", "transaction date", "ngay dat hang", "ngay mua", "ngay giao dich",
        "ngay tao don", "ngay",
    ],
    "quantity": [
        "quantity", "qty", "units", "units sold", "ordered quantity", "unit sold",
        "sales quantity", "so luong", "so luong ban", "sl", "so luong mua",
    ],
    "unit_price": [
        "unit price", "unitprice", "price", "price per unit", "selling price", "sale price",
        "don gia", "gia ban", "gia", "don gia ban",
    ],
    "revenue": [
        "revenue", "sales", "total sales", "gross sales", "net sales", "total revenue",
        "sales amount", "amount", "total amount", "line total", "total", "doanh thu",
        "thanh tien", "tong tien", "gia tri don hang", "tien ban hang", "gmv",
    ],
    "discount": [
        "discount", "discount %", "discount percent", "discount rate", "discount amount",
        "giam gia", "chiet khau", "ty le giam gia",
    ],
    "stock_quantity": [
        "stock quantity", "stock", "current stock", "inventory", "inventory level",
        "inventory quantity", "available stock", "quantity on hand", "on hand",
        "ton kho", "so luong ton", "so luong ton kho", "ton", "hang ton",
    ],
    "cost": [
        "cost", "unit cost", "cost price", "purchase cost", "cogs", "cost of goods",
        "cost of goods sold", "gia von", "don gia von", "chi phi", "gia nhap", "von",
    ],
    "profit": [
        "profit", "gross profit", "net profit", "margin", "loi nhuan", "lai",
        "loi nhuan gop", "lai gop",
    ],
    "region": [
        "region", "area", "country", "city", "state", "territory", "location",
        "khu vuc", "vung", "thanh pho", "quoc gia", "dia diem",
    ],
}

FIELD_REQUIREMENTS = {
    "order_date": {
        "description": 'Ngày dùng để phân tích chuỗi thời gian và dự báo.',
        "affected": ['Xu hướng tổng quan', 'Dự báo doanh thu', 'Dự báo sản phẩm', 'Dự báo tồn kho', 'Phân tích rời bỏ'],
        "suggestion": 'Thêm cột ngày giao dịch hoặc ngày đặt hàng theo định dạng ISO (YYYY-MM-DD).',
    },
    "quantity": {
        "description": 'Số đơn vị bán được trong mỗi giao dịch.',
        "affected": ['Dự báo nhu cầu sản phẩm', 'Số ngày tồn kho đáp ứng', 'Sản lượng bán'],
        "suggestion": 'Thêm cột số lượng dạng số hoặc tải dữ liệu đã tổng hợp theo đơn hàng.',
    },
    "revenue": {
        "description": 'Doanh thu giao dịch hoặc số lượng × đơn giá.',
        "affected": ['Phân tích doanh thu', 'Giá trị chi tiêu của khách hàng', 'Phân tích lợi nhuận'],
        "suggestion": 'Thêm doanh thu hoặc cung cấp cả số lượng và đơn giá để hệ thống tính doanh thu.',
    },
    "product_name": {
        "description": 'Mã sản phẩm dùng để phân tích theo từng sản phẩm.',
        "affected": ['Trí tuệ sản phẩm', 'Phân tích tồn kho', 'Gợi ý sản phẩm'],
        "suggestion": 'Thêm cột tên sản phẩm hoặc mã sản phẩm/SKU.',
    },
    "customer_id": {
        "description": 'Mã khách hàng dùng để nhóm dữ liệu theo từng khách hàng.',
        "affected": ['Phân khúc khách hàng', 'Dự đoán rời bỏ', 'Gợi ý cá nhân hóa'],
        "suggestion": 'Thêm cột mã khách hàng. Tránh dùng tên làm mã vì có thể trùng nhau.',
    },
    "stock_quantity": {
        "description": 'Số lượng tồn kho hiện có của từng sản phẩm.',
        "affected": ['Trạng thái tồn kho', 'Khuyến nghị đặt hàng lại', 'Dự báo hết hàng'],
        "suggestion": 'Thêm cột số lượng tồn kho hiện tại cho từng mã sản phẩm.',
    },
    "cost": {
        "description": 'Chi phí đơn vị hoặc chi phí từng dòng dùng để tính lợi nhuận.',
        "affected": ['Lợi nhuận gộp', 'Biên lợi nhuận gộp', 'Giả định chi phí lưu kho'],
        "suggestion": 'Thêm chi phí đơn vị hoặc giá vốn hàng bán nếu cần phân tích lợi nhuận.',
    },
    "category": {
        "description": 'Danh mục sản phẩm dùng để phân tích cơ cấu kinh doanh.',
        "affected": ['Cơ cấu danh mục', 'Nhận xét tăng trưởng theo danh mục', 'Lập kế hoạch tồn kho theo danh mục'],
        "suggestion": 'Thêm cột danh mục để phân tích theo từng danh mục.',
    },
}


def _norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("đ", "d")
    text = re.sub(r"[^a-z0-9%]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _alias_score(column: str, alias: str) -> int:
    col = _norm(column)
    target = _norm(alias)
    if col == target:
        return 100
    if col.endswith(" " + target) or col.startswith(target + " "):
        return 82
    if target in col.split():
        return 72
    if target in col and len(target) >= 4:
        return 58
    return 0


def detect_mapping(columns: list[str]) -> dict[str, dict[str, Any] | None]:
    candidates: list[tuple[int, str, str]] = []
    for field, aliases in ALIASES.items():
        for column in columns:
            for alias in aliases:
                score = _alias_score(column, alias)
                if score:
                    candidates.append((score, field, column))
    candidates.sort(key=lambda item: item[0], reverse=True)

    mapping: dict[str, dict[str, Any] | None] = {field: None for field in FIELD_LABELS}
    used_columns: set[str] = set()
    for score, field, column in candidates:
        if mapping.get(field) is not None or column in used_columns:
            continue
        mapping[field] = {
            "column": column,
            "confidence": score,
            "method": "header_alias",
        }
        used_columns.add(column)

    return mapping


def mapped_column(mapping: dict, field: str) -> str | None:
    entry = mapping.get(field)
    if isinstance(entry, dict):
        return entry.get("column")
    return None


def field_mapping_view(mapping: dict) -> list[dict]:
    view = []
    for field, label in FIELD_LABELS.items():
        entry = mapping.get(field)
        view.append(
            {
                "field": field,
                "label": label,
                "column": entry.get("column") if isinstance(entry, dict) else None,
                "confidence": entry.get("confidence") if isinstance(entry, dict) else 0,
                "method": entry.get("method", "not_detected") if isinstance(entry, dict) else "not_detected",
                "derived": bool(entry.get("derived")) if isinstance(entry, dict) else False,
            }
        )
    return view


def capabilities(mapping: dict) -> dict[str, bool]:
    has_date = bool(mapped_column(mapping, "order_date"))
    has_qty = bool(mapped_column(mapping, "quantity"))
    has_price = bool(mapped_column(mapping, "unit_price"))
    has_revenue = bool(mapped_column(mapping, "revenue"))
    has_product = bool(mapped_column(mapping, "product_name") or mapped_column(mapping, "product_id"))
    has_customer = bool(mapped_column(mapping, "customer_id"))
    return {
        "overview": bool(has_date and (has_revenue or (has_qty and has_price))),
        "revenue": bool(has_date and (has_revenue or (has_qty and has_price))),
        "products": bool(has_date and has_qty and has_product),
        "inventory": bool(has_product and mapped_column(mapping, "stock_quantity")),
        "customers": bool(has_customer and has_date and (has_revenue or (has_qty and has_price))),
        "profit": bool(has_revenue and mapped_column(mapping, "cost")),
        "category": bool(mapped_column(mapping, "category")),
    }


def missing_data_guidance(mapping: dict) -> list[dict]:
    guidance = []
    has_revenue = bool(mapped_column(mapping, "revenue"))
    can_derive_revenue = bool(mapped_column(mapping, "quantity") and mapped_column(mapping, "unit_price"))
    checks = {
        "order_date": not bool(mapped_column(mapping, "order_date")),
        "quantity": not bool(mapped_column(mapping, "quantity")),
        "revenue": not (has_revenue or can_derive_revenue),
        "product_name": not bool(mapped_column(mapping, "product_name") or mapped_column(mapping, "product_id")),
        "customer_id": not bool(mapped_column(mapping, "customer_id")),
        "stock_quantity": not bool(mapped_column(mapping, "stock_quantity")),
        "cost": not bool(mapped_column(mapping, "cost")),
        "category": not bool(mapped_column(mapping, "category")),
    }
    for field, missing in checks.items():
        if not missing:
            continue
        info = FIELD_REQUIREMENTS.get(field)
        if info:
            guidance.append({"field": field, "label": FIELD_LABELS[field], **info})
    return guidance


def capabilities_view(mapping: dict) -> list[dict]:
    caps = capabilities(mapping)
    labels = {
        "overview": ('Tổng quan điều hành', 'Chỉ số kinh doanh, xu hướng, cơ cấu danh mục và nhận xét AI'),
        "revenue": ('Phân tích doanh thu', 'Chỉ số doanh thu, dự báo và so sánh giữa các kỳ'),
        "products": ('Trí tuệ sản phẩm', 'Dự báo nhu cầu và xếp hạng sản phẩm bán chạy'),
        "inventory": ('Dự báo tồn kho', 'Trạng thái tồn kho, số ngày đáp ứng và bổ sung hàng'),
        "customers": ('Trí tuệ khách hàng', 'Phân khúc RFM, nguy cơ rời bỏ và gợi ý sản phẩm phù hợp'),
        "profit": ('Phân tích lợi nhuận', 'Lợi nhuận gộp và biên lợi nhuận từ dữ liệu chi phí'),
        "category": ('Phân tích danh mục', 'Hiệu quả cơ cấu kinh doanh theo danh mục'),
    }
    return [
        {"key": key, "label": labels[key][0], "available": available, "description": labels[key][1]}
        for key, available in caps.items()
    ]
