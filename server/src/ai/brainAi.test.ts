import { describe, it, expect, vi, beforeEach } from 'vitest';

// Anh Tâm 10/10/2026: "gemini báo đã đầy ... cài đặt model ở quản trị dành riêng cho kho tri thức".

let CFG: Record<string, string> = {};
const GOI_GEMINI: string[] = [];
const GOI_CLAUDE: Array<string | undefined> = [];
let GEMINI_LOI: Record<string, Error> = {};
let CLAUDE_TRA = '';

vi.mock('../config.js', () => ({ getConfig: async () => CFG }));
vi.mock('../gemini/client.js', () => ({
  generateContent: vi.fn(async (req: { model: string }) => {
    GOI_GEMINI.push(req.model);
    if (GEMINI_LOI[req.model]) throw GEMINI_LOI[req.model];
    return [{ text: '{"ok":true}' }];
  }),
}));
vi.mock('./claude.js', () => ({
  toJsonSchema: (x: unknown) => x,
  claudeProvider: {
    generateContent: vi.fn(async (req: { model?: string }) => {
      GOI_CLAUDE.push(req.model);
      return [{ text: CLAUDE_TRA }];
    }),
  },
}));

const A = await import('./brainAi.js');

beforeEach(() => {
  CFG = {};
  GOI_GEMINI.length = 0;
  GOI_CLAUDE.length = 0;
  GEMINI_LOI = {};
  CLAUDE_TRA = '';
});

describe('cài đặt AI của kho', () => {
  it('chưa chọn gì → Gemini flash như trước', async () => {
    expect(await A.cauHinhAiKho()).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash', fallback: '' });
    expect(await A.aiKhoJson('x', {})).toEqual({ ok: true });
    expect(GOI_GEMINI).toEqual(['gemini-2.5-flash']);
  });

  it('chọn model khác → dùng đúng model đó', async () => {
    CFG = { brainAiModel: 'gemini-2.5-flash-lite' };
    await A.aiKhoJson('x', {});
    expect(GOI_GEMINI).toEqual(['gemini-2.5-flash-lite']);
  });

  it('model chính hết lượt (429) → tự thử model dự phòng', async () => {
    CFG = { brainAiModel: 'gemini-2.5-flash', brainAiFallback: 'gemini-2.5-flash-lite' };
    GEMINI_LOI = { 'gemini-2.5-flash': new Error('Gemini 429: { "error": { "code": 429, "message": "You exceeded your current quota" } }') };
    expect(await A.aiKhoJson('x', {})).toEqual({ ok: true });
    expect(GOI_GEMINI).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });

  it('lỗi khác (không phải hết lượt) → không đổi model, báo lỗi thật', async () => {
    CFG = { brainAiFallback: 'gemini-2.5-flash-lite' };
    GEMINI_LOI = { 'gemini-2.5-flash': new Error('Gemini 400: bad request') };
    await expect(A.aiKhoJson('x', {})).rejects.toThrow('400');
    expect(GOI_GEMINI).toEqual(['gemini-2.5-flash']);
  });

  it('chọn Claude: không chọn model → để Claude dùng model của trợ lý; JSON bọc ``` vẫn đọc được', async () => {
    CFG = { brainAiProvider: 'claude' };
    CLAUDE_TRA = '```json\n{"y":[1,2]}\n```';
    expect(await A.aiKhoJson('x', { type: 'OBJECT' })).toEqual({ y: [1, 2] });
    expect(GOI_CLAUDE).toEqual([undefined]);
    expect(GOI_GEMINI).toEqual([]);
  });
});

describe('laLoiHetLuot / docJson', () => {
  it('nhận ra lỗi hết lượt / quá tải', () => {
    expect(A.laLoiHetLuot(new Error('Gemini 429: quota'))).toBe(true);
    expect(A.laLoiHetLuot({ status: 529, message: 'Overloaded' })).toBe(true);
    expect(A.laLoiHetLuot(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(A.laLoiHetLuot(new Error('Gemini 400: invalid'))).toBe(false);
  });
  it('lấy JSON lẫn trong chữ', () => {
    expect(A.docJson('Đây: {"a":1} nhé')).toEqual({ a: 1 });
    expect(() => A.docJson('không có json')).toThrow();
  });
});
