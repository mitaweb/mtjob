# MTJOB — Phần mềm quản lý công việc & chấm công cho Agency Marketing

Hệ thống nội bộ: nhân sự **chat với trợ lý** để ghi nhận task (điểm cố định), **chấm công GPS** theo ca,
**báo cáo điểm hằng ngày** và **tổng kết tháng** (xếp hạng + thưởng + công & lương) — dữ liệu lưu trên
**Google Sheets**. Trợ lý chat dùng **Gemini qua OAuth Google**.

## Kiến trúc

```
web/ (React PWA)  ──HTTPS/JWT──>  server/ (Node + Express)  ──>  Google Sheets  (CSDL)
  - Trợ lý chat                     - REST API                    Gemini API     (OAuth, NLU chat)
  - Chấm công GPS                   - node-cron (báo cáo)
  - Web Push (service worker)       - web-push (VAPID)
```

- **Backend** `server/`: Node 20+, TypeScript (chạy bằng `tsx`), Express, `googleapis`, `web-push`, `node-cron`.
- **Frontend** `web/`: React + Vite + Tailwind + Recharts, PWA (service worker + Web Push).
- **Dữ liệu**: Google Sheets (các tab xem `docs/schema.md`). Không cần CSDL riêng.

## Yêu cầu

- Node.js 20+ (đã test trên Node 24).
- 1 Google Cloud project + **Service Account** (bật Sheets API, Drive API, Generative Language API).
- 1 Google Sheet trống làm CSDL.
- **OAuth Client (Web)** cho Gemini — trợ lý chat (hoặc API key dự phòng).
- VAPID keys cho Web Push.

Chi tiết thiết lập Google: **`docs/google-setup.md`**.

## Bắt đầu nhanh (local)

```bash
# 1) Cài dependencies
npm install --prefix server
npm install --prefix web

# 2) Tạo file môi trường
#    Copy .env.example -> server/.env và điền SHEET_DB_ID, GOOGLE_APPLICATION_CREDENTIALS, GEMINI_API_KEY, VAPID...
#    Tạo VAPID:  npx --prefix server web-push generate-vapid-keys

# 3) Tạo cấu trúc Sheet + seed + tài khoản admin
npm run setup-sheet --prefix server
#    -> in ra admin mặc định: admin@mtjob.local / Admin@2026  (ĐỔI NGAY)

# 4) Đồng bộ nhân sự từ Google Sheet nguồn (Họ tên/Chức vụ/Lương/BHXH/Ngày vào/Năm sinh)
npm run sync-members --prefix server

# 5) Bật trợ lý AI bằng OAuth Google (chạy server trước để nhận callback)
npm run gemini-auth --prefix server     # mở URL -> đồng ý -> dán GEMINI_OAUTH_REFRESH_TOKEN vào .env

# 6) Chạy
npm run dev --prefix server     # API http://localhost:8080
npm run dev --prefix web        # PWA http://localhost:5173 (proxy /api -> 8080)
```

Đăng nhập bằng tài khoản admin, vào **Quản trị → Đồng bộ nhân sự**, rồi đặt mật khẩu cho từng thành viên.

## Scripts

| Lệnh (trong `server/`) | Tác dụng |
|---|---|
| `npm run dev` | Chạy API (hot reload) + đăng ký cron báo cáo |
| `npm test` | Unit test logic nghiệp vụ (Vitest) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run setup-sheet` | Tạo tab/tiêu đề + seed Config/TaskCatalog/Holidays + admin |
| `npm run sync-members` | Đồng bộ nhân sự từ Sheet nguồn |
| `npm run gemini-auth` | Lấy URL OAuth Google cho trợ lý Gemini |
| `npm run job:daily` | Chạy tay báo cáo hằng ngày |
| `npm run job:monthly` | Chạy tay tổng kết tháng (xếp hạng + công/lương) |

## Quy tắc nghiệp vụ (đã chốt)

- **Điểm task**: bảng `TaskCatalog` cố định; bot tự gán điểm khi ghi nhận.
- **Thưởng**: `floor((điểm_tháng − 6000) / 1000) × 800.000đ` (chỉ phần vượt 6000).
- **Ca làm**: sáng 08:30–12:00, chiều 13:30–17:00; mỗi ca = 0.5 công; checkout ~12:00 = nửa ngày.
- **Lương thực lãnh** = `round(Mức lương / ngày_công_chuẩn × ngày_làm_thực_tế) − BHXH`
  (ngày công chuẩn = T2–T6 trừ lễ; **online có tính công, nghỉ phép không**; **giám đốc không tính payroll**).
  Đổi cách trừ BHXH sang `10.5% × cơ sở` bằng `Config.bhxhMode = percent`.
- **Đơn online / nghỉ phép**: duyệt **2 cấp** (leader → giám đốc); online duyệt xong tự ghi công.

## Kiểm thử

```bash
npm test --prefix server        # 39 unit test cho bonus, payroll, chấm công, điểm, parse nhân sự
npm run typecheck --prefix server
npm run build --prefix web
```

Triển khai production: **`docs/deploy-vps.md`**. Cấu trúc dữ liệu: **`docs/schema.md`**.
