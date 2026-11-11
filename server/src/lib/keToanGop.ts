// Kế toán thuế — gộp số liệu THEO NGÀY CỦA SỐ LIỆU (anh Tâm 11/11/2026: "ưu tiên báo cáo sau ghi đè báo cáo cũ, các chỉ số
// có ngày cập nhật mới hơn phải được giữ lại, đánh giá giữ lại hay k, k hiểu thì hỏi").
// Ngày của số liệu = ngày lập / ngày chốt / ngày gửi của báo cáo — KHÔNG phải ngày tải lên.

export interface BanGhiChiSo {
  giaTri: Record<string, number>;
  /** Ngày số liệu của từng chỉ số (YYYY-MM-DD; '' = không rõ) */
  ngay: Record<string, string>;
}

export interface KhacBiet {
  khoa: string;
  cu: number;
  moi: number;
  ngayCu: string;
  ngayMoi: string;
}

export interface KetQuaGop extends BanGhiChiSo {
  /** Báo cáo mới hơn → đã ghi đè */
  ghiDe: KhacBiet[];
  /** Báo cáo cũ hơn → giữ số đang có */
  giuCu: KhacBiet[];
  /** Cùng ngày / không rõ ngày mà số khác → tạm giữ số cũ, chờ AI đánh giá hoặc anh quyết */
  canXet: KhacBiet[];
}

const lech = (a: number, b: number) => Math.abs(a - b) > 0.5;

export function gopChiSo(cu: BanGhiChiSo | null, moi: { giaTri: Record<string, number>; ngay: string }): KetQuaGop {
  const giaTri = { ...(cu?.giaTri || {}) };
  const ngay = { ...(cu?.ngay || {}) };
  const ra: KetQuaGop = { giaTri, ngay, ghiDe: [], giuCu: [], canXet: [] };
  for (const [khoa, v] of Object.entries(moi.giaTri)) {
    if (!Number.isFinite(v)) continue;
    if (!(khoa in giaTri)) {
      giaTri[khoa] = v;
      ngay[khoa] = moi.ngay;
      continue;
    }
    const c = giaTri[khoa]!;
    const nc = ngay[khoa] || '';
    if (!lech(c, v)) {
      if (moi.ngay > nc) ngay[khoa] = moi.ngay;
      continue;
    }
    const kb = { khoa, cu: c, moi: v, ngayCu: nc, ngayMoi: moi.ngay };
    if (moi.ngay && nc && moi.ngay > nc) {
      giaTri[khoa] = v;
      ngay[khoa] = moi.ngay;
      ra.ghiDe.push(kb);
    } else if (moi.ngay && nc && moi.ngay < nc) {
      ra.giuCu.push(kb);
    } else if (moi.ngay && !nc) {
      // Số cũ không rõ ngày, báo cáo mới có ngày → báo cáo mới đáng tin hơn.
      giaTri[khoa] = v;
      ngay[khoa] = moi.ngay;
      ra.ghiDe.push(kb);
    } else {
      ra.canXet.push(kb);
    }
  }
  return ra;
}

/** Áp quyết định cho các chỉ số cần xét (AI hoặc anh chọn số mới). */
export function apQuyetDinh(bg: BanGhiChiSo, chon: KhacBiet[]): BanGhiChiSo {
  const giaTri = { ...bg.giaTri };
  const ngay = { ...bg.ngay };
  for (const k of chon) {
    giaTri[k.khoa] = k.moi;
    ngay[k.khoa] = k.ngayMoi || ngay[k.khoa] || '';
  }
  return { giaTri, ngay };
}

// ── Tháng đã lấy từ cổng thuế (anh Tâm 11/11/2026: "tháng nào mà đã cập nhật từ cổng thuế có trên hệ thống rồi thì note
// lại, đã cập nhật từ tháng... để cập nhật tiếp mà k phải lấy nhiều") ──

/** Lấy sau khi tháng kết thúc ít nhất ngần này ngày mới coi là ĐỦ (hoá đơn ký muộn, người bán gửi chậm vài ngày). */
const NGAY_CHO_DU = 5;

