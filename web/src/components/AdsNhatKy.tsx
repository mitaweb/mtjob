// Nhật ký điều chỉnh quảng cáo + đề xuất của AI chờ duyệt (anh Tâm 11/11/2026). Ai được giao tài khoản (theo phòng) thấy và duyệt
// được; giám đốc thấy tất cả để theo dõi.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

interface Dong {
  id: string;
  taiSanId: string;
  taiKhoan: string;
  khach: string;
  cap: 'campaign' | 'adgroup' | 'ad' | 'keyword';
  ten: string;
  hanhDong: 'bat' | 'tat' | 'ngan_sach' | 'tu_khoa_am' | 'them_tu_khoa';
  giaTriCu: string;
  giaTriMoi: string;
  lyDo: string;
  trangThai: string;
  ketQua: string;
  nguoiTao: string;
  nguoiLam: string;
  taoLuc: string;
  lamLuc: string;
}

const CAP: Record<Dong['cap'], string> = { campaign: 'chiến dịch', adgroup: 'nhóm QC', ad: 'quảng cáo', keyword: 'từ khoá' };
const gio = (iso: string) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const vn = (s: string) => (/^\d+(\.\d+)?$/.test(s) ? `${Math.round(Number(s)).toLocaleString('vi-VN')}đ` : s);

/** "bút lamy [PHRASE]" → "“bút lamy” (khớp cụm từ)" — kiểu khớp từ khoá Google Ads nói bằng tiếng Việt (anh Tâm 12/11/2026 hỏi "[PHRASE] là gì"). */
const KHOP: Record<string, string> = { PHRASE: 'khớp cụm từ', EXACT: 'khớp chính xác', BROAD: 'khớp rộng' };
const tuKhoaVn = (s: string) => {
  const m = /^(.*)\s\[(PHRASE|EXACT|BROAD)\]$/.exec(s.trim());
  return m ? `“${m[1]}” (${KHOP[m[2]!]})` : `“${s}”`;
};

function moTa(x: Dong): string {
  switch (x.hanhDong) {
    case 'bat':
      return `Bật ${CAP[x.cap]} «${x.ten}»`;
    case 'tat':
      return `Tạm dừng ${CAP[x.cap]} «${x.ten}»`;
    case 'ngan_sach':
      return `Ngân sách ngày ${CAP[x.cap]} «${x.ten}»: ${x.giaTriCu ? `${vn(x.giaTriCu)} → ` : ''}${vn(x.giaTriMoi)}`;
    case 'tu_khoa_am':
      return `Thêm từ khoá phủ định ${tuKhoaVn(x.giaTriMoi)} vào chiến dịch «${x.ten}»`;
    case 'them_tu_khoa':
      return `Thêm từ khoá ${tuKhoaVn(x.giaTriMoi)} vào nhóm «${x.ten}»`;
  }
}

type Kenh = 'tat_ca' | 'meta' | 'gads';
const TEN_KENH: Record<Kenh, string> = { tat_ca: 'Tất cả', meta: 'Facebook', gads: 'Google Ads' };
const kenhCua = (x: Dong): Kenh => (x.taiSanId.startsWith('meta:') ? 'meta' : 'gads');

/** Anh Tâm 12/11/2026: "phần AI đề xuất duyệt cần tách theo tài khoản quảng cáo, theo kênh" — gom theo tài khoản, nhiều đề xuất lên trước. */
function theoTaiKhoan(ds: Dong[]): Array<{ id: string; ten: string; ds: Dong[] }> {
  const m = new Map<string, { id: string; ten: string; ds: Dong[] }>();
  for (const x of ds) {
    const g = m.get(x.taiSanId) || { id: x.taiSanId, ten: x.khach ? `${x.khach} — ${x.taiKhoan}` : x.taiKhoan, ds: [] };
    g.ds.push(x);
    m.set(x.taiSanId, g);
  }
  return [...m.values()].sort((a, b) => b.ds.length - a.ds.length || a.ten.localeCompare(b.ten, 'vi'));
}

