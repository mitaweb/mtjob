// Gộp thưởng điểm và thưởng KPI dự án thành MỘT bảng theo người.
//
// Dùng cho bảng thưởng trên trang lương VÀ cho khoản chi tự ghi lúc chốt thưởng — cùng một
// hàm, nên số anh nhìn thấy trên bảng và số vào chi phí không thể lệch nhau. Thuần, có test.

export interface DongThuongDiem {
  memberId: string;
  fullName: string;
  teamId: string;
  points: number;
  /** Thưởng điểm trước khi soi kết quả dự án. */
  bonusGoc: number;
  /** 1 hoặc 0,5. */
  heSo: number;
  /** Thực nhận = bonusGoc × heSo. */
  amount: number;
}

export interface DongThuongKpi {
  memberId: string;
  fullName: string;
  teamId: string;
  projectId: string;
  projectName: string;
  vaiTro: 'leader' | 'member';
  tyLe: number | null;
  mucThuong: number;
  amount: number;
}

export interface ThuongNguoi {
  memberId: string;
  fullName: string;
  teamId: string;
  points: number;
  thuongDiemGoc: number;
  heSo: number;
  thuongDiem: number;
  thuongKpi: number;
  duAn: DongThuongKpi[];
  tong: number;
}

/**
 * Gộp theo người, xếp tổng cao → thấp (bằng tiền thì theo tên, cho thứ tự đứng yên).
 *
 * Người không dính đồng thưởng nào bị bỏ — bảng này để đếm tiền, không phải danh bạ. Nhưng
 * GIỮ người có dự án mà 0đ, hoặc bị cắt nửa thưởng điểm: bảng phải giải thích được vì sao
 * họ không có tiền, không thì người ta tưởng bị sót tên.
 */
export function gopThuong(diem: DongThuongDiem[], kpi: DongThuongKpi[]): ThuongNguoi[] {
  const theo = new Map<string, ThuongNguoi>();
  const lay = (id: string, fullName: string, teamId: string): ThuongNguoi => {
    let o = theo.get(id);
    if (!o) {
      o = {
        memberId: id,
        fullName,
        teamId,
        points: 0,
        thuongDiemGoc: 0,
        heSo: 1,
        thuongDiem: 0,
        thuongKpi: 0,
        duAn: [],
        tong: 0,
      };
      theo.set(id, o);
    }
    // Hai nguồn có thể thiếu tên (người đã nghỉ) — nguồn nào có thì lấy.
    if (!o.fullName && fullName) o.fullName = fullName;
    if (!o.teamId && teamId) o.teamId = teamId;
    return o;
  };

  for (const d of diem) {
    const o = lay(d.memberId, d.fullName, d.teamId);
    o.points = d.points;
    o.thuongDiemGoc = d.bonusGoc;
    o.heSo = d.heSo;
    o.thuongDiem = d.amount;
  }
  for (const k of kpi) {
    const o = lay(k.memberId, k.fullName, k.teamId);
    o.thuongKpi += k.amount;
    o.duAn.push(k);
  }

  const ra: ThuongNguoi[] = [];
  for (const o of theo.values()) {
    o.tong = o.thuongDiem + o.thuongKpi;
    if (o.tong > 0 || o.duAn.length > 0 || o.heSo < 1) ra.push(o);
  }
  return ra.sort((a, b) => b.tong - a.tong || a.fullName.localeCompare(b.fullName, 'vi'));
}

/** Tổng tiền thưởng của cả bảng — đúng số được ghi vào chi phí. */
export function tongThuong(rows: Array<{ tong: number }>): number {
  return rows.reduce((s, r) => s + (Number(r.tong) || 0), 0);
}
