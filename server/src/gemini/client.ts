// Calls the Gemini (Generative Language) REST API for structured JSON output.
// Auth precedence: OAuth (Bearer access token) → API key (?key=).
import { oauthConfigured, getAccessToken } from './auth.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

export function geminiAvailable(): boolean {
  return oauthConfigured() || !!process.env.GEMINI_API_KEY;
}

/** Ask Gemini for a JSON object matching `schema` (responseSchema). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateJson(prompt: string, schema: unknown): Promise<any> {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url = `${BASE}/models/${geminiModel()}:generateContent`;

  if (oauthConfigured()) {
    headers['Authorization'] = `Bearer ${await getAccessToken()}`;
  } else if (process.env.GEMINI_API_KEY) {
    url += `?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  } else {
    throw new Error('Gemini chưa cấu hình (cần OAuth hoặc GEMINI_API_KEY).');
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(text);
}
