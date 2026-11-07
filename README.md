# AutoDS — Hệ thống AI hỗ trợ quyết định kinh doanh

AutoDS chuyển dữ liệu giao dịch bán lẻ thành dự báo có kiểm định, khuyến nghị tồn kho, phân tích khách hàng, kết quả so sánh mô hình và báo cáo hỗ trợ quyết định.

Các chỉ số, biểu đồ và khuyến nghị được tính từ bộ dữ liệu đang dùng. Khi cơ sở dữ liệu trống, hệ thống có thể nạp bộ dữ liệu mẫu được gắn nhãn minh họa rõ ràng.

## Các chức năng

- **Xưởng dữ liệu:** tải CSV/XLSX/XLS, nhận diện và ánh xạ cột, đánh giá chất lượng, xem dữ liệu gốc hoặc đã làm sạch và chọn bộ dữ liệu phân tích.
- **Tổng quan:** chỉ số kinh doanh, diễn biến doanh thu, dự báo, hành động ưu tiên và tín hiệu tồn kho.
- **Doanh thu:** phân tích theo thời gian, danh mục, sản phẩm và khách hàng; dự báo 7–365 ngày và kiểm định theo thời gian.
- **Sản phẩm:** dự báo nhu cầu từng sản phẩm, phân loại xu hướng và tiềm năng, giải thích kết quả và chất lượng mô hình.
- **Tồn kho:** tồn kho an toàn, điểm đặt hàng lại, lượng đặt hàng kinh tế (EOQ), phân loại ABC và khuyến nghị bổ sung hàng.
- **Khách hàng:** phân khúc K-Means theo RFM, dự đoán rời bỏ có giám sát, đánh giá mô hình và gợi ý sản phẩm.
- **Tác nhân AI:** quy trình LangGraph gồm sáu bước phân tích, chạy tự động hoặc có phê duyệt, nhật ký và tổng hợp quyết định theo bằng chứng.
- **Đánh giá mô hình:** so sánh mô hình người dùng chọn và mô hình AI chọn trên cùng tập kiểm thử độc lập.
- **Báo cáo:** lưu kết quả tại thời điểm phân tích, xem chi tiết và xuất PDF/Excel bằng tiếng Việt.
- **Cài đặt:** cấu hình vận hành, tình trạng mô hình ngôn ngữ, mô hình khả dụng và giới hạn hệ thống.

## Cấu trúc dự án

```text
NCKH/
├── backend/
│   ├── app/
│   │   ├── api/            Các tuyến API FastAPI
│   │   ├── agents/         Quy trình tác nhân và diễn giải AI
│   │   ├── core/           Xử lý lỗi, phản hồi và Việt hóa
│   │   ├── forecasting/    Mô hình dự báo và kiểm định
│   │   ├── services/       Xử lý dữ liệu và nghiệp vụ phân tích
│   │   ├── models/         Mô hình dữ liệu SQLAlchemy
│   │   └── main.py         Điểm khởi chạy API
│   ├── tests/              Kiểm thử API và Việt hóa
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/          Mười trang chức năng
│   │   ├── components/     Bố cục, biểu đồ và thành phần giao diện
│   │   ├── context/        Giao diện sáng/tối và bộ dữ liệu đang dùng
│   │   ├── i18n/           Ngôn ngữ và bản dịch
│   │   └── lib/            API, kiểu dữ liệu và định dạng
│   └── package.json
├── datasets/               Dữ liệu mẫu
├── reports/                Tệp báo cáo xuất ra
├── notebooks/              Phân tích và thí nghiệm nghiên cứu
├── scripts/                Công cụ đồng bộ bản dịch
├── docker/                 Cấu hình triển khai
└── docker-compose.yml
```

Khi phát triển, Vite chuyển tiếp `/api` đến `http://127.0.0.1:8000`. Khi triển khai bằng Docker, nginx chuyển tiếp yêu cầu API đến dịch vụ máy chủ.

## Khởi chạy

Cần Python 3.11 trở lên và Node.js 22 trở lên kèm npm. Dự án đã được kiểm tra với Python 3.14. Docker Desktop là tùy chọn khi triển khai bằng bộ chứa.

Từ thư mục gốc dự án, tạo môi trường và chạy API:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Trên macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

API chạy tại `http://127.0.0.1:8000`; tài liệu tương tác tại `http://127.0.0.1:8000/docs`. Mặc định hệ thống tạo cơ sở dữ liệu SQLite ở `backend/autods.db`. Nếu chưa có dữ liệu và `SEED_DEMO_DATA=true`, hệ thống nạp dữ liệu mẫu.

