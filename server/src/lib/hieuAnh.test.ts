import { describe, it, expect } from 'vitest';
import { chonDoanHoc, gopHieuAnh, chonDieuChoLoiNhac, type MucHieuAnh } from './hieuAnh.js';
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
    const cu = [muc('S', { trangThai: 'anh_sua' }), muc('B', { trangThai: 'anh_bo', noiDung: 'Anh Tâm thích gọi điện hơn nhắn tin' })];
    const r = gopHieuAnh(cu, {
      xacNhan: [{ id: 'S', noiDungMoi: 'câu khác' }, { id: 'B' }],
      moi: [{ khiaCanh: 'thoi_quen', noiDung: 'Anh Tâm thích gọi điện hơn nhắn tin.' }],
    });
    expect(r).toEqual({ them: [], sua: [] });
  });
  it('điều mới trùng ý điều đang dùng → coi như xác nhận; điều mới thật → thêm; bỏ loại sai / quá ngắn', () => {
    const r = gopHieuAnh([muc('A')], {
      xacNhan: [],
      moi: [
        { khiaCanh: 'nguyen_tac', noiDung: 'anh tâm KHÔNG nhận gói SEO dưới 6 tháng!', bangChung: 'x' },
        { khiaCanh: 'cach_noi', noiDung: 'Anh Tâm xưng "anh", gọi khách là "em", trả lời ngắn', doiTuong: '' },
        { khiaCanh: 'linh_tinh', noiDung: 'Một điều không thuộc nhóm nào cả' },
        { khiaCanh: 'uu_tien', noiDung: 'ngắn' },
      ],
    });
    expect(r.sua).toEqual([{ id: 'A', soLanThay: 2, bangChung: ['x'] }]);
    expect(r.them).toEqual([{ khiaCanh: 'cach_noi', noiDung: 'Anh Tâm xưng "anh", gọi khách là "em", trả lời ngắn', doiTuong: '', bangChung: [] }]);
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
    muc('3', { noiDung: 'Với Quốc Phong anh luôn gửi báo cáo thứ 2', khiaCanh: 'nguoi', doiTuong: 'Quốc Phong', soLanThay: 1 }),
    muc('4', { noiDung: 'Điều anh đã bỏ', trangThai: 'anh_bo', soLanThay: 99 }),
    muc('5', { noiDung: 'Anh dạy: báo giá luôn kèm VAT', nguon: 'anh_day', soLanThay: 1 }),
  ];
  it('bỏ điều anh đã bỏ; ưu tiên điều liên quan người được hỏi, rồi điều anh dạy / sửa, rồi số lần thấy', () => {
    const t = chonDieuChoLoiNhac(ds, { toiDa: 3, cauHoi: 'tình hình quoc phong thế nào' });
    const dong = t.split('\n').filter((x) => x.startsWith('- '));
    expect(dong).toHaveLength(3);
    expect(dong[0]).toContain('Quốc Phong');
    expect(dong[1]).toContain('báo giá luôn kèm VAT');
    expect(dong[2]).toContain('trả lời ngắn gọn');
    expect(t).not.toContain('Điều anh đã bỏ');
  });
  it('chưa có gì → chuỗi rỗng', () => {
    expect(chonDieuChoLoiNhac([], {})).toBe('');
  });
});
