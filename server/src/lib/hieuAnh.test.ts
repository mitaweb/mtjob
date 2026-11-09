import { describe, it, expect } from 'vitest';
import { chonDoanHoc, gopHieuAnh, chonDieuChoLoiNhac, baiKhoHieuAnh, type MucHieuAnh } from './hieuAnh.js';
import type { TinZalo } from './zalo.js';

// Anh Tâm 9/11/2026: "bộ não hiện tại phải hiểu được anh thông qua các đoạn chat của anh với nhân viên và khách hàng".
// Tên / nội dung dưới đây là GIẢ.

const tin = (id: string, ts: number, fromSelf: boolean, content: string, sender = 'Khách A'): TinZalo => ({
  msgId: id,
  threadId: 'T1',
  fromSelf,
  sender: fromSelf ? '' : sender,
  content,
  ts: String(ts),
});

describe('chonDoanHoc — đoạn chat để học về anh', () => {
  const ds = [
    tin('1', 1, false, 'Chào anh'),
    tin('2', 2, false, 'Bên em báo giá gói SEO bao nhiêu ạ?'),
    tin('3', 3, false, 'Em cần gấp trong tuần'),
    tin('4', 4, true, 'Gói SEO bên anh tối thiểu 6 tháng, không nhận 1 tháng em nhé'),
    tin('5', 5, false, 'Dạ'),
    tin('6', 6, true, 'ok'),
  ];
  it('lấy tin anh gửi kèm vài tin ngay trước làm ngữ cảnh; đánh dấu mọi tin của anh chưa học', () => {
    const r = chonDoanHoc(ds, new Set(['4', '6']), { ngCanh: 2 });
    expect(r.msgIds.sort()).toEqual(['4', '6']);
    expect(r.doan).toContain('Khách A: Bên em báo giá gói SEO bao nhiêu ạ?');
    expect(r.doan).toContain('ANH: Gói SEO bên anh tối thiểu 6 tháng');
    expect(r.doan).not.toContain('Chào anh'); // ngoài 2 tin ngữ cảnh
  });
  it('tin của anh chỉ toàn "ok", "dạ", sticker → không cần gọi AI (đoạn rỗng) nhưng vẫn đánh dấu đã học', () => {
    const r = chonDoanHoc(ds, new Set(['6']), { ngCanh: 2 });
    expect(r).toEqual({ doan: '', msgIds: ['6'] });
  });
  it('che số điện thoại / số dài trước khi gửi AI', () => {
    const r = chonDoanHoc([tin('9', 9, true, 'Em gọi anh số 0901234567 nhé, STK 0071000123456')], new Set(['9']));
    expect(r.doan).not.toMatch(/0901234567|0071000123456/);
  });
});

const muc = (id: string, o: Partial<MucHieuAnh> = {}): MucHieuAnh => ({
  id,
  phamVi: 'chung',
  khiaCanh: 'nguyen_tac',
  noiDung: 'Anh Tâm không nhận gói SEO dưới 6 tháng',
  doiTuong: '',
  bangChung: [],
  soLanThay: 1,
  trangThai: 'dung',
  nguon: 'zalo',
  capNhat: '2026-11-01',
  ...o,
});

