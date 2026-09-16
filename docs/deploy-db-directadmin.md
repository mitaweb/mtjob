# Chuyển DATABASE về máy chủ DirectAdmin (app vẫn ở Vercel)

Mô hình: **Vercel giữ nguyên** (frontend + API serverless). Chỉ **PostgreSQL** chuyển từ Neon
về máy chủ riêng của anh Tâm. Không sửa một dòng code nào ở tầng dữ liệu — driver đã tự
nhận URL không phải Neon thì dùng `pg` thường (`server/src/db/client.ts`).

```
Trình duyệt ──> Vercel (sin1) ──> https://job.mtdigital.vn ──> API serverless ──> PostgreSQL trên máy DirectAdmin (cổng 5432, SSL)
```

Lý do rời Neon: gói Free chỉ 100 giờ-compute/tháng, app dùng cả ngày làm việc là sát trần
(tháng 9/2026 hết 91% sau 16 ngày). Xem `deploy-vercel.md` phần giới hạn.

## 0. Yêu cầu

- Máy DirectAdmin phải là **VPS/máy riêng có SSH root**. Hosting DirectAdmin dùng chung
  (không root) **không cài được Postgres** — dừng ở đây nếu là trường hợp đó.
- Máy có **IP tĩnh công khai** và mở được cổng 5432 (Vercel gói Hobby không có IP cố định,
  nên không chặn theo IP nguồn được — bảo vệ bằng SSL + mật khẩu mạnh + SCRAM).
- Đã sửa `vercel.json` thêm `"regions": ["sin1"]` (đã có trong repo) — hàm chạy ở
  Singapore thay vì Mỹ, gần Việt Nam nhất trong các vùng Vercel.

## 1. Cài PostgreSQL 16 + pgvector (root)

**AlmaLinux / Rocky / CentOS 9** (DirectAdmin hay dùng):
```bash
dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm
dnf -qy module disable postgresql
dnf install -y postgresql16-server postgresql16-contrib pgvector_16
/usr/pgsql-16/bin/postgresql-16-setup initdb
systemctl enable --now postgresql-16
```

**Ubuntu / Debian:**
```bash
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-16 postgresql-16-pgvector
systemctl enable --now postgresql
```

Kiểm: `sudo -u postgres psql -c "select version();"`

## 2. Tạo role + database

Sinh mật khẩu mạnh (không tự nghĩ): `openssl rand -base64 32` → ghi lại, dùng ở bước 5.

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE mtjob LOGIN PASSWORD '<MẬT-KHẨU-VỪA-SINH>';
CREATE DATABASE mtjob OWNER mtjob;
\c mtjob
CREATE EXTENSION IF NOT EXISTS vector;
SQL
```

`CREATE EXTENSION vector` chạy bằng `postgres` (superuser) vì role thường không được tạo
extension. App gọi lại `CREATE EXTENSION IF NOT EXISTS` sẽ thấy đã có, không lỗi.

## 3. Cho phép kết nối từ ngoài, bắt buộc SSL

Đường dẫn cấu hình: EL `/var/lib/pgsql/16/data/`, Debian `/etc/postgresql/16/main/`.

**Chứng chỉ SSL** — tự ký là đủ (driver app đặt `rejectUnauthorized: false`, chỉ cần mã hoá
đường truyền, không cần xác thực tên máy):
```bash
cd /var/lib/pgsql/16/data   # hoặc /etc/postgresql/16/main
openssl req -new -x509 -days 3650 -nodes -text -subj "/CN=job.mtdigital.vn" -out server.crt -keyout server.key
chown postgres:postgres server.key server.crt && chmod 600 server.key
```

**postgresql.conf** — sửa/thêm:
```
listen_addresses = '*'
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file  = 'server.key'
password_encryption = scram-sha-256
max_connections = 100
```

**pg_hba.conf** — thêm cuối file (chỉ nhận SSL, chỉ role `mtjob`, chỉ DB `mtjob`):
```
hostssl  mtjob  mtjob  0.0.0.0/0  scram-sha-256
hostssl  mtjob  mtjob  ::/0       scram-sha-256
```
Và **không** có dòng `host` (không SSL) nào mở ra ngoài.

```bash
systemctl restart postgresql-16   # Debian: postgresql
```

**Firewall**: mở 5432. DirectAdmin thường dùng CSF:
```bash
# /etc/csf/csf.conf → thêm 5432 vào TCP_IN, rồi:
csf -r
```
Không CSF thì `firewall-cmd --permanent --add-port=5432/tcp && firewall-cmd --reload`
(hoặc `ufw allow 5432/tcp`).

Kiểm từ máy ngoài (máy Windows của anh, cần `psql`; hoặc từ chính máy chủ với IP công khai):
```bash
psql "postgresql://mtjob:<MẬT-KHẨU>@<IP-MÁY-CHỦ>:5432/mtjob?sslmode=require" -c "select 1"
```

## 4. Chuyển dữ liệu từ Neon sang (chạy TRÊN máy chủ, 1 lần)

Kéo thẳng từ Neon vào máy — không qua file trung gian, không mất dòng nào:
```bash
NEON='postgresql://neondb_owner:<MẬT-KHẨU-NEON>@ep-twilight-sky-ao62bcei.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
LOCAL='postgresql://mtjob:<MẬT-KHẨU>@127.0.0.1:5432/mtjob'

