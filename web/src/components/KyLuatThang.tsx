/**
 * Cảnh báo đi trễ / về sớm của một tháng.
 *
 * Luôn kèm DANH SÁCH NGÀY kèm giờ: nói "bạn đi trễ 3 lần" mà không chỉ ra ba ngày nào thì
 * người bị nhắc không kiểm lại được, và cũng không sửa được nếu máy chấm sai.
 */

export interface NgayViPham {
  date: string;
  tre: boolean;
  treMin: number;
  gioVao: string;
  donTre: boolean;
  som: boolean;
  somMin: number;
  gioRa: string;
  donSom: boolean;
}

export interface TongKetKyLuat {
  soLanTre: number;
  soLanSom: number;
  soLanKhongDon: number;
  ngay: NgayViPham[];
}

const ddmm = (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

/** Mô tả một ngày: trễ bao nhiêu, vào lúc mấy giờ, đã xin phép chưa. */
export function moTaNgay(n: NgayViPham): string {
  const ve: string[] = [];
  if (n.tre) {
    // treMin = 0 nghĩa là không có mốc giờ nào, chỉ biết qua đơn đã duyệt.
    ve.push(n.treMin > 0 ? `đi trễ ${n.treMin} phút (vào ${n.gioVao})` : 'đi trễ (theo đơn)');
  }
  if (n.som) {
    ve.push(n.somMin > 0 ? `về sớm ${n.somMin} phút (ra ${n.gioRa})` : 'về sớm (theo đơn)');
  }
  const thieuDon = (n.tre && !n.donTre) || (n.som && !n.donSom);
  return `${ve.join(', ')}${thieuDon ? ' · chưa có đơn' : ' · đã có đơn'}`;
}

export default function KyLuatThang({
  kyLuat,
  canhBao,
  tieuDe,
}: {
  kyLuat: TongKetKyLuat | null;
  /** Câu cảnh báo do máy chủ soạn — để tin nhắn đẩy và màn hình nói y hệt nhau. */
  canhBao?: string;
  tieuDe?: string;
}) {
  if (!kyLuat || kyLuat.ngay.length === 0) return null;

  return (
    <div className="rounded-xl border border-accent-300 bg-accent-50 p-3">
      <p className="text-sm font-semibold text-ink">⚠️ {canhBao || tieuDe || 'Chấm công tháng này'}</p>
      <ul className="mt-2 space-y-0.5">
        {kyLuat.ngay.map((n) => (
          <li key={n.date} className="text-xs text-ink-soft">
            <span className="font-medium text-ink">{ddmm(n.date)}</span> — {moTaNgay(n)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">
        Trễ tính theo giờ chấm công vào so với giờ bắt đầu ca; về sớm tính theo giờ chấm ra buổi chiều so
        với giờ tan làm. Sai giờ thì báo quản trị sửa lại chấm công.
      </p>
    </div>
  );
}
