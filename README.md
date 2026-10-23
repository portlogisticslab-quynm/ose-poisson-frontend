# OSE Poisson/Exponential Simulation (frontend-only)

Từ phiên bản 2.0 (24/10/2026) toàn bộ tính toán chạy trong trình duyệt; app **không còn backend**
(đã gỡ `api-poisson.ose.vn`, Render `ose-poisson-backend`, container `poisson-backend`).

## Cấu trúc

| File | Vai trò |
|---|---|
| `index.html`, `styles.css` | Giao diện |
| `sim-engine.js` | Engine mô phỏng: sinh Exponential (crypto RNG), tiến trình Poisson, mean/variance, Poisson PMF, histogram Exponential, nội dung workbook Excel |
| `app.js` | Điều khiển, vẽ canvas, Chart.js, xuất Excel (SheetJS nạp khi bấm Export) |

Nhịp mô phỏng giữ như bản cũ: 0,09 × speed đơn vị thời gian mô phỏng mỗi 180 ms, nhưng chạy theo
`requestAnimationFrame` nên mượt hơn và không phải chờ mạng.

Workbook Excel gồm các sheet: `Summary`, `Poisson_Intervals`, `Events`, `Poisson_PMF`, `Exponential_Histogram`.

## Chạy thử trên máy

```bash
python -m http.server 5500
```

Mở `http://127.0.0.1:5500` (không cần backend).

## Cloudflare Pages

- Build command: để trống (hoặc `exit 0`).
- Output directory: `/`.
- Mỗi lần sửa `app.js` / `sim-engine.js`, tăng `?v=` trong `index.html`.
