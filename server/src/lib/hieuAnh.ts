// Bộ não HIỂU ANH TÂM (anh Tâm 9/11/2026: "bộ não hiện tại phải hiểu được anh thông qua các đoạn chat của anh với nhân
// viên và khách hàng"). Hàm THUẦN: chọn đoạn chat để AI học về anh, gộp điều AI rút ra vào hồ sơ (quyết định của anh
// thắng AI), chọn điều đưa vào lời dặn trợ lý.
import type { TinZalo } from './zalo.js';
import { cheSoDai } from './docAi.js';
import { xoaLienHe } from './brainGate.js';
import { removeAccents } from './people.js';

export const KHIA_CANH = {
  cach_noi: 'Cách anh nói / xưng hô',
  nguyen_tac: 'Nguyên tắc làm việc',
  uu_tien: 'Điều anh ưu tiên',
  cach_quyet: 'Cách anh quyết',
  nguoi: 'Với từng người',
  thoi_quen: 'Thói quen',
  khong_thich: 'Điều anh không thích',
} as const;
export type KhiaCanh = keyof typeof KHIA_CANH;
export const KHIA_CANH_KEYS = Object.keys(KHIA_CANH) as KhiaCanh[];

export type TrangThaiHieuAnh = 'dung' | 'anh_sua' | 'anh_bo';
export type NguonHieuAnh = 'zalo' | 'chat' | 'anh_day';

export interface MucHieuAnh {
  id: string;
  khiaCanh: KhiaCanh;
  /** Một câu "Anh Tâm …" */
  noiDung: string;
  /** Người / khách liên quan ('' = chung) */
  doiTuong: string;
  /** ≤ 3 trích ngắn làm bằng chứng */
  bangChung: string[];
  soLanThay: number;
  trangThai: TrangThaiHieuAnh;
  nguon: NguonHieuAnh;
  capNhat: string;
}

const MAX_BANG_CHUNG = 3;
const MAX_MOI_MOT_LUOT = 10;

/** Tin không mang ý gì về anh ("ok", "dạ", sticker, ảnh trơn…). */
export function laTinVoNghia(s: string): boolean {
  const t = removeAccents(String(s || '').trim().toLowerCase()).replace(/[!.?…~]+$/g, '');
  if (t.length < 4) return true;
  return /^(ok+|oke+|okie|okay|da+|vang|uh+|u+m*|um+|ừ|cam on|thanks?|tks|thank you|\[(sticker|anh|hinh|file|video|link|tep)[^\]]*\].*|[\p{Extended_Pictographic}\s]+)$/u.test(t);
}

function lamSach(s: string): string {
  return xoaLienHe(cheSoDai(String(s || '').replace(/\s+/g, ' ').trim())).text.slice(0, 500);
}

/**
 * Đoạn chat của MỘT cuộc để AI học về anh: mỗi tin anh gửi chưa học kèm `ngCanh` tin ngay trước (người kia hỏi gì →
 * anh đáp sao); các khúc gần nhau gộp lại, khúc xa cách "…". `msgIds` = mọi tin của anh chưa học (đánh dấu sau khi xử
 * lý, kể cả tin vô nghĩa). Mọi tin của anh đều vô nghĩa → `doan` rỗng (khỏi gọi AI).
 */
export function chonDoanHoc(tin: TinZalo[], chuaHoc: Set<string>, o: { ngCanh?: number } = {}): { doan: string; msgIds: string[] } {
  const ngCanh = o.ngCanh ?? 4;
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

/** Chuẩn hoá để so trùng ý: bỏ dấu, chữ thường, bỏ dấu câu. */
function chuan(s: string): string {
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

export interface KetQuaAiHieuAnh {
  moi: Array<{ khiaCanh: string; noiDung: string; doiTuong?: string; bangChung?: string }>;
  xacNhan: Array<{ id: string; bangChung?: string; noiDungMoi?: string }>;
}

export interface SuaHieuAnh {
  id: string;
  soLanThay: number;
  bangChung: string[];
  noiDung?: string;
}

export interface ThemHieuAnh {
  khiaCanh: KhiaCanh;
  noiDung: string;
  doiTuong: string;
  bangChung: string[];
}

/**
 * Gộp điều AI rút ra vào hồ sơ. Điều anh đã SỬA hoặc BỎ thì AI không đụng, không thêm lại điều trùng ý điều anh bỏ.
 * Điều mới trùng ý điều đang dùng → coi như xác nhận (tăng số lần thấy). Câu chữ AI chỉnh chỉ áp cho điều AI tự rút
 * (không phải điều anh dạy).
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
    const giong = cu.find((m) => trungY(m.noiDung, noiDung));
    if (giong) {
      xacNhan(giong, x.bangChung);
      continue;
    }
    if (them.some((t) => trungY(t.noiDung, noiDung)) || them.length >= MAX_MOI_MOT_LUOT) continue;
    const bc = String(x.bangChung || '').trim().slice(0, 200);
    them.push({ khiaCanh: x.khiaCanh as KhiaCanh, noiDung, doiTuong: String(x.doiTuong || '').trim().slice(0, 100), bangChung: bc ? [bc] : [] });
  }
  return { them, sua: [...sua.values()] };
}

/**
 * Điều đưa vào lời dặn trợ lý: bỏ điều anh đã bỏ; ưu tiên điều về người / khách có trong câu hỏi, rồi điều anh dạy /
 * anh sửa, rồi điều thấy nhiều lần, mới hơn. '' khi chưa có gì.
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
    'NHỮNG ĐIỀU EM ĐÃ HIỂU VỀ ANH (học từ cách anh nhắn với nhân viên / khách và điều anh dạy) — làm theo đúng ý,',
    'đúng giọng anh; điều anh dạy luôn đúng hơn điều tự đoán:',
    ...chon.map((m) => `- [${KHIA_CANH[m.khiaCanh]}${m.doiTuong ? ` · ${m.doiTuong}` : ''}] ${m.noiDung}`),
  ].join('\n');
}
