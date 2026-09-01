# Triển khai lên Vercel (qua GitHub)

Repo đã cấu hình sẵn cho Vercel: `vercel.json` + serverless entry `api/index.ts`.
Mỗi lần push lên `main` → Vercel tự build & deploy.

## Kiến trúc trên Vercel

| Thành phần | Trên VPS/Mac | Trên Vercel |
|---|---|---|
| Frontend PWA | Vite dev / Nginx | Build tĩnh → CDN (`web/dist`) |
| API Express | tiến trình Node (`npm run dev`) | 1 serverless function (`api/index.ts`) |
| Báo cáo định kỳ | `node-cron` trong tiến trình | **Vercel Cron** gọi `/api/jobs/daily` & `/api/jobs/monthly` |
| CSDL | Postgres bất kỳ | **Neon** (Vercel Storage) — tự inject `DATABASE_URL` |

## Các bước

### 1. Import repo
1. Vào [vercel.com/new](https://vercel.com/new) → **Import** repo `mitaweb/mtjob`.
2. Application Preset để **Other**, Root Directory để **`./`** — `vercel.json` đã khai báo đủ. → **Deploy**.

### 2. Tạo database (Neon)
Project → tab **Storage** → **Create Database** → **Neon (Postgres)** → Connect.
`DATABASE_URL` được tự thêm vào Environment Variables. Copy connection string đó về `server/.env` ở máy local (cần cho bước 4).

### 3b. Tạo Blob store (cho "Lưu ý khách hàng" — ảnh/PDF)
Project → tab **Storage** → **Create** → **Blob** → Connect vào project.
Vercel tự thêm `BLOB_READ_WRITE_TOKEN` vào Environment Variables (mọi môi trường).
Video chỉ dán link nên không tốn Blob; chỉ ảnh + PDF được tải lên (tối đa 20MB/tệp).

> Muốn test upload ở máy local: `vercel env pull server/.env` để kéo `BLOB_READ_WRITE_TOKEN` về.

### 3. Environment Variables (Settings → Environment Variables)

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | (tự có khi connect Neon) |
| `JWT_SECRET` | chuỗi ngẫu nhiên dài |
| `CRON_SECRET` | chuỗi ngẫu nhiên — Vercel tự gắn vào header khi gọi cron |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | từ `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | địa chỉ liên hệ THẬT (`https://job.mtdigital.vn`). Apple trả 403 nếu là tên miền giả như `.local`; Google thì bỏ qua nên rất dễ tưởng đã chạy tốt |
| `BLOB_READ_WRITE_TOKEN` | tự có khi tạo Blob store (xem bước 3b) — dùng cho "Lưu ý khách hàng" (ảnh/PDF) |
| *(AI — tuỳ chọn)* `GEMINI_API_KEY` | key AI Studio (cách đơn giản nhất trên Vercel) |
| *(AI — OAuth)* `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GEMINI_OAUTH_REFRESH_TOKEN`, `GOOGLE_OAUTH_REDIRECT` | redirect = `https://<domain>/api/oauth2/callback` |

> ⚠️ `GEMINI_BASE_URL` (cliproxyapi localhost trên Mac) **không dùng được trên Vercel**.
> Không cấu hình AI thì chat chạy chế độ heuristic — vẫn ghi nhận task bình thường.

Sau khi thêm env → **Redeploy** (Deployments → ⋯ → Redeploy).

### 4. Khởi tạo dữ liệu (chạy 1 lần, từ máy local)
`server/.env` đã có `DATABASE_URL` (bước 2):
```bash
npm run setup-db --prefix server
```
Tạo bảng + seed config/danh mục task/ngày lễ/**13 thành viên** + admin (`admin@mtjob.local / Admin@2026` — đổi ngay).

### 5. Kiểm tra
- `https://<domain>/api/health` → JSON `{ok:true, env:{databaseUrl:true, ...}}`.
- Đăng nhập admin → Quản trị → đặt mật khẩu thành viên.
- **Settings → Cron Jobs**: 2 job `15 10 * * *` (= 17:15 VN) và `30 1 1 * *` (= 08:30 VN ngày 1).
- Test cron tay: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/jobs/daily`

### 6. Lịch chạy cho NHẮC HẸN (bắt buộc, không có thì nhắc hẹn trễ)

Hai cron trong `vercel.json` chỉ lo báo cáo ngày/tháng. **Nhắc hẹn cần quét vài phút một
lần** mà gói Hobby không cho — nên phải gắn một dịch vụ cron ngoài:

1. Mở [cron-job.org](https://cron-job.org) (miễn phí) → **Create cronjob**.
2. URL: `https://<domain>/api/jobs/reminders` · Method **GET** · Every **5 minutes**.
3. Tab **Advanced → Headers**, thêm một dòng:
   `Authorization: Bearer <CRON_SECRET>` — đúng chuỗi đã đặt trong Vercel env.
4. Bấm chạy thử, phải nhận `{"ok":true,"job":"reminders","sent":0}`.
   Trả `401` là sai `CRON_SECRET`.

Chưa gắn thì nhắc hẹn **chỉ bắn khi có người mở app** (middleware tự quét, 5 phút/lần) —
hẹn 08:00 mà 08:49 mới có người vào thì 08:49 mới báo. Quá 3 tiếng không ai mở app thì
mất luôn lần nhắc đó (`graceMinutes` trong `lib/reminder.ts`).

## Giới hạn cần biết (gói Hobby)

- **Cron Hobby tối đa 2 job, mỗi job 1 lần/ngày, giờ chạy có thể lệch trong ~1 tiếng** — đủ cho báo cáo ngày/tháng.
- **Không đủ cho nhắc hẹn** — xem bước 6. Lên gói Pro thì thêm thẳng vào `vercel.json`:
  `{ "path": "/api/jobs/reminders", "schedule": "*/5 * * * *" }` và bỏ cron ngoài đi.
- Function timeout 60s (`vercel.json`); nếu thiếu thì bật Fluid Compute / tăng `maxDuration`.
- Neon free tier có thể "ngủ" khi lâu không dùng → request đầu tiên hơi chậm (~1s đánh thức).
