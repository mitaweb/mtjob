import { describe, it, expect, vi, beforeEach } from 'vitest';

// Zalo cá nhân → kho tri thức "có chọn lọc" (anh Tâm 5/10/2026).

const BAT = new Set<string>();
const CUOC: Array<Record<string, unknown>> = [];
const TIN: Array<Record<string, unknown>> = [];
const VAO_KHO: Array<{ input: Record<string, unknown>; nguoi: Record<string, unknown> }> = [];
const DA_RUT: string[][] = [];
let AI_Y: Array<{ tieuDe: string; noiDung: string }> = [];
let CHUA_RUT: Array<Record<string, unknown>> = [];

vi.mock('../gemini/client.js', () => ({ generateJson: vi.fn(async () => ({ y: AI_Y })) }));
vi.mock('./zalo.repo.js', () => ({
  ghiCuoc: vi.fn(async (c: Record<string, unknown>) => {
    CUOC.push(c);
    return BAT.has(String(c.threadId));
  }),
  ghiTin: vi.fn(async (t: Record<string, unknown>) => {
    TIN.push(t);
  }),
  dsCuoc: vi.fn(async () => [
    { threadId: 'T1', name: 'Chị Hà', customer: 'Savax Door', enabled: true, chuaRut: 3, lastMsgAt: '2026-10-05T01:00:00Z' },
    { threadId: 'T2', name: 'Mẹ', customer: '', enabled: false, chuaRut: 0, lastMsgAt: '2026-10-05T01:00:00Z' },
  ]),
  timCuoc: vi.fn(async () => undefined),
  tinChuaRut: vi.fn(async () => CHUA_RUT),
  danhDauDaRut: vi.fn(async (_t: string, ids: string[]) => {
    DA_RUT.push(ids);
  }),
  donTinCu: vi.fn(async () => undefined),
}));
vi.mock('./brainItems.service.js', () => ({
  xetDuaVaoKho: vi.fn(async (input: Record<string, unknown>, nguoi: Record<string, unknown>) => {
    VAO_KHO.push({ input, nguoi });
    return { item: { id: 'x', status: 'pending' }, message: 'Đã gửi — chờ giám đốc duyệt' };
  }),
}));
vi.mock('./crm.repo.js', () => ({ getCustomers: async () => [{ id: 'K3', name: 'Savax Door' }] }));
vi.mock('./members.repo.js', () => ({ getDirectors: async () => [{ id: 'GD', fullName: 'Anh Tâm' }] }));

const S = await import('./zalo.service.js');

beforeEach(() => {
  BAT.clear();
  CUOC.length = 0;
  TIN.length = 0;
  VAO_KHO.length = 0;
  DA_RUT.length = 0;
  AI_Y = [];
  CHUA_RUT = [];
});

describe('nhanTin — chỉ lưu nội dung cuộc đã bật', () => {
  const tin = (threadId: string, msgId: string, content: unknown, extra: Record<string, unknown> = {}) => ({
    msgId, threadId, content, ts: Date.UTC(2026, 9, 5, 2, 0), threadName: 'Người nhắn', ...extra,
  });

  it('cuộc chưa bật (mặc định): chỉ đếm, KHÔNG lưu nội dung', async () => {
    const r = await S.nhanTin([tin('T9', 'm1', 'Con ăn cơm chưa'), tin('T9', 'm2', 'Tối về sớm nhé')]);
    expect(r).toEqual({ luu: 0, boQua: 2 });
    expect(TIN).toHaveLength(0);
    expect(CUOC[0]).toMatchObject({ threadId: 'T9', soTin: 2 });
  });

  it('cuộc đã bật: lưu chữ + link, bỏ sticker; ghi đúng tin của mình / của khách', async () => {
    BAT.add('T1');
    const r = await S.nhanTin([
      tin('T1', 'm1', 'Chị muốn tông xanh', { sender: 'Chị Hà' }),
      tin('T1', 'm2', { catId: 3 }),
      tin('T1', 'm3', { title: 'brief.pdf', href: 'https://f/x' }, { fromSelf: true }),
    ]);
    expect(r).toEqual({ luu: 2, boQua: 0 });
    expect(TIN.map((t) => t.content)).toEqual(['Chị muốn tông xanh', '[Tệp/link: brief.pdf — https://f/x]']);
    expect(TIN[1]).toMatchObject({ fromSelf: true });
  });

  it('bỏ qua tin thiếu mã', async () => {
    expect(await S.nhanTin([{ msgId: '', threadId: 'T1', content: 'x', ts: 1 }])).toEqual({ luu: 0, boQua: 0 });
  });
});

describe('rút tri thức', () => {
  const tinDb = (id: string, fromSelf: boolean, content: string, phut: number) => ({
    msgId: id, threadId: 'T1', fromSelf, sender: fromSelf ? '' : 'Chị Hà', content, ts: String(Date.UTC(2026, 9, 5, 1, phut)),
  });

  it('chỉ cuộc ĐÃ BẬT; mỗi ý đi qua bộ phân loại với nguồn zalo + đúng khách; đánh dấu đã rút', async () => {
    CHUA_RUT = [tinDb('a', false, 'Chị không thích chữ đỏ', 1), tinDb('b', true, 'Dạ em ghi nhận', 2)];
    AI_Y = [{ tieuDe: 'Savax không thích chữ đỏ', noiDung: 'Khách không muốn dùng chữ màu đỏ trong thiết kế.' }];
    const r = await S.rutTriThucZalo({ epNgay: true });
    expect(r).toEqual({ cuoc: 1, y: 1 });
    expect(VAO_KHO).toHaveLength(1);
    expect(VAO_KHO[0]!.input).toMatchObject({ source: 'zalo', customer: 'Savax Door', title: 'Savax không thích chữ đỏ' });
    expect(VAO_KHO[0]!.nguoi).toMatchObject({ id: 'GD', role: 'director' });
    expect(DA_RUT).toEqual([['a', 'b']]);
  });

  it('AI thấy không có gì đáng giữ → không gửi gì vào kho, vẫn đánh dấu đã rút (khỏi rút lại)', async () => {
    CHUA_RUT = [tinDb('a', false, 'ok anh', 1)];
    AI_Y = [];
    await S.rutTriThucZalo({ epNgay: true });
    expect(VAO_KHO).toHaveLength(0);
    expect(DA_RUT).toEqual([['a']]);
  });

  it('ý quá ngắn bị loại', async () => {
    CHUA_RUT = [tinDb('a', false, 'x', 1)];
    AI_Y = [{ tieuDe: 'x', noiDung: 'ngắn' }];
    await S.rutTriThucZalo({ epNgay: true });
    expect(VAO_KHO).toHaveLength(0);
  });
});
