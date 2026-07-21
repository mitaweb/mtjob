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
  /** Tệp gửi kèm (PDF/ảnh) dạng base64 — dùng khi cho AI đọc tài liệu. */
  inlineData?: { mimeType: string; data: string };
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
  /** Ghi đè timeout (vd đọc tài liệu dài cần lâu hơn mặc định 25s). */
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Header xác thực dùng chung cho mọi endpoint Gemini. */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (oauthConfigured()) {
    headers['Authorization'] = `Bearer ${await getAccessToken()}`;
    return headers;
  }
  const key = await configuredApiKey();
  if (key) {
    // Header thay vì ?key= trên URL: key trong URL dễ lọt vào log proxy/access log.
    headers['x-goog-api-key'] = key;
  } else if (process.env.GEMINI_BASE_URL) {
    // Proxy cục bộ (vd cliproxyapi) tự lo xác thực — không cần key.
  } else {
    throw new Error('Gemini chưa cấu hình (dán API key trong Quản trị, hoặc OAuth/GEMINI_BASE_URL).');
  }
  return headers;
}

/** Gọi Gemini generateContent: timeout 25s + retry 1 lần khi 429/5xx/lỗi mạng. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callApi(model: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<any> {
  const headers = await authHeaders();
  const url = `${baseUrl()}/models/${model}:generateContent`;

  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
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
        throw new Error(`Gemini không phản hồi sau ${timeoutMs / 1000}s.`);
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
  const data = await callApi(model, body, req.timeoutMs);
  return (data?.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
}

function partsText(parts: GeminiPart[]): string {
  return parts.map((p) => p.text || '').join('');
}

/**
 * Như generateContent nhưng bắn từng mẩu chữ qua onDelta trong lúc AI viết.
 * Dùng endpoint :streamGenerateContent?alt=sse, gộp các mẩu lại rồi trả về
 * ĐÚNG shape của generateContent để vòng lặp gọi hàm dùng chung được.
 */
export async function generateContentStream(
  req: GenerateRequest,
  onDelta: (delta: string) => void,
): Promise<GeminiPart[]> {
  const model = req.model || (await geminiModel());
  const headers = await authHeaders();
  const body: Record<string, unknown> = { contents: req.contents };
  if (req.tools) body.tools = req.tools;
  if (req.systemInstruction) body.systemInstruction = req.systemInstruction;
  if (req.generationConfig) body.generationConfig = req.generationConfig;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), req.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = ''; // gộp chữ để trả về cuối cùng
    // Gộp lệnh gọi hàm theo TÊN — Gemini có thể gửi rải qua nhiều mẩu.
    const calls = new Map<string, { name: string; args: Record<string, unknown> }>();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE: mỗi sự kiện là một dòng "data: {...}", cách nhau bằng dòng trống.
      const lines = buf.split('\n');
      buf = lines.pop() ?? ''; // giữ lại phần chưa trọn dòng
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chunk = JSON.parse(payload) as any;
          for (const p of chunk?.candidates?.[0]?.content?.parts ?? []) {
            if (p?.text) {
              text += p.text;
              onDelta(p.text);
            } else if (p?.functionCall) {
              // Gemini có thể chia một lệnh gọi hàm thành nhiều mẩu. Gộp theo tên hàm
              // thay vì đẩy từng mẩu vào — nếu không sẽ ra tên hàm cụt/lặp và gọi sai.
              const name = String(p.functionCall.name || '').trim();
              if (!name) continue;
              const seen = calls.get(name);
              if (seen) Object.assign(seen.args, p.functionCall.args || {});
              else calls.set(name, { name, args: { ...(p.functionCall.args || {}) } });
            }
          }
        } catch {
          // Mẩu JSON hỏng — bỏ qua, không làm chết cả luồng.
        }
      }
    }

    const out: GeminiPart[] = [];
    if (text) out.push({ text });
    for (const c of calls.values()) out.push({ functionCall: { name: c.name, args: c.args } });
    return out;
  } finally {
    clearTimeout(timer);
  }
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

export interface ModelOption {
  id: string;
  label: string;
}

/** Danh sách model Gemini dùng được (lấy thẳng từ API, không cài cứng trong code). */
export async function listGeminiModels(): Promise<ModelOption[]> {
  const headers = await authHeaders();
  const res = await fetch(`${baseUrl()}/models?pageSize=200`, { headers });
  if (!res.ok) {
    throw new Error(`Không lấy được danh sách model (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.models ?? []) as any[])
    .filter((m) => (m?.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => {
      const id = String(m.name || '').replace(/^models\//, '');
      return { id, label: m.displayName ? `${m.displayName} (${id})` : id };
    })
    .filter((m) => m.id);
}

// ── Embeddings cho kho tri thức ──
// LUÔN dùng Gemini kể cả khi trợ lý đang chạy Claude (Anthropic không có API embeddings).

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768; // khớp cột vector(768) trong schema — đổi số này phải nạp lại toàn bộ kho
const EMBED_BATCH = 100; // giới hạn của batchEmbedContents

/** Kho tri thức cần API key thật: OAuth (scope retriever) và proxy có thể không phục vụ embedContent. */
export async function embeddingsAvailable(): Promise<boolean> {
  return !!(await configuredApiKey());
}

/** Chuẩn hoá vector về độ dài 1 (dim < 3072 không được Gemini chuẩn hoá sẵn). */
function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum);
  return len > 0 ? v.map((x) => x / len) : v;
}

/**
 * Mã hoá danh sách văn bản thành vector.
 * taskType: 'RETRIEVAL_DOCUMENT' khi nạp kho, 'RETRIEVAL_QUERY' khi tìm kiếm.
 */
export async function embedTexts(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const headers = await authHeaders();
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const slice = texts.slice(i, i + EMBED_BATCH);
    const body = {
      requests: slice.map((text) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBED_DIM,
      })),
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl()}/models/${EMBED_MODEL}:batchEmbedContents`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        throw new Error(`Gemini embed ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vecs: number[][] = (data?.embeddings ?? []).map((e: any) => (e?.values ?? []) as number[]);
      if (vecs.length !== slice.length) throw new Error('Gemini embed trả về thiếu vector.');
      out.push(...vecs.map(normalize));
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}
