// Nhật ký điều chỉnh quảng cáo + đề xuất của AI chờ duyệt (anh Tâm 11/11/2026). Ai được giao tài khoản (theo phòng) thấy và duyệt
// được; giám đốc thấy tất cả để theo dõi.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

interface Dong {
  id: string;
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

export default function AdsNhatKy() {
  const toast = useToast();
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
  return (
    <div className="space-y-4">
      {d.canCapNhatDb && <p className="card bg-amber-50 text-sm">Cần bấm <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b> trước.</p>}
      <div className="card space-y-2">
        <p className="font-semibold">🤖 AI đề xuất — chờ duyệt ({d.deXuat.length})</p>
        <p className="text-sm text-ink-muted">
          Mỗi sáng AI đọc kho tri thức về khách (ghi chú quảng cáo, điều anh dặn) + số 7–30 ngày để đề xuất. Bấm <b>Duyệt</b> là MTJOB làm ngay trên
          Meta / Google Ads và báo trưởng phòng.
        </p>
        {!d.deXuat.length && <p className="text-sm text-ink-muted">Không có đề xuất nào đang chờ.</p>}
        <ul className="divide-y divide-brand-100">
          {d.deXuat.map((x) => (
            <li key={x.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{moTa(x)}</p>
                <p className="text-xs text-ink-muted">
                  {x.khach || x.taiKhoan} · {gio(x.taoLuc)}
                </p>
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
      </div>

      <div className="card space-y-2">
        <p className="font-semibold">📝 Nhật ký điều chỉnh</p>
        {!d.lichSu.length && <p className="text-sm text-ink-muted">Chưa có điều chỉnh nào.</p>}
        <ul className="divide-y divide-brand-100">
          {d.lichSu.map((x) => (
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