describe('gopHieuAnh — gộp điều AI rút ra vào hồ sơ', () => {
  it('xác nhận điều cũ → tăng số lần thấy, thêm bằng chứng (tối đa 3)', () => {
    const r = gopHieuAnh([muc('A', { bangChung: ['b1', 'b2', 'b3'] })], { moi: [], xacNhan: [{ id: 'A', bangChung: 'b4' }] });
    expect(r.sua).toEqual([{ id: 'A', soLanThay: 2, bangChung: ['b2', 'b3', 'b4'] }]);
    expect(r.them).toEqual([]);
  });
  it('điều anh đã sửa hoặc đã bỏ thì AI không đụng; điều mới trùng ý điều anh bỏ thì không thêm lại', () => {
    const cu = [muc('S', { trangThai: 'anh_sua' }), muc('B', { trangThai: 'anh_bo', khiaCanh: 'thoi_quen', noiDung: 'Anh Tâm thích gọi điện hơn nhắn tin' })];
    const r = gopHieuAnh(cu, {
      xacNhan: [{ id: 'S', noiDungMoi: 'câu khác' }, { id: 'B' }],
      moi: [{ khiaCanh: 'thoi_quen', noiDung: 'Anh Tâm thích gọi điện hơn nhắn tin.' }],
    });
    expect(r).toEqual({ them: [], sua: [] });
  });
  it('điều mới trùng ý điều đang dùng → xác nhận; điều mới thật → thêm; bỏ loại sai / quá ngắn', () => {
    const r = gopHieuAnh([muc('A')], {
      xacNhan: [],
      moi: [
        { khiaCanh: 'nguyen_tac', noiDung: 'anh tâm KHÔNG nhận gói SEO dưới 6 tháng!', bangChung: 'x' },
        { phamVi: 'chung', khiaCanh: 'cach_noi', noiDung: 'Anh Tâm xưng "anh", gọi khách là "em", trả lời ngắn' },
        { khiaCanh: 'linh_tinh', noiDung: 'Một điều không thuộc nhóm nào cả' },
        { khiaCanh: 'uu_tien', noiDung: 'ngắn' },
      ],
    });
    expect(r.sua).toEqual([{ id: 'A', soLanThay: 2, bangChung: ['x'] }]);
    expect(r.them).toEqual([{ phamVi: 'chung', doiTuong: '', khiaCanh: 'cach_noi', noiDung: 'Anh Tâm xưng "anh", gọi khách là "em", trả lời ngắn', bangChung: [] }]);
  });
  it('cùng câu nhưng khác khách → hai điều riêng; phạm vi khách / việc mà thiếu tên thì coi là chung', () => {
    const cu = [muc('K1', { phamVi: 'khach', doiTuong: 'Tín Đạt', noiDung: 'Mọi bài đăng phải gửi anh duyệt trước' })];
    const r = gopHieuAnh(cu, {
      xacNhan: [],
      moi: [
        { phamVi: 'khach', doiTuong: 'tín đạt', khiaCanh: 'nguyen_tac', noiDung: 'Mọi bài đăng phải gửi anh duyệt trước.' },
        { phamVi: 'khach', doiTuong: 'Welllife', khiaCanh: 'nguyen_tac', noiDung: 'Mọi bài đăng phải gửi anh duyệt trước' },
        { phamVi: 'viec', doiTuong: '', khiaCanh: 'nguyen_tac', noiDung: 'Báo cáo phải có so sánh tuần trước' },
      ],
    });
    expect(r.sua.map((s) => s.id)).toEqual(['K1']);
    expect(r.them.map((t) => [t.phamVi, t.doiTuong])).toEqual([
      ['khach', 'Welllife'],
      ['chung', ''],
    ]);
  });
  it('AI sửa câu chữ điều đang dùng (không phải anh dạy) thì nhận', () => {
    const r = gopHieuAnh([muc('A')], { moi: [], xacNhan: [{ id: 'A', noiDungMoi: 'Anh Tâm chỉ nhận gói SEO từ 6 tháng trở lên' }] });
    expect(r.sua).toEqual([{ id: 'A', soLanThay: 2, bangChung: [], noiDung: 'Anh Tâm chỉ nhận gói SEO từ 6 tháng trở lên' }]);
  });
});

