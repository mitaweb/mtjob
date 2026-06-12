# Cấu trúc dữ liệu (Postgres)

Nguồn chân lý: `server/src/db/schema.ts` (script `setup-db` tạo đúng theo đây).
Ngày/giờ lưu dạng text ISO (`YYYY-MM-DD`, ISO datetime) — so sánh theo thứ tự từ điển.

| Bảng | Cột chính |
|---|---|
| `members` | member_id (PK), full_name, dob, position, team_id, role, salary, bhxh, join_date, email, password_hash, active |
| `teams` | team_id (PK), team_name, leader_member_id |
| `task_catalog` | task_code (PK), task_name, points, active, note |
| `tasks` | task_id (PK), created_at, member_id, member_name, team_id, task_code, task_name, points, completed_at, source, note |
| `attendance` | (date, member_id) PK, name, morning_in_at/out, afternoon_in_at/out, lat, lng, dist_m, day_fraction, mode, status, note |
| `requests` | req_id (PK), kind (online/leave), member_id, name, dates, scope, type, reason, leader_*/director_* status-by-at, final_status, created_at |
| `holidays` | date (PK), name, year |
| `config` | key (PK), value |
| `push_subscriptions` | endpoint (PK), sub_id, member_id, p256dh, auth, ua, created_at |
| `notifications` | notif_id (PK), member_id, type, title, body, created_at, read_at |
| `monthly_scores` | (year, month, member_id) PK, total_points, rank, bonus_vnd |
| `payroll` | (year, month, member_id) PK, standard_days, actual_days, gross_salary, bhxh, net_salary |

## Quy ước
- `members.role` ∈ member / leader / director / admin. `attendance.day_fraction` ∈ {0, 0.5, 1}.
- `attendance.mode` ∈ office / online / leave / holiday. `requests.final_status` ∈ pending / approved / rejected.
- `tasks` ghi nối (append); điểm lấy từ `task_catalog` theo `task_code`.
- **Retention:** job đầu tháng tự xoá `notifications` cũ hơn 90 ngày + subscription push chết (404/410) bị xoá ngay khi gửi — DB giữ ổn định ~vài chục MB nhiều năm (dư trong 500MB free của Neon).

## Config (key/value)
| Key | Mặc định | Ý nghĩa |
|---|---|---|
| companyLat / companyLng | 10.762622 / 106.660172 | Toạ độ công ty (đổi theo thực tế) |
| checkinRadiusM | 150 | Bán kính cho phép chấm công (m) |
| morningStart / morningEnd | 08:30 / 12:00 | Ca sáng |
| afternoonStart / afternoonEnd | 13:30 / 17:00 | Ca chiều |
| dailyReportTime | 18:00 | Giờ gửi báo cáo ngày (chế độ node-cron) |
| monthlyReportDay | 1 | Ngày gửi tổng kết tháng |
| bonusThreshold / bonusStep / bonusAmount | 6000 / 1000 / 800000 | Công thức thưởng |
| bhxhMode | direct | `direct` = trừ thẳng cột BHXH; `percent` = 10.5% × cơ sở |
| tz | Asia/Ho_Chi_Minh | Múi giờ |
