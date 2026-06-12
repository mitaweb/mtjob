import cron from 'node-cron';
import { getConfig } from '../config.js';
import { runDailyReports } from './dailyReport.js';
import { runMonthlyReport } from './monthlyReport.js';

const TZ = process.env.APP_TZ || 'Asia/Ho_Chi_Minh';

/** Register the daily + monthly cron jobs using times from the Config tab. */
export function registerCronJobs(): void {
  getConfig()
    .then((cfg) => {
      const [dhRaw, dmRaw] = cfg.dailyReportTime.split(':');
      const dh = Number(dhRaw) || 18;
      const dm = Number(dmRaw) || 0;
      const day = cfg.monthlyReportDay || 1;

      cron.schedule(
        `${dm} ${dh} * * *`,
        () => {
          void runDailyReports().catch((e) => console.error('[cron daily]', e));
        },
        { timezone: TZ },
      );

      cron.schedule(
        `30 8 ${day} * *`,
        () => {
          void runMonthlyReport().catch((e) => console.error('[cron monthly]', e));
        },
        { timezone: TZ },
      );

      console.log(`[cron] báo cáo ngày ${cfg.dailyReportTime}, tổng kết tháng ngày ${day} lúc 08:30 (${TZ})`);
    })
    .catch((e) => console.warn('[cron] chưa đọc được config:', (e as Error).message));
}
