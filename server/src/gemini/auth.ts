// Gemini auth via Google OAuth2 (user consent → refresh token → access tokens).
// Hand-rolled over the OAuth2 REST endpoints — no googleapis dependency.
// One-time consent stores a refresh token in GEMINI_OAUTH_REFRESH_TOKEN; the
// server mints short-lived access tokens from it.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Scope required to call the Gemini (Generative Language) API with OAuth.
// CHỈ xin generative-language.retriever: thêm cloud-platform sẽ làm app chưa
// xác minh bị Google CHẶN CỨNG ("Ứng dụng này đã bị chặn") thay vì chỉ cảnh báo.
const SCOPES = ['https://www.googleapis.com/auth/generative-language.retriever'];

function clientId(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || '';
}
function clientSecret(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
}
function redirectUri(): string {
  return process.env.GOOGLE_OAUTH_REDIRECT || 'http://localhost:8080/api/oauth2/callback';
}

export function refreshToken(): string {
  return process.env.GEMINI_OAUTH_REFRESH_TOKEN || '';
}

export function oauthConfigured(): boolean {
  return !!(clientId() && clientSecret() && refreshToken());
}

let cachedToken = '';
let cachedExp = 0;

/** Short-lived access token from the stored refresh token (cached until ~5 min before expiry). */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExp) return cachedToken;
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken(),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`OAuth refresh ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  cachedToken = data.access_token || '';
  cachedExp = Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000;
  return cachedToken;
}

/** Consent URL — open once, approve, get redirected to the callback. */
export function getAuthUrl(): string {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES.join(' '),
  });
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

/** Exchange the authorization code for a refresh token. */
export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`OAuth exchange ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { refresh_token?: string };
  return data.refresh_token || '';
}
