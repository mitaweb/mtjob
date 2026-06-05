import 'dotenv/config';
import { runDailyReports } from './dailyReport.js';

runDailyReports()
  .then(() => {
    console.log('[job] Đã gửi báo cáo hằng ngày.');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[job] Lỗi báo cáo hằng ngày:', e);
    process.exit(1);
  });
