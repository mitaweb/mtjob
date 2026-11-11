// Bộ não HIỂU ANH TÂM (anh Tâm 9/11/2026: "bộ não hiện tại phải hiểu được anh thông qua các đoạn chat của anh với nhân
// viên và khách hàng"; "anh cần nhân sự hiểu được anh cần gì, làm gì ở 1 job, 1 khách hàng nào đó thông qua tất cả
// thông tin trong zalo của anh"; "không tách tab, kho tri thức oke rồi"). Hàm THUẦN: chọn đoạn chat để AI học, gộp điều
// AI rút ra (quyết định của anh thắng AI), gom thành mục kho tri thức cho nhân sự tra, chọn điều cho lời dặn trợ lý.
import type { TinZalo } from './zalo.js';
import { cheSoDai } from './docAi.js';
import { xoaLienHe } from './brainGate.js';
import { removeAccents } from './people.js';

/** Điều này áp cho ai / việc gì. */
export const PHAM_VI = {
  chung: 'Chung',
  khach: 'Khách',
  viec: 'Việc',
  nguoi: 'Nhân viên',
} as const;
export type PhamVi = keyof typeof PHAM_VI;
export const PHAM_VI_KEYS = Object.keys(PHAM_VI) as PhamVi[];

export const KHIA_CANH = {
  cach_noi: 'Cách anh nói / xưng hô',
  nguyen_tac: 'Nguyên tắc làm việc',
  uu_tien: 'Điều anh ưu tiên',
  cach_quyet: 'Cách anh quyết',
  thoi_quen: 'Thói quen',
  khong_thich: 'Điều anh không thích',
} as const;
export type KhiaCanh = keyof typeof KHIA_CANH;
export const KHIA_CANH_KEYS = Object.keys(KHIA_CANH) as KhiaCanh[];

export type TrangThaiHieuAnh = 'dung' | 'anh_sua' | 'anh_bo';
export type NguonHieuAnh = 'zalo' | 'chat' | 'kho' | 'anh_day';

export interface MucHieuAnh {
  id: string;
  phamVi: PhamVi;
  khiaCanh: KhiaCanh;
  /** Một câu — với khách / việc viết như lời dặn nhân sự ("Làm cho khách X: anh cần…") */
  noiDung: string;
  /** Tên khách (phamVi khach) / tên việc (viec) / tên nhân viên (nguoi); '' khi chung */
  doiTuong: string;
  /** ≤ 3 trích ngắn làm bằng chứng */
  bangChung: string[];
  soLanThay: number;
  trangThai: TrangThaiHieuAnh;
  nguon: NguonHieuAnh;
  capNhat: string;
}

const MAX_BANG_CHUNG = 3;
const MAX_MOI_MOT_LUOT = 15;

/** Tin không mang ý gì ("ok", "dạ", sticker, ảnh trơn…). */
export function laTinVoNghia(s: string): boolean {
  const t = removeAccents(String(s || '').trim().toLowerCase()).replace(/[!.?…~]+$/g, '');
  if (t.length < 4) return true;
  return /^(ok+|oke+|okie|okay|da+|vang|uh+|u+m*|um+|ừ|cam on|thanks?|tks|thank you|\[(sticker|anh|hinh|file|video|link|tep)[^\]]*\].*|[\p{Extended_Pictographic}\s]+)$/u.test(t);
}

function lamSach(s: string): string {
  return xoaLienHe(cheSoDai(String(s || '').replace(/\s+/g, ' ').trim())).text.slice(0, 500);
}

/**
 * Đoạn chat của MỘT cuộc để AI học: mỗi tin anh gửi chưa học kèm `ngCanh` tin ngay trước (người kia hỏi / báo gì → anh
 * đáp, dặn sao); các khúc gần nhau gộp lại, khúc xa cách "…". `msgIds` = mọi tin của anh chưa học (đánh dấu sau khi xử
 * lý, kể cả tin vô nghĩa). Mọi tin của anh đều vô nghĩa → `doan` rỗng (khỏi gọi AI).
 */
