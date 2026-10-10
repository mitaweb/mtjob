import { describe, it, expect, vi, beforeEach } from 'vitest';

// Zalo cá nhân → kho tri thức (anh Tâm 5/10/2026). Từ 10/10/2026: "AI tự đọc sau đó tự học những thứ
// liên quan đến công việc luôn, không cần anh phải duyệt, cái nào phân vân mới tới lượt anh" + "Đọc và
// cập nhật khách hàng, nội dung khách hàng, lên lịch nhắc cho anh nếu cần".

const LUU = new Set<string>();
const CUOC: Array<Record<string, unknown>> = [];
const TIN: Array<Record<string, unknown>> = [];
const VAO_KHO: Array<{ input: Record<string, unknown>; nguoi: Record<string, unknown> }> = [];
const DA_RUT: string[][] = [];
let AI_Y: Array<{ tieuDe: string; noiDung: string }> = [];
let AI_DOC: Record<string, unknown> | null = null;
let CHUA_RUT: Array<Record<string, unknown>> = [];
let CUOC_CAN_RUT: Array<Record<string, unknown>> = [];
const TRANG_THAI: Array<{ loai: string; id: string; o: unknown }> = [];
const NHAC: Array<Record<string, unknown>> = [];
const BAO: Array<{ id: string; n: Record<string, unknown> }> = [];
let VI_DU: Array<Record<string, unknown>> = [];

let AI_NHOM: Array<Record<string, unknown>> = [];
let NHOM_CHUA_XET: Array<Record<string, unknown>> = [];
const KET_QUA_XET: Array<{ id: string; kq: Record<string, unknown> }> = [];
const CRM_GHI: Array<Record<string, unknown>> = [];
let PROMPT = '';

// AI của kho đi qua ai/brainAi.ts — chuyển thẳng về generateJson giả lập ở dưới.
vi.mock('../ai/brainAi.js', async () => {
  const g = await import('../gemini/client.js');
  return { aiKhoJson: (p: string, s: unknown) => (g.generateJson as (p: string, s: unknown) => Promise<unknown>)(p, s) };
});
vi.mock('../gemini/client.js', () => ({
  generateJson: vi.fn(async (prompt: string) => {
    PROMPT = prompt;
    return prompt.includes('CÁC NHÓM') ? { nhom: AI_NHOM } : (AI_DOC ?? { y: AI_Y });
  }),
}));
vi.mock('./zalo.repo.js', () => ({
  CHUA_RO_THEO_TEN: 'Chưa rõ theo tên nhóm',
  ghiCuoc: vi.fn(async (c: Record<string, unknown>) => {
    CUOC.push(c);
    return LUU.has(String(c.threadId));
  }),
  ghiTin: vi.fn(async (t: Record<string, unknown>) => {
    TIN.push(t);
  }),
  cuocCanRut: vi.fn(async () => CUOC_CAN_RUT),
  timCuoc: vi.fn(async () => undefined),
  tinChuaRut: vi.fn(async () => CHUA_RUT),
  tinGanDay: vi.fn(async () => CHUA_RUT),
  danhDauDaRut: vi.fn(async (_t: string, ids: string[]) => {
    DA_RUT.push(ids);
  }),
  donTinCu: vi.fn(async () => undefined),
  danhDauCaNhan: vi.fn(async (id: string, note: string) => {
    TRANG_THAI.push({ loai: 'ca_nhan', id, o: note });
  }),
  danhDauCongViec: vi.fn(async (id: string, o: unknown) => {
    TRANG_THAI.push({ loai: 'cong_viec', id, o });
  }),
  ghiGhiChuAi: vi.fn(async (id: string, note: string) => {
    TRANG_THAI.push({ loai: 'ghi_chu', id, o: note });
  }),
  hoiAnh: vi.fn(async (id: string, o: unknown) => {
    TRANG_THAI.push({ loai: 'hoi', id, o });
  }),
  viDuAnhQuyet: vi.fn(async () => VI_DU),
  nhomChuaXet: vi.fn(async () => NHOM_CHUA_XET),
  ghiKetQuaXet: vi.fn(async (id: string, kq: Record<string, unknown>) => {
    KET_QUA_XET.push({ id, kq });
  }),
}));
vi.mock('./brainItems.service.js', () => ({
  xetDuaVaoKho: vi.fn(async (input: Record<string, unknown>, nguoi: Record<string, unknown>) => {
    VAO_KHO.push({ input, nguoi });
    return { item: { id: 'x', status: 'published' }, message: 'Đã vào kho' };
  }),
}));
vi.mock('./crm.repo.js', () => ({
  CLOSED_STATUS: 'Đã chốt',
  getCustomers: async () => [{ id: 'K3', name: 'Savax Door', info: 'Khách VIP' }],
  upsertCustomer: vi.fn(async (c: Record<string, unknown>) => {
    CRM_GHI.push(c);
  }),
}));
vi.mock('./members.repo.js', () => ({ getDirectors: async () => [{ id: 'GD', fullName: 'Anh Tâm' }] }));
vi.mock('./notifications.service.js', () => ({
  notify: vi.fn(async (id: string, n: Record<string, unknown>) => {
    BAO.push({ id, n });
  }),
}));
vi.mock('./reminders.repo.js', () => ({
  addReminder: vi.fn(async (r: Record<string, unknown>) => {
    NHAC.push(r);
  }),
}));

