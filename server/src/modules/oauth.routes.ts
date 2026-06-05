import { Router } from 'express';
import { asyncHandler } from '../util/errors.js';
import { exchangeCode } from '../gemini/auth.js';

export const oauthRouter = Router();

// Public callback for the Google consent flow. Shows the refresh token to paste
// into server/.env (GEMINI_OAUTH_REFRESH_TOKEN).
oauthRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const code = String(req.query.code || '');
    if (!code) {
      res.status(400).send('Thiếu mã uỷ quyền (code).');
      return;
    }
    const refresh = await exchangeCode(code);
    const value =
      refresh ||
      '(không nhận được refresh_token — đảm bảo access_type=offline & prompt=consent, gỡ quyền cũ rồi thử lại)';
    res
      .status(200)
      .type('html')
      .send(
        `<!doctype html><html lang="vi"><body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px">
<h2>Uỷ quyền Gemini thành công ✅</h2>
<p>Dán dòng dưới vào <code>server/.env</code> rồi khởi động lại server:</p>
<pre style="background:#f4f4f4;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all">GEMINI_OAUTH_REFRESH_TOKEN=${value}</pre>
</body></html>`,
      );
  }),
);
