import { q } from '../db/client.js';
import { isMonthLocked } from './payrollLock.js';

// Khoá THƯỞNG của một tháng — tách khỏi khoá lương (payrollLock.ts).
//
// Anh Tâm 13/9/2026: "thưởng và lương chốt khác nhau". Lương đi theo công; thưởng đi theo
// điểm và kết quả dự án — chốt vào hai lúc khác nhau.
//
// Module LÁ giống payrollLock.ts: projectBonus.service, scores.adjust, tasks.service,
// admin.sync cùng cần hỏi, không được import vòng qua các service lớn.

/** Tháng đã chốt thưởng chưa. */
export async function isBonusLocked(year: number, month: number): Promise<boolean> {
  const rows = await q('SELECT 1 FROM bonus_locks WHERE year = $1 AND month = $2 LIMIT 1', [year, month]);
  return rows.length > 0;
}

/**
 * Điểm của tháng này còn sửa được không. Trả câu lý do, hoặc '' nếu sửa được.
 *
 * Điểm chỉ quyết định THƯỞNG, nên đúng ra chỉ cần khoá thưởng. Vẫn giữ cả khoá lương vì
 * các tháng chốt lương TRƯỚC khi có nút chốt thưởng chưa hề có dòng khoá thưởng — bỏ khoá
 * lương ra là mở điểm tháng 7, tháng 8 cho sửa và cho áp lại bảng điểm, trong khi thưởng
 * các tháng đó đã trả rồi.
 */
export async function lyDoKhoaDiem(year: number, month: number): Promise<string> {
  if (await isBonusLocked(year, month)) return `Tháng ${month}/${year} đã chốt thưởng`;
  if (await isMonthLocked(year, month)) return `Tháng ${month}/${year} đã chốt lương`;
  return '';
}

/** Mọi tháng mà điểm không được đổi nữa — cùng luật với `lyDoKhoaDiem`, cho câu SQL áp bảng điểm. */
export const SQL_THANG_KHOA_DIEM =
  'SELECT year, month FROM bonus_locks UNION SELECT year, month FROM payroll_locks';
