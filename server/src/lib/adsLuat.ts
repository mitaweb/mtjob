// Luật thắng / thua / chờ cho Ads Agent (anh Tâm 12/11/2026: "học repo loganriebel/meta-ads-agent làm meta ads").
// Học từ repo đó (MIT): ra quyết định theo CPA mục tiêu + chi tối thiểu, KHÔNG theo CTR ở vài trăm lượt hiển thị; ba kết cục
// (thắng / thua / CHỜ — chờ là một kết luận, không phải thiếu); Meta cần ~50 kết quả / 7 ngày để thoát giai đoạn học, sửa
// lớn là học lại từ đầu → tăng ngân sách từng nấc nhỏ, vừa sửa thì để yên vài ngày; tần suất cao = quảng cáo mỏi (thay nội
// dung, đừng tắt vội). Hàm THUẦN — AI đề xuất phải đi qua đây trước khi tới người duyệt.

export type NhanHq = 'thang' | 'thua' | 'cho' | 'moi';

export interface SoHq {
  /** Chi tiêu trong khoảng xét (tiền) */
  chi: number;
  hienThi: number;
  ketQua: number;
  /** Meta: số lần trung bình một người thấy quảng cáo */
  tanSuat?: number;
}

export interface NguCanhHq {
  /** CPA mục tiêu (tiền); 0 = chưa biết → không kết luận */
  cpaMucTieu: number;
  nen: 'meta' | 'gads';
  /** Số ngày từ lần sửa gần nhất trên MTJOB (bật / tắt / ngân sách); không có = chưa sửa */
  ngayTuLanSua?: number;
}

export interface PhanLoaiHq {
  nhan: NhanHq;
  lyDo: string;
  /** Thắng: được tăng ngân sách tối đa bao nhiêu (0,2 = 20%) một lần */
  tangToiDa?: number;
}

/** Ngưỡng — chỉnh ở đây (hệ số theo CPA mục tiêu nên dùng được cho mọi loại tiền). */
export const LUAT = {
  hienThiToiThieu: 1000,
  /** 0 kết quả / CPA quá cao chỉ kết luận THUA khi đã chi ≥ 2× CPA mục tiêu */
  chiKetLuan: 2,
  /** CPA > 1,5× mục tiêu = thua */
  cpaThua: 1.5,
  /** Thắng cần ít nhất 3 kết quả (1–2 kết quả là ngẫu nhiên) */
  ketQuaThang: 3,
  /** Meta thoát giai đoạn học: ~50 kết quả / 7 ngày */
  ketQuaHocMeta: 50,
  tanSuatMoi: 3,
  ngayChoSauSua: 3,
  tangKhiDangHoc: 0.2,
  tangToiDa: 0.3,
} as const;

const tien = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

