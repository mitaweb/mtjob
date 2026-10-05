// Luật cứng của kho tri thức ("bộ não thứ hai") — hàm thuần, có test.
//
// Anh Tâm 4/10/2026: "phải hiểu được những gì nên đưa vào hệ thống, những gì không". Phần
// hiểu nội dung do AI làm (brainItems.service.ts); file này giữ những thứ KHÔNG được phép
// phó mặc cho AI: bí mật thì chặn, liên lạc của khách thì xoá, và bảng nhóm dùng chung.

/** 9 nhóm tri thức công việc + 1 nhóm riêng giám đốc. Khoá là thứ lưu trong DB. */
export const NHOM = {
  khach_hang: 'Khách hàng',
  quy_trinh: 'Quy trình làm việc',
  tieu_chuan: 'Tiêu chuẩn thiết kế & nội dung',
  dich_vu: 'Dịch vụ & bảng giá',
  nhan_su: 'Chính sách nhân sự',
  tinh_huong: 'Xử lý tình huống',
  mau: 'Mẫu dùng sẵn',
  cong_cu: 'Công cụ',
  quyet_dinh: 'Quyết định đã chốt',
  rieng: 'Riêng giám đốc',
} as const;

export type NhomKey = keyof typeof NHOM;
export const NHOM_KEYS = Object.keys(NHOM) as NhomKey[];

export function laNhom(k: unknown): k is NhomKey {
  return typeof k === 'string' && k in NHOM;
}

/** Bảng quy tắc dạng chữ — dùng trong lời dặn của AI, trùng với khung hiện trên trang Kho tri thức. */
export const QUY_TAC_KHO = [
  'ĐƯA VÀO KHO (kiến thức làm việc dùng chung, bền vững):',
  '- khach_hang: đặc điểm, sở thích, điều cần tránh, lịch sử làm việc với MỘT khách cụ thể.',
  '- quy_trinh: các bước làm việc (chạy chiến dịch, bàn giao khách, cách ghi task…).',
  '- tieu_chuan: màu sắc, font, logo, giọng văn, checklist duyệt thiết kế/nội dung.',
  '- dich_vu: gói dịch vụ, cái gì gồm/không gồm, giá niêm yết.',
  '- nhan_su: LUẬT về nghỉ phép, chấm công, cách tính điểm/thưởng (không phải số của ai).',
  '- tinh_huong: cách xử lý tình huống với khách (đòi giảm giá, chê thiết kế, trễ deadline…).',
  '- mau: mẫu tin nhắn, báo giá, brief dùng lại được.',
  '- cong_cu: hướng dẫn dùng phần mềm, tài khoản quảng cáo (KHÔNG kèm mật khẩu).',
  '- quyet_dinh: quyết định giám đốc đã chốt, có hiệu lực ("từ 10/2026 video quảng cáo dùng mã CON05").',
  '',
  'CHỈ GIÁM ĐỐC XEM (nhóm rieng): lịch trình/lịch hẹn cá nhân của giám đốc; phân tích, đánh giá,',
  'so sánh từng nhân viên (điểm bất thường, task trùng…); lương/thưởng/kỷ luật của một người cụ thể;',
  'tài chính, doanh thu, công nợ của công ty.',
  '',
  'KHÔNG LƯU: số liệu thay đổi hằng ngày (điểm, chấm công, công nợ, ai làm gì hôm nay — trợ lý tra',
  'thẳng bảng thật); câu trả lời chung chung ai cũng biết; chào hỏi, tán gẫu; ý kiến chưa chốt;',
  'câu trợ lý báo lỗi/không tra được.',
].join('\n');

// ── Bí mật: chặn cứng, không lưu ở đâu cả ──

const MAU_BI_MAT: Array<[RegExp, string]> = [
  [/(mật\s*khẩu|mat\s*khau|password|passwd|\bpass\b|\bpwd\b)\s*[:=]\s*\S+/i, 'mật khẩu'],
  [/\b(otp|mã\s*xác\s*(thực|nhận))\s*[:=]?\s*\d{4,8}\b/i, 'mã OTP'],
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'API key'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'API key Google'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'token GitHub'],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]{16,}/, 'khoá Supabase'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'khoá bí mật'],
  [/(postgres(ql)?|mysql):\/\/[^:\s]+:[^@\s]+@/i, 'chuỗi kết nối có mật khẩu'],
  [/(stk|số\s*tài\s*khoản|so\s*tai\s*khoan|tài\s*khoản\s*ngân\s*hàng)\D{0,20}\d[\d\s.-]{7,20}\d/i, 'số tài khoản ngân hàng'],
];

