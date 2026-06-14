import 'dotenv/config';
import { createApp } from './http/app.js';
import { registerCronJobs } from './jobs/scheduler.js';

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0'; // đặt HOST=127.0.0.1 khi chạy sau reverse proxy

const app = createApp();
app.listen(port, host, () => {
  console.log(`[MTJOB] API đang chạy tại http://${host}:${port}`);
  registerCronJobs();
});
