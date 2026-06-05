# Cấu trúc dữ liệu (các tab Google Sheet)

Nguồn chân lý: `server/src/sheets/schema.ts` (script `setup-sheet` tạo đúng theo đây).

| Tab | Cột |
|---|---|
| `Members` | MemberID, FullName, DOB, Position, TeamID, Role, Salary, BHXH, JoinDate, Email, PasswordHash, Active |
| `Teams` | TeamID, TeamName, LeaderMemberID |
| `TaskCatalog` | TaskCode, TaskName, Points, Active, Note |
| `Tasks` | TaskID, CreatedAt, MemberID, MemberName, TeamID, TaskCode, TaskName, Points, CompletedAt, Source, Note |
| `Attendance` | Date, MemberID, Name, MorningInAt, MorningOutAt, AfternoonInAt, AfternoonOutAt, Lat, Lng, DistM, DayFraction, Mode, Status, Note |
| `OnlineRequests` | ReqID, MemberID, Name, Dates, Scope, Reason, LeaderStatus, LeaderBy, LeaderAt, DirectorStatus, DirectorBy, DirectorAt, FinalStatus, CreatedAt |
| `LeaveRequests` | ReqID, MemberID, Name, Dates, Type, Reason, LeaderStatus, LeaderBy, LeaderAt, DirectorStatus, DirectorBy, DirectorAt, FinalStatus, CreatedAt |
| `Holidays` | Date, Name, Year |
| `Config` | Key, Value |
| `PushSubscriptions` | SubID, MemberID, Endpoint, P256dh, Auth, UA, CreatedAt |
| `Notifications` | NotifID, MemberID, Type, Title, Body, CreatedAt, ReadAt |
| `MonthlyScores` | Year, Month, MemberID, TotalPoints, Rank, BonusVND |
| `Payroll` | Year, Month, MemberID, StandardDays, ActualDays, GrossSalary, BHXH, NetSalary |

## Khoá & quy ước
- `Members`: khoá `MemberID`. `Active` = `TRUE/FALSE`. `Role` ∈ member/leader/director/admin.
- `Attendance`: khoá ghép (`Date` + `MemberID`). `DayFraction` ∈ {0, 0.5, 1}. `Mode` ∈ office/online/leave/holiday.
- `Tasks`: ghi nối (append). Điểm lấy từ `TaskCatalog` theo `TaskCode`.

## Config (Key/Value)
| Key | Mặc định | Ý nghĩa |
|---|---|---|
| companyLat / companyLng | 10.762622 / 106.660172 | Toạ độ công ty (đổi theo thực tế) |
| checkinRadiusM | 150 | Bán kính cho phép chấm công (m) |
| morningStart / morningEnd | 08:30 / 12:00 | Ca sáng |
| afternoonStart / afternoonEnd | 13:30 / 17:00 | Ca chiều |
| dailyReportTime | 18:00 | Giờ gửi báo cáo ngày |
| monthlyReportDay | 1 | Ngày gửi tổng kết tháng (08:30) |
| bonusThreshold / bonusStep / bonusAmount | 6000 / 1000 / 800000 | Công thức thưởng |
| bhxhMode | direct | `direct` = trừ thẳng cột BHXH; `percent` = 10.5% × cơ sở |
| tz | Asia/Ho_Chi_Minh | Múi giờ |