/** Có bí mật trong nội dung không. Trả tên loại bí mật đầu tiên tìm thấy, '' nếu sạch. */
export function timBiMat(text: string): string {
  const s = String(text || '');
  for (const [re, ten] of MAU_BI_MAT) if (re.test(s)) return ten;
  return '';
}

// ── Liên lạc của khách: xoá khỏi nội dung (nhân viên không được xem SĐT khách) ──

// SĐT Việt Nam: 0xxxxxxxxx / +84xxxxxxxxx / 84xxxxxxxxx, cho phép dấu cách/chấm/gạch giữa các cụm.
const SDT = /(?<![\d.])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\d.]*\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Xoá SĐT và email. Trả nội dung đã xoá + số chỗ đã xoá. */
export function xoaLienHe(text: string): { text: string; daXoa: number } {
  let daXoa = 0;
  const out = String(text || '')
    .replace(SDT, (m) => {
      // Số tiền "20.000.000" hay mã "0123" không phải SĐT: phải đủ 9–11 chữ số sau khi bỏ dấu.
      const so = m.replace(/\D/g, '');
      if (so.length < 9 || so.length > 12) return m;
      if (/^\d{1,3}(\.\d{3})+$/.test(m.trim())) return m;
      daXoa++;
      return '[đã ẩn SĐT]';
    })
    .replace(EMAIL, () => {
      daXoa++;
      return '[đã ẩn email]';
    });
  return { text: out, daXoa };
}

// ── Quyết định của bộ phân loại → trạng thái + phạm vi ──

export type QuyetDinh = 'cong_viec' | 'rieng_giam_doc' | 'khong_luu' | 'can_duyet';
export type TrangThai = 'published' | 'pending' | 'rejected' | 'archived';

export interface KetQuaXep {
  status: TrangThai;
  /** 'all' | 'team:Ads' | 'director' */
  scope: string;
  category: NhomKey;
}

/**
 * Đổi quyết định của AI ra trạng thái lưu.
 *
 * - `laGiamDoc`: giám đốc/admin gửi thì "can_duyet" ban hành luôn (chính anh là người duyệt).
 * - Nguồn AI TỰ RÚT (`auto` từ chat với trợ lý, `zalo` từ tin nhắn Zalo): KHÔNG BAO GIỜ tự mở cho
 *   cả công ty — AI có thể hiểu sai, nên việc công việc vào hàng chờ; riêng tư giữ riêng giám đốc.
 * - Nhóm `rieng` luôn đi kèm phạm vi `director`, kể cả khi AI ghi lệch.
 */
/** Nguồn mà AI tự rút ra, không có người đọc lại trước khi gửi. */
export const NGUON_AI_TU_RUT = new Set(['auto', 'zalo']);

export function xepTrangThai(
  q: { quyetDinh: QuyetDinh; category: string; teamId?: string },
  ctx: { laGiamDoc: boolean; nguon: string },
): KetQuaXep {
  const nhom: NhomKey = laNhom(q.category) ? q.category : 'quy_trinh';
  const phamViCongViec = q.teamId && /^(Ads|Content|SEO)$/.test(q.teamId) && nhom !== 'khach_hang' ? `team:${q.teamId}` : 'all';

  if (q.quyetDinh === 'khong_luu') return { status: 'rejected', scope: 'director', category: nhom };
  if (q.quyetDinh === 'rieng_giam_doc' || nhom === 'rieng') {
    return { status: 'published', scope: 'director', category: 'rieng' };
  }
  if (q.quyetDinh === 'can_duyet') {
    return { status: ctx.laGiamDoc && !NGUON_AI_TU_RUT.has(ctx.nguon) ? 'published' : 'pending', scope: phamViCongViec, category: nhom };
  }
  // cong_viec
  if (NGUON_AI_TU_RUT.has(ctx.nguon)) return { status: 'pending', scope: phamViCongViec, category: nhom };
  return { status: 'published', scope: phamViCongViec, category: nhom };
}

