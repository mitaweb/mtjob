import { describe, it, expect } from 'vitest';
import {
  timBiMat,
  xoaLienHe,
  xepTrangThai,
  cauBaoNguoiGui,
  khopKhach,
  cauHoiGiong,
  tuKhoaTimKiem,
  chuanTen,
} from './brainGate.js';

// Anh Tâm 4/10/2026: "phải hiểu được những gì nên đưa vào hệ thống, những gì không".

describe('timBiMat — bí mật chặn cứng', () => {
  it('bắt mật khẩu, API key, token, chuỗi kết nối, số tài khoản', () => {
    expect(timBiMat('Tài khoản ads: admin, mật khẩu: Abc@123')).toBe('mật khẩu');
    expect(timBiMat('pass = hello2026')).toBe('mật khẩu');
    expect(timBiMat('key sk-ant-api03-abcdefghijklmnopqrstu')).toBe('API key');
    expect(timBiMat('AIzaSyD-abcdefghijklmnopqrstuvwxyz12345')).toBe('API key Google');
    expect(timBiMat('ghp_abcdefghijklmnopqrstuvwxyz123456')).toBe('token GitHub');
    expect(timBiMat('postgresql://postgres.x:Secret123@host:5432/db')).toBe('chuỗi kết nối có mật khẩu');
    expect(timBiMat('STK Vietcombank: 0071 0003 12345')).toBe('số tài khoản ngân hàng');
    expect(timBiMat('Mã OTP: 482913')).toBe('mã OTP');
  });

  it('không bắt nhầm nội dung công việc bình thường', () => {
    expect(timBiMat('Video quảng cáo dùng mã CON05, 135 điểm')).toBe('');
    expect(timBiMat('Gói SEO 20.000.000đ/tháng, thanh toán ngày 5')).toBe('');
    expect(timBiMat('Màu chính #0B5FD9, font Be Vietnam Pro')).toBe('');
    expect(timBiMat('Khách đổi mật khẩu fanpage thì báo leader')).toBe('');
  });
});

describe('xoaLienHe — SĐT/email khách bị ẩn', () => {
  it('ẩn SĐT các kiểu viết và email', () => {
    const r = xoaLienHe('Gọi chị Hà 0901234567 hoặc +84 912 345 678, mail ha@gmail.com');
    expect(r.text).toBe('Gọi chị Hà [đã ẩn SĐT] hoặc [đã ẩn SĐT], mail [đã ẩn email]');
    expect(r.daXoa).toBe(3);
    expect(xoaLienHe('SĐT: 090.123.4567').text).toBe('SĐT: [đã ẩn SĐT]');
  });

  it('không đụng số tiền, ngày tháng, mã việc', () => {
    const s = 'Ngân sách 20.000.000đ, ký 05/10/2026, mã CON05, 135 điểm, năm 2026';
    expect(xoaLienHe(s)).toEqual({ text: s, daXoa: 0 });
  });
});

describe('xepTrangThai — quyết định AI → trạng thái lưu', () => {
  const nv = { laGiamDoc: false, nguon: 'manual' };
  const gd = { laGiamDoc: true, nguon: 'manual' };

  it('công việc → ban hành cho cả công ty; chỉ một phòng → phạm vi phòng', () => {
    expect(xepTrangThai({ quyetDinh: 'cong_viec', category: 'tieu_chuan' }, nv)).toEqual({ status: 'published', scope: 'all', category: 'tieu_chuan' });
    expect(xepTrangThai({ quyetDinh: 'cong_viec', category: 'quy_trinh', teamId: 'Ads' }, nv).scope).toBe('team:Ads');
  });

  it('tri thức khách hàng luôn mở cho mọi phòng — khách làm việc với nhiều phòng', () => {
    expect(xepTrangThai({ quyetDinh: 'cong_viec', category: 'khach_hang', teamId: 'SEO' }, nv).scope).toBe('all');
  });

  it('riêng giám đốc → chỉ giám đốc xem; nhóm rieng luôn kèm phạm vi director', () => {
    expect(xepTrangThai({ quyetDinh: 'rieng_giam_doc', category: 'quy_trinh' }, nv)).toEqual({ status: 'published', scope: 'director', category: 'rieng' });
    expect(xepTrangThai({ quyetDinh: 'cong_viec', category: 'rieng' }, nv).scope).toBe('director');
  });

  it('không chắc → nhân viên gửi thì chờ duyệt, giám đốc gửi thì ban hành luôn', () => {
    expect(xepTrangThai({ quyetDinh: 'can_duyet', category: 'dich_vu' }, nv).status).toBe('pending');
    expect(xepTrangThai({ quyetDinh: 'can_duyet', category: 'dich_vu' }, gd).status).toBe('published');
  });

  it('AI tự vơ từ chat KHÔNG BAO GIỜ tự mở cho cả công ty, kể cả của giám đốc', () => {
    expect(xepTrangThai({ quyetDinh: 'cong_viec', category: 'quy_trinh' }, { laGiamDoc: true, nguon: 'auto' }).status).toBe('pending');
    expect(xepTrangThai({ quyetDinh: 'can_duyet', category: 'quy_trinh' }, { laGiamDoc: true, nguon: 'auto' }).status).toBe('pending');
  });

  it('tin nhắn Zalo: ý rõ ràng vào kho luôn; chưa chắc vẫn chờ duyệt; riêng tư giữ riêng giám đốc', () => {
    // Anh Tâm 8/10/2026: "cái nào oke thì đưa vào tri thức".
    const zalo = { laGiamDoc: true, nguon: 'zalo' };
    expect(xepTrangThai({ quyetDinh: 'cong_viec', category: 'khach_hang' }, zalo)).toMatchObject({ status: 'published', scope: 'all' });
    expect(xepTrangThai({ quyetDinh: 'can_duyet', category: 'khach_hang' }, zalo).status).toBe('pending');
    expect(xepTrangThai({ quyetDinh: 'rieng_giam_doc', category: 'khach_hang' }, zalo)).toMatchObject({ status: 'published', scope: 'director' });
  });

  it('không lưu → rejected; nhóm lạ → quy trình', () => {
    expect(xepTrangThai({ quyetDinh: 'khong_luu', category: 'quy_trinh' }, gd).status).toBe('rejected');
    expect(xepTrangThai({ quyetDinh: 'cong_viec', category: 'linh_tinh' }, nv).category).toBe('quy_trinh');
  });
});

