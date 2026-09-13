import { q } from '../db/client.js';

// Khoá THƯỞNG của một tháng — tách khỏi khoá lương (payrollLock.ts).
//
// Anh Tâm 13/9/2026: "thưởng và lương chốt khác nhau". Lương đi theo công; thưởng đi theo
// điểm và kết quả dự án — chốt vào hai lúc khác nhau.
//
// Điểm (bù điểm, xoá việc, áp lại bảng điểm) CHỈ khoá theo khoá thưởng. Bản đầu em còn
// giữ thêm khoá lương cho các tháng chốt lương trước khi có nút này; anh Tâm gặp ngay:
// tháng 8 chốt lương rồi mà chưa chốt thưởng, cần dọn việc ghi trùng thì bị chặn "đã chốt
// lương". Một khoá cho một chuyện — tháng nào thưởng đã trả thì bấm chốt thưởng tháng đó.
//
// Module LÁ giống payrollLock.ts: projectBonus.service, scores.adjust, tasks.service,
// admin.sync cùng cần hỏi, không được import vòng qua các service lớn.

/** Tháng đã chốt thưởng chưa. */
export async function isBonusLocked(year: number, month: number): Promise<boolean> {
  const rows = await q('SELECT 1 FROM bonus_locks WHERE year = $1 AND month = $2 LIMIT 1', [year, month]);
  return rows.length > 0;
}

/** Điểm của tháng này còn sửa được không. Trả câu lý do, hoặc '' nếu sửa được. */
export async function lyDoKhoaDiem(year: number, month: number): Promise<string> {
  return (await isBonusLocked(year, month)) ? `Tháng ${month}/${year} đã chốt thưởng` : '';
}

/** Mọi tháng mà điểm không được đổi nữa — cùng luật với `lyDoKhoaDiem`, cho câu SQL áp bảng điểm. */
export const SQL_THANG_KHOA_DIEM = 'SELECT year, month FROM bonus_locks';