/** Câu báo lại cho người gửi — nói rõ đồ vào đâu, ai xem được, hoặc vì sao không lưu. */
export function cauBaoNguoiGui(r: { status: TrangThai; scope: string; category: string; customer?: string; lyDo?: string }): string {
  const nhom = laNhom(r.category) ? NHOM[r.category] : r.category;
  const kh = r.customer ? ` · ${r.customer}` : '';
  if (r.status === 'rejected') return `Không lưu vào kho: ${r.lyDo || 'nội dung không phải tri thức dùng lâu dài'}.`;
  if (r.status === 'pending') return `Đã gửi — chờ giám đốc duyệt (nhóm ${nhom}${kh}).${r.lyDo ? ` Lý do: ${r.lyDo}` : ''}`;
  if (r.scope === 'director') return `Đã lưu — chỉ giám đốc xem được (${nhom}${kh}).`;
  if (r.scope.startsWith('team:')) return `Đã vào kho — nhóm ${nhom}${kh}, dành cho phòng ${r.scope.slice(5)}.`;
  return `Đã vào kho — nhóm ${nhom}${kh}.`;
}

// ── Khớp tên khách với CRM — chính xác, không đoán theo chữ chứa ──

/** Chuẩn hoá tên để so: bỏ dấu, chữ thường, gọn khoảng trắng. */
export function chuanTen(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tìm đúng MỘT khách trong CRM cho tên `ten`.
 *
 * Trước đây kho lọc bằng `customer ILIKE '%Thảo%'` nên hỏi "Thảo MLĐ" dính cả "Lê Thảo".
 * Thứ tự: trùng hẳn tên → nếu không, đúng một khách có tên CHỨA cả cụm (hoặc cụm chứa tên khách,
 * với tên khách đủ dài) → nếu không hoặc nhiều khách cùng khớp thì trả null, không đoán.
 */
export function khopKhach<T extends { id: string; name: string }>(ten: string, khach: T[]): T | null {
  const t = chuanTen(ten);
  if (!t) return null;
  const trung = khach.filter((k) => chuanTen(k.name) === t);
  if (trung.length === 1) return trung[0]!;
  if (trung.length > 1) return null;
  const chua = khach.filter((k) => {
    const n = chuanTen(k.name);
    return n.length > 0 && (n.includes(t) || (n.length >= 4 && t.includes(n)));
  });
  return chua.length === 1 ? chua[0]! : null;
}

// ── Câu hỏi giống nhau (gộp câu hỏi chưa có lời giải) ──

const TU_RONG = new Set([
  'la', 'thi', 'co', 'khong', 'cho', 'cua', 'nhu', 'nao', 'gi', 'the', 'minh', 'em', 'anh', 'chi', 'ban', 'a', 'oi',
  'vay', 'ha', 'nhe', 'duoc', 'lam', 'sao', 've', 'voi', 'cac', 'nhung', 'mot', 'nay', 'do', 'khi', 'neu',
]);

function tuKhoa(s: string): Set<string> {
  return new Set(chuanTen(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !TU_RONG.has(w)));
}

/** Hai câu hỏi có cùng ý không (Jaccard trên từ khoá ≥ 0,6). Đủ để gộp câu hỏi lặp, không cần gọi AI. */
export function cauHoiGiong(a: string, b: string): boolean {
  const A = tuKhoa(a);
  const B = tuKhoa(b);
  if (A.size === 0 || B.size === 0) return false;
  let chung = 0;
  for (const w of A) if (B.has(w)) chung++;
  return chung / (A.size + B.size - chung) >= 0.6;
}

/** Từ khoá để tìm bằng chữ trong tiêu đề/thẻ/tóm tắt (bỏ từ rỗng, tối đa 6 từ). */
export function tuKhoaTimKiem(s: string): string[] {
  return [...tuKhoa(s)].filter((w) => w.length >= 3).slice(0, 6);
}
