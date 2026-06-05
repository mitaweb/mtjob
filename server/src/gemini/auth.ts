// Gemini auth via Google OAuth2 (user consent → refresh token → access tokens).
// Reused server-side: one-time consent stores a refresh token in
// GEMINI_OAUTH_REFRESH_TOKEN; the server mints short-lived access tokens from it.
import { google } from 'googleapis';

// Scope required to call the Gemini (Generative Language) API with OAuth.
const SCOPES = [
  'https://www.googleapis.com/auth/generative-language.retriever',
  'https://www.googleapis.com/auth/cloud-platform',
];

function redirectUri(): string {
  return process.env.GOOGLE_OAUTH_REDIRECT || 'http://localhost:8080/api/oauth2/callback';
}

export function refreshToken(): string {
  return process.env.GEMINI_OAUTH_REFRESH_TOKEN || '';
}

export function oauthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && refreshToken());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any;
function client() {
  if (!_client) {
    _client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri(),
    );
  }
  return _client;
}

let cachedToken = '';
let cachedExp = 0;

/** Short-lived access token from the stored refresh token (cached ~50 min). */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedExp) return cachedToken;
  const c = client();
  c.setCredentials({ refresh_token: refreshToken() });
  const r = await c.getAccessToken();
  cachedToken = (typeof r === 'string' ? r : r?.token) || '';
  cachedExp = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

/** Consent URL — open once, approve, get redirected to the callback. */
export function getAuthUrl(): string {
  return client().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

/** Exchange the authorization code for a refresh token. */
export async function exchangeCode(code: string): Promise<string> {
  const { tokens } = await client().getToken(code);
  return tokens.refresh_token || '';
}