export function phanLoai(s: SoHq, c: NguCanhHq): PhanLoaiHq {
  if (c.ngayTuLanSua !== undefined && c.ngayTuLanSua < LUAT.ngayChoSauSua) {
    return { nhan: 'cho', lyDo: `vừa sửa ${c.ngayTuLanSua} ngày trước — để nền tảng học lại ít nhất ${LUAT.ngayChoSauSua} ngày` };
  }
  if (s.hienThi < LUAT.hienThiToiThieu) return { nhan: 'cho', lyDo: `mới ${Math.round(s.hienThi)} lượt hiển thị — chưa đủ ${LUAT.hienThiToiThieu} để kết luận` };
  if (c.nen === 'meta' && (s.tanSuat || 0) >= LUAT.tanSuatMoi) {
    return { nhan: 'moi', lyDo: `tần suất ${(s.tanSuat || 0).toFixed(1)} — một người thấy quá nhiều lần, nên thay nội dung / mở rộng đối tượng chứ đừng tắt vội` };
  }
  const muc = c.cpaMucTieu;
  if (!(muc > 0)) return { nhan: 'cho', lyDo: 'chưa có CPA mục tiêu (tài khoản 30 ngày chưa có kết quả) — chưa kết luận được' };
  const nguong = muc * LUAT.chiKetLuan;
  if (s.ketQua <= 0) {
    return s.chi >= nguong
      ? { nhan: 'thua', lyDo: `chi ${tien(s.chi)} (≥ ${LUAT.chiKetLuan}× CPA mục tiêu ${tien(muc)}) mà 0 kết quả` }
      : { nhan: 'cho', lyDo: `0 kết quả nhưng mới chi ${tien(s.chi)} — chưa tới ${tien(nguong)} để kết luận` };
  }
  const cpa = s.chi / s.ketQua;
  if (cpa > muc * LUAT.cpaThua) {
    return s.chi >= nguong
      ? { nhan: 'thua', lyDo: `CPA ${tien(cpa)} > ${LUAT.cpaThua}× mục tiêu ${tien(muc)} (${s.ketQua} kết quả)` }
      : { nhan: 'cho', lyDo: `CPA ${tien(cpa)} cao nhưng mới chi ${tien(s.chi)} — chưa đủ để kết luận` };
  }
  if (cpa <= muc && s.ketQua >= LUAT.ketQuaThang) {
    const dangHoc = c.nen === 'meta' && s.ketQua < LUAT.ketQuaHocMeta;
    return {
      nhan: 'thang',
      lyDo: `CPA ${tien(cpa)} ≤ mục tiêu ${tien(muc)} với ${s.ketQua} kết quả${dangHoc ? ` — Meta còn trong giai đoạn học (< ${LUAT.ketQuaHocMeta} kết quả / 7 ngày), tăng từng nấc nhỏ` : ''}`,
      tangToiDa: dangHoc ? LUAT.tangKhiDangHoc : LUAT.tangToiDa,
    };
  }
  return { nhan: 'cho', lyDo: `CPA ${tien(cpa)} với ${s.ketQua} kết quả — trong khoảng chấp nhận, chưa có tín hiệu rõ` };
}

/** CPA mục tiêu: anh / nhân sự đặt thì dùng; chưa đặt → CPA trung bình 30 ngày của chính tài khoản; không có kết quả → 0. */
export function cpaMucTieu(caiDat: number, chi30: number, ketQua30: number): number {
  if (caiDat > 0) return caiDat;
  return ketQua30 > 0 ? chi30 / ketQua30 : 0;
}

/**
 * Đề xuất của AI có hợp luật không: tắt chỉ khi THUA; tăng ngân sách chỉ khi THẮNG và không quá mức (quá thì hạ về mức tối
 * đa); giảm ngân sách khi thua / mỏi. Từ khoá phủ định / thêm từ khoá dựa cụm khách gõ → để AI xét. Trả {} = giữ nguyên.
 */
export function locDeXuat(
  d: { hanhDong: string; cap: string; doiTuongId: string; nganSach?: number },
  pl: ReadonlyMap<string, PhanLoaiHq>,
  nganSachCu: number,
): { bo?: string; nganSach?: number } {
  const p = pl.get(`${d.cap}:${d.doiTuongId}`);
  if (d.hanhDong === 'tat') {
    if (!p) return { bo: 'không có số trong khoảng xét' };
    return p.nhan === 'thua' ? {} : { bo: `luật: ${p.nhan === 'moi' ? 'mỏi — thay nội dung trước' : 'chưa đủ dữ liệu để tắt'} (${p.lyDo})` };
  }
  if (d.hanhDong === 'ngan_sach') {
    const moi = Number(d.nganSach) || 0;
    if (!p || !(nganSachCu > 0)) return { bo: 'không có số / ngân sách cũ để so' };
    if (moi > nganSachCu) {
      if (p.nhan !== 'thang') return { bo: `luật: chỉ tăng ngân sách khi thắng (${p.lyDo})` };
      const tran = Math.round(nganSachCu * (1 + (p.tangToiDa ?? LUAT.tangToiDa)));
      return moi > tran ? { nganSach: tran } : {};
    }
    return p.nhan === 'thua' || p.nhan === 'moi' ? {} : { bo: `luật: chỉ giảm ngân sách khi thua (${p.lyDo})` };
  }
  return {};
}
