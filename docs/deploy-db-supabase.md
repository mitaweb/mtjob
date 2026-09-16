# Chuyển DATABASE từ Neon sang Supabase (app vẫn ở Vercel)

Lý do: Neon Free chỉ cho 100 giờ-compute/tháng, app dùng cả ngày là hết (tháng 9/2026 hết
91% sau 16 ngày). Supabase Free **không giới hạn giờ chạy**, cùng vùng Singapore với
Vercel `sin1`, có pgvector. Không sửa code: driver thấy URL không phải Neon thì tự dùng
`pg` thường (`server/src/db/client.ts`).

Giới hạn Free cần nhớ: 0,5 GB dữ liệu (đang dùng 0,04), 5 GB truyền tải/tháng (đang dùng
~0,4), **không có backup tự động** (xem bước 5), tạm dừng nếu 7 ngày không ai truy cập
(app dùng hằng ngày nên không dính).

## 1. Tạo project

[supabase.com](https://supabase.com) → **New project**:
- Name: `mtjob`
- Database password: bấm **Generate** rồi **lưu lại ngay** — Supabase không cho xem lại.
- Region: **Southeast Asia (Singapore)** — bắt buộc, để cùng vùng với Vercel.

Đợi ~2 phút cho project sẵn sàng.

## 2. Bật pgvector

Dashboard → **Database → Extensions** → tìm `vector` → bật. (Hoặc SQL Editor:
`create extension if not exists vector;`)

## 3. Lấy chuỗi kết nối cho Vercel

Dashboard → **Connect** (nút trên cùng) → tab **Transaction pooler** (cổng **6543**):
```
postgresql://postgres.<ref>:<MẬT-KHẨU>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```
**Không thêm `?sslmode=require`.** Pooler Supabase dùng chứng chỉ tự ký; app đã tự bật SSL
không xác thực chứng chỉ, còn `sslmode=require` trong URL làm `pg` đòi xác thực đầy đủ và
văng `SELF_SIGNED_CERT_IN_CHAIN`. (Driver đã tự bỏ tham số này — `stripSslMode` trong
`client.ts` — nhưng đừng tự thêm vào cho khỏi rối.)

> Dùng **pooler**, không dùng *Direct connection*: kết nối trực tiếp ở gói Free chỉ có IPv6,
> Vercel không gọi ra IPv6 được. Transaction pooler còn gom kết nối của nhiều instance
> serverless lại — mỗi instance Vercel mở tối đa 3 kết nối (`max: 3` trong client.ts).

## 4. Chuyển dữ liệu từ Neon sang (1 lần, ngoài giờ làm)

Cần `pg_dump` + `psql`. Trên Windows cài một lần:
```powershell
winget install PostgreSQL.PostgreSQL.16
```
rồi mở PowerShell **mới** (để có `pg_dump` trong PATH; không có thì gọi thẳng
`"C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"`).

Chuỗi **nguồn** Neon: lấy host **không có `-pooler`** (pooler không cho dump).
Chuỗi **đích** Supabase: dùng **Session pooler** (cổng **5432**, tab *Session pooler* ở nút
Connect) — dump nhiều câu lệnh cần một phiên cố định, transaction pooler không hợp.

```powershell
$NEON = "postgresql://neondb_owner:<MẬT-KHẨU-NEON>@ep-twilight-sky-ao62bcei.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
$SUPA = "postgresql://postgres.<ref>:<MẬT-KHẨU-SUPABASE>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"

pg_dump $NEON --no-owner --no-privileges --no-comments -f mtjob.sql
(Get-Content mtjob.sql) -notmatch '^(CREATE EXTENSION|COMMENT ON EXTENSION)' | Set-Content mtjob-clean.sql -Encoding utf8
psql $SUPA -v ON_ERROR_STOP=1 -f mtjob-clean.sql
```

- Bỏ dòng `CREATE EXTENSION`: đã bật ở bước 2, để dump tự tạo sẽ báo lỗi quyền.
- `ON_ERROR_STOP`: có lỗi là dừng ngay, không chuyển nửa vời.
- File `mtjob.sql` chứa toàn bộ dữ liệu công ty — **xoá sau khi xong**, đừng để trong thư
  mục đồng bộ cloud.

**Đối chiếu**: chạy ở cả Neon SQL Editor lẫn Supabase SQL Editor, hai kết quả phải giống:
```sql
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;
```
Bảng lớn nhất kiểm chắc thêm: `SELECT count(*) FROM tasks;`

Làm ngoài giờ làm việc: trong lúc dump mà nhân viên ghi việc mới trên Neon thì dòng đó không sang.

## 5. Trỏ Vercel sang Supabase

Vercel → Settings → Environment Variables → `DATABASE_URL` (Production) → Edit → dán chuỗi
**Transaction pooler** ở bước 3 → Save → **Deployments → Redeploy**.

Kiểm: `https://job.mtdigital.vn/api/health` trả `ok:true`; đăng nhập; mở Bảng lương tháng 8
— số phải y hệt lúc còn trên Neon.

Giữ Neon thêm vài ngày để quay lui được (đổi lại `DATABASE_URL`, redeploy). Ổn rồi thì xoá
project Neon — mật khẩu Neon đã lộ trong chat, xoá project là hết chuyện.

## 6. Backup (Free không tự làm)

Chạy hằng tuần trên máy DirectAdmin (root, đã có `psql`/`pg_dump` — cài `postgresql16`
client nếu chưa):
```bash
mkdir -p /var/backups/mtjob
cat >/etc/cron.d/mtjob-backup <<'CRON'
0 3 * * 0 root pg_dump "postgresql://postgres.<ref>:<MẬT-KHẨU>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require" -Fc -f /var/backups/mtjob/mtjob-$(date +\%F).dump && find /var/backups/mtjob -name '*.dump' -mtime +60 -delete
CRON
```
Khôi phục: `pg_restore -d "<chuỗi Session pooler>" --clean --if-exists mtjob-2026-09-21.dump`.

Không có máy chủ thì chạy tay trên Windows mỗi tuần một lệnh `pg_dump ... -Fc -f mtjob.dump`.

## 7. Cron nhắc hẹn

Giữ job cron-job.org gọi `/api/jobs/reminders`. Supabase không có hạn mức giờ chạy nên
đặt lại **mỗi 5 phút** cho nhắc hẹn đúng giờ (xem `deploy-vercel.md` bước 6).
