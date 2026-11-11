// Điều chỉnh quảng cáo + nghiên cứu từ khoá ngay trên MTJOB (anh Tâm 11/11/2026). Mở từ bảng tài khoản ở trang Kết nối MCP.
// Mọi thao tác hỏi xác nhận trước khi lưu; ghi nhật ký; báo trưởng phòng.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

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
    const r = await api<{ so: number }>(`/ads/${id}/ai-de-xuat`, { method: 'POST' });
    toast.success(r.so ? `AI đề xuất ${r.so} điều chỉnh — xem ở tab 📝 Nhật ký & đề xuất` : 'AI chưa thấy gì cần chỉnh');
  }

  return (
    <div className="card space-y-3 border-2 border-brand-600">
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

function ChienDich({ taiSanId, loai }: { taiSanId: string; loai: 'meta' | 'gads' }) {
  const toast = useToast();
  const [d, setD] = useState<{ doiTuong: DoiTuong[]; so7: Record<string, SoNgan>; tienTe: string } | null>(null);
  const [loi, setLoi] = useState('');
  const [mo, setMo] = useState<Record<string, boolean>>({});
  const [ns, setNs] = useState<Record<string, string>>({});
  const tai = () =>
    api<{ doiTuong: DoiTuong[]; so7: Record<string, SoNgan>; tienTe: string }>(`/ads/${encodeURIComponent(taiSanId)}/doi-tuong`)
      .then((x) => {
        setD(x);
        setLoi('');
      })
      .catch((e) => setLoi((e as Error).message));
  useEffect(() => {
    void tai();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taiSanId]);

  if (loi) return <p className="text-sm text-red-700">⚠ {loi}</p>;
  if (!d) return <p className="text-sm text-ink-muted">Đang tải chiến dịch…</p>;
  const camp = d.doiTuong.filter((x) => x.cap === 'campaign').sort((a, b) => (d.so7[b.id]?.chi || 0) - (d.so7[a.id]?.chi || 0) || Number(b.bat) - Number(a.bat));
  const con = (cap: Cap, cha: string) => d.doiTuong.filter((x) => x.cap === cap && x.cha === cha);

  async function doiTrangThai(x: DoiTuong) {
    const moi = !x.bat;
    if (!confirm(`${moi ? 'BẬT' : 'TẠM DỪNG'} ${TEN_CAP[x.cap]} «${x.ten}»?`)) return;
    if (await guiThaoTac({ taiSanId, cap: x.cap, doiTuongId: x.id, ten: x.ten, hanhDong: moi ? 'bat' : 'tat', giaTriCu: x.bat ? 'BẬT' : 'DỪNG' }, toast)) await tai();
  }
  async function doiNganSach(x: DoiTuong) {
    const so = Number(String(ns[x.id] || '').replace(/[^\d.]/g, ''));
    if (!(so > 0)) return toast.error('Nhập ngân sách ngày mới');
    const canh = x.nganSachChung ? '\n⚠ Ngân sách này DÙNG CHUNG với chiến dịch khác — đổi là đổi cả các chiến dịch đó.' : '';
    if (!confirm(`Đổi ngân sách ngày ${TEN_CAP[x.cap]} «${x.ten}»\n${vn(x.nganSach)} → ${vn(so)} ${d!.tienTe}?${canh}`)) return;
    if (await guiThaoTac({ taiSanId, cap: x.cap, doiTuongId: x.id, ten: x.ten, hanhDong: 'ngan_sach', nganSach: so, giaTriCu: String(x.nganSach), budgetResource: x.budgetResource }, toast)) {
      setNs({ ...ns, [x.id]: '' });
      await tai();
    }
  }

  const Dong = ({ x, lui }: { x: DoiTuong; lui: number }) => {
    const s = x.cap === 'campaign' ? d.so7[x.id] : undefined;
    const coCon = x.cap !== 'ad' && con(x.cap === 'campaign' ? 'adgroup' : 'ad', x.id).length > 0;
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 py-2 text-sm" style={{ paddingLeft: lui * 20 }}>
        {coCon ? (
          <button type="button" className="w-6 text-ocean-700" aria-label={mo[x.id] ? 'Thu gọn' : 'Mở'} onClick={() => setMo({ ...mo, [x.id]: !mo[x.id] })}>
            {mo[x.id] ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <span className={`rounded-full px-2 py-0.5 text-xs ${x.bat ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{x.bat ? 'Đang bật' : 'Tạm dừng'}</span>
        <span className="min-w-0 flex-1 font-medium">{x.ten}</span>
        {s && (
          <span className="text-xs text-ink-muted">
            7 ngày: {vn(s.chi)}đ · {s.click} click · {s.ketQua.toFixed(s.ketQua % 1 ? 1 : 0)} kết quả
          </span>
        )}
        {(x.nganSach > 0 || (loai === 'gads' && x.cap === 'campaign' && x.budgetResource)) && (
          <span className="flex items-center gap-1">
            <span className="text-xs text-ink-muted">NS ngày {vn(x.nganSach)}</span>
            <input
              className="input w-28 py-1 text-sm"
              inputMode="numeric"
              placeholder="NS mới"
              aria-label={`Ngân sách ngày mới cho ${x.ten}`}
              value={ns[x.id] || ''}
              onChange={(e) => setNs({ ...ns, [x.id]: e.target.value })}
            />
            <AsyncButton className="btn-ghost py-1 text-xs" onClick={() => doiNganSach(x)}>
              Lưu
            </AsyncButton>
          </span>
        )}
        <AsyncButton className="btn-ghost py-1 text-xs" onClick={() => doiTrangThai(x)}>
          {x.bat ? '⏸ Tạm dừng' : '▶ Bật'}
        </AsyncButton>
      </div>
    );
  };

  return (
    <div>
      {!camp.length && <p className="text-sm text-ink-muted">Không có chiến dịch.</p>}
      {camp.map((c) => (
        <div key={c.id}>
          <Dong x={c} lui={0} />
          {mo[c.id] &&
            con('adgroup', c.id).map((g) => (
              <div key={g.id}>
                <Dong x={g} lui={1} />
                {mo[g.id] && con('ad', g.id).map((a) => <Dong key={a.id} x={a} lui={2} />)}
              </div>
            ))}
        </div>
      ))}
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
