// Điều chỉnh quảng cáo + nghiên cứu từ khoá ngay trên MTJOB (anh Tâm 11/11/2026). Mở từ bảng tài khoản ở trang Kết nối MCP.
// Mọi thao tác hỏi xác nhận trước khi lưu; ghi nhật ký; báo trưởng phòng.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import ChonKhoang, { MAU, thamSoKhoang, type KhoangChon } from './ChonKhoang';

type Cap = 'campaign' | 'adgroup' | 'ad' | 'keyword';
interface DoiTuong {
  id: string;
  ten: string;
  cap: Cap;
  bat: boolean;
  trangThai: string;
  nganSach: number;
  cha: string;
  budgetResource?: string;
  nganSachChung?: boolean;
}
interface SoNgan {
  chi: number;
  click: number;
  ketQua: number;
}
interface TuKhoa {
  id: string;
  tuKhoa: string;
  kieuKhop: string;
  bat: boolean;
  campaignId: string;
  chienDich: string;
  nhom: string;
  diemCL: number;
  click: number;
  chi: number;
  chuyenDoi: number;
  cpc: number;
}
interface Cum {
  cum: string;
  campaignId: string;
  chienDich: string;
  trangThai: string;
  click: number;
  chi: number;
  chuyenDoi: number;
  langPhi: boolean;
}
interface GoiY {
  tuKhoa: string;
  lyDo?: string;
  luongTim: number;
  canhTranh: string;
  giaThapNhat: number;
  giaCaoNhat: number;
}

const vn = (n: number) => Math.round(n || 0).toLocaleString('vi-VN');
const TEN_CAP: Record<Cap, string> = { campaign: 'chiến dịch', adgroup: 'nhóm quảng cáo', ad: 'quảng cáo', keyword: 'từ khoá' };
const KIEU: Record<string, string> = { EXACT: 'chính xác', PHRASE: 'cụm từ', BROAD: 'mở rộng' };

