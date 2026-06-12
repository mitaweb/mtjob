# Triển khai lên Vercel (qua GitHub)

Repo đã cấu hình sẵn cho Vercel: `vercel.json` + serverless entry `api/index.ts`.
Mỗi lần push lên `main` → Vercel tự build & deploy.

## Kiến trúc trên Vercel

| Thành phần | Trên VPS/Mac | Trên Vercel |
|---|---|---|
| Frontend PWA | Vite dev / Nginx | Build tĩnh → CDN (`web/dist`) |
| API Express | tiến trình Node (`npm run dev`) | 1 serverless function (`api/index.ts`) |
| Báo cáo định kỳ | `node-cron` trong tiến trình | **Vercel Cron** gọi `/api/jobs/daily` & `/api/jobs/monthly` |
| Service account | file `service-account.json` | biến `GOOGLE_SERVICE_ACCOUNT_JSON` |

## Các bước

### 1. Import repo
1. Vào [vercel.com/new](https://vercel.com/new) → **Import** repo `mitaweb/mtjob`.
2. **KHÔNG** đổi Root Directory / Build settings — `vercel.json` đã khai báo đủ
   (install 2 package, build `web/`, output `web/dist`, function `api/`).

### 2. Environment Variables (Settings → Environment Variables)

| Biến | Giá trị |
|---|---|
| `SHEET_DB_ID` | ID Google Sheet CSDL |
| `SHEET_HR_SOURCE_ID` | ID sheet nhân sự nguồn (mặc định đã có trong code, nên đặt rõ) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Nội dung** file `service-account.json` (dán nguyên JSON, hoặc base64 nếu dashboard làm hỏng xuống dòng) |
| `JWT_SECRET` | chuỗi ngẫu nhiên dài |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | từ `npx web-push generate-vapid-keys` |
| `CRON_SECRET` | chuỗi ngẫu nhiên — Vercel tự gắn vào header khi gọi cron |
| *(AI — tuỳ chọn)* `GEMINI_API_KEY` | key AI Studio (cách đơn giản nhất trên Vercel) |
| *(AI — OAuth)* `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GEMINI_OAUTH_REFRESH_TOKEN` / `GOOGLE_OAUTH_REDIRECT` | redirect = `https://<domain>/api/oauth2/callback` (thêm vào OAuth client trong Google Console) |

> ⚠️ `GEMINI_BASE_URL=http://localhost:...` (cliproxyapi trên Mac) **không dùng được trên Vercel** —
> serverless không thấy localhost của máy anh. Trên Vercel hãy dùng `GEMINI_API_KEY`/OAuth,
> hoặc để trống (chat rơi về chế độ heuristic vẫn ghi nhận task được).
> `GEMINI_BASE_URL` chỉ dành cho lúc chạy local trên Mac.

### 3. Deploy
Bấm **Deploy**. Sau khi xong, app chạy tại `https://<project>.vercel.app`
(HTTPS sẵn → GPS + Web Push + PWA hoạt động).

### 4. Khởi tạo dữ liệu (chạy 1 lần, từ máy local)
Các script ghi vào Google Sheet nên chạy ở máy nào cũng được:
```bash
npm run setup-sheet --prefix server     # tạo tab + seed + admin
npm run sync-members --prefix server    # import nhân sự
```

### 5. Kiểm tra cron
- **Settings → Cron Jobs** phải thấy 2 job: `0 11 * * *` (= 18:00 VN hằng ngày) và `30 1 1 * *` (= 08:30 VN ngày 1).
- Test tay: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/jobs/daily`

## Giới hạn cần biết (gói Hobby)

- **Cron Hobby tối đa 2 job, mỗi job 1 lần/ngày, giờ chạy có thể lệch trong ~1 tiếng** — đủ cho báo cáo ngày/tháng; cần đúng giờ tuyệt đối thì nâng Pro.
- Function timeout đặt 60s (`vercel.json`); nếu tổng kết tháng chạy sát giới hạn (nhiều thành viên), bật Fluid Compute hoặc tăng `maxDuration`.
- Serverless = nhiều instance song song: cache RAM & hàng đợi ghi chỉ có tác dụng trong từng instance. Với đội ~13 người thì rủi ro va chạm ghi Sheets là không đáng kể.
- `web/dist` không commit vào git — Vercel tự build từ source.
