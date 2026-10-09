import { describe, it, expect, vi, beforeEach } from 'vitest';

// "Bộ não thứ hai" (anh Tâm 4/10/2026): mọi thứ vào kho được hiểu + gắn nhãn; hỏi thì tra theo nhãn.
// AI (generateJson/embedTexts) được giả lập — thứ cần chứng minh là cách hệ thống DÙNG quyết định của AI.

const AI = { phanLoai: {} as Record<string, unknown>, loi: false };
const MUC = new Map<string, Record<string, unknown>>();
const CAU_HOI = new Map<string, Record<string, unknown>>();
const DOAN: Array<Record<string, unknown>> = [];
const NAP: Array<Record<string, unknown>> = [];
const GO: string[] = [];
const BAO: Array<{ ids: string[]; type: string }> = [];
let HITS: Array<Record<string, unknown>> = [];
let CHU: Array<Record<string, unknown>> = [];

// AI của kho đi qua ai/brainAi.ts — chuyển thẳng về generateJson giả lập ở dưới.
vi.mock('../ai/brainAi.js', async () => {
  const g = await import('../gemini/client.js');
  return { aiKhoJson: (p: string, s: unknown) => (g.generateJson as (p: string, s: unknown) => Promise<unknown>)(p, s) };
});
vi.mock('../gemini/client.js', () => ({
  generateJson: vi.fn(async () => {
    if (AI.loi) throw new Error('hết quota');
    return AI.phanLoai;
  }),
  embedTexts: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2])),
  embeddingsAvailable: vi.fn(async () => true),
}));
vi.mock('./crm.repo.js', () => ({
  getCustomers: async () => [
    { id: 'K1', name: 'C Thảo MLĐ' },
    { id: 'K2', name: 'Lê Thảo Gateway' },
    { id: 'K3', name: 'Savax Door' },
  ],
}));
vi.mock('./members.repo.js', () => ({ getDirectors: async () => [{ id: 'GD' }] }));
vi.mock('./notifications.service.js', () => ({
  notifyMany: vi.fn(async (ids: string[], n: { type: string }) => {
    BAO.push({ ids, type: n.type });
  }),
}));
vi.mock('./brain.service.js', () => ({
  ingest: vi.fn(async (x: Record<string, unknown>) => {
    NAP.push(x);
    return 1;
  }),
  removeSource: vi.fn(async (_t: string, id: string) => {
    GO.push(id);
  }),
  htmlToText: (s: string) => s.replace(/<[^>]+>/g, ''),
}));
vi.mock('./brain.repo.js', () => ({
  searchChunks: vi.fn(async (_v: unknown, o: Record<string, unknown>) => {
    DOAN.push(o);
    return o.sourceType === 'item' ? HITS.filter((h) => h.sourceType === 'item') : HITS;
  }),
  deleteBySource: vi.fn(async () => undefined),
  isMissingTable: () => false,
}));
vi.mock('../db/client.js', () => ({ q: vi.fn(async () => []) }));
vi.mock('./brainItems.repo.js', () => ({
  upsertItem: vi.fn(async (i: Record<string, unknown>) => {
    MUC.set(String(i.id), { ...i });
  }),
  findItem: vi.fn(async (id: string) => MUC.get(id)),
  itemsByIds: vi.fn(async (ids: string[]) => ids.map((id) => MUC.get(id)).filter(Boolean)),
  keywordItems: vi.fn(async () => CHU),
  listQuestions: vi.fn(async () => [...CAU_HOI.values()].filter((x) => x.status === 'open')),
  upsertQuestion: vi.fn(async (x: Record<string, unknown>) => {
    CAU_HOI.set(String(x.id), { ...x });
  }),
  findQuestion: vi.fn(async (id: string) => CAU_HOI.get(id)),
}));

const S = await import('./brainItems.service.js');

const NV = { id: 'M1', name: 'Thu Hà', role: 'member', teamId: 'Ads' };
const GD = { id: 'GD', name: 'Anh Tâm', role: 'director', teamId: '' };
const phanLoai = (x: Record<string, unknown>) => {
  AI.phanLoai = { quyetDinh: 'cong_viec', category: 'tieu_chuan', customerName: '', teamId: '', tieuDe: 'Tiêu đề AI', tomTat: 'Tóm tắt AI', tags: ['mau'], lyDo: 'vì vậy', ...x };
};

beforeEach(() => {
  MUC.clear();
  CAU_HOI.clear();
  DOAN.length = 0;
  NAP.length = 0;
  GO.length = 0;
  BAO.length = 0;
  HITS = [];
  CHU = [];
  AI.loi = false;
  phanLoai({});
});