export default function AdsDieuChinh({ taiSanId, ten, loai, dong }: { taiSanId: string; ten: string; loai: 'meta' | 'gads'; dong: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<'cd' | 'tk' | 'gc'>('cd');
  const id = encodeURIComponent(taiSanId);

  async function aiDeXuat() {
    const r = await api<{ so: number; thongKe?: { luatLoai: number; soThang: number; soThua: number; soMoi: number; soCho: number } | null }>(`/ads/${id}/ai-de-xuat`, {
      method: 'POST',
    });
    const t = r.thongKe;
    const luat = t ? ` · Luật: ${t.soThang} thắng, ${t.soThua} thua, ${t.soMoi} mỏi, ${t.soCho} chờ${t.luatLoai ? ` — loại ${t.luatLoai} đề xuất trái luật` : ''}` : '';
    toast.success(`${r.so ? `AI đề xuất ${r.so} điều chỉnh mới — xem ở tab 📝 Nhật ký & đề xuất` : 'AI chưa thấy gì mới cần chỉnh'}${luat}`);
  }

  return (
    <div id="bang-dieu-chinh" className="card scroll-mt-4 space-y-3 border-2 border-brand-600">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">🛠 Điều chỉnh: {ten}</p>
        <div className="ml-auto flex flex-wrap gap-2">
          <AsyncButton className="btn-ghost py-1 text-sm" onClick={aiDeXuat} busyLabel="AI đang đọc kho tri thức + số liệu…">
            🤖 AI đề xuất
          </AsyncButton>
          <button type="button" className="btn-ghost py-1 text-sm" onClick={dong}>
            Đóng
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {(
          [
            ['cd', 'Chiến dịch'],
            ...(loai === 'gads' ? [['tk', '🔍 Nghiên cứu từ khoá']] : []),
            ['gc', '🧠 Ghi chú khách'],
          ] as Array<[typeof tab, string]>
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`rounded-xl border px-3 py-1 text-sm ${tab === k ? 'border-brand-600 bg-brand-600 text-ink' : 'border-brand-200 bg-white text-ink-soft'}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'cd' && <ChienDich taiSanId={taiSanId} loai={loai} />}
      {tab === 'tk' && loai === 'gads' && <NghienCuuTuKhoa taiSanId={taiSanId} />}
      {tab === 'gc' && <GhiChu taiSanId={taiSanId} ten={ten} />}
    </div>
  );
}

/** Gửi một thao tác (đã xác nhận). Trả true nếu thành công. */
async function guiThaoTac(body: Record<string, unknown>, toast: ReturnType<typeof useToast>): Promise<boolean> {
  try {
    await api('/ads/thao-tac', { body });
    toast.success('Đã cập nhật lên nền tảng quảng cáo');
    return true;
  } catch (e) {
    toast.error((e as Error).message);
    return false;
  }
}

type ChiSo = Record<string, number | undefined>;
type Cot = { k: string; ten: string; kieu: 'tien' | 'so' | 'pt' | 'lan' | 'x' };
// Cột như Trình quản lý quảng cáo (anh Tâm 11/11/2026: "lấy đc càng nhiều chỉ số về để tối ưu càng tốt").
const COT: Record<'meta' | 'gads', Cot[]> = {
  gads: [
    { k: 'chi', ten: 'Chi phí', kieu: 'tien' },
    { k: 'hienThi', ten: 'Hiển thị', kieu: 'so' },
    { k: 'click', ten: 'Click', kieu: 'so' },
    { k: 'ctr', ten: 'CTR', kieu: 'pt' },
    { k: 'cpc', ten: 'CPC TB', kieu: 'tien' },
    { k: 'chuyenDoi', ten: 'Chuyển đổi', kieu: 'lan' },
    { k: 'tyLeCD', ten: 'Tỷ lệ CĐ', kieu: 'pt' },
    { k: 'cpa', ten: 'Chi phí / CĐ', kieu: 'tien' },
    { k: 'giaTriCD', ten: 'Giá trị CĐ', kieu: 'tien' },
    { k: 'roas', ten: 'ROAS', kieu: 'x' },
    { k: 'tyLeHienThi', ten: 'Tỷ lệ hiển thị', kieu: 'pt' },
    { k: 'matNganSach', ten: 'Mất HT do NS', kieu: 'pt' },
    { k: 'matXepHang', ten: 'Mất HT do xếp hạng', kieu: 'pt' },
    { k: 'dauTrang', ten: '% đầu trang', kieu: 'pt' },
    { k: 'dauTrangTuyetDoi', ten: '% đầu trang tuyệt đối', kieu: 'pt' },
  ],
  meta: [
    { k: 'chi', ten: 'Chi tiêu', kieu: 'tien' },
    { k: 'ketQua', ten: 'Kết quả', kieu: 'so' },
    { k: 'cpa', ten: 'Chi phí / KQ', kieu: 'tien' },
    { k: 'tiepCan', ten: 'Tiếp cận', kieu: 'so' },
    { k: 'hienThi', ten: 'Hiển thị', kieu: 'so' },
    { k: 'tanSuat', ten: 'Tần suất', kieu: 'lan' },
    { k: 'cpm', ten: 'CPM', kieu: 'tien' },
    { k: 'clickLink', ten: 'Click liên kết', kieu: 'so' },
    { k: 'click', ten: 'Click (tất cả)', kieu: 'so' },
    { k: 'ctr', ten: 'CTR', kieu: 'pt' },
    { k: 'cpc', ten: 'CPC', kieu: 'tien' },
    { k: 'tinNhan', ten: 'Tin nhắn', kieu: 'so' },
    { k: 'lead', ten: 'Lead', kieu: 'so' },
    { k: 'mua', ten: 'Lượt mua', kieu: 'so' },
    { k: 'giaTriMua', ten: 'Giá trị mua', kieu: 'tien' },
    { k: 'roas', ten: 'ROAS', kieu: 'x' },
  ],
};
const fmt = (v: number | undefined, kieu: Cot['kieu']) => {
  if (v === undefined || !Number.isFinite(v)) return '—';
  if (kieu === 'pt') return `${(v * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
  if (kieu === 'x') return v ? `${v.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}x` : '—';
  if (kieu === 'lan') return v.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  if (kieu === 'tien') return v ? `${vn(v)}đ` : '—';
  return vn(v);
};
/** Dòng tổng: cộng số tuyệt đối, tính lại tỷ lệ; tỷ lệ hiển thị không cộng được → —. */
function tongCong(ds: ChiSo[]): ChiSo {
  const t: Record<string, number> = {};
  for (const c of ds) for (const k of ['chi', 'hienThi', 'click', 'chuyenDoi', 'giaTriCD', 'tiepCan', 'clickLink', 'tinNhan', 'lead', 'mua', 'giaTriMua', 'ketQua']) t[k] = (t[k] || 0) + (c[k] || 0);
  const kq = t.chuyenDoi || t.ketQua || 0;
  return {
    ...t,
    ctr: t.hienThi ? t.click / t.hienThi : 0,
    cpc: t.click ? t.chi / t.click : 0,
    tyLeCD: t.click ? (t.chuyenDoi || 0) / t.click : 0,
    cpa: kq ? t.chi / kq : undefined,
    roas: t.chi ? (t.giaTriCD || t.giaTriMua || 0) / t.chi : 0,
    cpm: t.hienThi ? (t.chi / t.hienThi) * 1000 : 0,
    tanSuat: undefined,
  };
}

function ChienDich({ taiSanId, loai }: { taiSanId: string; loai: 'meta' | 'gads' }) {
  const toast = useToast();
  const id = encodeURIComponent(taiSanId);
  const [d, setD] = useState<{ doiTuong: DoiTuong[]; tienTe: string } | null>(null);
  const [cs, setCs] = useState<Record<string, Record<string, ChiSo>>>({});
  // Khoảng ngày + chia theo thời gian như Facebook (anh Tâm 11/11/2026).
  const [kh, setKh] = useState<KhoangChon>({ mau: '7', tu: '', den: '' });
  const [chia, setChia] = useState<'' | 'ngay' | 'tuan' | 'thang'>('');
  const [theoTg, setTheoTg] = useState<Array<{ ky: string; nhan: string; chiSo: ChiSo }> | null>(null);
  const tsKh = thamSoKhoang(kh);
  const nhanKh = kh.mau === 'tuy_chon' ? `${kh.tu} → ${kh.den}` : MAU.find(([k]) => k === kh.mau)?.[1] || '';
  const [loi, setLoi] = useState('');
  const [mo, setMo] = useState<Record<string, boolean>>({});
  const [ns, setNs] = useState<Record<string, string>>({});
  const [anTat, setAnTat] = useState(true);
  const taiDoiTuong = () =>
    api<{ doiTuong: DoiTuong[]; tienTe: string }>(`/ads/${id}/doi-tuong`)
      .then((x) => {
        setD(x);
        setLoi('');
      })
      .catch((e) => setLoi((e as Error).message));
  const taiChiSo = () =>
    Promise.all(
      ['campaign', 'adgroup', 'ad'].map((cap) =>
        api<{ chiSo: Record<string, ChiSo> }>(`/ads/${id}/chi-tiet?cap=${cap}&${tsKh}`)
          .then((r) => [cap, r.chiSo] as const)
          .catch(() => [cap, {}] as const),
      ),
    ).then((ds) => setCs(Object.fromEntries(ds)));
  useEffect(() => {
    void taiDoiTuong();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taiSanId]);
  useEffect(() => {
    void taiChiSo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taiSanId, tsKh]);
  useEffect(() => {
    setTheoTg(null);
    if (!chia) return;
    api<{ dong: Array<{ ky: string; nhan: string; chiSo: ChiSo }> }>(`/ads/${id}/theo-thoi-gian?nhom=${chia}&${tsKh}`)
      .then((r) => setTheoTg(r.dong))
      .catch(() => setTheoTg([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taiSanId, tsKh, chia]);

  if (loi) return <p className="text-sm text-red-700">⚠ {loi}</p>;
  if (!d) return <p className="text-sm text-ink-muted">Đang tải chiến dịch…</p>;
  const cot = COT[loai];
  const so = (x: DoiTuong): ChiSo => cs[x.cap]?.[x.id] || {};
  const chiCua = (x: DoiTuong) => so(x).chi || 0;
  const tatCa = d.doiTuong.filter((x) => x.cap === 'campaign').sort((a, b) => chiCua(b) - chiCua(a) || Number(b.bat) - Number(a.bat));
  // Chiến dịch đang dừng và không tiêu trong kỳ: ẩn mặc định cho gọn.
  const camp = anTat ? tatCa.filter((c) => c.bat || chiCua(c) > 0) : tatCa;
  const con = (cap: Cap, cha: string) => d.doiTuong.filter((x) => x.cap === cap && x.cha === cha).sort((a, b) => chiCua(b) - chiCua(a));
  const tong = tongCong(tatCa.map(so));

  async function doiTrangThai(x: DoiTuong) {
    const moi = !x.bat;
    if (!confirm(`${moi ? 'BẬT' : 'TẠM DỪNG'} ${TEN_CAP[x.cap]} «${x.ten}»?`)) return;
    if (await guiThaoTac({ taiSanId, cap: x.cap, doiTuongId: x.id, ten: x.ten, hanhDong: moi ? 'bat' : 'tat', giaTriCu: x.bat ? 'BẬT' : 'DỪNG' }, toast)) await taiDoiTuong();
  }
  async function doiNganSach(x: DoiTuong) {
    const moi = Number(String(ns[x.id] || '').replace(/[^\d.]/g, ''));
    if (!(moi > 0)) return toast.error('Nhập ngân sách ngày mới');
    const canh = x.nganSachChung ? '\n⚠ Ngân sách này DÙNG CHUNG với chiến dịch khác — đổi là đổi cả các chiến dịch đó.' : '';
    if (!confirm(`Đổi ngân sách ngày ${TEN_CAP[x.cap]} «${x.ten}»\n${vn(x.nganSach)} → ${vn(moi)} ${d!.tienTe}?${canh}`)) return;
    if (await guiThaoTac({ taiSanId, cap: x.cap, doiTuongId: x.id, ten: x.ten, hanhDong: 'ngan_sach', nganSach: moi, giaTriCu: String(x.nganSach), budgetResource: x.budgetResource }, toast)) {
      setNs({ ...ns, [x.id]: '' });
      await taiDoiTuong();
    }
  }

  const dong = (x: DoiTuong, lui: number) => {
    const capCon: Cap | null = x.cap === 'campaign' ? 'adgroup' : x.cap === 'adgroup' ? 'ad' : null;
    const coCon = !!capCon && con(capCon, x.id).length > 0;
    const coNs = x.nganSach > 0 || (loai === 'gads' && x.cap === 'campaign' && !!x.budgetResource);
    const s = so(x);
    const nen = x.cap === 'campaign' ? 'bg-white' : 'bg-[#fffaf0]';
    return (
      <tr key={`${x.cap}:${x.id}`} className={`${nen} ${!x.bat ? 'text-ink-muted' : ''}`}>
        <td className={`sticky left-0 z-10 min-w-[260px] max-w-[320px] px-2 py-1.5 ${nen}`} style={{ paddingLeft: 8 + lui * 18 }}>
          <div className="flex items-start gap-1">
            {coCon ? (
              <button type="button" className="w-5 shrink-0 text-ocean-700" aria-label={mo[x.id] ? 'Thu gọn' : 'Mở'} onClick={() => setMo({ ...mo, [x.id]: !mo[x.id] })}>
                {mo[x.id] ? '▾' : '▸'}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium" title={x.ten}>
                {x.ten}
              </p>
              <p className="text-xs">
                <span className={x.bat ? 'text-green-700' : ''}>{x.bat ? '● Đang bật' : '○ Tạm dừng'}</span>
                {x.trangThai && !['ACTIVE', 'ENABLED', 'PAUSED'].includes(x.trangThai) && <span className="ml-1 text-amber-700">· {x.trangThai}</span>}
              </p>
            </div>
          </div>
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right">
          {coNs ? (
            <div className="flex items-center justify-end gap-1">
              <span title={x.nganSachChung ? 'Ngân sách dùng chung' : ''}>
                {vn(x.nganSach)}đ{x.nganSachChung ? '*' : ''}
              </span>
              <input
                className="input w-24 px-1.5 py-0.5 text-xs"
                inputMode="numeric"
                placeholder="mới"
                aria-label={`Ngân sách ngày mới cho ${x.ten}`}
                value={ns[x.id] || ''}
                onChange={(e) => setNs({ ...ns, [x.id]: e.target.value })}
              />
              <AsyncButton className="btn-ghost px-1.5 py-0.5 text-xs" onClick={() => doiNganSach(x)}>
                Lưu
              </AsyncButton>
            </div>
          ) : (
            <span className="text-xs">—</span>
          )}
        </td>
        {cot.map((c) => (
          <td key={c.k} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
            {fmt(s[c.k], c.kieu)}
          </td>
        ))}
        <td className="whitespace-nowrap px-2 py-1.5 text-right">
          <AsyncButton className="btn-ghost px-2 py-0.5 text-xs" onClick={() => doiTrangThai(x)}>
            {x.bat ? '⏸ Dừng' : '▶ Bật'}
          </AsyncButton>
        </td>
      </tr>
    );
  };

  const hang: JSX.Element[] = [];
  for (const c of camp) {
    hang.push(dong(c, 0));
    if (!mo[c.id]) continue;
    for (const g of con('adgroup', c.id)) {
      hang.push(dong(g, 1));
      if (mo[g.id]) for (const a of con('ad', g.id)) hang.push(dong(a, 2));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ChonKhoang gia={kh} doi={setKh} />
        <span className="flex items-center gap-1 text-xs">
          Chia theo:
          {(
            [
              ['', 'Không'],
              ['ngay', 'Ngày'],
              ['tuan', 'Tuần'],
              ['thang', 'Tháng'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className={`rounded-lg px-2 py-1 ${chia === k ? 'bg-ocean-700 text-white' : 'bg-brand-50'}`} onClick={() => setChia(k)}>
              {l}
            </button>
          ))}
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={anTat} onChange={(e) => setAnTat(e.target.checked)} /> Ẩn chiến dịch đang dừng và không tiêu ({tatCa.length - camp.length})
        </label>
      </div>
      {chia && (
        <div className="max-h-[420px] overflow-auto rounded-xl border border-brand-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-20 bg-brand-50 text-xs text-ink-muted">
              <tr>
                <th className="sticky left-0 z-30 bg-brand-50 px-2 py-2 text-left">{chia === 'ngay' ? 'Ngày' : chia === 'tuan' ? 'Tuần' : 'Tháng'} (cả tài khoản)</th>
                {cot.map((c) => (
                  <th key={c.k} className="whitespace-nowrap px-2 py-2 text-right">
                    {c.ten}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {theoTg === null ? (
                <tr>
                  <td className="px-2 py-2 text-ink-muted" colSpan={cot.length + 1}>
                    Đang tải…
                  </td>
                </tr>
              ) : (
                theoTg.map((r) => (
                  <tr key={r.ky}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 font-medium">{r.nhan}</td>
                    {cot.map((c) => (
                      <td key={c.k} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                        {fmt(r.chiSo[c.k], c.kieu)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="max-h-[640px] overflow-auto rounded-xl border border-brand-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-brand-50 text-xs text-ink-muted">
            <tr>
              <th className="sticky left-0 z-30 bg-brand-50 px-2 py-2 text-left">Chiến dịch / nhóm / quảng cáo</th>
              <th className="px-2 py-2 text-right">Ngân sách ngày</th>
              {cot.map((c) => (
                <th key={c.k} className="whitespace-nowrap px-2 py-2 text-right">
                  {c.ten}
                </th>
              ))}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100">
            <tr className="bg-amber-50 font-semibold">
              <td className="sticky left-0 z-10 bg-amber-50 px-2 py-1.5">Tổng tài khoản ({nhanKh})</td>
              <td />
              {cot.map((c) => (
                <td key={c.k} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  {fmt(tong[c.k], c.kieu)}
                </td>
              ))}
              <td />
            </tr>
            {hang}
          </tbody>
        </table>
      </div>
      {!camp.length && <p className="text-sm text-ink-muted">Không có chiến dịch nào đang chạy / có chi tiêu trong kỳ.</p>}
      <p className="text-xs text-ink-muted">
        {loai === 'gads'
          ? 'Tỷ lệ hiển thị / mất hiển thị chỉ có ở chiến dịch tìm kiếm. * = ngân sách dùng chung nhiều chiến dịch.'
          : 'Kết quả = tin nhắn + lead + lượt mua. Số Meta có thể còn thay đổi 1–2 ngày gần nhất.'}
      </p>
    </div>
  );
}

function NghienCuuTuKhoa({ taiSanId }: { taiSanId: string }) {
  const toast = useToast();
  const id = encodeURIComponent(taiSanId);
  const [d, setD] = useState<{ tuKhoa: TuKhoa[]; cum: Cum[] } | null>(null);
  const [nhom, setNhom] = useState<DoiTuong[]>([]);
  const [loi, setLoi] = useState('');
  const [xem, setXem] = useState<'cum' | 'tk' | 'goiy'>('cum');
  const [chiLangPhi, setChiLangPhi] = useState(false);
  const [goc, setGoc] = useState('');
  const [url, setUrl] = useState('');
  const [goiY, setGoiY] = useState<GoiY[] | null>(null);
  const [nguonGoiY, setNguonGoiY] = useState<'planner' | 'ai'>('planner');
  const tai = () =>
    Promise.all([api<{ tuKhoa: TuKhoa[]; cum: Cum[] }>(`/ads/${id}/tu-khoa`), api<{ doiTuong: DoiTuong[] }>(`/ads/${id}/doi-tuong`)])
      .then(([a, b]) => {
        setD(a);
        setNhom(b.doiTuong.filter((x) => x.cap === 'adgroup'));
      })
      .catch((e) => setLoi((e as Error).message));
  useEffect(() => {
    void tai();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taiSanId]);

  const cum = useMemo(() => (d?.cum || []).filter((c) => !chiLangPhi || c.langPhi), [d, chiLangPhi]);
  if (loi) return <p className="text-sm text-red-700">⚠ {loi}</p>;
  if (!d) return <p className="text-sm text-ink-muted">Đang tải từ khoá 30 ngày…</p>;

  async function phuDinh(c: Cum) {
    const kieu = confirm(`Thêm "${c.cum}" làm TỪ KHOÁ PHỦ ĐỊNH cho chiến dịch «${c.chienDich}»?\n\nOK = khớp cụm từ (chặn mọi tìm kiếm chứa cụm này)\nHuỷ = không thêm`);
    if (!kieu) return;
    if (await guiThaoTac({ taiSanId, cap: 'campaign', doiTuongId: c.campaignId, ten: c.chienDich, hanhDong: 'tu_khoa_am', tuKhoa: c.cum, kieuKhop: 'PHRASE', lyDo: c.langPhi ? `Tốn ${vn(c.chi)}đ, 0 chuyển đổi (30 ngày)` : '' }, toast)) await tai();
  }
  async function themTuKhoa(chu: string, campaignId?: string) {
    const ung = nhom.filter((g) => !campaignId || g.cha === campaignId);
    if (!ung.length) return toast.error('Không có nhóm quảng cáo để thêm');
    const chon = ung.length === 1 ? ung[0] : ung[Number(prompt(`Thêm "${chu}" vào nhóm nào? Gõ số:\n${ung.map((g, i) => `${i}: ${g.ten}`).join('\n')}`, '0'))];
    if (!chon) return;
    if (!confirm(`Thêm từ khoá "${chu}" [cụm từ] vào nhóm «${chon.ten}»?`)) return;
    if (await guiThaoTac({ taiSanId, cap: 'adgroup', doiTuongId: chon.id, ten: chon.ten, hanhDong: 'them_tu_khoa', tuKhoa: chu, kieuKhop: 'PHRASE' }, toast)) await tai();
  }
  async function doiTuKhoa(k: TuKhoa) {
    if (!confirm(`${k.bat ? 'TẠM DỪNG' : 'BẬT'} từ khoá "${k.tuKhoa}"?`)) return;
    if (await guiThaoTac({ taiSanId, cap: 'keyword', doiTuongId: k.id, ten: k.tuKhoa, hanhDong: k.bat ? 'tat' : 'bat', giaTriCu: k.bat ? 'BẬT' : 'DỪNG' }, toast)) await tai();
  }
  async function layGoiY() {
    const r = await api<{ goiY: GoiY[]; nguon: 'planner' | 'ai' }>(`/ads/${id}/goi-y`, {
      body: { tuKhoa: goc.split(/[,\n]/).map((x) => x.trim()).filter(Boolean), url: url.trim() || undefined },
    });
    setGoiY(r.goiY);
    setNguonGoiY(r.nguon);
  }

  const th = 'px-2 py-1.5 text-left';
  const td = 'px-2 py-1.5';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-sm">
        {(
          [
            ['cum', `Cụm khách gõ (${d.cum.length})`],
            ['tk', `Từ khoá đang chạy (${d.tuKhoa.length})`],
            ['goiy', 'Gợi ý từ khoá mới'],
          ] as Array<[typeof xem, string]>
        ).map(([k, l]) => (
          <button key={k} type="button" className={`rounded-lg px-2.5 py-1 ${xem === k ? 'bg-ocean-700 text-white' : 'bg-brand-50'}`} onClick={() => setXem(k)}>
            {l}
          </button>
        ))}
      </div>

      {xem === 'cum' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chiLangPhi} onChange={(e) => setChiLangPhi(e.target.checked)} /> Chỉ cụm tốn tiền mà 0 chuyển đổi
          </label>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-brand-50 text-xs text-ink-muted">
                <tr>
                  <th className={th}>Khách gõ (30 ngày)</th>
                  <th className={th}>Chiến dịch</th>
                  <th className={`${th} text-right`}>Click</th>
                  <th className={`${th} text-right`}>Chi</th>
                  <th className={`${th} text-right`}>Chuyển đổi</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {cum.map((c) => (
                  <tr key={`${c.campaignId}|${c.cum}`} className={c.langPhi ? 'bg-red-50/50' : ''}>
                    <td className={td}>
                      {c.cum}
                      {c.trangThai === 'EXCLUDED' && <span className="ml-1 text-xs text-ink-muted">(đã phủ định)</span>}
                      {c.trangThai === 'ADDED' && <span className="ml-1 text-xs text-ink-muted">(đã là từ khoá)</span>}
                      {c.langPhi && <span className="ml-1 text-xs text-red-700">tốn tiền, 0 CĐ</span>}
                    </td>
                    <td className={`${td} text-xs text-ink-muted`}>{c.chienDich}</td>
                    <td className={`${td} text-right tabular-nums`}>{c.click}</td>
                    <td className={`${td} text-right tabular-nums`}>{vn(c.chi)}đ</td>
                    <td className={`${td} text-right tabular-nums`}>{c.chuyenDoi.toFixed(c.chuyenDoi % 1 ? 1 : 0)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {c.trangThai !== 'EXCLUDED' && (
                        <AsyncButton className="btn-ghost px-2 py-0.5 text-xs" onClick={() => phuDinh(c)}>
                          ⛔ Phủ định
                        </AsyncButton>
                      )}
                      {c.trangThai !== 'ADDED' && c.chuyenDoi > 0 && (
                        <AsyncButton className="btn-ghost px-2 py-0.5 text-xs" onClick={() => themTuKhoa(c.cum, c.campaignId)}>
                          ＋ Từ khoá
                        </AsyncButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {xem === 'tk' && (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-brand-50 text-xs text-ink-muted">
              <tr>
                <th className={th}>Từ khoá</th>
                <th className={th}>Nhóm / chiến dịch</th>
                <th className={`${th} text-right`}>Điểm CL</th>
                <th className={`${th} text-right`}>Click</th>
                <th className={`${th} text-right`}>Chi</th>
                <th className={`${th} text-right`}>CĐ</th>
                <th className={`${th} text-right`}>CPC</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {d.tuKhoa.map((k) => (
                <tr key={k.id} className={k.chi > 0 && !k.chuyenDoi ? 'bg-red-50/50' : ''}>
                  <td className={td}>
                    {k.tuKhoa} <span className="text-xs text-ink-muted">({KIEU[k.kieuKhop] || k.kieuKhop})</span>
                    {!k.bat && <span className="ml-1 text-xs text-ink-muted">· đang dừng</span>}
                  </td>
                  <td className={`${td} text-xs text-ink-muted`}>
                    {k.nhom} · {k.chienDich}
                  </td>
                  <td className={`${td} text-right tabular-nums ${k.diemCL && k.diemCL < 5 ? 'text-red-700' : ''}`}>{k.diemCL || '—'}</td>
                  <td className={`${td} text-right tabular-nums`}>{k.click}</td>
                  <td className={`${td} text-right tabular-nums`}>{vn(k.chi)}đ</td>
                  <td className={`${td} text-right tabular-nums`}>{k.chuyenDoi.toFixed(k.chuyenDoi % 1 ? 1 : 0)}</td>
                  <td className={`${td} text-right tabular-nums`}>{vn(k.cpc)}đ</td>
                  <td className={`${td} text-right`}>
                    <AsyncButton className="btn-ghost px-2 py-0.5 text-xs" onClick={() => doiTuKhoa(k)}>
                      {k.bat ? '⏸ Dừng' : '▶ Bật'}
                    </AsyncButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {xem === 'goiy' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1 text-sm" placeholder="Từ khoá gốc, cách nhau dấu phẩy (vd: tiệm nail, làm móng quận 3)" value={goc} onChange={(e) => setGoc(e.target.value)} />
            <input className="input w-64 text-sm" placeholder="hoặc trang web của khách" value={url} onChange={(e) => setUrl(e.target.value)} />
            <AsyncButton className="btn-primary py-1 text-sm" onClick={layGoiY} busyLabel="Đang hỏi Keyword Planner…">
              Gợi ý
            </AsyncButton>
          </div>
          {goiY && nguonGoiY === 'ai' && (
            <p className="rounded-xl bg-brand-50 p-2 text-xs">
              🤖 AI gợi ý từ <b>bộ não</b> (ghi chú khách, kho tri thức, cụm khách gõ có chuyển đổi). Chưa có lượng tìm kiếm: Keyword Planner của Google cần
              quyền API mức Basic.
            </p>
          )}
          {goiY && (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="sticky top-0 bg-brand-50 text-xs text-ink-muted">
                  <tr>
                    <th className={th}>Từ khoá</th>
                    <th className={`${th} text-right`}>Lượt tìm / tháng</th>
                    <th className={th}>Cạnh tranh</th>
                    <th className={`${th} text-right`}>Giá thầu đầu trang</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100">
                  {goiY.map((g) => (
                    <tr key={g.tuKhoa}>
                      <td className={td}>
                        {g.tuKhoa}
                        {g.lyDo && <span className="block text-xs text-ink-muted">{g.lyDo}</span>}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{vn(g.luongTim)}</td>
                      <td className={`${td} text-xs`}>{{ LOW: 'thấp', MEDIUM: 'vừa', HIGH: 'cao' }[g.canhTranh] || '—'}</td>
                      <td className={`${td} text-right tabular-nums`}>{g.giaCaoNhat ? `${vn(g.giaThapNhat)}–${vn(g.giaCaoNhat)}đ` : '—'}</td>
                      <td className={`${td} text-right`}>
                        <AsyncButton className="btn-ghost px-2 py-0.5 text-xs" onClick={() => themTuKhoa(g.tuKhoa)}>
                          ＋ Thêm
                        </AsyncButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** CPA mục tiêu — AI chỉ đề xuất tắt khi THUA, tăng ngân sách khi THẮNG so với số này (luật học từ meta-ads-agent, 12/11/2026). */
function MucTieuCpa({ taiSanId }: { taiSanId: string }) {
  const toast = useToast();
  const id = encodeURIComponent(taiSanId);
  const [m, setM] = useState<{ caiDat: number; tuDong: number; dung: number } | null>(null);
  const [o, setO] = useState('');
  useEffect(() => {
    api<{ caiDat: number; tuDong: number; dung: number }>(`/ads/${id}/muc-tieu`)
      .then((r) => {
        setM(r);
        setO(r.caiDat ? String(r.caiDat) : '');
      })
      .catch(() => setM({ caiDat: 0, tuDong: 0, dung: 0 }));
  }, [id]);
  async function luu() {
    const r = await api<{ caiDat: number; tuDong: number; dung: number }>(`/ads/${id}/muc-tieu`, { body: { cpa: Number(o.replace(/\D/g, '')) || 0 } });
    setM(r);
    toast.success(r.caiDat ? 'Đã lưu CPA mục tiêu' : 'Đã bỏ — AI dùng CPA trung bình 30 ngày');
  }
  if (!m) return null;
  return (
    <div className="space-y-1 rounded-xl bg-brand-50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>🎯 CPA mục tiêu</b>
        <input className="input w-36 py-1" inputMode="numeric" value={o} onChange={(e) => setO(e.target.value)} placeholder={m.tuDong ? m.tuDong.toLocaleString('vi-VN') : 'vd 80000'} aria-label="CPA mục tiêu" />
        <AsyncButton className="btn-primary py-1 text-sm" onClick={luu} busyLabel="Đang lưu…">
          Lưu
        </AsyncButton>
      </div>
      <p className="text-xs text-ink-muted">
        {m.caiDat ? 'Phòng đặt' : m.tuDong ? `Để trống = tự lấy CPA trung bình 30 ngày (${m.tuDong.toLocaleString('vi-VN')}đ)` : 'Tài khoản 30 ngày chưa có kết quả — nên đặt để AI xét được'}. AI chỉ đề xuất{' '}
        <b>tắt</b> khi chi ≥ 2× số này mà 0 kết quả hoặc CPA &gt; 1,5×; chỉ <b>tăng ngân sách</b> khi CPA ≤ số này với ≥ 3 kết quả (mỗi lần ≤ 20–30%); vừa
        sửa dưới 3 ngày thì để yên.
      </p>
    </div>
  );
}

function GhiChu({ taiSanId, ten }: { taiSanId: string; ten: string }) {
  const toast = useToast();
  const id = encodeURIComponent(taiSanId);
  const [nd, setNd] = useState<string | null>(null);
  useEffect(() => {
    api<{ noiDung: string }>(`/ads/${id}/ghi-chu`)
      .then((r) => setNd(r.noiDung))
      .catch(() => setNd(''));
  }, [id]);
  async function luu() {
    await api(`/ads/${id}/ghi-chu`, { body: { noiDung: nd || '' } });
    toast.success('Đã lưu vào kho tri thức — AI dùng khi đề xuất');
  }
  if (nd === null) return <p className="text-sm text-ink-muted">Đang tải…</p>;
  return (
    <div className="space-y-2">
      <MucTieuCpa taiSanId={taiSanId} />
      <p className="text-sm text-ink-muted">
        Điều cần biết khi chạy quảng cáo cho <b>{ten}</b>: sản phẩm / dịch vụ chính, khu vực, khách mục tiêu, từ khoá nên chạy, từ / nhu cầu KHÔNG
        nhận (vd "giá rẻ", "học nghề", "tuyển dụng"). Lưu vào <b>kho tri thức</b> của khách — AI đọc để lọc từ khoá và đề xuất phủ định.
      </p>
      <textarea
        className="input min-h-40 text-sm"
        value={nd}
        onChange={(e) => setNd(e.target.value)}
        placeholder={'Vd:\n- Tiệm nail cao cấp, chỉ ở quận 3 TP.HCM\n- Không nhận: học nghề nail, tuyển thợ, nail giá rẻ, sỉ dụng cụ\n- Khách mục tiêu: nữ văn phòng 25–40'}
      />
      <AsyncButton className="btn-primary py-1 text-sm" onClick={luu} busyLabel="Đang lưu…">
        Lưu vào kho tri thức
      </AsyncButton>
    </div>
  );
}
