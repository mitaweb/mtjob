// Google API clients (Sheets + Drive) authenticated via a service account.
import { google } from 'googleapis';
import type { sheets_v4, drive_v3 } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

// Service-account credentials: prefer GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or
// base64 — required on serverless hosts like Vercel where there is no key file),
// fall back to a key file path in GOOGLE_APPLICATION_CREDENTIALS.
function credentialsFromEnv(): Record<string, unknown> | undefined {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return undefined;
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

// Typed loosely: googleapis' GoogleAuth generic doesn't line up cleanly with the
// service client `auth` option across versions, so we keep this as `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _auth: any;
function getAuth() {
  if (!_auth) {
    const credentials = credentialsFromEnv();
    _auth = new google.auth.GoogleAuth({
      scopes: SCOPES,
      ...(credentials
        ? { credentials }
        : { keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined }),
    });
  }
  return _auth;
}

let _sheets: sheets_v4.Sheets | undefined;
export function sheetsClient(): sheets_v4.Sheets {
  if (!_sheets) _sheets = google.sheets({ version: 'v4', auth: getAuth() });
  return _sheets;
}

let _drive: drive_v3.Drive | undefined;
export function driveClient(): drive_v3.Drive {
  if (!_drive) _drive = google.drive({ version: 'v3', auth: getAuth() });
  return _drive;
}

/** ID of the main "database" spreadsheet. */
export function dbId(): string {
  const id = process.env.SHEET_DB_ID;
  if (!id) throw new Error('SHEET_DB_ID chưa được cấu hình trong .env');
  return id;
}
