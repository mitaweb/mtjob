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

### 3. Environment Variables (Settings → Environment Variables)

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | (tự có khi connect Neon) |
| `JWT_SECRET` | chuỗi ngẫu nhiên dài |
| `CRON_SECRET` | chuỗi ngẫu nhiên — Vercel tự gắn vào header khi gọi cron |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | từ `npx web-push generate-vapid-keys` |
| *(AI — tuỳ chọn)* `GEMINI_API_KEY` | key AI Studio (cách đơn giản nhất trên Vercel) |
| *(AI — OAuth)* `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GEMINI_OAUTH_REFRESH_TOKEN`, `GOOGLE_OAUTH_REDIRECT` | redirect = `https://<domain>/api/oauth2/callback` |
| *(tuỳ chọn)* `SHEET_HR_SOURCE_ID` / `SHEET_HR_SOURCE_GID` | cho nút "Đồng bộ nhân sự" (sheet phải share công khai) |

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
- **Settings → Cron Jobs**: 2 job `0 11 * * *` (= 18:00 VN) và `30 1 1 * *` (= 08:30 VN ngày 1).
- Test cron tay: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/jobs/daily`

## Giới hạn cần biết (gói Hobby)

- **Cron Hobby tối đa 2 job, mỗi job 1 lần/ngày, giờ chạy có thể lệch trong ~1 tiếng** — đủ cho báo cáo ngày/tháng.
- Function timeout 60s (`vercel.json`); nếu thiếu thì bật Fluid Compute / tăng `maxDuration`.
- Neon free tier có thể "ngủ" khi lâu không dùng → request đầu tiên hơi chậm (~1s đánh thức).
