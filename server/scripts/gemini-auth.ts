import 'dotenv/config';
import { getAuthUrl } from '../src/gemini/auth.js';

if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  console.error('❌ Thiếu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET trong .env');
  process.exit(1);
}

console.log('\n1) Mở URL sau, đăng nhập Google & đồng ý cấp quyền Gemini:\n');
console.log(getAuthUrl());
console.log('\n2) Sau khi đồng ý, Google chuyển hướng về /api/oauth2/callback và hiển thị');
console.log('   GEMINI_OAUTH_REFRESH_TOKEN — dán vào server/.env rồi khởi động lại server.');
console.log('   (Server cần đang chạy để nhận callback; GOOGLE_OAUTH_REDIRECT phải khớp OAuth client.)\n');