describe('cauBaoNguoiGui', () => {
  it('nói rõ vào đâu, ai xem được, hoặc vì sao không lưu', () => {
    expect(cauBaoNguoiGui({ status: 'published', scope: 'all', category: 'khach_hang', customer: 'Savax Door' })).toBe('Đã vào kho — nhóm Khách hàng · Savax Door.');
    expect(cauBaoNguoiGui({ status: 'published', scope: 'director', category: 'rieng' })).toContain('chỉ giám đốc xem được');
    expect(cauBaoNguoiGui({ status: 'published', scope: 'team:Ads', category: 'quy_trinh' })).toContain('phòng Ads');
    expect(cauBaoNguoiGui({ status: 'pending', scope: 'all', category: 'dich_vu' })).toContain('chờ giám đốc duyệt');
    expect(cauBaoNguoiGui({ status: 'rejected', scope: 'director', category: 'quy_trinh', lyDo: 'số liệu thay đổi hằng ngày' })).toBe('Không lưu vào kho: số liệu thay đổi hằng ngày.');
  });
});

describe('khopKhach — đúng một khách, không đoán', () => {
  const ds = [
    { id: 'K1', name: 'C Thảo MLĐ' },
    { id: 'K2', name: 'Lê Thảo Gateway' },
    { id: 'K3', name: 'Savax Door' },
    { id: 'K4', name: 'Quốc Phong Hair Salon' },
  ];

  it('trùng tên (không phân biệt dấu/hoa thường)', () => {
    expect(khopKhach('c thao mld', ds)?.id).toBe('K1');
    expect(khopKhach('SAVAX DOOR', ds)?.id).toBe('K3');
  });

  it('gõ thiếu nhưng chỉ một khách khớp → nhận', () => {
    expect(khopKhach('Quốc Phong', ds)?.id).toBe('K4');
    expect(khopKhach('Thảo MLĐ', ds)?.id).toBe('K1');
  });

  it('nhiều khách cùng khớp hoặc không ai khớp → null, KHÔNG gán bừa', () => {
    expect(khopKhach('Thảo', ds)).toBeNull();
    expect(khopKhach('Khách lạ', ds)).toBeNull();
    expect(khopKhach('', ds)).toBeNull();
  });
});

describe('cauHoiGiong — gộp câu hỏi lặp', () => {
  it('cùng ý khác chữ thì gộp', () => {
    expect(cauHoiGiong('Màu chủ đạo thương hiệu là màu gì?', 'màu chủ đạo của thương hiệu là gì vậy')).toBe(true);
  });
  it('khác chủ đề thì không', () => {
    expect(cauHoiGiong('Màu chủ đạo thương hiệu là gì?', 'Nghỉ phép năm được mấy ngày?')).toBe(false);
    expect(cauHoiGiong('', 'abc')).toBe(false);
  });
});

describe('tuKhoaTimKiem / chuanTen', () => {
  it('bỏ dấu, bỏ từ rỗng', () => {
    expect(chuanTen('  Đặng  Hà ')).toBe('dang ha');
    expect(tuKhoaTimKiem('Quy trình bàn giao khách hàng là gì?')).toEqual(['quy', 'trinh', 'giao', 'khach', 'hang']); // 'bàn' bỏ dấu trùng 'bạn' (từ rỗng) — chấp nhận
  });
});