describe('xetDuaVaoKho — một cửa đưa vào kho', () => {
  it('kiến thức công việc → ban hành, gắn nhãn của AI, nạp đoạn với đúng phạm vi + nhóm', async () => {
    const r = await S.xetDuaVaoKho({ title: 'Màu thương hiệu', body: 'Màu chính xanh #0B5FD9, phụ cam.', source: 'manual' }, NV);
    expect(r.item).toMatchObject({ status: 'published', scope: 'all', category: 'tieu_chuan', title: 'Tiêu đề AI', summary: 'Tóm tắt AI' });
    expect(r.message).toBe('Đã vào kho — nhóm Tiêu chuẩn thiết kế & nội dung.');
    expect(NAP[0]).toMatchObject({ sourceType: 'item', visibility: 'all', category: 'tieu_chuan' });
  });

  it('có mật khẩu → không lưu gì cả, không gọi AI, không ghi DB', async () => {
    const r = await S.xetDuaVaoKho({ title: 'TK ads', body: 'user admin, mật khẩu: Abc@12345', source: 'manual' }, NV);
    expect(r.item).toBeNull();
    expect(r.message).toContain('mật khẩu');
    expect(MUC.size).toBe(0);
    expect(NAP).toHaveLength(0);
  });

  it('SĐT khách bị ẩn trước khi lưu', async () => {
    const r = await S.xetDuaVaoKho({ title: 'Lưu ý Savax', body: 'Gọi anh Tùng 0901234567 trước 10h sáng.', source: 'manual' }, NV);
    expect(r.item!.body).toBe('Gọi anh Tùng [đã ẩn SĐT] trước 10h sáng.');
  });

  it('khách: AI chép tên → khớp ĐÚNG khách trong CRM; tên mơ hồ → không gắn bừa', async () => {
    phanLoai({ category: 'khach_hang', customerName: 'thảo mlđ' });
    const a = await S.xetDuaVaoKho({ title: 'x', body: 'Chị thích tông pastel, ghét chữ đỏ.', source: 'manual' }, NV);
    expect(a.item).toMatchObject({ customerId: 'K1', customer: 'C Thảo MLĐ', category: 'khach_hang', scope: 'all' });
    phanLoai({ category: 'khach_hang', customerName: 'Thảo' });
    const b = await S.xetDuaVaoKho({ title: 'y', body: 'Ghi chú về chị Thảo nào đó.', source: 'manual' }, NV);
    expect(b.item!.customerId).toBe('');
  });

  it('chuyện riêng của giám đốc → chỉ giám đốc xem, nhân viên không tra được', async () => {
    phanLoai({ quyetDinh: 'rieng_giam_doc', category: 'quy_trinh' });
    const r = await S.xetDuaVaoKho({ title: 'Phân tích task', body: 'Nhiên mở việc lúc 22h, Tú trùng giờ 5 việc.', source: 'chat' }, GD);
    expect(r.item).toMatchObject({ scope: 'director', category: 'rieng', status: 'published' });
    expect(NAP[0]!.visibility).toBe('director');
  });

  it('không đáng lưu → rejected, không nạp đoạn, báo lý do', async () => {
    phanLoai({ quyetDinh: 'khong_luu', lyDo: 'số liệu thay đổi hằng ngày' });
    const r = await S.xetDuaVaoKho({ title: 'Điểm hôm nay', body: 'Hôm nay Hà được 320 điểm.', source: 'manual' }, NV);
    expect(r.item!.status).toBe('rejected');
    expect(r.message).toBe('Không lưu vào kho: số liệu thay đổi hằng ngày.');
    expect(NAP).toHaveLength(0);
    expect(GO).toContain(r.item!.id);
  });

  it('AI tự vơ mà không đáng lưu → không để lại rác', async () => {
    phanLoai({ quyetDinh: 'khong_luu' });
    const r = await S.xetDuaVaoKho({ title: 'x', body: 'Hỏi: chào\n\nChào anh nhé.', source: 'auto' }, GD);
    expect(r.item).toBeNull();
    expect(MUC.size).toBe(0);
  });

  it('AI lỗi → vào hàng chờ, KHÔNG tự ban hành', async () => {
    AI.loi = true;
    const r = await S.xetDuaVaoKho({ title: 'Quy trình', body: 'Bước 1 nhận brief, bước 2 làm.', source: 'manual', customer: 'Savax' }, GD);
    expect(r.item).toMatchObject({ status: 'pending', scope: 'director', customerId: 'K3' });
    expect(NAP).toHaveLength(0);
  });

  it('nhân viên gửi điều gần giống mục đang có → chờ duyệt + báo giám đốc', async () => {
    HITS = [{ sourceType: 'item', sourceId: 'BI-cu', title: 'Tiêu chuẩn thiết kế & nội dung: Màu thương hiệu', score: 0.9, content: '' }];
    const r = await S.xetDuaVaoKho({ title: 'Màu', body: 'Màu chính là xanh lá.', source: 'manual' }, NV);
    expect(r.item!.status).toBe('pending');
    expect(r.item!.aiReason).toContain('Màu thương hiệu');
    expect(BAO).toEqual([{ ids: ['GD'], type: 'brain_pending' }]);
  });

  it('giám đốc gửi thì không bị chặn vì trùng; chuyện chỉ một phòng → phạm vi phòng', async () => {
    HITS = [{ sourceType: 'item', sourceId: 'BI-cu', title: 'x', score: 0.95, content: '' }];
    phanLoai({ teamId: 'SEO', category: 'quy_trinh' });
    const r = await S.xetDuaVaoKho({ title: 'Quy trình SEO', body: 'Audit → keyword → content.', source: 'manual' }, GD);
    expect(r.item).toMatchObject({ status: 'published', scope: 'team:SEO', teamId: 'SEO', approvedBy: 'Anh Tâm' });
  });

  it('chạy lại với mã cố định thì giữ ngày tạo cũ (không nhân bản)', async () => {
    await S.xetDuaVaoKho({ title: 'a', body: 'nội dung đủ dài', source: 'customer_note', itemId: 'CN-1', goc: { createdAt: '2026-07-01T00:00:00Z' } }, GD);
    await S.xetDuaVaoKho({ title: 'a', body: 'nội dung đủ dài hơn', source: 'customer_note', itemId: 'CN-1' }, GD);
    expect(MUC.size).toBe(1);
    expect(MUC.get('CN-1')!.createdAt).toBe('2026-07-01T00:00:00Z');
  });
});

