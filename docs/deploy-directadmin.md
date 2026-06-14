# Cài MTJOB lên DirectAdmin (toàn quyền máy chủ / root)

Mô hình: **PM2 chạy API Node** (kèm cron) nghe `127.0.0.1:8080` → **Apache của DirectAdmin reverse proxy `/api`** về nó; **frontend tĩnh** nằm trong `public_html`; **DB giữ ở Neon** (Postgres cloud). Cùng 1 domain nên không vướng CORS.

```
Trình duyệt ──> https://app.tenmien.vn ──> Apache (DirectAdmin) ──┬── /            -> public_html (web/dist)
                                                                  └── /api/*       -> 127.0.0.1:8080 (PM2: Node API) ──> Neon
```

## 0. Yêu cầu
- SSH **root**, domain đã thêm trong DirectAdmin (vd `app.tenmien.vn`), đã bật SSL Let's Encrypt cho domain đó.
- `DATABASE_URL` của Neon (đang dùng) + các secret (JWT, VAPID, CRON, GEMINI_API_KEY).

## 1. Cài Node 20 + PM2 + git (root)
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -   # CentOS/AlmaLinux (DirectAdmin hay dùng)
yum install -y nodejs git                                   # hoặc: apt install -y nodejs git
npm i -g pm2
node -v   # >= 20
```

## 2. Lấy mã nguồn
Đặt API ngoài public_html (không để lộ mã nguồn server). Ví dụ trong home của user sở hữu domain (giả sử user `mtweb`):
```bash
cd /home/mtweb
git clone https://github.com/mitaweb/mtjob.git
cd mtjob
npm install --prefix server
npm install --prefix web
```

## 3. Cấu hình `server/.env`
```bash
nano /home/mtweb/mtjob/server/.env
```
Nội dung tối thiểu:
```
PORT=8080
HOST=127.0.0.1
APP_TZ=Asia/Ho_Chi_Minh
DATABASE_URL=postgresql://...neon...   # connection string Neon
JWT_SECRET=<chuỗi ngẫu nhiên dài>
CRON_SECRET=<chuỗi ngẫu nhiên>
VAPID_PUBLIC_KEY=<...>
VAPID_PRIVATE_KEY=<...>
VAPID_SUBJECT=mailto:admin@tenmien.vn
GEMINI_API_KEY=<key AI Studio, tuỳ chọn>
```
> `HOST=127.0.0.1` để API chỉ nghe nội bộ (chỉ Apache proxy vào được).

## 4. Khởi tạo CSDL (1 lần — nếu DB Neon đã seed trước thì bỏ qua)
```bash
npm run setup-db --prefix server
```

## 5. Chạy API bằng PM2 (kèm cron tự động)
```bash
cd /home/mtweb/mtjob/server
pm2 start "npm run start" --name mtjob-api
pm2 save
pm2 startup    # chạy dòng lệnh nó in ra để tự bật khi reboot
pm2 logs mtjob-api   # xem log, Ctrl+C để thoát
```
node-cron chạy ngay trong tiến trình này → **báo cáo ngày/tháng tự chạy, không cần Cron Job của DirectAdmin**.

## 6. Build & đưa frontend vào public_html
Frontend gọi `/api` cùng domain nên **không cần** đặt `VITE_API_BASE`.
```bash
cd /home/mtweb/mtjob
npm run build --prefix web
# Copy nội dung dist vào public_html của domain:
cp -r web/dist/* /home/mtweb/domains/app.tenmien.vn/public_html/
```

### `.htaccess` cho SPA (đặt trong public_html)
```bash
nano /home/mtweb/domains/app.tenmien.vn/public_html/.htaccess
```
```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^api/ - [L]                 # /api để Apache proxy lo, không rewrite
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]           # mọi route khác -> SPA
</IfModule>
<FilesMatch "sw\.js$">
  Header set Cache-Control "no-cache"
</FilesMatch>
```

## 7. Reverse proxy `/api` → 127.0.0.1:8080
Đảm bảo Apache có mod_proxy (DirectAdmin thường bật sẵn). Trên DirectAdmin:
**Admin/User Level → Domain Setup → app.tenmien.vn → Custom HTTPD Configurations** → dán vào (cả khối SSL 443):
```apache
ProxyPreserveHost On
ProxyPass /api http://127.0.0.1:8080/api
ProxyPassReverse /api http://127.0.0.1:8080/api
RequestHeader set X-Forwarded-Proto "https"
```
Rồi rebuild cấu hình web:
```bash
cd /usr/local/directadmin/custombuild
./build rewrite_confs
```
> Nếu máy dùng **Nginx/OpenLiteSpeed reverse proxy** trước Apache thì directive khác — báo em biết web server nào em đưa cấu hình đúng.

## 8. Tường lửa
Chặn cổng 8080 từ ngoài (chỉ Apache nội bộ gọi). Vì đã `HOST=127.0.0.1` nên cổng 8080 không listen ra ngoài — không cần mở firewall cho nó.

## 9. Kiểm tra
- `https://app.tenmien.vn/api/health` → JSON `{ok:true, env:{databaseUrl:true,...}}`.
- Mở `https://app.tenmien.vn` → đăng nhập `hotam / 123456` (hoặc admin nếu chưa xoá).

## Cập nhật về sau
```bash
cd /home/mtweb/mtjob && git pull
npm install --prefix server && npm install --prefix web
npm run build --prefix web
cp -r web/dist/* /home/mtweb/domains/app.tenmien.vn/public_html/
pm2 restart mtjob-api
```

## Ghi chú
- DB vẫn ở **Neon** — không dùng MySQL của DirectAdmin. Nếu muốn DB nội bộ, cài Postgres trên chính server (`yum install postgresql-server`) rồi đổi `DATABASE_URL` về `localhost`.
- API chạy `tsx` (không cần build server). Muốn nhẹ hơn có thể bundle bằng esbuild — báo em nếu cần.
- HTTPS (SSL Let's Encrypt của DirectAdmin) là bắt buộc để GPS chấm công + Web Push hoạt động.
