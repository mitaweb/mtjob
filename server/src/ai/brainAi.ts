// AI riêng cho Kho tri thức (anh Tâm 10/10/2026: "gemini báo đã đầy, em thiết kế thêm 1 chỗ cài đặt
// model ở trong phần quản trị dành riêng cho kho tri thức, anh sẽ lựa chọn model").
//
// Mọi việc AI của kho đi qua đây: phân loại mục tri thức, tự ghi từ hội thoại, hồ sơ khách, đọc tệp,
// rút ý từ Zalo, xét nhóm Zalo. Trợ lý hỏi-đáp và nhận diện tin ghi việc KHÔNG đổi theo — chúng có
// cài đặt riêng. Embeddings (tìm kiếm) vẫn luôn là Gemini vì Claude không có API embeddings.
//
// Model chính hết lượt (429 / quota / quá tải) → tự thử model dự phòng nếu anh có chọn.
import { getConfig } from '../config.js';
import { generateContent as geminiGenerate, type GeminiPart, type GenerateRequest } from '../gemini/client.js';
import { claudeProvider, toJsonSchema } from './claude.js';

export const MAC_DINH_GEMINI_KHO = 'gemini-2.5-flash';

export interface CauHinhAiKho {
  provider: 'gemini' | 'claude';
  /** '' với Claude = dùng model của trợ lý (claude.ts tự lấy). */
  model: string;
  fallback: string;
}

export async function cauHinhAiKho(): Promise<CauHinhAiKho> {
  const c = await getConfig().catch(() => null);
  const provider = c?.brainAiProvider === 'claude' ? 'claude' : 'gemini';
  const chon = String(c?.brainAiModel || '').trim();
  return {
    provider,
    model: chon || (provider === 'gemini' ? MAC_DINH_GEMINI_KHO : ''),
    fallback: String(c?.brainAiFallback || '').trim(),
  };
}

/** Lỗi do hết lượt / giới hạn tốc độ / quá tải — đáng thử model khác. */
export function laLoiHetLuot(e: unknown): boolean {
  const m = String((e as { message?: unknown })?.message ?? e ?? '');
  const status = Number((e as { status?: unknown })?.status);
  return status === 429 || status === 529 || /\b429\b|\b529\b|quota|rate.?limit|RESOURCE_EXHAUSTED|overloaded/i.test(m);
}

/** Lời gọi tổng quát (có thể kèm tệp). `model` do cài đặt kho quyết định, không truyền từ ngoài. */
export async function aiKhoContent(req: Omit<GenerateRequest, 'model'>): Promise<GeminiPart[]> {
  const ch = await cauHinhAiKho();
  const goi = (model: string) =>
    ch.provider === 'claude'
      ? claudeProvider.generateContent({ ...req, ...(model ? { model } : {}) })
      : geminiGenerate({ ...req, model: model || MAC_DINH_GEMINI_KHO });
  try {
    return await goi(ch.model);
  } catch (e) {
    if (ch.fallback && ch.fallback !== ch.model && laLoiHetLuot(e)) {
      console.warn(`[ai kho] ${ch.model || ch.provider} hết lượt → thử ${ch.fallback}`);
      return await goi(ch.fallback);
    }
    throw e;
  }
}

/** Lấy đối tượng JSON từ câu trả lời dạng chữ (Claude hay bọc ```json ... ```). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function docJson(text: string): any {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(s || '{}');
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error(`AI không trả về JSON hợp lệ: ${s.slice(0, 120)}`);
  }
}

/** Hỏi AI một đối tượng JSON theo `schema` (định dạng schema của Gemini). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function aiKhoJson(prompt: string, schema: unknown): Promise<any> {
  const { provider } = await cauHinhAiKho();
  const parts =
    provider === 'gemini'
      ? await aiKhoContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
        })
      : await aiKhoContent({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text:
                    `${prompt}\n\nCHỈ trả về MỘT đối tượng JSON hợp lệ đúng JSON Schema dưới đây, không kèm chữ nào khác:\n` +
                    JSON.stringify(toJsonSchema(schema)),
                },
              ],
            },
          ],
        });
  return docJson(parts.map((p) => p.text || '').join(''));
}
