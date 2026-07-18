// Calls the Gemini (Generative Language) REST API for structured JSON output.
// Auth precedence: OAuth (Bearer) → API key (config DB → env) → local proxy (GEMINI_BASE_URL).
import { oauthConfigured, getAccessToken } from './auth.js';
import { getConfig } from '../config.js';

// Base URL — override with GEMINI_BASE_URL to route through a local AI proxy
// (e.g. cliproxyapi) that speaks the Gemini REST format.
function baseUrl(): string {
  return (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
}

const TIMEOUT_MS = 25_000; // maxDuration function trên Vercel là 60s

/** Model: config DB (admin chọn trong UI) → env → mặc định flash. */
export async function geminiModel(): Promise<string> {
  try {
    const cfg = await getConfig();
    if (cfg.geminiModel) return cfg.geminiModel.trim();
  } catch {
    // DB chưa sẵn sàng — rơi về env.
  }
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

/** API key: ưu tiên key admin dán trong UI (config DB), sau đó tới env. */
async function configuredApiKey(): Promise<string> {
  try {
    const cfg = await getConfig();
    if (cfg.geminiApiKey) return cfg.geminiApiKey.trim();
  } catch {
    // DB chưa sẵn sàng — rơi về env.
  }
  return (process.env.GEMINI_API_KEY || '').trim();
}

export async function geminiAvailable(): Promise<boolean> {
  if (oauthConfigured() || !!process.env.GEMINI_BASE_URL) return true;
  return !!(await configuredApiKey());
}

// ── Kiểu dữ liệu tối thiểu cho hội thoại + function calling ──
export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GenerateRequest {
  contents: GeminiContent[];
  tools?: unknown[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: Record<string, unknown>;
  /** Ghi đè model cho riêng lời gọi này (vd NLU luôn dùng flash). */
  model?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gọi Gemini generateContent: timeout 25s + retry 1 lần khi 429/5xx/lỗi mạng. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callApi(model: string, body: unknown): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const url = `${baseUrl()}/models/${model}:generateContent`;

  if (oauthConfigured()) {
    headers['Authorization'] = `Bearer ${await getAccessToken()}`;
  } else {
    const key = await configuredApiKey();
    if (key) {
      // Header thay vì ?key= trên URL: key trong URL dễ lọt vào log proxy/access log.
      headers['x-goog-api-key'] = key;
    } else if (process.env.GEMINI_BASE_URL) {
      // Proxy cục bộ (vd cliproxyapi) tự lo xác thực — không cần key.
    } else {
      throw new Error('Gemini chưa cấu hình (dán API key trong Quản trị, hoặc OAuth/GEMINI_BASE_URL).');
    }
  }

  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await sleep(800);
          continue;
        }
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
      }
      return await res.json();
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // Không retry timeout — retry sẽ đội gấp đôi thời gian chờ của người dùng.
        throw new Error(`Gemini không phản hồi sau ${TIMEOUT_MS / 1000}s.`);
      }
      if (attempt === 0 && e instanceof TypeError) {
        // Lỗi mạng tạm thời (fetch ném TypeError) → thử lại 1 lần.
        await sleep(800);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Lời gọi tổng quát: hội thoại nhiều lượt + tools (function calling) + systemInstruction.
 * Trả về parts của candidate đầu tiên (có thể chứa text lẫn functionCall).
 */
export async function generateContent(req: GenerateRequest): Promise<GeminiPart[]> {
  const model = req.model || (await geminiModel());
  const body: Record<string, unknown> = { contents: req.contents };
  if (req.tools) body.tools = req.tools;
  if (req.systemInstruction) body.systemInstruction = req.systemInstruction;
  if (req.generationConfig) body.generationConfig = req.generationConfig;
  const data = await callApi(model, body);
  return (data?.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
}

function partsText(parts: GeminiPart[]): string {
  return parts.map((p) => p.text || '').join('');
}

/** Ask Gemini for a JSON object matching `schema` (responseSchema). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateJson(prompt: string, schema: unknown, model?: string): Promise<any> {
  const parts = await generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    model,
  });
  return JSON.parse(partsText(parts) || '{}');
}

/** Ask Gemini for a free-form text answer (tiếng Việt). */
export async function generateText(prompt: string): Promise<string> {
  const parts = await generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
  return partsText(parts).trim();
}
