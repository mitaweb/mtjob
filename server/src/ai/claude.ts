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

/**
 * Claude bắt buộc mỗi `tool_use` có ĐÚNG MỘT `tool_result` và ngược lại. Lượt nào lệch là
 * cả request trả 400, mất luôn câu trả lời. Vá lại thay vì để nó nổ:
 *   - kết quả trùng id (chỉ giữ cái đầu)
 *   - kết quả không có lệnh gọi tương ứng
 *   - lệnh gọi không có kết quả — xảy ra khi lịch sử đứt gánh giữa vòng gọi hàm
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function donDepCapToolUse(msgs: any[]): any[] {
  // Lặp vì ba việc dọn ăn theo nhau: bỏ lượt 'assistant' mở đầu có thể làm kết quả ở lượt
  // sau thành mồ côi, mà bỏ kết quả lại có thể làm một lượt rỗng đi rồi lòi ra 'assistant'
  // mới ở đầu. Mỗi vòng chỉ bớt đi nên chắc chắn dừng.
  let ds = msgs;
  for (let vong = 0; vong < 5; vong++) {
    // Claude phải mở đầu bằng lượt 'user' (lời chào của bot ở đầu lịch sử chat bị bỏ).
    while (ds.length > 0 && ds[0].role === 'assistant') ds.shift();

    const idLenhGoi = new Set<string>();
    const idKetQua = new Set<string>();
    for (const m of ds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const b of m.content as any[]) {
        if (b.type === 'tool_use') idLenhGoi.add(b.id);
        else if (b.type === 'tool_result') idKetQua.add(b.tool_use_id);
      }
    }

    const daGiu = new Set<string>();
    let boBot = false;
    for (const m of ds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const giu = (m.content as any[]).filter((b) => {
        if (b.type === 'tool_use') return idKetQua.has(b.id);
        if (b.type !== 'tool_result') return true;
        if (!idLenhGoi.has(b.tool_use_id) || daGiu.has(b.tool_use_id)) return false;
        daGiu.add(b.tool_use_id);
        return true;
      });
      if (giu.length !== m.content.length) boBot = true;
      m.content = giu;
    }

    const truoc = ds.length;
    ds = ds.filter((m) => m.content.length > 0);
    if (!boBot && ds.length === truoc && (ds.length === 0 || ds[0].role === 'user')) break;
  }
  return ds;
}

/** contents (Gemini) → messages (Claude). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toClaudeMessages(contents: GeminiContent[]): any[] {
  // Ghép kết quả với lệnh gọi theo THỨ TỰ, mỗi lệnh gọi chỉ được dùng một lần.
  //
  // Trước đây ghép theo TÊN hàm (lấy lệnh gọi gần nhất cùng tên). Hỏng ngay khi AI gọi CÙNG
  // một hàm hai lần trong một lượt — chuyện thường gặp, ví dụ đặt hai lịch hẹn một câu: cả
  // hai kết quả cùng trỏ về lệnh gọi thứ hai, lệnh thứ nhất thì mồ côi. Claude trả
  // 400 "Found multiple tool_result blocks with id ..." và trợ lý đứng hình (anh Tâm 4/8/2026).
  const chuaGhep: Array<{ id: string; name: string; luot: number }> = [];
  contents.forEach((c, i) =>
    c.parts.forEach((p, j) => {
      if (p.functionCall) chuaGhep.push({ id: callId(i, j), name: p.functionCall.name, luot: i });
    }),
  );
  /** Lệnh gọi cũ nhất còn chờ kết quả, và phải nằm TRƯỚC lượt đang xét — kết quả không
   *  bao giờ được vơ lấy một lệnh gọi ở tương lai. */
  const nhanId = (name: string, luot: number): string | null => {
    const k = chuaGhep.findIndex((x) => x.name === name && x.luot < luot);
    return k < 0 ? null : chuaGhep.splice(k, 1)[0]!.id;
  };

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
        const id = nhanId(p.functionResponse.name, i);
        if (!id) return; // không còn lệnh gọi nào chờ kết quả → bỏ
        const r = p.functionResponse.response as Record<string, unknown>;
        const text = typeof r?.result === 'string' ? r.result : JSON.stringify(r ?? {});
        blocks.push({ type: 'tool_result', tool_use_id: id, content: text });
      } else if (p.text) {
        blocks.push({ type: 'text', text: p.text });
      }
    });
    if (blocks.length > 0) msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content: blocks });
  });

  return donDepCapToolUse(msgs);
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

/** Dựng client + body Messages API từ request kiểu Gemini — dùng chung cho gọi thường và stream. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildRequest(req: GenerateRequest): Promise<{ client: Anthropic; body: any }> {
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
  return { client, body };
}

async function generateContent(req: GenerateRequest): Promise<GeminiPart[]> {
  const { client, body } = await buildRequest(req);
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

/** Như generateContent nhưng bắn từng mẩu chữ ra ngoài trong lúc Claude viết. */
async function generateContentStream(req: GenerateRequest, onDelta: (d: string) => void): Promise<GeminiPart[]> {
  const { client, body } = await buildRequest(req);
  const stream = client.messages.stream(body);
  stream.on('text', (delta: string) => {
    if (delta) onDelta(delta);
  });
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') throw new Error('Claude đã từ chối trả lời câu hỏi này.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return toGeminiParts(final.content as any[]);
}

export const claudeProvider: AiProvider = { name: 'claude', generateContent, generateContentStream };