Mở cửa sổ dòng lệnh thứ hai và chạy giao diện:

```powershell
cd frontend
npm install
npm run dev
```

Mở `http://127.0.0.1:5173` hoặc địa chỉ Vite thông báo. Nếu chưa có dữ liệu, vào **Xưởng dữ liệu** để tải tệp hoặc nạp bộ dữ liệu mẫu.

Các lệnh tiện dụng trên Windows, chạy tại thư mục gốc:

```powershell
npm run dev:backend
npm run dev:frontend
npm run build
npm run smoke
```

Các lệnh trên giả định môi trường Python nằm trong `.venv` ở thư mục gốc.

## Cấu hình

Ứng dụng chạy được với cấu hình mặc định. Nếu cần thay đổi, sao chép `.env.example` thành `.env`.

| Biến | Mục đích | Mặc định |
| --- | --- | --- |
| `DATABASE_URL` | Địa chỉ cơ sở dữ liệu SQLAlchemy | SQLite `backend/autods.db` |
| `CORS_ORIGINS` | Các nguồn truy cập được phép, cách nhau bằng dấu phẩy | Các địa chỉ Vite cục bộ |
| `AUTODS_API_KEY` | Bảo vệ API bằng tiêu đề `X-API-Key` | Tắt |
| `MAX_UPLOAD_MB` | Giới hạn dung lượng tải lên | `50` |
| `MAX_AGENT_RUNTIME_SECONDS` | Giới hạn thời gian một lần chạy tác nhân | `300` |
| `LLM_API_KEY` | Khóa cho mô hình ngôn ngữ tương thích API OpenAI | Chưa đặt |
| `LLM_BASE_URL` | Địa chỉ API mô hình ngôn ngữ | `https://api.openai.com/v1` |
| `LLM_MODEL` | Mã mô hình tạo diễn giải | `gpt-4o-mini` |
| `LANGSMITH_API_KEY` | Khóa theo dõi LangSmith tùy chọn | Chưa đặt |
| `SEED_DEMO_DATA` | Nạp dữ liệu mẫu khi cơ sở dữ liệu trống | `true` |

Phân tích định lượng, học máy, báo cáo và quyết định của tác nhân vẫn hoạt động khi chưa có khóa mô hình ngôn ngữ. Mô hình ngôn ngữ chỉ diễn giải bằng tiếng Việt từ những giá trị đã tính toán, không thay đổi các chỉ số.

## API và phương pháp phân tích

Phản hồi JSON sử dụng cấu trúc thống nhất:

```json
{ "success": true, "data": {}, "message": null }
```

API bao gồm quản lý dữ liệu, tổng quan, sản phẩm, tồn kho, khách hàng, doanh thu, đánh giá mô hình, báo cáo và tác nhân. Danh sách tuyến và tham số đầy đủ nằm trong tài liệu OpenAPI của ứng dụng đang chạy. Các khóa JSON, mã mô hình và mã trạng thái được giữ ổn định.

Ánh xạ trường dữ liệu dựa trên tên cột và nội dung, kèm độ tin cậy và giải thích các trường được tính toán. Doanh thu lấy từ cột tương ứng hoặc tính từ số lượng, đơn giá và mức giảm giá. Những chức năng thiếu dữ liệu bắt buộc được đánh dấu không khả dụng.

Dự báo so sánh hồi quy tuyến tính, trung bình trượt, san bằng mũ Holt, rừng ngẫu nhiên, XGBoost và ARIMA khi khả dụng. Mô hình được chọn bằng MAE kiểm định trong tập huấn luyện. Trang đánh giá so sánh phương án người dùng và AI trên cùng tập kiểm thử cuối cùng chưa được dùng để chọn mô hình; hai phương án có thể hòa nhau.

Tồn kho sử dụng thời gian chờ giao hàng, mức phục vụ, chi phí đặt hàng và tỷ lệ lưu kho có thể cấu hình. Công thức tồn kho an toàn là `z × độ lệch chuẩn nhu cầu × √thời gian chờ`; điểm đặt hàng lại và EOQ sử dụng các giả định tương ứng.

Phân khúc khách hàng dùng RFM, giá trị đơn hàng trung bình, tần suất mua và thời gian gắn bó đã chuẩn hóa, với số cụm dựa trên điểm silhouette. Nhãn rời bỏ được xác định bằng thời gian không hoạt động; kết quả hỗ trợ ưu tiên chăm sóc và cần được kiểm chứng với thực tế.

Tác nhân gọi các dịch vụ phân tích Python đã được kiểm chứng, không thực thi mã do người dùng cung cấp và không sửa dữ liệu nguồn hay hồ sơ kinh doanh. Hệ thống không khẳng định lợi ích tài chính khi chưa có bằng chứng về chi phí hoặc thử nghiệm có đối chứng.

