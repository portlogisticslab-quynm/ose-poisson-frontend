# OSE Poisson/Exponential Frontend

Đây là repository frontend đã được tách khỏi thuật toán mô phỏng.

## Thành phần còn lại ở frontend

- HTML/CSS giao diện.
- Chart.js và canvas để hiển thị.
- Kiểm tra dữ liệu nhập cơ bản.
- Gọi API backend.
- Tải file Excel do backend tạo.

## Thành phần đã chuyển sang backend

- Sinh số ngẫu nhiên Exponential.
- Logic tiến trình Poisson.
- Thống kê mean/variance.
- Poisson PMF và Exponential density.
- Histogram.
- Tạo workbook Excel.

## Chạy thử trên máy

1. Chạy backend tại `http://127.0.0.1:8000`.
2. Trong thư mục frontend chạy:

```bash
python -m http.server 5500
```

3. Mở `http://127.0.0.1:5500`.

Không nên mở trực tiếp bằng `file://` vì trình duyệt có thể chặn yêu cầu API.

## Cấu hình API

Sửa `config.js`:

```javascript
window.OSE_API_BASE = "https://api.ose.vn";
```

## Đưa lên Cloudflare Pages

- Tạo repository GitHub từ thư mục này.
- Kết nối repository với Cloudflare Pages.
- Build command: để trống.
- Output directory: `/`.
