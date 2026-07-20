// Provider Claude — dùng SDK chính thức @anthropic-ai/sdk.
// Nhận/trả đúng shape Gemini (xem ai/types.ts) rồi tự chuyển đổi sang định dạng Messages API,
// nhờ vậy runToolLoop trong assistant.service.ts dùng chung cho cả hai nhà cung cấp.
import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config.js';
import type { GeminiPart, GeminiContent, GenerateRequest } from '../gemini/client.js';
import type { AiProvider } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 8000; // không stream → giữ dưới ngưỡng timeout HTTP
const TIMEOUT_MS = 50_000; // maxDuration function trên Vercel là 60s

async function cfg(): Promise<{ apiKey: string; model: string; baseUrl: string }> {
  try {
    const c = await getConfig();
    return {
      apiKey: (c.claudeApiKey || process.env.ANTHROPIC_API_KEY || '').trim(),
      model: (c.claudeModel || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim(),
      baseUrl: (c.claudeBaseUrl || process.env.ANTHROPIC_BASE_URL || '').trim(),
    };
  } catch {
    // DB chưa sẵn sàng — rơi về env.
    return {
      apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
      model: (process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim(),
      baseUrl: (process.env.ANTHROPIC_BASE_URL || '').trim(),
    };
  }
}

export async function claudeAvailable(): Promise<boolean> {
  return !!(await cfg()).apiKey;
}

// ── Chuyển đổi schema: Gemini dùng type CHỮ HOA, Claude dùng JSON Schema chuẩn (chữ thường) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJsonSchema(node: any): any {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' && typeof v === 'string') out[k] = v.toLowerCase();
    else out[k] = toJsonSchema(v);
  }
  return out;
}

/** `tools: [{functionDeclarations:[...]}]` (Gemini) → `tools: [{name, description, input_schema}]` (Claude). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toClaudeTools(tools: unknown[] | undefined): any[] | undefined {
  if (!tools?.length) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decls = tools.flatMap((t: any) => t?.functionDeclarations ?? []);
  if (!decls.length) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return decls.map((d: any) => ({
    name: d.name,
    description: d.description || '',
    // Claude bắt buộc input_schema là object schema; hàm không tham số vẫn phải có properties rỗng.
    input_schema: d.parameters
      ? { type: 'object', properties: {}, ...toJsonSchema(d.parameters) }
      : { type: 'object', properties: {} },
  }));
}

/**
 * ID cho cặp tool_use/tool_result: Gemini chỉ mang tên hàm, Claude cần id khớp nhau.
 * Sinh id theo vị trí (contents[i].parts[j]) — cùng một hội thoại thì hai bên luôn khớp.
 */
function callId(msgIdx: number, partIdx: number): string {
  return `call_${msgIdx}_${partIdx}`;
}

/** Tìm id của functionCall gần nhất TRƯỚC vị trí `beforeMsg` có cùng tên hàm. */
function findCallId(contents: GeminiContent[], beforeMsg: number, name: string): string | null {
  for (let i = beforeMsg - 1; i >= 0; i--) {
    const parts = contents[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      if (parts[j]?.functionCall?.name === name) return callId(i, j);
    }
  }
  return null;
}

/** contents (Gemini) → messages (Claude). Bỏ các lượt 'model' ở đầu vì Claude yêu cầu mở đầu bằng 'user'. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toClaudeMessages(contents: GeminiContent[]): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgs: any[] = [];
  contents.forEach((c, i) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [];
    c.parts.forEach((p, j) => {
      if (p.functionCall) {
        blocks.push({
          type: 'tool_use',
          id: callId(i, j),
          name: p.functionCall.name,
          input: p.functionCall.args ?? {},
        });
      } else if (p.functionResponse) {
        const id = findCallId(contents, i, p.functionResponse.name);
        if (!id) return; // không tìm được lệnh gọi tương ứng → bỏ, tránh Claude trả 400
        const r = p.functionResponse.response as Record<string, unknown>;
        const text = typeof r?.result === 'string' ? r.result : JSON.stringify(r ?? {});
        blocks.push({ type: 'tool_result', tool_use_id: id, content: text });
      } else if (p.text) {
        blocks.push({ type: 'text', text: p.text });
      }
    });
    if (blocks.length === 0) return;
    const role = c.role === 'model' ? 'assistant' : 'user';
    // Claude phải bắt đầu bằng lượt 'user' (lời chào của bot ở đầu lịch sử chat bị bỏ).
    if (msgs.length === 0 && role === 'assistant') return;
    msgs.push({ role, content: blocks });
  });
  return msgs;
}

/** content blocks (Claude) → parts (Gemini) để runToolLoop xử lý như cũ. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toGeminiParts(content: any[]): GeminiPart[] {
  const parts: GeminiPart[] = [];
  for (const b of content ?? []) {
    if (b?.type === 'text' && b.text) parts.push({ text: b.text });
    else if (b?.type === 'tool_use') {
      parts.push({ functionCall: { name: b.name, args: (b.input ?? {}) as Record<string, unknown> } });
    }
    // thinking/khác: bỏ qua — vòng lặp tool chỉ cần text và lệnh gọi hàm.
  }
  return parts;
}

async function generateContent(req: GenerateRequest): Promise<GeminiPart[]> {
  const { apiKey, model, baseUrl } = await cfg();
  if (!apiKey) throw new Error('Claude chưa cấu hình (dán API key trong Quản trị).');

  const client = new Anthropic({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl.replace(/\/+$/, '') } : {}),
    timeout: TIMEOUT_MS,
    maxRetries: 1,
  });

  const messages = toClaudeMessages(req.contents);
  if (messages.length === 0) throw new Error('Không có nội dung hội thoại để gửi.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    model: req.model || model,
    max_tokens: MAX_TOKENS,
    messages,
    // Tắt thinking: vòng lặp tool chuyển qua lại giữa hai định dạng nên không giữ được
    // thinking block nguyên vẹn — mà Claude yêu cầu echo lại y nguyên khi trả tool_result.
    thinking: { type: 'disabled' },
  };
  const system = req.systemInstruction?.parts?.map((p) => p.text).join('\n');
  if (system) body.system = system;
  const tools = toClaudeTools(req.tools);
  if (tools) body.tools = tools;

  const res = await client.messages.create(body);
  if (res.stop_reason === 'refusal') {
    throw new Error('Claude đã từ chối trả lời câu hỏi này.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return toGeminiParts(res.content as any[]);
}

/** Danh sách model Claude lấy thẳng từ API (hoạt động với cả endpoint tuỳ biến nếu nó hỗ trợ). */
export async function listClaudeModels(): Promise<Array<{ id: string; label: string }>> {
  const { apiKey, baseUrl } = await cfg();
  if (!apiKey) throw new Error('Chưa cấu hình API key Claude.');
  const client = new Anthropic({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl.replace(/\/+$/, '') } : {}),
    timeout: 15_000,
    maxRetries: 1,
  });
  const res = await client.models.list({ limit: 100 });
  return (res.data ?? []).map((m) => ({
    id: m.id,
    label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
  }));
}

export const claudeProvider: AiProvider = { name: 'claude', generateContent };
