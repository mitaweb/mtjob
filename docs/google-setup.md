# Thiết lập Google (Service Account + Sheets + Drive + Gemini)

## 1. Tạo project & bật API
1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project (vd `mtjob`).
2. **APIs & Services → Enable APIs**, bật:
   - Google Sheets API
   - Google Drive API
   - Generative Language API (Gemini)

## 2. Tạo Service Account
1. **IAM & Admin → Service Accounts → Create**.
2. Tạo key JSON: **Keys → Add key → JSON** → tải về, lưu là `server/service-account.json`.
3. Lấy **email** của service account (dạng `xxx@yyy.iam.gserviceaccount.com`).

## 3. Tạo Google Sheet CSDL & chia sẻ
1. Tạo 1 Google Sheet trống. Copy **ID** từ URL (`/d/<ID>/edit`) → điền `SHEET_DB_ID`.
2. **Share** Sheet đó cho email service account, quyền **Editor**.

## 4. Sheet nhân sự nguồn
- ID mặc định đã có sẵn trong `.env.example` (`SHEET_HR_SOURCE_ID`).
- Khi chạy production: **Share** sheet nhân sự nguồn cho email service account (quyền **Viewer**).
- 6 cột cố định, KHÔNG có dòng tiêu đề: `Họ tên | Chức vụ | Mức lương | BHXH | Ngày vào làm | Năm sinh`.
  - Chức vụ gộp team + vai trò: `Ads`, `SEO`, `Content`, `Ads Leader`, `Content Leader`, `SEO Leader`, `Giám đốc`.

## 5. Gemini (trợ lý chat) — OAuth Google
1. **APIs & Services → OAuth consent screen**: cấu hình (Internal nếu dùng Workspace), thêm scope
   `https://www.googleapis.com/auth/generative-language.retriever`.
2. **Credentials → Create Credentials → OAuth client ID**, kiểu **Web application**:
   - Authorized redirect URI: `http://localhost:8080/api/oauth2/callback` (thêm domain prod nếu có).
3. Copy Client ID/Secret → `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` trong `.env`.
4. Chạy server (`npm run dev --prefix server`), rồi `npm run gemini-auth --prefix server`:
   mở URL → đăng nhập & đồng ý → trang callback hiển thị `GEMINI_OAUTH_REFRESH_TOKEN` → dán vào `.env` → khởi động lại.
   - **Dự phòng**: dùng API key tại [aistudio.google.com](https://aistudio.google.com/apikey) → `GEMINI_API_KEY` (bỏ qua OAuth).

## 6. VAPID (Web Push)
```bash
npx --prefix server web-push generate-vapid-keys
```
Điền `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` vào `server/.env` và `VITE_VAPID_PUBLIC_KEY` (nếu cần) vào `web/.env`.

## 7. Khởi tạo dữ liệu
```bash
npm run setup-sheet --prefix server     # tạo tab + seed + admin
npm run sync-members --prefix server    # import nhân sự
```

> Lưu ý: service account **không tốn quota người dùng**; mọi thao tác đọc/ghi Sheet đều qua tài khoản này.
