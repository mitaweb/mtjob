import { q } from '../db/client.js';

/**
 * Tháng đã chốt lương chưa.
 *
 * Tách khỏi `payroll.service` thành module LÁ (chỉ phụ thuộc db/client) để cắt vòng lặp
 * import: `payroll.service` cần gọi `projectBonus.service` lúc chốt lương để chụp lại
 * thưởng, mà `projectBonus.service` lại cần biết tháng đã khoá chưa. Hai file import
 * lẫn nhau là vòng lặp; cả hai cùng import file này thì không.
 *
 * `payroll.service` xuất lại hàm này nên mọi chỗ đang `import { isMonthLocked } from
 * './payroll.service.js'` vẫn chạy nguyên.
 */
export async function isMonthLocked(year: number, month: number): Promise<boolean> {
  const rows = await q('SELECT 1 FROM payroll_locks WHERE year = $1 AND month = $2 LIMIT 1', [year, month]);
  return rows.length > 0;
}