const thangSau = (t: string) => {
  const [y, m] = t.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const thangTruoc = (t: string) => {
  const [y, m] = t.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
/** Ngày (YYYY-MM-DD) tháng `t` coi như đã chốt: ngày đầu tháng sau + (NGAY_CHO_DU − 1). */
const ngayDu = (t: string) => `${thangSau(t)}-${String(NGAY_CHO_DU).padStart(2, '0')}`;

export interface ThangDaLay {
  /** Khoảng tháng đã lấy ĐỦ liền nhau gần nhất (YYYY-MM; '' = chưa có) */
  duTu: string;
  duDen: string;
  /** Tháng đã lấy nhưng lấy sớm (tháng chưa chốt) → nên lấy lại */
  canLayLai: string[];
  /** Tháng nên lấy tiếp */
  goiY: string;
}

/** `daLay`: tháng → lúc lấy gần nhất (ISO). */
export function tinhThangDaLay(daLay: Record<string, string>, homNay: string): ThangDaLay {
  const thangNay = homNay.slice(0, 7);
  const du = (t: string) => !!daLay[t] && daLay[t]!.slice(0, 10) >= ngayDu(t);
  const thang = Object.keys(daLay).filter((t) => /^\d{4}-\d{2}$/.test(t)).sort();
  const batDau = thang[0] && thang[0] < thangNay ? thang[0] : thangTruoc(thangNay);
  let goiY = thangNay;
  for (let t = batDau; t <= thangNay; t = thangSau(t)) {
    if (!du(t)) {
      goiY = t;
      break;
    }
  }
  // Khoảng đủ liền nhau kết thúc ngay trước tháng gợi ý (nếu có).
  let duDen = '';
  let duTu = '';
  for (let t = thangTruoc(goiY); du(t); t = thangTruoc(t)) {
    if (!duDen) duDen = t;
    duTu = t;
  }
  return { duTu, duDen, canLayLai: thang.filter((t) => t < thangNay && daLay[t] && !du(t)), goiY };
}

// ── Bảng lương một tháng / sổ công nợ một ngày chốt: nhận hoặc giữ CẢ KHỐI (các số trong khối cùng một báo cáo) ──

/** 'moi' = ghi cả khối mới; 'cu' = giữ khối đang có; 'xet' = cần AI đánh giá / hỏi anh. */
export function quyetDinhCaKhoi(r: KetQuaGop, daCo: boolean): 'moi' | 'cu' | 'xet' {
  if (!daCo) return 'moi';
  if (r.canXet.length) return 'xet';
  if (r.ghiDe.length) return 'moi';
  if (r.giuCu.length) return 'cu';
  return 'moi';
}

export function phangCongNo(so: { dong: ReadonlyArray<{ ma: string; duNo: number; duCo: number; [k: string]: unknown }>; [k: string]: unknown }): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const d of so.dong) {
    ra[`${d.ma}|duNo`] = d.duNo;
    ra[`${d.ma}|duCo`] = d.duCo;
  }
  return ra;
}

/** Mã chỉ tiêu: mã số trong báo cáo nếu có, không thì tên bỏ dấu nối gạch dưới. */
export function khoaChiTieu(ma: string, ten: string): string {
  const m = String(ma || '').trim();
  if (m) return m.slice(0, 20);
  return String(ten || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export function tomTatGop(t: { ghiDe: number; giuCu: number; aiMoi: number; aiCu: number; hoi: number }): string {
  return [
    t.ghiDe ? ` · cập nhật ${t.ghiDe} chỉ số theo báo cáo mới hơn` : '',
    t.giuCu ? ` · giữ ${t.giuCu} chỉ số (báo cáo này cũ hơn)` : '',
    t.aiMoi ? ` · AI chọn số mới cho ${t.aiMoi} chỗ` : '',
    t.aiCu ? ` · AI giữ số cũ ${t.aiCu} chỗ` : '',
    t.hoi ? ` · ❓ ${t.hoi} chỗ cần anh quyết` : '',
  ].join('');
}

/**
 * Ngày lập báo cáo theo dòng ký kiểu Việt Nam ("Hà Nội, ngày 15 tháng 01 năm 2026"). Nhiều ngày (kỳ báo cáo, ngày ký) →
 * lấy ngày muộn nhất. Không thấy → ''.
 */
export function ngayLapTrongFile(sheets: ReadonlyArray<{ rows: ReadonlyArray<ReadonlyArray<unknown>> }>): string {
  let max = '';
  const re = /ng[aà]y\s+(\d{1,2})\s+th[aá]ng\s+(\d{1,2})\s+n[aă]m\s+(\d{4})/gi;
  for (const s of sheets)
    for (const r of s.rows)
      for (const o of r) {
        for (const m of String(o ?? '').matchAll(re)) {
          const d = Number(m[1]);
          const t = Number(m[2]);
          const n = Number(m[3]);
          if (d < 1 || d > 31 || t < 1 || t > 12 || n < 2000 || n > 2100) continue;
          const iso = `${n}-${String(t).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          if (iso > max) max = iso;
        }
      }
  return max;
}

/**
 * Ngày lập chỉ hợp lệ khi không sớm hơn mốc của số liệu (đầu kỳ báo cáo / đầu tháng lương / ngày chốt công nợ). Mẫu kế toán
 * đôi khi ghi nhầm năm ở dòng ký (KQKD 6 tháng 2026 ký "27/10/2025") — tin ngày đó thì báo cáo bị coi là cũ sai.
 */
export function ngayHopLe(ngay: string, mocSomNhat: string): string {
  return ngay && (!mocSomNhat || ngay >= mocSomNhat) ? ngay : '';
}