export default function AdsNhatKy() {
  const toast = useToast();
  const [kenh, setKenh] = useState<Kenh>('tat_ca');
  const [d, setD] = useState<{ deXuat: Dong[]; lichSu: Dong[]; canCapNhatDb: boolean } | null>(null);
  const tai = () => api<{ deXuat: Dong[]; lichSu: Dong[]; canCapNhatDb: boolean }>('/ads/nhat-ky').then(setD);
  useEffect(() => {
    tai().catch(() => setD({ deXuat: [], lichSu: [], canCapNhatDb: false }));
  }, []);

  async function duyet(x: Dong) {
    if (!confirm(`Duyệt và làm ngay?\n${moTa(x)}`)) return;
    try {
      await api(`/ads/de-xuat/${x.id}/duyet`, { method: 'POST' });
      toast.success('Đã làm trên nền tảng quảng cáo');
    } catch (e) {
      toast.error((e as Error).message);
    }
    await tai();
  }
  async function bo(x: Dong) {
    await api(`/ads/de-xuat/${x.id}/bo`, { method: 'POST' });
    await tai();
  }

  if (!d) return <div className="card text-sm text-ink-muted">Đang tải…</div>;
  const hop = (x: Dong) => kenh === 'tat_ca' || kenhCua(x) === kenh;
  const deXuat = d.deXuat.filter(hop);
  const lichSu = d.lichSu.filter(hop);
  const nhom = theoTaiKhoan(deXuat);
  return (
    <div className="space-y-4">
      {d.canCapNhatDb && <p className="card bg-amber-50 text-sm">Cần bấm <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b> trước.</p>}
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto font-semibold">🤖 AI đề xuất — chờ duyệt ({d.deXuat.length})</p>
          <div className="flex gap-1.5" role="tablist" aria-label="Kênh quảng cáo">
            {(['tat_ca', 'meta', 'gads'] as Kenh[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kenh === k}
                className={`whitespace-nowrap rounded-lg border px-3 py-1 text-sm ${kenh === k ? 'border-ink bg-ink text-white' : 'border-brand-200 bg-white text-ink-soft'}`}
                onClick={() => setKenh(k)}
              >
                {TEN_KENH[k]} <span className={kenh === k ? 'text-white/70' : 'text-ink-muted'}>{k === 'tat_ca' ? d.deXuat.length : d.deXuat.filter((x) => kenhCua(x) === k).length}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-ink-muted">
          Mỗi sáng AI đọc kho tri thức về khách (ghi chú quảng cáo, điều anh dặn) + số 7–30 ngày để đề xuất. Bấm <b>Duyệt</b> là MTJOB làm ngay trên
          Meta / Google Ads và báo trưởng phòng.
        </p>
        {!deXuat.length && <p className="text-sm text-ink-muted">Không có đề xuất nào đang chờ{kenh === 'tat_ca' ? '' : ` ở ${TEN_KENH[kenh]}`}.</p>}
        <div className="space-y-2">
          {nhom.map((g, i) => (
            <details key={g.id} open={i === 0} className="rounded-xl border border-brand-100">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium">
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-xs text-ink-soft">{g.id.startsWith('meta:') ? 'Facebook' : 'Google'}</span>
                <span className="min-w-0 flex-1 truncate">{g.ten}</span>
                <span className="text-xs font-normal text-ink-muted">{g.ds.length} đề xuất</span>
              </summary>
              <ul className="divide-y divide-brand-100 px-3">
                {g.ds.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{moTa(x)}</p>
                      <p className="text-xs text-ink-muted">{gio(x.taoLuc)}</p>
                      {x.lyDo && <p className="text-xs">💡 {x.lyDo}</p>}
                    </div>
                    <AsyncButton className="btn-primary py-1 text-xs" onClick={() => duyet(x)}>
                      ✓ Duyệt
                    </AsyncButton>
                    <AsyncButton className="btn-ghost py-1 text-xs" onClick={() => bo(x)}>
                      Bỏ
                    </AsyncButton>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>

      <div className="card space-y-2">
        <p className="font-semibold">📝 Nhật ký điều chỉnh{kenh === 'tat_ca' ? '' : ` — ${TEN_KENH[kenh]}`}</p>
        {!lichSu.length && <p className="text-sm text-ink-muted">Chưa có điều chỉnh nào.</p>}
        <ul className="divide-y divide-brand-100">
          {lichSu.map((x) => (
            <li key={x.id} className="py-2 text-sm">
              <p>
                <span className={x.trangThai === 'da_lam' ? 'text-green-700' : x.trangThai === 'loi' ? 'text-red-700' : 'text-ink-muted'}>
                  {x.trangThai === 'da_lam' ? '✅' : x.trangThai === 'loi' ? '⚠' : '✕ bỏ'}
                </span>{' '}
                {moTa(x)}
              </p>
              <p className="text-xs text-ink-muted">
                {x.khach || x.taiKhoan} · {x.nguoiTao === 'ai' ? `AI đề xuất, ${x.nguoiLam} duyệt` : x.nguoiLam} · {gio(x.lamLuc || x.taoLuc)}
                {x.lyDo ? ` · ${x.lyDo}` : ''}
                {x.trangThai === 'loi' ? ` · lỗi: ${x.ketQua}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
