# MTJOB — Phần mềm quản lý công việc & chấm công cho Agency Marketing

Hệ thống nội bộ: nhân sự **chat với trợ lý** để ghi nhận task (điểm cố định), **chấm công GPS** theo ca,
**báo cáo điểm hằng ngày** và **tổng kết tháng** (xếp hạng + thưởng + công & lương) — dữ liệu lưu trên
**Postgres** (Neon/Supabase/bất kỳ). Trợ lý chat dùng **Gemini** (tuỳ chọn).

## Kiến trúc

```
web/ (React PWA)  ──HTTPS/JWT──>  server/ (Node + Express)  ──>  Postgres (DATABASE_URL)
  - Trợ lý chat                     - REST API                    Gemini API (tuỳ chọn, NLU chat)
  - Chấm công GPS                   - node-cron / Vercel Cron
  - Web Push (service worker)       - web-push (VAPID)
```

- **Backend** `server/`: Node 20+, TypeScript (chạy bằng `tsx`), Express, `pg`, `web-push`, `node-cron`.
- **Frontend** `web/`: React + Vite + Tailwind + Recharts, PWA (service worker + Web Push).
- **Dữ liệu**: Postgres — schema trong `server/src/db/schema.ts` (xem `docs/schema.md`).

## Yêu cầu

- Node.js 20+ (đã test trên Node 24).
- 1 CSDL Postgres — nhanh nhất: **Vercel → Storage → Create Database → Neon** (gói free, tự thêm `DATABASE_URL`).
- VAPID keys cho Web Push.
- (Tuỳ chọn) Gemini API key hoặc OAuth cho trợ lý chat.

Chi tiết: **`docs/setup.md`**.

## Bắt đầu nhanh (local)

```bash
# 1) Cài dependencies
npm install --prefix server
npm install --prefix web

# 2) Tạo file môi trường
#    Copy .env.example -> server/.env, điền DATABASE_URL (+ VAPID nếu cần push)
#    Tạo VAPID:  npx --prefix server web-push generate-vapid-keys

# 3) Khởi tạo CSDL: bảng + seed (config, danh mục task, ngày lễ, 13 thành viên, admin)
npm run setup-db --prefix server
#    -> admin mặc định: admin@mtjob.local / Admin@2026  (ĐỔI NGAY sau khi đăng nhập)

# 4) Chạy
npm run dev --prefix server     # API http://localhost:8080
npm run dev --prefix web        # PWA http://localhost:5173 (proxy /api -> 8080)
```

Đăng nhập admin → **Quản trị** → đặt mật khẩu cho từng thành viên.

## Scripts

| Lệnh (trong `server/`) | Tác dụng |
|---|---|
| `npm run dev` | Chạy API (hot reload) + đăng ký cron báo cáo |
| `npm test` | Unit test logic nghiệp vụ (Vitest) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run setup-db` | Tạo bảng + seed config/danh mục/ngày lễ/thành viên + admin |
| `npm run sync-members` | Đồng bộ nhân sự từ Google Sheet nguồn (cần sheet share công khai) |
| `npm run gemini-auth` | Lấy URL OAuth Google cho trợ lý Gemini |
| `npm run job:daily` | Chạy tay báo cáo hằng ngày |
| `npm run job:monthly` | Chạy tay tổng kết tháng (xếp hạng + công/lương) |

## Quy tắc nghiệp vụ (đã chốt)

- **Điểm task**: bảng danh mục cố định (`task_catalog`); bot tự gán điểm khi ghi nhận.
- **Thưởng**: `floor((điểm_tháng − 6000) / 1000) × 800.000đ` (chỉ phần vượt 6000).
- **Ca làm**: sáng 08:30–12:00, chiều 13:30–17:00; mỗi ca = 0.5 công; checkout ~12:00 = nửa ngày.
- **Lương thực lãnh** = `round(Mức lương / ngày_công_chuẩn × ngày_làm_thực_tế) − 10,5% × mức_đóng_BHXH`
  (ngày công chuẩn = T2–T6 trừ lễ; **online có tính công, nghỉ phép không**; **giám đốc không tính payroll**;
  lương chặn sàn 0đ). Đổi sang trừ thẳng giá trị cột BHXH bằng config `bhxhMode = direct`.
- **Đơn online / nghỉ phép**: duyệt **2 cấp** (leader → giám đốc); online duyệt xong tự ghi công.

## Kiểm thử

```bash
npm test --prefix server        # 39 unit test cho bonus, payroll, chấm công, điểm, parse nhân sự
npm run typecheck --prefix server
npm run build --prefix web
```

Triển khai production: **`docs/deploy-vercel.md`** (Vercel qua GitHub — khuyến nghị) hoặc **`docs/deploy-vps.md`** (VPS).
Thiết lập DB/AI/Push: **`docs/setup.md`**. Cấu trúc dữ liệu: **`docs/schema.md`**.