/usr/pgsql-16/bin/pg_dump "$NEON" --no-owner --no-privileges --no-comments \
  | grep -v '^CREATE EXTENSION\|^COMMENT ON EXTENSION' \
  | psql "$LOCAL" -v ON_ERROR_STOP=1
```
- Dùng host **không có `-pooler`** cho `pg_dump` (pooler không hỗ trợ dump).
- `grep -v CREATE EXTENSION`: extension đã tạo ở bước 2 bằng superuser; để dump tự tạo sẽ
  lỗi quyền.
- Có lỗi thì dừng ngay (`ON_ERROR_STOP`) — không chuyển nửa vời.

**Đối chiếu số dòng** — chạy câu này ở CẢ HAI bên (Neon SQL Editor và máy chủ), hai bảng
phải giống hệt:
```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;
```
Với bảng nhỏ `n_live_tup` có thể lệch vài đơn vị do thống kê; muốn chắc thì
`SELECT count(*) FROM tasks;` (bảng lớn nhất) ở cả hai bên.

Làm bước này ngoài giờ làm việc (tối hoặc cuối tuần): trong lúc chuyển mà nhân viên ghi
việc mới trên Neon thì dòng đó không sang.

## 5. Trỏ Vercel sang máy chủ

Vercel → Settings → Environment Variables → `DATABASE_URL` (Production) → Edit:
```
postgresql://mtjob:<MẬT-KHẨU>@<IP-MÁY-CHỦ>:5432/mtjob?sslmode=require
```
Rồi **Deployments → Redeploy**. Kiểm `https://job.mtdigital.vn/api/health` trả `ok:true`,
đăng nhập, mở Bảng lương tháng 8 — số phải y hệt lúc còn trên Neon.

Sau khi đổi, mật khẩu Neon cũ (đã lộ trong chat) không còn ý nghĩa; vẫn nên xoá project
Neon hoặc đổi mật khẩu để khỏi ai vào được dữ liệu cũ.

## 6. Backup hằng đêm (root)

```bash
mkdir -p /var/backups/mtjob && chown postgres /var/backups/mtjob
cat >/etc/cron.d/mtjob-backup <<'CRON'
30 2 * * * postgres /usr/pgsql-16/bin/pg_dump -Fc mtjob > /var/backups/mtjob/mtjob-$(date +\%F).dump && find /var/backups/mtjob -name '*.dump' -mtime +30 -delete
CRON
```
Khôi phục: `pg_restore -d mtjob --clean --if-exists /var/backups/mtjob/mtjob-2026-09-20.dump`.
Copy thư mục backup ra máy khác định kỳ — backup nằm cùng máy với DB thì cháy máy là mất cả hai.

## 7. Nhắc hẹn vẫn cần cron ngoài

App vẫn là serverless trên Vercel nên không tự quét được — giữ job cron-job.org gọi
`/api/jobs/reminders`. **Khác trước:** DB máy riêng không có hạn mức compute, nên đặt lại
**mỗi 5 phút** cho nhắc hẹn đúng giờ.

## Quay lui

Đổi `DATABASE_URL` trên Vercel về chuỗi Neon, redeploy. Dữ liệu trên Neon vẫn còn nguyên
tới khi anh chủ động xoá — nhưng những gì ghi trên máy chủ mới sau lúc chuyển sẽ không có ở Neon.

## Độ trễ — điều cần biết trước

Trên Neon, hàm Vercel (Mỹ) đi tới DB (Singapore) mất ~200ms mỗi câu SQL. Sau khi chuyển:
hàm ở Singapore → DB ở Việt Nam ~30–50ms mỗi câu. Nhanh hơn hiện tại, nhưng chậm hơn nếu cả
app lẫn DB cùng nằm trên máy anh (xem `deploy-directadmin.md`). Trang nào hiện thấy chậm
rõ rệt sau khi chuyển thì báo — thường là do một màn hình bắn quá nhiều câu SQL nối tiếp.