describe('timTriThuc — tra theo nhãn, trả theo mục', () => {
  const muc = (id: string, x: Record<string, unknown> = {}) =>
    MUC.set(id, { id, title: `Mục ${id}`, body: `Nội dung ${id}`, summary: `Tóm ${id}`, category: 'quy_trinh', customer: '', customerId: '', status: 'published', scope: 'all', updatedAt: '2026-10-04T00:00:00Z', ...x });

  it('hỏi về một khách → lọc ĐÚNG customer_id, không dùng ILIKE', async () => {
    await S.timTriThuc('khách thích màu gì', { directorScope: false, memberId: 'M1', teamId: 'Ads', customer: 'Thảo MLĐ' });
    expect(DOAN[0]).toMatchObject({ customerId: 'K1', customerName: 'C Thảo MLĐ', customer: undefined, teamId: 'Ads', directorScope: false });
  });

  it('gom nhiều đoạn của cùng một mục thành MỘT kết quả, kèm nhóm + ngày để trích nguồn', async () => {
    muc('BI-1', { category: 'tieu_chuan', title: 'Màu thương hiệu' });
    HITS = [
      { sourceType: 'item', sourceId: 'BI-1', score: 0.8, content: '[x]\nđoạn A', customer: '', createdAt: '' },
      { sourceType: 'item', sourceId: 'BI-1', score: 0.7, content: '[x]\nđoạn B', customer: '', createdAt: '' },
    ];
    const kq = await S.timTriThuc('màu chủ đạo', { directorScope: true });
    expect(kq.match(/📘/g)).toHaveLength(1);
    expect(kq).toContain('[Tiêu chuẩn thiết kế & nội dung] Màu thương hiệu — cập nhật 04/10/2026');
    expect(kq).toContain('đoạn A');
    expect(kq).not.toContain('đoạn B');
  });

  it('khớp chữ (mã việc, tên riêng) bù cho vector', async () => {
    muc('BI-2', { title: 'Mã video quảng cáo CON05' });
    CHU = [{ ...MUC.get('BI-2'), hits: 2 }];
    const kq = await S.timTriThuc('CON05', { directorScope: true });
    expect(kq).toContain('Mã video quảng cáo CON05');
  });

  it('không có gì đủ khớp → CHƯA CÓ TRONG KHO', async () => {
    HITS = [{ sourceType: 'item', sourceId: 'BI-3', score: 0.3, content: 'x', customer: '', createdAt: '' }];
    muc('BI-3');
    const kq = await S.timTriThuc('nghỉ phép năm mấy ngày', { directorScope: false, memberId: 'M1' });
    expect(kq.startsWith(S.CHUA_CO)).toBe(true);
  });

  it('độ khớp thấp thì cảnh báo trợ lý đừng suy diễn thành quy định', async () => {
    muc('BI-4');
    HITS = [{ sourceType: 'item', sourceId: 'BI-4', score: 0.55, content: '[x]\nabc', customer: '', createdAt: '' }];
    expect(await S.timTriThuc('q', { directorScope: true })).toContain('Độ khớp thấp');
  });
});

