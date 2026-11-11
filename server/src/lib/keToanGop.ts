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