export function chonDoanHoc(tin: TinZalo[], chuaHoc: Set<string>, o: { ngCanh?: number } = {}): { doan: string; msgIds: string[] } {
  const ngCanh = o.ngCanh ?? 6;
  const ds = [...tin].sort((a, b) => Number(a.ts) - Number(b.ts));
  const msgIds = ds.filter((t) => t.fromSelf && chuaHoc.has(t.msgId)).map((t) => t.msgId);
  const lay = new Set<number>();
  ds.forEach((t, i) => {
    if (!t.fromSelf || !chuaHoc.has(t.msgId) || laTinVoNghia(t.content)) return;
    for (let k = Math.max(0, i - ngCanh); k <= i; k++) lay.add(k);
  });
  if (!lay.size) return { doan: '', msgIds };
  const dong: string[] = [];
  let truoc = -2;
  for (const i of [...lay].sort((a, b) => a - b)) {
    const t = ds[i]!;
    if (truoc >= 0 && i > truoc + 1) dong.push('…');
    dong.push(`${t.fromSelf ? 'ANH' : t.sender || 'Người kia'}: ${lamSach(t.content)}`);
    truoc = i;
  }
  return { doan: dong.join('\n'), msgIds };
}

/** Chuẩn hoá để so trùng: bỏ dấu, chữ thường, bỏ dấu câu. */
export function chuan(s: string): string {
  return removeAccents(String(s || '').toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trungY(a: string, b: string): boolean {
  const x = chuan(a);
  const y = chuan(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 15 && (x.includes(y) || y.includes(x));
}

const cungCho = (a: { phamVi: PhamVi; doiTuong: string }, b: { phamVi: PhamVi; doiTuong: string }) =>
  a.phamVi === b.phamVi && chuan(a.doiTuong) === chuan(b.doiTuong);

export interface KetQuaAiHieuAnh {
  moi: Array<{ phamVi?: string; khiaCanh: string; noiDung: string; doiTuong?: string; bangChung?: string }>;
  xacNhan: Array<{ id: string; bangChung?: string; noiDungMoi?: string }>;
}

export interface SuaHieuAnh {
  id: string;
  soLanThay: number;
  bangChung: string[];
  noiDung?: string;
}

export interface ThemHieuAnh {
  phamVi: PhamVi;
  khiaCanh: KhiaCanh;
  noiDung: string;
  doiTuong: string;
  bangChung: string[];
}

/**
 * Gộp điều AI rút ra vào hồ sơ. Điều anh đã SỬA hoặc BỎ thì AI không đụng, không thêm lại điều trùng ý điều anh bỏ.
 * Điều mới trùng ý điều đang dùng (cùng phạm vi, cùng khách / việc / người) → coi như xác nhận. Câu chữ AI chỉnh chỉ áp
 * cho điều AI tự rút (không phải điều anh dạy).
 */
export function gopHieuAnh(cu: MucHieuAnh[], ai: KetQuaAiHieuAnh): { them: ThemHieuAnh[]; sua: SuaHieuAnh[] } {
  const theoId = new Map(cu.map((m) => [m.id, m]));
  const sua = new Map<string, SuaHieuAnh>();
  const xacNhan = (m: MucHieuAnh, bangChung?: string, noiDungMoi?: string) => {
    if (m.trangThai !== 'dung') return;
    const s = sua.get(m.id) || { id: m.id, soLanThay: m.soLanThay, bangChung: [...m.bangChung] };
    s.soLanThay++;
    const bc = String(bangChung || '').trim().slice(0, 200);
    if (bc && !s.bangChung.includes(bc)) s.bangChung = [...s.bangChung, bc].slice(-MAX_BANG_CHUNG);
    const nd = String(noiDungMoi || '').trim();
    if (nd.length >= 10 && m.nguon !== 'anh_day' && nd !== m.noiDung) s.noiDung = nd.slice(0, 300);
    sua.set(m.id, s);
  };
  for (const x of ai.xacNhan || []) {
    const m = theoId.get(String(x.id || ''));
    if (m) xacNhan(m, x.bangChung, x.noiDungMoi);
  }
  const them: ThemHieuAnh[] = [];
  for (const x of (ai.moi || []).slice(0, MAX_MOI_MOT_LUOT * 2)) {
    const noiDung = String(x.noiDung || '').trim().slice(0, 300);
    if (!(KHIA_CANH_KEYS as string[]).includes(x.khiaCanh) || noiDung.length < 10) continue;
    const doiTuong = String(x.doiTuong || '').trim().slice(0, 100);
    let phamVi: PhamVi = (PHAM_VI_KEYS as string[]).includes(String(x.phamVi)) ? (x.phamVi as PhamVi) : 'chung';
    if (phamVi !== 'chung' && !doiTuong) phamVi = 'chung';
    const moi = { phamVi, doiTuong: phamVi === 'chung' ? '' : doiTuong };
    const giong = cu.find((m) => cungCho(m, moi) && trungY(m.noiDung, noiDung));
    if (giong) {
      xacNhan(giong, x.bangChung);
      continue;
    }
    if (them.some((t) => cungCho(t, moi) && trungY(t.noiDung, noiDung)) || them.length >= MAX_MOI_MOT_LUOT) continue;
    const bc = String(x.bangChung || '').trim().slice(0, 200);
    them.push({ ...moi, khiaCanh: x.khiaCanh as KhiaCanh, noiDung, bangChung: bc ? [bc] : [] });
  }
  return { them, sua: [...sua.values()] };
}

export interface BaiKho {
  /** Khoá cố định (phạm vi | đối tượng | khía cạnh) → mã mục kho ổn định, học thêm thì cập nhật đúng mục */
  khoa: string;
  title: string;
  body: string;
  summary: string;
  /** Nhóm kho (lib/brainGate NHOM) */
  category: 'khach_hang' | 'quy_trinh' | 'rieng';
  /** 'all' = mọi nhân sự tra được; 'director' = chỉ anh */
  scope: 'all' | 'director';
  /** Tên khách (mục khách) */
  customer: string;
}

/**
 * Gom hồ sơ thành MỤC KHO TRI THỨC để nhân sự tra ("anh Tâm cần gì ở khách X / việc Y"): mỗi khách một mục (nhóm Khách
 * hàng), mỗi loại việc một mục (Quy trình), cách anh làm việc chung theo khía cạnh (Quy trình). Riêng anh: cách anh
 * quyết và điều về từng nhân viên. Điều anh đã bỏ không ghi; điều thấy nhiều lần đứng trước.
 */
export function baiKhoHieuAnh(ds: MucHieuAnh[], goi = 'anh Tâm'): BaiKho[] {
  const Goi = goi.charAt(0).toUpperCase() + goi.slice(1);
  const nhom = new Map<string, MucHieuAnh[]>();
  for (const m of ds) {
    if (m.trangThai === 'anh_bo' || !m.noiDung.trim()) continue;
    const khoa = m.phamVi === 'chung' ? `chung||${m.khiaCanh}` : `${m.phamVi}|${chuan(m.doiTuong)}|`;
    nhom.set(khoa, [...(nhom.get(khoa) || []), m]);
  }
  const ra: BaiKho[] = [];
  for (const [khoa, cua] of nhom) {
    cua.sort((a, b) => b.soLanThay - a.soLanThay || b.capNhat.localeCompare(a.capNhat));
    const m0 = cua[0]!;
    // Tên hiển thị: cách viết hay gặp nhất.
    const dem = new Map<string, number>();
    for (const m of cua) dem.set(m.doiTuong, (dem.get(m.doiTuong) || 0) + 1);
    const hoa = (s: string) => (s.match(/\p{Lu}/gu) || []).length;
    const ten = [...dem.entries()].sort((a, b) => b[1] - a[1] || hoa(b[0]) - hoa(a[0]))[0]![0];
    const body = cua.map((m) => `- ${m.noiDung}`).join('\n');
    const n = `${cua.length} điều AI tự rút từ chat Zalo / trợ lý của ${goi}`;
    if (m0.phamVi === 'khach') {
      ra.push({ khoa, title: `${Goi} cần gì khi làm cho khách ${ten}`, body, summary: `Lời dặn của ${goi} khi làm cho ${ten} (${n})`, category: 'khach_hang', scope: 'all', customer: ten });
    } else if (m0.phamVi === 'viec') {
      ra.push({ khoa, title: `${Goi} cần gì ở việc «${ten}»`, body, summary: `Yêu cầu của ${goi} với việc ${ten} (${n})`, category: 'quy_trinh', scope: 'all', customer: '' });
    } else if (m0.phamVi === 'nguoi') {
      ra.push({ khoa, title: `${Goi} làm việc với ${ten}`, body, summary: `Cách ${goi} làm việc với ${ten} (${n})`, category: 'rieng', scope: 'director', customer: '' });
    } else {
      const rieng = m0.khiaCanh === 'cach_quyet';
      ra.push({
        khoa,
        title: `Cách ${goi} làm việc — ${KHIA_CANH[m0.khiaCanh]}`,
        body,
        summary: `${KHIA_CANH[m0.khiaCanh]} của ${goi} (${n})`,
        category: rieng ? 'rieng' : 'quy_trinh',
        scope: rieng ? 'director' : 'all',
        customer: '',
      });
    }
  }
  return ra.sort((a, b) => a.khoa.localeCompare(b.khoa));
}

/**
 * Điều đưa vào lời dặn trợ lý của anh: bỏ điều anh đã bỏ; ưu tiên điều về khách / việc / người có trong câu hỏi, rồi
 * điều anh dạy / anh sửa, rồi điều thấy nhiều lần, mới hơn. '' khi chưa có gì.
 */
export function chonDieuChoLoiNhac(ds: MucHieuAnh[], o: { toiDa?: number; cauHoi?: string }): string {
  const cauHoi = chuan(o.cauHoi || '');
  const lienQuan = (m: MucHieuAnh) => !!m.doiTuong && !!cauHoi && cauHoi.includes(chuan(m.doiTuong));
  const anh = (m: MucHieuAnh) => m.nguon === 'anh_day' || m.trangThai === 'anh_sua';
  const chon = ds
    .filter((m) => m.trangThai !== 'anh_bo' && m.noiDung.trim())
    .sort(
      (a, b) =>
        Number(lienQuan(b)) - Number(lienQuan(a)) ||
        Number(anh(b)) - Number(anh(a)) ||
        b.soLanThay - a.soLanThay ||
        b.capNhat.localeCompare(a.capNhat),
    )
    .slice(0, o.toiDa ?? 30);
  if (!chon.length) return '';
  return [
    'NHỮNG ĐIỀU EM ĐÃ HIỂU VỀ ANH (tự học từ chat Zalo của anh với nhân viên / khách và điều anh dạy) — làm theo đúng ý,',
    'đúng giọng anh; điều anh dạy luôn đúng hơn điều tự đoán:',
    ...chon.map((m) => `- [${m.phamVi === 'chung' ? KHIA_CANH[m.khiaCanh] : `${PHAM_VI[m.phamVi]}: ${m.doiTuong}`}] ${m.noiDung}`),
  ].join('\n');
}

// Từ không mang ý (xưng hô, từ nối, chữ của chính lệnh "quên") — không dùng để khớp điều cần quên.
const TU_BO_QUA = new Set(['anh', 'tam', 'em', 'chi', 'cua', 'la', 'va', 'cho', 'thi', 'nay', 'do', 'chuyen', 'dieu', 'quen', 'cai', 'nhe', 'di', 'voi', 've', 'minh', 'ay', 'kia', 'nua', 'luon', 'giup', 'hay', 'viec']);
const tuY = (s: string) => new Set(chuan(s).split(' ').filter((w) => w.length >= 2 && !TU_BO_QUA.has(w)));

/**
 * Anh bảo "quên điều X" → các điều (chưa quên) khớp ý X: ≥ 60% từ mang ý của X có trong điều đó (kể cả tên khách / việc
 * / người), tối thiểu 2 từ. Không khớp thì rỗng — không quên bừa. Khớp nhất trước.
 */
export function timDieuCanQuen(ds: MucHieuAnh[], cau: string): MucHieuAnh[] {
  const can = tuY(cau);
  if (can.size === 0) return [];
  return ds
    .filter((m) => m.trangThai !== 'anh_bo')
    .map((m) => {
      const co = tuY(`${m.doiTuong} ${m.noiDung}`);
      const chung = [...can].filter((w) => co.has(w)).length;
      return { m, chung, diem: chung / can.size };
    })
    .filter((x) => x.chung >= Math.min(2, can.size) && x.diem >= 0.6)
    .sort((a, b) => b.diem - a.diem)
    .map((x) => x.m);
}

/** Anh đang SỬA trợ lý ("không phải", "sai rồi", "ý anh là", "lần sau…", "đừng…") — đáng học ngay. */
export function laLoiSua(text: string): boolean {
  return /(?<!\p{L})(không phải|sai rồi|nhầm rồi|chưa đúng|không đúng|ý anh là|anh bảo là|anh đã bảo|lần sau|từ nay|đừng|không được)(?!\p{L})/iu.test(
    String(text || ''),
  );
}