const S = await import('./zalo.service.js');

beforeEach(() => {
  LUU.clear();
  CUOC.length = 0;
  TIN.length = 0;
  VAO_KHO.length = 0;
  DA_RUT.length = 0;
  AI_Y = [];
  AI_DOC = null;
  CHUA_RUT = [];
  CUOC_CAN_RUT = [];
  TRANG_THAI.length = 0;
  NHAC.length = 0;
  BAO.length = 0;
  VI_DU = [];
  AI_NHOM = [];
  NHOM_CHUA_XET = [];
  KET_QUA_XET.length = 0;
  CRM_GHI.length = 0;
  PROMPT = '';
});

// Anh Tâm 8/10/2026: nhóm khách "TÊN KH - MT DIGITAL", một số khác — AI quyết, khớp/tạo ở CRM.
describe('xacDinhNhomKhach', () => {
  const nhom = (threadId: string, name: string) => ({ threadId, name, isGroup: true, enabled: false });

  it('khớp khách đã có; khách mới thì tạo trong CRM; không liên quan công việc thì thôi đọc', async () => {
    NHOM_CHUA_XET = [nhom('G1', 'SAVAX DOOR - MT DIGITAL'), nhom('G2', 'Topaz Spa x MT'), nhom('G3', 'Gia đình')];
    AI_NHOM = [
      { id: 'G1', laNhomKhach: true, tenKhach: 'Savax Door', lyDo: 'đúng quy ước' },
      { id: 'G2', loai: 'khach', tenKhach: 'Topaz Spa', lyDo: 'tên thương hiệu + MT' },
      { id: 'G3', loai: 'khac', lyDo: 'nhóm gia đình' },
      { id: 'LA', laNhomKhach: true, tenKhach: 'Bịa' },
    ];
    const r = await S.xacDinhNhomKhach();
    expect(r).toEqual({ xet: 3, nhomKhach: 2, khachMoi: ['Topaz Spa'] });
    expect(PROMPT).toContain('"goiYTenKhach":"SAVAX DOOR"');
    expect(PROMPT).toContain('Savax Door');
    expect(CRM_GHI).toHaveLength(1);
    expect(CRM_GHI[0]).toMatchObject({ name: 'Topaz Spa', status: 'Đã chốt', assignedTo: 'GD', phone: '' });
    const theo = Object.fromEntries(KET_QUA_XET.map((x) => [x.id, x.kq]));
    expect(theo.G1).toMatchObject({ laNhomKhach: true, customerId: 'K3', customer: 'Savax Door' });
    expect(theo.G2).toMatchObject({ laNhomKhach: true, customerId: CRM_GHI[0]!.id, customer: 'Topaz Spa' });
    expect(theo.G3).toMatchObject({ laNhomKhach: false, customerId: '' });
    expect(String(theo.G3!.aiNote)).toContain('nhóm gia đình');
  });

  it('nhóm công việc không phải của khách (nội bộ, đối tác) → vẫn học; tên chưa rõ → để AI đọc tin', async () => {
    NHOM_CHUA_XET = [nhom('G4', 'Team Ads MT'), nhom('G5', 'Nhóm 2024')];
    AI_NHOM = [
      { id: 'G4', loai: 'cong_viec', lyDo: 'nhóm nội bộ' },
      { id: 'G5', loai: 'chua_ro' },
    ];
    await S.xacDinhNhomKhach();
    expect(KET_QUA_XET).toHaveLength(0);
    expect(TRANG_THAI).toEqual([
      { loai: 'cong_viec', id: 'G4', o: { aiNote: 'Nhóm công việc — nhóm nội bộ', customerId: '', customer: '' } },
      { loai: 'ghi_chu', id: 'G5', o: 'Chưa rõ theo tên nhóm — AI sẽ đọc tin nhắn để xét' },
    ]);
  });

  it('AI bỏ sót nhóm nào thì nhóm đó để lượt sau xét lại', async () => {
    NHOM_CHUA_XET = [nhom('G1', 'A - MT DIGITAL'), nhom('G2', 'B')];
    AI_NHOM = [{ id: 'G2', laNhomKhach: false, lyDo: 'không rõ' }];
    const r = await S.xacDinhNhomKhach();
    expect(r.xet).toBe(1);
    expect(KET_QUA_XET.map((x) => x.id)).toEqual(['G2']);
  });

  it('hai nhóm cùng một khách mới → chỉ tạo khách một lần', async () => {
    NHOM_CHUA_XET = [nhom('G1', 'Kingpen - MT DIGITAL'), nhom('G2', 'Kingpen Ads')];
    AI_NHOM = [
      { id: 'G1', laNhomKhach: true, tenKhach: 'Kingpen' },
      { id: 'G2', laNhomKhach: true, tenKhach: 'Kingpen' },
    ];
    await S.xacDinhNhomKhach();
    expect(CRM_GHI).toHaveLength(1);
    expect(KET_QUA_XET.map((x) => x.kq.customerId)).toEqual([CRM_GHI[0]!.id, CRM_GHI[0]!.id]);
  });
});