describe('câu hỏi chưa có lời giải', () => {
  it('câu mới → lưu + báo giám đốc; câu giống → gộp, tăng số lần, nhớ thêm người hỏi', async () => {
    const a = await S.chuyenCauHoi('Màu chủ đạo của thương hiệu là màu gì?', NV);
    expect(a).toContain('Đã chuyển câu hỏi');
    expect(BAO).toEqual([{ ids: ['GD'], type: 'brain_question' }]);
    await S.chuyenCauHoi('màu chủ đạo thương hiệu là gì vậy', { ...NV, id: 'M2' });
    const ds = [...CAU_HOI.values()];
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ times: 2, askers: ['M1', 'M2'] });
    expect(BAO).toHaveLength(1); // câu gộp không báo lại
  });

  it('giám đốc trả lời → thành mục kho, đóng câu hỏi, báo lại mọi người đã hỏi', async () => {
    await S.chuyenCauHoi('Màu chủ đạo của thương hiệu là màu gì?', NV);
    const id = [...CAU_HOI.keys()][0]!;
    const r = await S.traLoiCauHoi(id, 'Xanh #0B5FD9, phụ cam #FF8A00.', GD);
    expect(r.ketQua.item).toMatchObject({ status: 'published', source: 'answer' });
    expect(CAU_HOI.get(id)).toMatchObject({ status: 'answered', answerItemId: r.ketQua.item!.id });
    expect(BAO.at(-1)).toEqual({ ids: ['M1'], type: 'brain_answer' });
    await expect(S.traLoiCauHoi(id, 'lần hai', GD)).rejects.toThrow('đã xử lý');
  });

  it('câu trả lời bị xếp riêng giám đốc thì không báo nhân viên (họ đâu đọc được)', async () => {
    await S.chuyenCauHoi('Lương tháng này của Tú bao nhiêu?', NV);
    const id = [...CAU_HOI.keys()][0]!;
    phanLoai({ quyetDinh: 'rieng_giam_doc' });
    await S.traLoiCauHoi(id, 'Tú lương 9 triệu.', GD);
    expect(BAO.filter((b) => b.type === 'brain_answer')).toHaveLength(0);
  });
});

// Anh Tâm 10/10/2026: "AI tự đọc ... tự học những thứ liên quan đến công việc luôn, không cần anh phải
// duyệt, cái nào phân vân mới tới lượt anh" — mục kẹt "chờ duyệt" chỉ vì AI lỗi lúc gửi.
describe('xetLaiMucCho — AI xét lại mục đang chờ', () => {
  async function mucKet(): Promise<string> {
    AI.loi = true;
    const r = await S.xetDuaVaoKho({ title: 'Lưu ý Savax', body: 'Khách duyệt bài trước 10h sáng thứ Hai.', source: 'manual' }, NV);
    AI.loi = false;
    expect(r.item).toMatchObject({ status: 'pending' });
    expect(r.item!.aiReason.startsWith(S.AI_LOI_LUC_GUI)).toBe(true);
    return r.item!.id;
  }

  it('rõ ràng là việc công ty → ban hành luôn, không cần giám đốc', async () => {
    const id = await mucKet();
    phanLoai({ quyetDinh: 'cong_viec' });
    const kq = await S.xetLaiMucCho({ ids: [id], han: Date.now() + 10_000 });
    expect(kq).toEqual({ xong: 1, banHanh: 1, conCho: 0, bo: 0, conLai: [] });
    expect(MUC.get(id)).toMatchObject({ status: 'published', scope: 'all' });
  });

  it('phân vân → vẫn chờ giám đốc (người xét lại không phải giám đốc nên không tự ban hành)', async () => {
    const id = await mucKet();
    phanLoai({ quyetDinh: 'can_duyet', lyDo: 'chưa chắc là quy định chung' });
    const kq = await S.xetLaiMucCho({ ids: [id], han: Date.now() + 10_000 });
    expect(kq.conCho).toBe(1);
    expect(MUC.get(id)).toMatchObject({ status: 'pending', aiReason: 'chưa chắc là quy định chung' });
  });

  it('AI vẫn lỗi (hết lượt) → dừng, để lượt sau; hết giờ → trả phần chưa xét', async () => {
    const a = await mucKet();
    const b = await mucKet();
    AI.loi = true;
    expect(await S.xetLaiMucCho({ ids: [a, b], han: Date.now() + 10_000 })).toMatchObject({ xong: 0, conLai: [a, b] });
    AI.loi = false;
    expect(await S.xetLaiMucCho({ ids: [a, b], han: Date.now() - 1 })).toMatchObject({ xong: 0, conLai: [a, b] });
  });

  it('mục không còn chờ (đã ban hành) thì bỏ qua', async () => {
    const id = await mucKet();
    MUC.set(id, { ...MUC.get(id), status: 'published' });
    expect(await S.xetLaiMucCho({ ids: [id], han: Date.now() + 10_000 })).toMatchObject({ xong: 0 });
  });
});
