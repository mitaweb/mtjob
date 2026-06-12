// Vercel serverless entry — wraps the Express app.
// Cron is NOT registered here; Vercel Cron calls /api/jobs/* per vercel.json.
import { createApp } from '../server/src/http/app.js';

const app = createApp();
export default app;
