# Triển khai lên VPS (Ubuntu + Nginx + PM2)

## 1. Chuẩn bị máy
```bash
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

## 2. Mã nguồn & cấu hình
```bash
git clone <repo> /var/www/mtjob && cd /var/www/mtjob
npm install --prefix server
npm install --prefix web

# Bí mật
cp .env.example server/.env        # điền DATABASE_URL (Postgres), VAPID, JWT_SECRET...

# Khởi tạo dữ liệu (1 lần): bảng + seed + thành viên + admin
npm run setup-db --prefix server
# (tuỳ chọn) bật AI: GEMINI_API_KEY, hoặc npm run gemini-auth --prefix server (OAuth)
```

## 3. Build frontend
```bash
npm run build --prefix web        # ra web/dist (file tĩnh)
```

## 4. Chạy API bằng PM2
```bash
cd /var/www/mtjob/server
pm2 start "npm run start" --name mtjob-api
pm2 save && pm2 startup
```
PM2 giữ tiến trình API (kèm cron báo cáo) chạy nền và tự khởi động lại.

## 5. Nginx (phục vụ PWA tĩnh + proxy /api)
`/etc/nginx/sites-available/mtjob`:
```nginx
server {
  listen 80;
  server_name mtjob.example.com;

  root /var/www/mtjob/web/dist;
  index index.html;

  # PWA SPA: mọi route -> index.html
  location / {
    try_files $uri /index.html;
  }

  # API
  location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  # Service worker không cache
  location = /sw.js { add_header Cache-Control "no-cache"; }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/mtjob /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. HTTPS (bắt buộc cho PWA + Web Push + GPS)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mtjob.example.com
```
> Geolocation và Web Push **chỉ hoạt động trên HTTPS** (hoặc localhost). iOS cần "Thêm vào màn hình chính" để nhận push.

## 7. Cron báo cáo
Đã đăng ký sẵn trong API qua `node-cron` (đọc giờ từ `Config`). Không cần cron hệ điều hành.
Muốn chạy tay: `npm run job:daily` / `npm run job:monthly` (trong `server/`).

## Cập nhật
```bash
cd /var/www/mtjob && git pull
npm install --prefix server && npm install --prefix web
npm run build --prefix web
pm2 restart mtjob-api
```
