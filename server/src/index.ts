import 'dotenv/config';
import { createApp } from './http/app.js';
import { registerCronJobs } from './jobs/scheduler.js';

const port = Number(process.env.PORT || 8080);

const app = createApp();
app.listen(port, () => {
  console.log(`[MTJOB] API đang chạy tại http://localhost:${port}`);
  registerCronJobs();
});
