// TẠM THỜI — chuyển MTJOB từ Vercel sang Coolify (anh Tâm 21/11/2026). Vercel không cho tải về giá trị biến "Sensitive"
// (khoá mã hoá Zalo / kết nối, chuỗi Supabase, khoá kho tệp…) nên chính bản trên Vercel gửi thẳng sang Coolify qua API,
// giá trị không hiện ra ở đâu. Gỡ file này + route khi chuyển xong.

/** Biến cần mang sang (chỉ những biến có giá trị trên Vercel mới gửi). */
export const BIEN_CHUYEN = [
  'DATABASE_URL',
  'CRON_SECRET',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'ZALO_SESSION_KEY',
  'KET_NOI_KEY',
  'KT_SECRET_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'mt_READ_WRITE_TOKEN',
  'mt_STORE_ID',
  'BLOB_READ_WRITE_TOKEN',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT',
  'GEMINI_OAUTH_REFRESH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  'GOOGLE_ADS_API_VERSION',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_CONFIG_ID',
  'META_API_VERSION',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'SHEET_HR_SOURCE_ID',
  'SHEET_HR_SOURCE_GID',
  'SHEET_TASKS_SOURCE_ID',
  'SHEET_TASKS_SOURCE_GIDS',
  'APP_TZ',
  'PUBLIC_URL',
] as const;

/** DATABASE_URL của Vercel là Supabase → đổi tên, không đè DATABASE_URL (DB mới) của Coolify. Sắp theo tên. */
export function bienCanChuyen(env: Record<string, string | undefined>): Array<{ key: string; value: string }> {
  return BIEN_CHUYEN.filter((k) => !!env[k])
    .map((k) => ({ key: k === 'DATABASE_URL' ? 'SUPABASE_DATABASE_URL' : k, value: String(env[k]) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
