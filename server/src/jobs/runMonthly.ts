import 'dotenv/config';
import { runMonthlyReport } from './monthlyReport.js';

runMonthlyReport()
  .then(() => {
    console.log('[job] Đã gửi tổng kết tháng (xếp hạng + công/lương).');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[job] Lỗi tổng kết tháng:', e);
    process.exit(1);
  });
