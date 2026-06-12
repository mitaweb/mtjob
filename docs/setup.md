# Thiết lập hệ thống (Postgres + Gemini + VAPID)

## 1. Tạo CSDL Postgres (1 phút)

**Cách khuyến nghị — Neon qua Vercel:**
1. Vercel → project **mtjob** → tab **Storage** → **Create Database** → chọn **Neon (Postgres)** → Create & Connect.
2. Vercel tự thêm `DATABASE_URL` vào Environment Variables của project.
3. Vào Storage → database vừa tạo → **`.env.local` / Connection string** → copy `DATABASE_URL` về máy, dán vào `server/.env` (để chạy local + script khởi tạo).

**Cách khác:** Supabase / Railway / Postgres tự host — chỉ cần `DATABASE_URL` chuẩn `postgres://user:pass@host/db`.

## 2. Khởi tạo dữ liệu (1 lần, từ máy local)

```bash
npm run setup-db --prefix server
```
Script sẽ: tạo bảng → seed cấu hình (toạ độ, ca làm, công thức thưởng) + danh mục task + ngày lễ 2026 → **seed 13 thành viên** (từ snapshot sheet nhân sự, tự tách team Ads/SEO/Content + leader) → tạo tài khoản admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD` trong `.env`, mặc định `admin@mtjob.local / Admin@2026`).

Sau đó vào app bằng admin → **Quản trị** → đặt mật khẩu cho từng thành viên.

### Đồng bộ lại nhân sự từ Google Sheet (tuỳ chọn)
Nút **"Đồng bộ nhân sự"** trong màn Quản trị (hoặc `npm run sync-members --prefix server`) đọc sheet nguồn qua **CSV công khai** — yêu cầu sheet được share **"Anyone with the link – Viewer"**. Không share thì quản lý thành viên trực tiếp trong app.

## 3. Web Push (VAPID)

```bash
npx --prefix server web-push generate-vapid-keys
```
Điền `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` vào `server/.env` (và env Vercel).

## 4. Gemini cho trợ lý chat (TUỲ CHỌN)

Không cấu hình → chat chạy chế độ heuristic (vẫn ghi nhận task được). Ba cách bật AI:

| Cách | Biến | Ghi chú |
|---|---|---|
| **API key** (đơn giản nhất) | `GEMINI_API_KEY` | Lấy tại [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **OAuth Google** | `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GEMINI_OAUTH_REFRESH_TOKEN`, `GOOGLE_OAUTH_REDIRECT` | Tạo OAuth client (Web) + redirect `https://<domain>/api/oauth2/callback`; chạy `npm run gemini-auth --prefix server` để lấy refresh token |
| **Proxy cục bộ** (cliproxyapi trên Mac) | `GEMINI_BASE_URL` | Chỉ dùng khi chạy local; không dùng được trên Vercel |