## Việt hóa và kiểm thử

Tiếng Việt là ngôn ngữ mặc định. Nút VI/EN cho phép thay đổi lựa chọn hiển thị. Tên sản phẩm và dữ liệu gốc do người dùng cung cấp được giữ nguyên. Các viết tắt chuyên môn như MAE, ROC-AUC và EOQ vẫn được sử dụng.

- `frontend/src/i18n/messages.ts`: bản dịch giao diện.
- `backend/app/core/vi_extra.txt`: nhãn bổ sung và thuật ngữ báo cáo.
- `backend/app/core/vi_prose.txt`: câu nhận xét và thông báo.
- `backend/app/core/vi_captures.json`: phân biệt tham số số, nhãn hệ thống và tên gốc khi dịch văn bản đã lưu.
- `backend/app/core/localization.py`: Việt hóa nội dung trình bày mà không đổi khóa dữ liệu.

Sau khi sửa nhãn, đồng bộ các tệp được tạo tự động:

```powershell
node scripts/sync_translations.mjs
```

Kiểm thử API và Việt hóa:

```powershell
.\.venv\Scripts\python.exe backend\tests\smoke_test.py
.\.venv\Scripts\python.exe backend\tests\test_vietnamese.py
```

Kiểm tra giao diện:

```powershell
cd frontend
npm run build
npm run lint
```

Kiểm thử API bao gồm dữ liệu, tổng quan, dự báo sản phẩm và tồn kho, phân khúc và rời bỏ, doanh thu, đánh giá mô hình, xuất PDF và quy trình tác nhân có phê duyệt. Kiểm thử Việt hóa kiểm tra dữ liệu giữ nguyên, thông báo lỗi, báo cáo cũ, tên trang tính và cột Excel, cùng phông chữ có dấu tiếng Việt.

## Triển khai Docker

```bash
docker compose up --build -d
```

Giao diện chạy tại `http://localhost:8080`; tài liệu API tại `http://localhost:8080/docs`. Dịch vụ máy chủ phải vượt qua kiểm tra sức khỏe trước khi giao diện khởi động. Ảnh máy chủ cài DejaVu Sans để xuất PDF tiếng Việt.

Các vùng lưu trữ có tên giữ lại cơ sở dữ liệu, tệp tải lên, dữ liệu mẫu và báo cáo. Lệnh sau xóa cả dữ liệu của bộ chứa:

```bash
docker compose down -v
```

Docker Compose không tự nạp toàn bộ `.env` vào các dịch vụ. Để bật mô hình ngôn ngữ hoặc LangSmith, thêm biến phù hợp vào `backend.environment` trong `docker-compose.yml` hoặc tệp cấu hình ghi đè. Không đưa khóa bí mật vào mã nguồn.

## Tài liệu nghiên cứu

Thư mục `notebooks/` có các bài hướng dẫn gọi cùng dịch vụ Python với API:

1. `01_data_quality_and_mapping.ipynb`: chất lượng, ánh xạ trường và khả năng phân tích.
2. `02_forecasting_and_validation.ipynb`: dự báo doanh thu, sản phẩm và lập kế hoạch tồn kho.
3. `03_customer_intelligence.ipynb`: phân khúc, rời bỏ và gợi ý sản phẩm.
4. `04_model_arena_and_agents.ipynb`: so sánh mô hình, đề xuất và phê duyệt tác nhân.

Các thí nghiệm độc lập đọc trực tiếp CSV mẫu gồm `data_analysis.ipynb`, `sales_forecasting.ipynb`, `customer_segmentation.ipynb`, `inventory_forecasting.ipynb` và `model_benchmark.ipynb`.

```powershell
.\.venv\Scripts\python.exe -m pip install -r notebooks\requirements.txt
.\.venv\Scripts\python.exe -m jupyter lab
```

Có thể chạy từ thư mục gốc hoặc `notebooks/`; các bài hướng dẫn tự xác định đường dẫn dự án và dữ liệu mẫu.

## Dữ liệu mẫu và giới hạn

Dữ liệu mẫu được tạo tổng hợp để minh họa chức năng. Kết quả phụ thuộc vào trường dữ liệu được cung cấp; tồn kho còn phụ thuộc vào các giả định kinh doanh. Báo cáo lưu ảnh chụp kết quả tại thời điểm tạo. Hệ thống hỗ trợ ra quyết định và cần kết hợp đánh giá chuyên môn phù hợp với bối cảnh sử dụng.
