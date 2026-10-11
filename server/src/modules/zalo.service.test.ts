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
let VIEC_MO: Array<Record<string, unknown>> = [];
const SUA_MUC: Array<{ id: string; patch: Record<string, unknown> }> = [];
vi.mock('./brainItems.repo.js', () => ({ listItems: vi.fn(async () => VIEC_MO) }));
vi.mock('./brainItems.service.js', () => ({
  suaMuc: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    SUA_MUC.push({ id, patch });
  }),
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
vi.mock('./members.repo.js', () => ({
  getDirectors: async () => [{ id: 'GD', fullName: 'Anh Tâm' }],
  getActiveMembers: async () => [{ id: 'GD', fullName: 'Anh Tâm' }, { id: 'M2', fullName: 'Ann Thuỳ' }],
}));
vi.mock('./notifications.service.js', () => ({
  notify: vi.fn(async (id: string, n: Record<string, unknown>) => {
    BAO.push({ id, n });
  }),
}));
const NHAC_DB = new Map<string, Record<string, unknown>>();
const TAT: string[] = [];
vi.mock('./reminders.repo.js', () => ({
  findReminder: vi.fn(async (id: string) => NHAC_DB.get(id)),
  luuNhacGop: vi.fn(async (r: Record<string, unknown>) => {
    NHAC.push(r);
    NHAC_DB.set(String(r.id), { ...r, active: true });
  }),
  tatNhac: vi.fn(async (id: string) => {
    TAT.push(id);
    const x = NHAC_DB.get(id);
    if (x) x.active = false;
  }),
  tatNhacTheoTienTo: vi.fn(async () => 0),
  nhacDangBatTheoTienTo: vi.fn(async (p: string) => [...NHAC_DB.values()].filter((x) => x.active && String(x.id).startsWith(p))),
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
  VIEC_MO = [];
  SUA_MUC.length = 0;
  NHAC_DB.clear();
  TAT.length = 0;
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

  it('khớp khách đã có; khách chưa có thì CHƯA tạo CRM (chờ tương tác); không liên quan thì thôi đọc', async () => {
    NHOM_CHUA_XET = [nhom('G1', 'SAVAX DOOR - MT DIGITAL'), nhom('G2', 'Topaz Spa x MT'), nhom('G3', 'Gia đình')];
    AI_NHOM = [
      { id: 'G1', laNhomKhach: true, tenKhach: 'Savax Door', lyDo: 'đúng quy ước' },
      { id: 'G2', loai: 'khach', tenKhach: 'Topaz Spa', lyDo: 'tên thương hiệu + MT' },
      { id: 'G3', loai: 'khac', lyDo: 'nhóm gia đình' },
      { id: 'LA', laNhomKhach: true, tenKhach: 'Bịa' },
    ];
    const r = await S.xacDinhNhomKhach();
    expect(r).toEqual({ xet: 3, nhomKhach: 2 });
    expect(PROMPT).toContain('"goiYTenKhach":"SAVAX DOOR"');
    expect(PROMPT).toContain('Savax Door');
    // Anh Tâm 11/10/2026: tạo khách theo tên nhóm đa phần sai → không tạo nữa
    expect(CRM_GHI).toHaveLength(0);
    const theo = Object.fromEntries(KET_QUA_XET.map((x) => [x.id, x.kq]));
    expect(theo.G1).toMatchObject({ laNhomKhach: true, customerId: 'K3', customer: 'Savax Door' });
    expect(theo.G2).toMatchObject({ laNhomKhach: true, customerId: '', customer: 'Topaz Spa' });
    expect(String(theo.G2!.aiNote)).toContain('chờ có tương tác gần đây');
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

  it('nhóm khách chưa có trong CRM → chỉ ghi tên chờ, không tạo khách', async () => {
    NHOM_CHUA_XET = [nhom('G1', 'Kingpen - MT DIGITAL'), nhom('G2', 'Kingpen Ads')];
    AI_NHOM = [
      { id: 'G1', laNhomKhach: true, tenKhach: 'Kingpen' },
      { id: 'G2', laNhomKhach: true, tenKhach: 'Kingpen' },
    ];
    await S.xacDinhNhomKhach();
    expect(CRM_GHI).toHaveLength(0);
    expect(KET_QUA_XET.map((x) => x.kq.customer)).toEqual(['Kingpen', 'Kingpen']);
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
    msgId: id, threadId, fromSelf, sender: fromSelf ? '' : 'Chị Hà', content, ts: String(Date.now() - (60 - phut) * 60_000),
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
    CHUA_RUT = [tinDb('a', false, 'Alo anh ơi, em hỏi chút', 1)];
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
    expect(NHAC[0]!.title).toBe('Nội Thất Long Phát: Gửi báo giá web cho Long Phát');
    expect(NHAC[0]!.id).toBe(`ZR-K-${CRM_GHI[0]!.id}`);
    // Ghi chú khách có dòng việc cần theo dõi
    expect(String(CRM_GHI[1]!.note)).toContain('📌 Việc cần theo dõi (AI');
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
    CHUA_RUT = [{ msgId: 'a', threadId: 'A', fromSelf: false, sender: 'K', content: 'xin chào anh, em muốn hỏi giá làm web', ts: '1' }];
    const r = await S.rutTriThucZalo({ epNgay: true, limit: 40, han: Date.now() - 1 });
    expect(r.cuoc).toBe(0);
    expect(DA_RUT).toEqual([]);
  });

  it('AI hết lượt (429) → dừng ngay, báo lỗi, không đọc tiếp cuộc sau', async () => {
    CUOC_CAN_RUT = [cuoc('A'), cuoc('B')];
    CHUA_RUT = [{ msgId: 'a', threadId: 'A', fromSelf: false, sender: 'K', content: 'xin chào anh, em muốn hỏi giá làm web', ts: '1' }];
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

// Anh Tâm 11/10/2026: "1 khách hàng 1 thông báo sau khi tổng hợp ... xác định chủ thể ... nhân viên nói về
// Tín Đạt thì cũng đưa thông tin đó vào khách hàng Tín Đạt, dựa vào văn phong, nội dung để xác định nhân viên".
describe('mỗi khách một nhắc, đúng chủ thể', () => {
  const cuoc = (o: Record<string, unknown>) => ({
    threadId: '777', name: 'Hồng Thanh', customer: 'Savax Door', customerId: 'K3', enabled: true, aiChecked: true, isGroup: false,
    chuaRut: 1, lastMsgAt: '2026-10-05T01:00:00Z', ...o,
  });
  const tin = (threadId = '777') => [{ msgId: 'm1', threadId, fromSelf: false, sender: 'X', content: 'Nội dung trao đổi công việc với khách', ts: '1' }];

  it('đọc lần 2: AI nhận danh sách đang theo dõi và trả danh sách mới nhất — vẫn MỘT nhắc', async () => {
    CUOC_CAN_RUT = [cuoc({})];
    CHUA_RUT = tin();
    AI_DOC = { loai: 'cong_viec', y: [], nhac: [{ viec: 'Xin kho tư liệu', han: '' }, { viec: 'Gửi báo giá video', han: '' }] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(NHAC).toHaveLength(1);
    expect(NHAC[0]).toMatchObject({ id: 'ZR-K-K3', title: 'Savax Door: 1) Xin kho tư liệu; 2) Gửi báo giá video' });

    // Lần sau: báo giá đã gửi → AI bỏ việc đó; nhắc cũ được ghi đè (cùng mã), không thêm nhắc mới
    CHUA_RUT = [{ msgId: 'm2', threadId: '777', fromSelf: true, sender: '', content: 'Anh gửi báo giá rồi nhé', ts: '2' }];
    AI_DOC = { loai: 'cong_viec', y: [], nhac: [{ viec: 'Xin kho tư liệu', han: '' }] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(PROMPT).toContain('ĐANG THEO DÕI: "Savax Door: 1) Xin kho tư liệu; 2) Gửi báo giá video"');
    expect(NHAC).toHaveLength(2);
    expect(NHAC[1]).toMatchObject({ id: 'ZR-K-K3', title: 'Savax Door: Xin kho tư liệu' });

    // Không đổi gì → không bắn lại
    CHUA_RUT = [{ msgId: 'm3', threadId: '777', fromSelf: false, sender: 'X', content: 'ok', ts: '3' }];
    await S.rutTriThucZalo({ epNgay: true });
    expect(NHAC).toHaveLength(2);

    // Hết việc → tắt nhắc
    CHUA_RUT = [{ msgId: 'm4', threadId: '777', fromSelf: false, sender: 'X', content: 'em gửi tư liệu rồi', ts: '4' }];
    AI_DOC = { loai: 'cong_viec', y: [], nhac: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(TAT).toContain('ZR-K-K3');
  });

  it('nhân viên nói về khách khác trong chat nội bộ → ý vào kho đúng khách đó, việc gộp vào nhắc của khách đó', async () => {
    CUOC_CAN_RUT = [cuoc({ threadId: '888', name: 'Ann Thuỳ', customer: '', customerId: '', enabled: false, aiChecked: false })];
    CHUA_RUT = tin('888');
    AI_DOC = {
      loai: 'cong_viec',
      laNhanSu: false, // AI quên — tên trùng nhân sự vẫn bị chặn thành khách
      laKhachHang: true,
      tenKhach: 'Ann Thuỳ',
      y: [{ tieuDe: 'Savax muốn đổi màu logo', noiDung: 'Nhân viên báo Savax muốn đổi logo sang màu xanh.', khach: 'Savax Door' }],
      nhac: [{ viec: 'Gửi Savax bản logo xanh', han: '', khach: 'Savax Door' }],
    };
    await S.rutTriThucZalo({ epNgay: true });
    expect(CRM_GHI.some((k) => k.name === 'Ann Thuỳ')).toBe(false); // không tạo khách từ nhân sự
    expect(TRANG_THAI[0]).toMatchObject({ loai: 'cong_viec', o: { customerId: '', aiNote: 'Nội bộ · nhân sự công ty' } });
    expect(VAO_KHO[0]!.input).toMatchObject({ customer: 'Savax Door' });
    expect(NHAC).toHaveLength(1);
    expect(NHAC[0]).toMatchObject({ id: 'ZR-K-K3', title: 'Savax Door: Gửi Savax bản logo xanh' });
    expect(PROMPT).toContain('NHÂN SỰ MT DIGITAL');
    expect(PROMPT).toContain('VĂN PHONG');
  });

  it('dọn nhắc lẻ kiểu cũ → mỗi khách một nhắc', async () => {
    NHAC_DB.set('ZR-555-1-0', { id: 'ZR-555-1-0', memberId: 'GD', title: 'Xin kho tư liệu (Zalo: Hồng Thanh)', onDate: '2026-10-11', atTime: '09:00', active: true });
    NHAC_DB.set('ZR-555-2-0', { id: 'ZR-555-2-0', memberId: 'GD', title: 'Gửi báo giá (Zalo: Hồng Thanh)', onDate: '2026-10-11', atTime: '09:00', active: true });
    const r = await S.gopNhacCu();
    expect(r).toEqual({ gop: 2, khach: 1 });
    expect(NHAC).toHaveLength(1);
    expect(NHAC[0]).toMatchObject({ id: 'ZR-T-555', title: 'Hồng Thanh: 1) Xin kho tư liệu; 2) Gửi báo giá' });
    expect(TAT).toEqual(['ZR-555-1-0', 'ZR-555-2-0']);
    expect(await S.gopNhacCu()).toEqual({ gop: 0, khach: 0 });
  });
});

// Anh Tâm 11/10/2026: "chỉ lấy khách hàng có tương tác gần đây, lâu rồi không tương tác đa phần đã ngưng dịch vụ".
describe('chỉ tạo khách khi có tương tác gần đây', () => {
  const nhom = { threadId: '999', name: 'KINGPEN - MT DIGITAL', customer: 'Kingpen', customerId: '', enabled: true, aiChecked: true, isGroup: true, chuaRut: 1, lastMsgAt: '' };
  it('nhóm khách có tin trong 60 ngày → tạo khách (đang dùng dịch vụ)', async () => {
    CUOC_CAN_RUT = [nhom];
    CHUA_RUT = [{ msgId: 'k1', threadId: '999', fromSelf: false, sender: 'Kingpen', content: 'Em gửi lịch đăng tuần sau', ts: String(Date.now() - 3 * 24 * 3600_000) }];
    AI_DOC = { loai: 'cong_viec', y: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(CRM_GHI[0]).toMatchObject({ name: 'Kingpen', status: 'Đã chốt' });
  });
  it('chỉ có lịch sử cũ (> 60 ngày) → không tạo khách', async () => {
    CUOC_CAN_RUT = [nhom];
    CHUA_RUT = [{ msgId: 'k2', threadId: '999', fromSelf: false, sender: 'Kingpen', content: 'Nghiệm thu web', ts: String(Date.now() - 120 * 24 * 3600_000) }];
    AI_DOC = { loai: 'cong_viec', laKhachHang: true, tenKhach: 'Kingpen', y: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(CRM_GHI).toHaveLength(0);
  });
});

// Anh Tâm 11/10/2026: "nếu đã xử lý thì em cập nhật, vd khách đã thanh toán thì bỏ cái lưu ý đó đi".
describe('AI tự gỡ lưu ý riêng đã xử lý', () => {
  it('chat cho thấy đã xong → mục riêng chuyển sang lưu trữ; mã lạ thì bỏ qua', async () => {
    CUOC_CAN_RUT = [{ threadId: '777', name: 'Hồng Thanh', customer: 'Savax Door', customerId: 'K3', enabled: true, aiChecked: true, isGroup: false, chuaRut: 1, lastMsgAt: '' }];
    CHUA_RUT = [{ msgId: 'p1', threadId: '777', fromSelf: false, sender: 'Hồng Thanh', content: 'Bên chị chuyển khoản hoá đơn rồi nhé', ts: String(Date.now()) }];
    VIEC_MO = [{ id: 'BI-hoadon', title: 'Hoá đơn đợt trước chưa xác nhận', summary: 'Chờ khách xác nhận hoá đơn' }];
    AI_DOC = { loai: 'cong_viec', y: [], daXong: ['BI-hoadon', 'BI-bia'] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(PROMPT).toContain('[BI-hoadon] Hoá đơn đợt trước chưa xác nhận');
    expect(SUA_MUC).toEqual([{ id: 'BI-hoadon', patch: { status: 'archived' } }]);
  });
});

// Anh Tâm 11/10/2026: "có cách nào xác định tin nhắn cũ để không đọc nữa ... đỡ tốn token đọc tin".
describe('đỡ tốn token', () => {
  it('tin mới chỉ là ok / dạ / cảm ơn → đánh dấu đã đọc, KHÔNG gọi AI', async () => {
    CUOC_CAN_RUT = [{ threadId: 'T1', name: 'Chị Hà', customer: '', customerId: '', enabled: true, aiChecked: true, isGroup: false, chuaRut: 2, lastMsgAt: '' }];
    CHUA_RUT = [
      { msgId: 'o1', threadId: 'T1', fromSelf: false, sender: 'Hà', content: 'Dạ ok anh', ts: '1' },
      { msgId: 'o2', threadId: 'T1', fromSelf: true, sender: '', content: 'cảm ơn chị 🙏', ts: '2' },
    ];
    PROMPT = '';
    await S.rutTriThucZalo({ epNgay: true });
    expect(PROMPT).toBe('');
    expect(DA_RUT).toEqual([['o1', 'o2']]);
  });
});

// Anh Tâm 11/10/2026: "những chỗ phân vân này anh sẽ comment vào để phần mềm hiểu".
describe('lời anh giải thích cho AI', () => {
  it('AI đọc lời anh về chính cuộc đó, và lời anh ở cuộc khác thành ví dụ', async () => {
    VI_DU = [{ ten: 'Nhi Lê', nhom: false, tomTat: 'Nhờ làm slide ngày hội', quyet: 'bo', ghiChu: 'Bạn trong BNI, việc hội nhóm — không phải khách' }];
    CUOC_CAN_RUT = [{
      threadId: 'T8', name: 'Team Ads MT', customer: '', customerId: '', enabled: true, aiChecked: true, isGroup: true,
      chuaRut: 1, lastMsgAt: '', anhGhiChu: 'Nhóm nội bộ team Ads — học quy trình chạy quảng cáo',
    }];
    CHUA_RUT = [{ msgId: 'g1', threadId: 'T8', fromSelf: false, sender: 'Như', content: 'Em đã tắt camp cũ, lên camp mới ngân sách 500k/ngày', ts: String(Date.now()) }];
    AI_DOC = { loai: 'cong_viec', y: [] };
    await S.rutTriThucZalo({ epNgay: true });
    expect(PROMPT).toContain('GIÁM ĐỐC GIẢI THÍCH VỀ CUỘC NÀY (làm theo đúng như vậy): "Nhóm nội bộ team Ads — học quy trình chạy quảng cáo"');
    expect(PROMPT).toContain('- BỎ QUA: chat «Nhi Lê» — Nhờ làm slide ngày hội (giám đốc giải thích: "Bạn trong BNI, việc hội nhóm — không phải khách")');
  });
});
