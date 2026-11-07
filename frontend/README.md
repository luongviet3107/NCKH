# Giao diện AutoDS

Giao diện React, TypeScript và Vite cho hệ thống hỗ trợ quyết định kinh doanh AutoDS.

## Chạy và kiểm tra

Từ thư mục `frontend`:

```powershell
npm install
npm run dev
```

Máy chủ API chạy tại `http://127.0.0.1:8000`. Vite chuyển tiếp các yêu cầu `/api` đến địa chỉ này.

```powershell
npm run build
npm run lint
```

Lệnh `build` kiểm tra kiểu TypeScript và tạo bản triển khai trong `dist/`.

## Ngôn ngữ

Ứng dụng mặc định dùng tiếng Việt, kể cả lần đầu mở lại sau bản cập nhật Việt hóa. Người dùng có thể đổi ngôn ngữ bằng nút VI/EN; lựa chọn sau đó được lưu trong trình duyệt.

- `src/i18n/messages.ts`: bản dịch các nhãn giao diện.
- `src/i18n/extra-messages.ts`: nhãn bổ sung được tạo tự động.
- `../backend/app/core/vi_extra.txt`: nguồn của nhãn bổ sung dùng chung với báo cáo.
- `src/lib/utils.ts`: định dạng số, ngày và thời lượng theo ngôn ngữ.

Sau khi sửa từ điển, chạy từ thư mục gốc dự án:

```powershell
node scripts/sync_translations.mjs
```

Tên sản phẩm, dữ liệu nhập vào, khóa API và các viết tắt khoa học được giữ nguyên. Nội dung phân tích, thông báo máy chủ và báo cáo được Việt hóa ở phía máy chủ.
