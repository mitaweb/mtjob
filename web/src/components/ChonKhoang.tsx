// Bộ chọn khoảng ngày như Trình quản lý quảng cáo Facebook (anh Tâm 11/11/2026: "Các chỉ số em cho phép xem theo ngày tuần
// tháng... như fb nhé"). Máy chủ tính ra ngày cụ thể (lib/khoangNgay.ts) từ `mau`.

export interface KhoangChon {
  mau: string;
  tu: string;
  den: string;
}

export const MAU: Array<[string, string]> = [
  ['hom_nay', 'Hôm nay'],
  ['hom_qua', 'Hôm qua'],
  ['7', '7 ngày qua'],
  ['14', '14 ngày qua'],
  ['30', '30 ngày qua'],
  ['90', '90 ngày qua'],
  ['tuan_nay', 'Tuần này'],
  ['tuan_truoc', 'Tuần trước'],
  ['thang_nay', 'Tháng này'],
  ['thang_truoc', 'Tháng trước'],
  ['tuy_chon', 'Tuỳ chọn…'],
];

export const thamSoKhoang = (k: KhoangChon) => `mau=${k.mau}${k.mau === 'tuy_chon' ? `&tu=${k.tu}&den=${k.den}` : ''}`;

export default function ChonKhoang({ gia, doi }: { gia: KhoangChon; doi: (k: KhoangChon) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select className="input w-auto py-1 text-sm" value={gia.mau} aria-label="Khoảng thời gian" onChange={(e) => doi({ ...gia, mau: e.target.value })}>
        {MAU.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {gia.mau === 'tuy_chon' && (
        <>
          <input className="input w-auto py-1 text-sm" type="date" value={gia.tu} aria-label="Từ ngày" onChange={(e) => doi({ ...gia, tu: e.target.value })} />
          <span className="text-xs text-ink-muted">→</span>
          <input className="input w-auto py-1 text-sm" type="date" value={gia.den} aria-label="Đến ngày" onChange={(e) => doi({ ...gia, den: e.target.value })} />
        </>
      )}
    </span>
  );
}
