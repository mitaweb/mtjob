// Fanpage có duyệt (học Javis — anh Tâm 11/11/2026). AI soạn bài / trả lời bình luận; CHỈ đăng khi anh bấm Đăng.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

interface Trang {
  pageId: string;
  ten: string;
}
interface DeXuat {
  id: string;
  pageId: string;
  ten: string;
  loai: 'bai' | 'tra_loi';
  noiDung: string;
  binhLuan: string;
  nguoiBl: string;
  bai: string;
  lyDo: string;
  trangThai: string;
  ketQua: string;
  nguoiTao: string;
  taoLuc: string;
  duyetLuc: string;
}
interface DuLieu {
  trang: Trang[];
  cho: DeXuat[];
  lichSu: DeXuat[];
  canCapNhatDb: boolean;
}

const gio = (iso: string) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');

function TheDeXuat({ d, xong }: { d: DeXuat; xong: () => Promise<void> }) {
  const toast = useToast();
  const [nd, setNd] = useState(d.noiDung);
  async function dang() {
    if (!confirm(`Đăng ${d.loai === 'bai' ? 'bài này' : 'trả lời này'} lên «${d.ten}»? Đăng xong là công khai.`)) return;
    await api(`/fanpage/de-xuat/${d.id}/duyet`, { body: { noiDung: nd } });
    toast.success('Đã đăng lên Facebook');
    await xong();
  }
  async function bo() {
    await api(`/fanpage/de-xuat/${d.id}/bo`, { method: 'POST' });
    await xong();
  }
  return (
    <li className="space-y-2 rounded-xl border border-brand-100 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-brand-100 px-2 py-0.5">{d.loai === 'bai' ? '📝 Bài đăng' : '💬 Trả lời bình luận'}</span>
        <span className="font-medium">{d.ten}</span>
        <span className="text-ink-muted">
          {d.nguoiTao === 'ai' ? 'AI soạn' : 'anh viết'} · {gio(d.taoLuc)}
        </span>
        {d.trangThai === 'loi' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">đăng lỗi: {d.ketQua}</span>}
      </div>
      {d.loai === 'tra_loi' && (
        <div className="rounded-xl bg-brand-50 p-2 text-sm">
          {d.bai && <p className="line-clamp-2 text-ink-muted">Bài: {d.bai}</p>}
          <p>
            <b>{d.nguoiBl || 'Khách'}:</b> {d.binhLuan}
          </p>
        </div>
      )}
      {d.lyDo && <p className="text-xs text-ink-muted">🤖 {d.lyDo}</p>}
      <textarea className="input min-h-20 text-sm" value={nd} onChange={(e) => setNd(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <AsyncButton className="btn-primary py-1 text-sm" onClick={dang} busyLabel="Đang đăng…">
          ✓ Duyệt &amp; đăng
        </AsyncButton>
        <AsyncButton className="btn-ghost py-1 text-sm" onClick={bo}>
          Bỏ
        </AsyncButton>
      </div>
    </li>
  );
}

export default function AdminFanpage() {
  const toast = useToast();
  const [d, setD] = useState<DuLieu | null>(null);
  const [pageId, setPageId] = useState('');
  const [yeuCau, setYeuCau] = useState('');
  const [bai, setBai] = useState('');

  async function tai() {
    const r = await api<DuLieu>('/fanpage');
    setD(r);
    if (!pageId && r.trang[0]) setPageId(r.trang[0].pageId);
  }
  useEffect(() => {
    tai().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ketNoiFanpage() {
    const r = await api<{ url: string }>('/ket-noi/meta/bat-dau?fanpage=1');
    window.location.href = r.url;
  }
  async function layTrang() {
    const r = await api<{ so: number }>('/fanpage/lay-trang', { method: 'POST' });
    toast.success(`Thấy ${r.so} Trang`);
    await tai();
  }
  async function quet() {
    const r = await api<{ moi: number; boQua: number; loi: string[]; baiDoc: number; binhLuanDoc: number }>('/fanpage/quet', { method: 'POST' });
    if (r.loi.length) toast.error(r.loi.join(' · '));
    else toast.success(`Đọc ${r.baiDoc} bài, ${r.binhLuanDoc} bình luận gần đây · ${r.moi} trả lời mới chờ duyệt${r.boQua ? ` · ${r.boQua} bình luận AI thấy không cần trả lời` : ''}`);
    await tai();
  }
  async function vietAi() {
    const r = await api<{ noiDung: string }>('/fanpage/viet-ai', { body: { pageId, yeuCau } });
    setBai(r.noiDung);
  }
  async function luuNhap() {
    await api('/fanpage/bai', { body: { pageId, noiDung: bai } });
    setBai('');
    setYeuCau('');
    toast.success('Đã lưu nháp — duyệt ở danh sách bên dưới');
    await tai();
  }

  if (!d) return <div className="card text-sm text-ink-muted">Đang tải…</div>;
  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">📣 Fanpage</h2>
        <p className="text-sm text-ink-muted">
          Mỗi 15 phút AI đọc bình luận mới, tự bỏ qua spam / tag bạn bè, soạn trả lời <b>chỉ từ tri thức công khai</b> trong kho
          (không nêu giá nội bộ). Bài đăng: anh viết hoặc nhờ AI viết. <b>Không có gì tự đăng</b> — anh sửa rồi bấm Duyệt &amp; đăng.
        </p>
      </div>
      {d.canCapNhatDb && <p className="rounded-xl bg-amber-50 p-3 text-sm">Cần bấm <b>🛠 Cập nhật cấu trúc DB</b> trước.</p>}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Trang: {d.trang.length ? d.trang.map((t) => t.ten).join(', ') : <b>chưa có</b>}</span>
        <AsyncButton className="btn-ghost py-1 text-sm" onClick={ketNoiFanpage} busyLabel="Đang mở Facebook…">
          🔑 Cấp quyền Fanpage
        </AsyncButton>
        <AsyncButton className="btn-ghost py-1 text-sm" onClick={layTrang} busyLabel="Đang lấy…">
          ↻ Lấy lại danh sách Trang
        </AsyncButton>
        {d.trang.length > 0 && (
          <AsyncButton className="btn-ghost py-1 text-sm" onClick={quet} busyLabel="AI đang đọc bình luận…">
            💬 Quét bình luận ngay
          </AsyncButton>
        )}
      </div>
      {!d.trang.length && (
        <p className="rounded-xl bg-brand-50 p-3 text-sm">
          Chưa có Trang. Làm 2 bước:
          <br />1. Vào <b>developers.facebook.com</b> → app Meta của MTJOB → <b>Trường hợp sử dụng</b> (Use cases) → <b>Thêm</b> →
          chọn <b>“Quản lý mọi thứ trên Trang”</b> (Manage everything on your Page). Thiếu bước này Facebook báo “Invalid Scopes”.
          <br />2. Bấm nút <b>Kết nối Fanpage</b> bên dưới, chọn các Trang của công ty.
          <br />
          <AsyncButton className="btn-primary mt-2 py-1 text-sm" onClick={ketNoiFanpage} busyLabel="Đang mở Facebook…">
            Kết nối Fanpage
          </AsyncButton>
        </p>
      )}

      <div>
        <p className="mb-2 font-medium">Chờ anh duyệt ({d.cho.length})</p>
        {d.cho.length ? (
          <ul className="space-y-3">
            {d.cho.map((x) => (
              <TheDeXuat key={x.id} d={x} xong={tai} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Không có gì chờ duyệt.</p>
        )}
      </div>

      {d.trang.length > 0 && (
        <div className="space-y-2 rounded-xl border border-brand-100 p-3">
          <p className="text-sm font-medium">Soạn bài mới</p>
          <select className="input w-auto py-1.5 text-sm" value={pageId} onChange={(e) => setPageId(e.target.value)}>
            {d.trang.map((t) => (
              <option key={t.pageId} value={t.pageId}>
                {t.ten}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1 text-sm" placeholder="Nhờ AI viết: chủ đề, ưu đãi, đối tượng…" value={yeuCau} onChange={(e) => setYeuCau(e.target.value)} />
            <AsyncButton className="btn-ghost py-1 text-sm" onClick={vietAi} busyLabel="AI đang viết…">
              ✨ AI viết
            </AsyncButton>
          </div>
          <textarea className="input min-h-28 text-sm" placeholder="Nội dung bài" value={bai} onChange={(e) => setBai(e.target.value)} />
          <AsyncButton className="btn-primary py-1 text-sm" onClick={luuNhap} busyLabel="Đang lưu…">
            Lưu nháp chờ duyệt
          </AsyncButton>
        </div>
      )}

      {d.lichSu.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-ocean-700">Đã xử lý gần đây ({d.lichSu.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {d.lichSu.map((x) => (
              <li key={x.id}>
                {x.trangThai === 'da_dang' ? '✅ đã đăng' : '✕ bỏ'} · {x.ten} · {x.loai === 'bai' ? 'bài' : `trả lời ${x.nguoiBl}`} · {gio(x.duyetLuc)} —{' '}
                <span className="text-ink-muted">{x.noiDung.slice(0, 120)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