describe('chonDieuChoLoiNhac — điều đưa vào lời dặn trợ lý', () => {
  const ds = [
    muc('1', { noiDung: 'Anh Tâm trả lời ngắn gọn', khiaCanh: 'cach_noi', soLanThay: 9 }),
    muc('2', { noiDung: 'Anh Tâm ưu tiên khách trả trước', khiaCanh: 'uu_tien', soLanThay: 2 }),
    muc('3', { phamVi: 'khach', noiDung: 'Gửi báo cáo Ads sáng thứ 2', doiTuong: 'Quốc Phong', soLanThay: 1 }),
    muc('4', { noiDung: 'Điều anh đã bỏ', trangThai: 'anh_bo', soLanThay: 99 }),
    muc('5', { noiDung: 'Anh dạy: báo giá luôn kèm VAT', nguon: 'anh_day', soLanThay: 1 }),
  ];
  it('bỏ điều anh đã bỏ; ưu tiên điều liên quan khách được hỏi, rồi điều anh dạy / sửa, rồi số lần thấy', () => {
    const t = chonDieuChoLoiNhac(ds, { toiDa: 3, cauHoi: 'tình hình quoc phong thế nào' });
    const dong = t.split('\n').filter((x) => x.startsWith('- '));
    expect(dong).toHaveLength(3);
    expect(dong[0]).toBe('- [Khách: Quốc Phong] Gửi báo cáo Ads sáng thứ 2');
    expect(dong[1]).toContain('báo giá luôn kèm VAT');
    expect(dong[2]).toContain('trả lời ngắn gọn');
    expect(t).not.toContain('Điều anh đã bỏ');
  });
  it('chưa có gì → chuỗi rỗng', () => {
    expect(chonDieuChoLoiNhac([], {})).toBe('');
  });
});

// Anh Tâm 9/11/2026: "anh cần nhân sự hiểu được anh cần gì, làm gì ở 1 job, 1 khách hàng"; "kho tri thức oke rồi" →
// điều hiểu về anh thành mục kho tri thức cho nhân sự tra.
describe('baiKhoHieuAnh — mục kho tri thức cho nhân sự', () => {
  const r = baiKhoHieuAnh([
    muc('1', { phamVi: 'khach', doiTuong: 'Tín Đạt', noiDung: 'Logo luôn dùng màu xanh navy, không dùng đỏ', soLanThay: 1 }),
    muc('2', { phamVi: 'khach', doiTuong: 'tín đạt', noiDung: 'Bài đăng gửi chị Hồng duyệt trước 10h', soLanThay: 4 }),
    muc('3', { phamVi: 'viec', doiTuong: 'Báo cáo Ads', noiDung: 'Báo cáo phải so sánh với tuần trước và nêu đề xuất' }),
    muc('4', { phamVi: 'chung', khiaCanh: 'nguyen_tac', noiDung: 'Anh Tâm muốn báo xong việc ngay trong ngày' }),
    muc('5', { phamVi: 'chung', khiaCanh: 'cach_quyet', noiDung: 'Anh Tâm giảm giá tối đa 10% cho khách ký 12 tháng' }),
    muc('6', { phamVi: 'nguoi', doiTuong: 'An Thùy', noiDung: 'Anh hay nhắc An Thùy kiểm lỗi chính tả' }),
    muc('7', { phamVi: 'khach', doiTuong: 'Welllife', noiDung: 'Điều anh đã bỏ', trangThai: 'anh_bo' }),
  ]);
  const theo = (t: string) => r.find((x) => x.title.includes(t))!;
  it('mỗi khách một mục (gộp cách viết tên khác nhau), điều thấy nhiều lần trước; nhân sự tra được', () => {
    expect(theo('Tín Đạt')).toMatchObject({
      title: 'Anh Tâm cần gì khi làm cho khách Tín Đạt',
      category: 'khach_hang',
      scope: 'all',
      body: '- Bài đăng gửi chị Hồng duyệt trước 10h\n- Logo luôn dùng màu xanh navy, không dùng đỏ',
    });
  });
  it('mỗi loại việc một mục; cách làm việc chung theo khía cạnh vào Quy trình', () => {
    expect(theo('Báo cáo Ads')).toMatchObject({ title: 'Anh Tâm cần gì ở việc «Báo cáo Ads»', category: 'quy_trinh', scope: 'all' });
    expect(theo('Nguyên tắc')).toMatchObject({ title: 'Cách anh Tâm làm việc — Nguyên tắc làm việc', category: 'quy_trinh', scope: 'all' });
  });
  it('cách anh quyết (giá, giảm giá) và điều về từng nhân viên: chỉ anh xem', () => {
    expect(theo('Cách anh quyết')).toMatchObject({ category: 'rieng', scope: 'director' });
    expect(theo('An Thùy')).toMatchObject({ category: 'rieng', scope: 'director' });
  });
  it('điều anh đã bỏ không thành mục', () => {
    expect(r.some((x) => x.title.includes('Welllife'))).toBe(false);
    expect(r).toHaveLength(5);
  });
});
