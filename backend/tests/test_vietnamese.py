"""Kiểm tra Việt hóa, tính toàn vẹn dữ liệu và tệp xuất có dấu tiếng Việt."""
from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.errors import error_payload
from app.core.localization import payload, text
from app.models import Report
from app.services import report_service
from openpyxl import load_workbook
from reportlab.pdfbase import pdfmetrics


class VietnameseTests(unittest.TestCase):
    def test_business_values_and_contract_tokens_are_preserved(self):
        original = {
            "products": [{"product": "Revenue", "category": "Inventory", "model": "random_forest",
                          "status": "Low Stock", "forecast_30d": 12.5,
                          "reason": "No sales history is available for this product."}],
            "rows": [{"description": "Current stock: 5 units"}],
        }
        saved = copy.deepcopy(original)
        result = payload(original)
        self.assertEqual(original, saved)
        for key in ("product", "category", "model", "status", "forecast_30d"):
            self.assertEqual(result["products"][0][key], original["products"][0][key])
        self.assertEqual(result["rows"], original["rows"])
        self.assertEqual(result["products"][0]["reason"], "Chưa có lịch sử bán hàng cho sản phẩm này.")

    def test_legacy_templates_preserve_names_and_translate_summaries(self):
        self.assertEqual(text("Prepare supply for Revenue"), "Chuẩn bị nguồn cung cho Revenue")
        result = text("The dataset contains 12 rows and 3 columns with a data quality score of 90. "
                      "Analyzed revenue is 100; a growth baseline is unavailable.")
        self.assertIn("12 dòng và 3 cột", result)
        self.assertIn("Doanh thu được phân tích là 100", result)
        self.assertNotIn("Analyzed", result)

    def test_error_codes_remain_stable(self):
        result = error_payload("file_too_large", "File exceeds the 50 MB upload limit.")
        self.assertEqual(result["error"]["code"], "file_too_large")
        self.assertEqual(result["error"]["message"], "Tệp vượt quá giới hạn tải lên 50 MB.")

    def test_excel_headers_labels_names_and_numbers(self):
        report = Report(id="vietnamese-test", title="Báo cáo tiếng Việt", summary="Tóm tắt có dấu",
                        content={"product_forecast": {"top_products": [
                            {"product": "Revenue", "category": "Inventory", "forecast_30d": 12.5,
                             "potential": "High Potential"}]},
                            "inventory_forecast": {"available": True, "top_items": [
                                {"product": "Revenue", "status": "Low Stock", "current_stock": 5}]}})
        saved = copy.deepcopy(report.content)
        with tempfile.TemporaryDirectory() as directory, patch.object(report_service, "REPORTS_DIR", Path(directory)):
            workbook = load_workbook(report_service.export_report_excel(report))
            try:
                self.assertEqual(workbook.sheetnames, ["Tóm tắt", "Chỉ số doanh thu", "Dự báo sản phẩm", "Tồn kho",
                                                       "Phân khúc khách hàng", "Đánh giá mô hình", "Khuyến nghị", "Ánh xạ cột"])
                products = list(workbook["Dự báo sản phẩm"].values)
                self.assertEqual(products[0], ("Sản phẩm", "Danh mục", "Dự báo 30 ngày", "Tiềm năng"))
                self.assertEqual(products[1], ("Revenue", "Inventory", 12.5, "Tiềm năng cao"))
                self.assertEqual(list(workbook["Tồn kho"].values)[1], ("Revenue", "Tồn kho thấp", 5))
            finally:
                workbook.close()
        self.assertEqual(report.content, saved)

    def test_pdf_export_uses_font_with_vietnamese_glyphs(self):
        regular, _ = report_service._register_pdf_fonts()
        glyphs = pdfmetrics.getFont(regular).face.charToGlyph
        for character in "Tiếng Việt đầy đủ ệ ữ ẵ Đ":
            if not character.isspace():
                self.assertIn(ord(character), glyphs)
        report = Report(id="vietnamese-pdf", title="Báo cáo tiếng Việt", summary="Kiểm tra tiếng Việt có dấu", content={})
        with tempfile.TemporaryDirectory() as directory, patch.object(report_service, "REPORTS_DIR", Path(directory)):
            result = report_service.export_report_pdf(report)
            self.assertTrue(result.read_bytes().startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