describe('nhanTin — lưu mọi cuộc, trừ cuộc đã bị loại', () => {
  const tin = (threadId: string, msgId: string, content: unknown, extra: Record<string, unknown> = {}) => ({
    msgId, threadId, content, ts: Date.UTC(2026, 9, 5, 2, 0), threadName: 'Người nhắn', ...extra,
  });

  it('cuộc đã bị loại (cá nhân / anh tắt): chỉ đếm, KHÔNG lưu nội dung', async () => {
    const r = await S.nhanTin([tin('T9', 'm1', 'Con ăn cơm chưa'), tin('T9', 'm2', 'Tối về sớm nhé')]);
    expect(r).toEqual({ luu: 0, boQua: 2 });
    expect(TIN).toHaveLength(0);
    expect(CUOC[0]).toMatchObject({ threadId: 'T9', soTin: 2 });
  });

  it('cuộc còn đọc: lưu chữ + link, bỏ sticker; ghi đúng tin của mình / của khách', async () => {
    LUU.add('T1');
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

describe('AI tự đọc cuộc trò chuyện', () => {
  const tinDb = (id: string, fromSelf: boolean, content: string, phut: number, threadId = 'T1') => ({
    msgId: id, threadId, fromSelf, sender: fromSelf ? '' : 'Chị Hà', content, ts: String(Date.UTC(2026, 9, 5, 1, phut)),
  });
  const cuoc = (o: Record<string, unknown>) => ({
    threadId: 'T1', name: 'Chị Hà', customer: '', customerId: '', enabled: false, aiChecked: false, isGroup: false,
    chuaRut: 2, lastMsgAt: '2026-10-05T01:00:00Z', ...o,
  });

  it('cuộc khách đã gắn: ý vào kho nguồn zalo + đúng khách, đánh dấu đã đọc', async () => {
    CUOC_CAN_RUT = [cuoc({ customer: 'Savax Door', customerId: 'K3', enabled: true, aiChecked: true })];
    CHUA_RUT = [tinDb('a', false, 'Chị không thích chữ đỏ', 1), tinDb('b', true, 'Dạ em ghi nhận', 2)];
    AI_Y = [{ tieuDe: 'Savax không thích chữ đỏ', noiDung: 'Khách không muốn dùng chữ màu đỏ trong thiết kế.' }];
    const r = await S.rutTriThucZalo({ epNgay: true });
    expect(r).toEqual({ cuoc: 1, y: 1, nhac: 0, caNhan: 0, hoi: 0, loi: '' });
    expect(VAO_KHO).toHaveLength(1);
    expect(VAO_KHO[0]!.input).toMatchObject({ source: 'zalo', customer: 'Savax Door', title: 'Savax không thích chữ đỏ' });
    expect(VAO_KHO[0]!.nguoi).toMatchObject({ id: 'GD', role: 'director' });
    expect(DA_RUT).toEqual([['a', 'b']]);
  });

  it('chuyện cá nhân → thôi đọc, xoá nội dung, không gửi gì vào kho', async () => {
    CUOC_CAN_RUT = [cuoc({ name: 'Mẹ' })];
    CHUA_RUT = [tinDb('a', false, 'Con ăn cơm chưa', 1)];
    AI_DOC = { loai: 'ca_nhan', tomTat: 'Mẹ hỏi thăm', y: [{ tieuDe: 'x', noiDung: 'không được vào kho đâu' }] };
    const r = await S.rutTriThucZalo({ epNgay: true });
    expect(r.caNhan).toBe(1);
    expect(TRANG_THAI).toEqual([{ loai: 'ca_nhan', id: 'T1', o: 'Không liên quan công việc — AI thôi đọc' }]);
    expect(VAO_KHO).toHaveLength(0);
    expect(NHAC).toHaveLength(0);
  });

  it('cuộc anh đã bật / đã là công việc thì AI không tự loại', async () => {
    CUOC_CAN_RUT = [cuoc({ enabled: true, aiChecked: true })];
    CHUA_RUT = [tinDb('a', false, 'Hôm nay trời đẹp', 1)];
    AI_DOC = { loai: 'ca_nhan', y: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(TRANG_THAI.some((t) => t.loai === 'ca_nhan')).toBe(false);
    expect(DA_RUT).toEqual([['a']]);
  });

  it('chưa rõ → không vào kho, đánh dấu đã đọc (khỏi đọc lại mỗi lượt), ghi lời AI', async () => {
    CUOC_CAN_RUT = [cuoc({})];
    CHUA_RUT = [tinDb('a', false, 'Alo', 1)];
    AI_DOC = { loai: 'chua_ro', y: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(TRANG_THAI[0]).toMatchObject({ loai: 'ghi_chu', id: 'T1' });
    expect(VAO_KHO).toHaveLength(0);
    expect(DA_RUT).toEqual([['a']]);
  });

  it('khách mới hỏi báo giá chưa trả lời → tạo khách tiềm năng, học, ghi hồ sơ, đặt nhắc anh', async () => {
    CUOC_CAN_RUT = [cuoc({ name: 'Anh Long' })];
    CHUA_RUT = [tinDb('a', false, 'Bên em báo giá web bán nội thất giúp anh', 1)];
    AI_DOC = {
      loai: 'cong_viec',
      laKhachHang: true,
      tenKhach: 'Nội Thất Long Phát',
      tomTat: 'Khách hỏi báo giá web',
      y: [{ tieuDe: 'Long Phát cần web bán nội thất', noiDung: 'Khách muốn làm web bán nội thất, có giỏ hàng.' }],
      boSungKhach: 'Bán nội thất gỗ, cần web có giỏ hàng. Liên hệ 0901234567',
      nhac: [{ viec: 'Gửi báo giá web cho Long Phát', han: '' }],
    };
    const r = await S.rutTriThucZalo({ epNgay: true });
    expect(r).toMatchObject({ cuoc: 1, y: 1, nhac: 1, caNhan: 0 });
    // Khách mới: tạo 'Mới', rồi ghi thêm hồ sơ (không SĐT)
    expect(CRM_GHI[0]).toMatchObject({ name: 'Nội Thất Long Phát', status: 'Mới', assignedTo: 'GD', info: '' });
    expect(String(CRM_GHI[1]!.info)).toContain('Bán nội thất gỗ');
    expect(String(CRM_GHI[1]!.info)).not.toContain('0901234567');
    expect(TRANG_THAI[0]).toMatchObject({
      loai: 'cong_viec',
      o: { customerId: CRM_GHI[0]!.id, customer: 'Nội Thất Long Phát', aiNote: 'Công việc · khách Nội Thất Long Phát — Khách hỏi báo giá web' },
    });
    expect(VAO_KHO[0]!.input).toMatchObject({ customer: 'Nội Thất Long Phát', source: 'zalo' });
    expect(NHAC[0]).toMatchObject({ memberId: 'GD', repeatKind: 'once', atTime: '08:30', active: true });
    expect(String(NHAC[0]!.title)).toContain('Gửi báo giá web cho Long Phát');
    expect(String(NHAC[0]!.onDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('khách đã có trong CRM → khớp, chỉ THÊM dòng vào hồ sơ, không tạo khách mới', async () => {
    CUOC_CAN_RUT = [cuoc({})];
    CHUA_RUT = [tinDb('a', false, 'Tháng sau chị chạy thêm Ads Tết', 1)];
    AI_DOC = { loai: 'cong_viec', laKhachHang: true, tenKhach: 'Savax Door', y: [], boSungKhach: 'Muốn chạy Ads Tết', nhac: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(CRM_GHI).toHaveLength(1);
    expect(CRM_GHI[0]).toMatchObject({ id: 'K3', name: 'Savax Door' });
    expect(String(CRM_GHI[0]!.info)).toMatch(/^Khách VIP\n• \d\d\/\d\d \(Zalo\): Muốn chạy Ads Tết$/);
  });

  it('ý quá ngắn bị loại', async () => {
    CUOC_CAN_RUT = [cuoc({ enabled: true, aiChecked: true })];
    CHUA_RUT = [tinDb('a', false, 'x', 1)];
    AI_Y = [{ tieuDe: 'x', noiDung: 'ngắn' }];
    await S.rutTriThucZalo({ epNgay: true });
    expect(VAO_KHO).toHaveLength(0);
  });
});

// Anh Tâm 10/10/2026: "cho anh 1 nút chủ động đọc và phân loại không cần chờ đến tối".
describe('đọc ngay — hạn giờ và hết lượt AI', () => {
  const cuoc = (threadId: string) => ({
    threadId, name: threadId, customer: '', customerId: '', enabled: true, aiChecked: true, isGroup: false,
    chuaRut: 1, lastMsgAt: '2026-10-05T01:00:00Z',
  });

  it('hết giờ thì dừng, lượt sau đọc tiếp', async () => {
    CUOC_CAN_RUT = [cuoc('A'), cuoc('B')];
    CHUA_RUT = [{ msgId: 'a', threadId: 'A', fromSelf: false, sender: 'K', content: 'xin chào', ts: '1' }];
    const r = await S.rutTriThucZalo({ epNgay: true, limit: 40, han: Date.now() - 1 });
    expect(r.cuoc).toBe(0);
    expect(DA_RUT).toEqual([]);
  });

  it('AI hết lượt (429) → dừng ngay, báo lỗi, không đọc tiếp cuộc sau', async () => {
    CUOC_CAN_RUT = [cuoc('A'), cuoc('B')];
    CHUA_RUT = [{ msgId: 'a', threadId: 'A', fromSelf: false, sender: 'K', content: 'xin chào', ts: '1' }];
    const g = await import('../gemini/client.js');
    (g.generateJson as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(new Error('Gemini 429: quota'));
    const r = await S.rutTriThucZalo({ epNgay: true, limit: 40, han: Date.now() + 10_000 });
    expect(r).toMatchObject({ cuoc: 0, loi: 'Gemini 429: quota' });
    expect(DA_RUT).toEqual([]);
  });
});

// Anh Tâm 10/10/2026: "cái nào cứ liên quan thì học, 50:50 thì hỏi anh rồi sau này tự quyết định".
describe('50:50 thì hỏi anh, rồi học theo anh', () => {
  const cuoc = (o: Record<string, unknown>) => ({
    threadId: 'T5', name: 'Anh Bình', customer: '', customerId: '', enabled: false, aiChecked: false, isGroup: false,
    chuaRut: 1, lastMsgAt: '2026-10-05T01:00:00Z', ...o,
  });

  it('phân vân → hỏi anh (kèm lý do + tóm tắt), không học gì, báo anh một lần', async () => {
    CUOC_CAN_RUT = [cuoc({})];
    CHUA_RUT = [{ msgId: 'a', threadId: 'T5', fromSelf: false, sender: 'Bình', content: 'Cuối tuần đi cafe, tiện bàn vụ web', ts: '1' }];
    AI_DOC = { loai: 'phan_van', lyDo: 'vừa chuyện riêng vừa nhắc việc', tomTat: 'Rủ cafe, nhắc vụ web', y: [{ tieuDe: 'x', noiDung: 'không được học đâu' }] };
    const r = await S.rutTriThucZalo({ epNgay: true });
    expect(r.hoi).toBe(1);
    expect(TRANG_THAI).toEqual([{ loai: 'hoi', id: 'T5', o: { lyDo: 'vừa chuyện riêng vừa nhắc việc', tomTat: 'Rủ cafe, nhắc vụ web' } }]);
    expect(VAO_KHO).toHaveLength(0);
    expect(DA_RUT).toEqual([['a']]);
    expect(BAO).toHaveLength(1);
    expect(BAO[0]).toMatchObject({ id: 'GD', n: { type: 'zalo_hoi', url: '/brain?tab=zalo' } });
  });

  it('cuộc anh đã chọn học thì AI không hỏi lại', async () => {
    CUOC_CAN_RUT = [cuoc({ enabled: true, aiChecked: true })];
    CHUA_RUT = [{ msgId: 'a', threadId: 'T5', fromSelf: false, sender: 'Bình', content: 'Gửi anh file brief', ts: '1' }];
    AI_DOC = { loai: 'phan_van', y: [] };
    const r = await S.rutTriThucZalo({ epNgay: true });
    expect(r.hoi).toBe(0);
    expect(TRANG_THAI.some((t) => t.loai === 'hoi')).toBe(false);
  });

  it('quyết định trước của anh được đưa cho AI làm ví dụ (cả lúc đọc tin lẫn lúc xét nhóm)', async () => {
    VI_DU = [
      { ten: 'Chợ sỉ Quảng Châu', nhom: true, tomTat: 'Mua bán hàng sỉ', quyet: 'bo' },
      { ten: 'Anh Bình', nhom: false, tomTat: 'Đối tác in ấn', quyet: 'hoc' },
    ];
    CUOC_CAN_RUT = [cuoc({})];
    CHUA_RUT = [{ msgId: 'a', threadId: 'T5', fromSelf: false, sender: 'Bình', content: 'Báo giá in catalogue', ts: '1' }];
    AI_DOC = { loai: 'cong_viec', y: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(PROMPT).toContain('GIÁM ĐỐC ĐÃ TỰ QUYẾT');
    expect(PROMPT).toContain('- BỎ QUA: nhóm «Chợ sỉ Quảng Châu» — Mua bán hàng sỉ');
    expect(PROMPT).toContain('- HỌC: chat «Anh Bình» — Đối tác in ấn');

    NHOM_CHUA_XET = [{ threadId: 'G7', name: 'Chợ sỉ Hà Nội', isGroup: true, enabled: false }];
    AI_NHOM = [{ id: 'G7', loai: 'khac', lyDo: 'nhóm chợ' }];
    await S.xacDinhNhomKhach();
    expect(PROMPT).toContain('- BỎ QUA: nhóm «Chợ sỉ Quảng Châu»');
    expect(PROMPT).not.toContain('Anh Bình'); // lúc xét nhóm chỉ đưa ví dụ là nhóm
    expect(PROMPT).toContain('nhóm CHỢ / mua bán');
  });
});
