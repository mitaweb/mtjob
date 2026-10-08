// Tab Zalo của Kho tri thức (anh Tâm 5/10 + 8/10/2026): đăng nhập Zalo cá nhân bằng QR, chọn cuộc
// trò chuyện nào cho app "học", rút tri thức vào kho. Nhóm khách ("TÊN KH - MT DIGITAL") do AI tự
// nhận ra, khớp/tạo khách ở CRM và kéo lịch sử cũ. Chỉ giám đốc.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge, EmptyState, SkeletonRows, type BadgeVariant } from './ui';

interface Cuoc {
  threadId: string;
  name: string;
  enabled: boolean;
  customer: string;
  msgCount: number;
  lastMsgAt: string;
  lastDigestAt: string;
  chuaRut: number;
  isGroup: boolean;
  aiChecked: boolean;
  aiNote: string;
  historyDone: boolean;
}

interface TrangThai {
  configured: boolean;
  needsMigrate?: boolean;
  status: string;
  qr: string;
  account: string;
  note: string;
  coPhien: boolean;
  lastSync?: string;
  threads: Cuoc[];
}

const NHAN: Record<string, { label: string; variant: BadgeVariant }> = {
  online: { label: 'Đã kết nối', variant: 'success' },
  waiting_qr: { label: 'Đang chờ quét QR', variant: 'warn' },
  scanned: { label: 'Đã quét — chờ xác nhận', variant: 'warn' },
  expired: { label: 'Phiên hết hạn', variant: 'danger' },
  error: { label: 'Lỗi', variant: 'danger' },
  offline: { label: 'Chưa đăng nhập', variant: 'neutral' },
};

const ngayGio = (iso: string) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

type Loc = 'hoc' | 'nhom' | 'rieng' | 'tat_ca';

export default function BrainZalo() {
  const toast = useToast();
  const [loc, setLoc] = useState<Loc | ''>('');
  const [tim, setTim] = useState('');
  const [st, setSt] = useState<TrangThai | null>(null);
  const [khach, setKhach] = useState<Record<string, string>>({});
  const [choQR, setChoQR] = useState(0); // mốc ms bắt đầu chờ QR (0 = không chờ)
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function tai() {
    const r = await api<TrangThai>('/zalo/status');
    setSt(r);
    setKhach((cu) => {
      const moi = { ...cu };
      for (const c of r.threads) if (moi[c.threadId] === undefined) moi[c.threadId] = c.customer;
      return moi;
    });
    return r;
  }

  useEffect(() => {
    tai().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đang chờ quét QR: hỏi trạng thái 2 giây/lần, tối đa 75 giây (máy chủ chỉ chờ ~52 giây).
  useEffect(() => {
    if (!choQR) return;
    const vong = async () => {
      const r = await tai().catch(() => null);
      const conCho = r && (r.status === 'waiting_qr' || r.status === 'scanned' || Date.now() - choQR < 6000);
      if (conCho && Date.now() - choQR < 75_000) hen.current = setTimeout(vong, 2000);
      else {
        setChoQR(0);
        if (r?.status === 'online') toast.success(`Đã đăng nhập Zalo${r.account ? ` — ${r.account}` : ''}`);
      }
    };
    hen.current = setTimeout(vong, 1500);
    return () => {
      if (hen.current) clearTimeout(hen.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choQR]);

  async function dangNhap() {
    try {
      await api('/zalo/login', { body: {} });
      setChoQR(Date.now());
      toast.info('Đang tạo mã QR…');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function dongBo() {
    try {
      const r = await api<{ ok: boolean; tin: number; note: string }>('/zalo/sync', { body: {} });
      if (r.ok) toast.success(r.note);
      else toast.error(r.note);
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Quét nhóm khách — mỗi lần máy chủ làm ~45 giây; còn việc thì gọi tiếp (tối đa 8 lần). */
  async function quetNhom() {
    try {
      for (let lan = 0; lan < 8; lan++) {
        const r = await api<{ ok: boolean; note: string; conLai: number }>('/zalo/groups', { body: {} });
        await tai();
        if (!r.ok) {
          toast.error(r.note);
          return;
        }
        if (!r.conLai) {
          toast.success(r.note);
          setLoc('nhom');
          return;
        }
        toast.info(r.note);
      }
      toast.info('Còn nhóm chưa xét xong — đêm nay app tự làm tiếp, hoặc bấm lại.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function rut(threadId?: string) {
    try {
      const r = await api<{ cuoc: number; y: number }>('/zalo/digest', { body: threadId ? { threadId } : {} });
      toast.success(r.cuoc ? `Đã rút ${r.y} ý từ ${r.cuoc} cuộc — xem ở tab Kho / Chờ duyệt` : 'Không có tin mới để rút');
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function dangXuat() {
    if (!window.confirm('Đăng xuất Zalo khỏi MTJOB? Phiên đăng nhập sẽ bị xoá, app ngừng đọc tin.')) return;
    try {
      await api('/zalo/logout', { body: {} });
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function suaCuoc(c: Cuoc, patch: { enabled?: boolean; customer?: string }) {
    if (patch.enabled === false && !window.confirm(`Tắt "${c.name || c.threadId}"? Nội dung tin đã lưu của cuộc này sẽ bị xoá (tri thức đã vào kho vẫn giữ).`)) return;
    try {
      await api(`/zalo/threads/${encodeURIComponent(c.threadId)}`, { body: patch });
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!st) return <div className="card"><SkeletonRows rows={4} /></div>;

  const nhan = NHAN[st.status] || NHAN.offline!;
  const anhQR = st.qr ? (st.qr.startsWith('data:') ? st.qr : `data:image/png;base64,${st.qr}`) : '';
  const cuocBat = st.threads.filter((c) => c.enabled);
  const soNhom = st.threads.filter((c) => c.isGroup).length;
  const locHienTai: Loc = loc || (cuocBat.length ? 'hoc' : 'tat_ca');
  const tuKhoa = tim.trim().toLowerCase();
  const hien = st.threads
    .filter((c) =>
      locHienTai === 'hoc' ? c.enabled : locHienTai === 'nhom' ? c.isGroup : locHienTai === 'rieng' ? !c.isGroup : true,
    )
    .filter((c) => !tuKhoa || `${c.name} ${c.customer}`.toLowerCase().includes(tuKhoa));
  const LOC: Array<[Loc, string, number]> = [
    ['hoc', 'Đang học', cuocBat.length],
    ['nhom', 'Nhóm', soNhom],
    ['rieng', 'Chat 1-1', st.threads.length - soNhom],
    ['tat_ca', 'Tất cả', st.threads.length],
  ];

  return (
    <div className="space-y-3">
      <div className="card border-amber-200 bg-amber-50 text-sm text-amber-900">
        ⚠️ Đây là kết nối <b>không chính thức</b> (giả lập Zalo Web). Zalo có thể khoá tài khoản nếu phát hiện. App chỉ <b>đọc</b> tin, không
        gửi tin hay làm gì thay anh. Đang mở Zalo trên trình duyệt (chat.zalo.me) thì lượt đồng bộ đó bị đẩy ra — Zalo điện thoại / PC không ảnh
        hưởng.
      </div>

      {!st.configured && (
        <div className="card border-rose-200 bg-rose-50 text-sm text-rose-800">
          Chưa cấu hình khoá mã hoá phiên. Vào Vercel → Settings → Environment Variables, thêm <b>ZALO_SESSION_KEY</b> = một chuỗi ngẫu nhiên dài
          ít nhất 32 ký tự, rồi Redeploy.
        </div>
      )}
      {st.needsMigrate && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
          Vào <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b> trước.
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">💬 Zalo</h2>
              <Badge variant={nhan.variant}>{nhan.label}</Badge>
              {st.account && <span className="text-sm text-ink-soft">{st.account}</span>}
            </div>
            {st.note && <p className="mt-0.5 text-xs text-ink-muted">{st.note}</p>}
            {st.lastSync && <p className="text-xs text-ink-faint">Đồng bộ gần nhất: {ngayGio(st.lastSync)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(!st.coPhien || st.status === 'expired') && (
              <AsyncButton className="btn-primary" onClick={dangNhap} busyLabel="…" disabled={!st.configured || !!choQR}>
                Đăng nhập Zalo
              </AsyncButton>
            )}
            {st.coPhien && (
              <>
                <AsyncButton className="btn-ghost" onClick={dongBo} busyLabel="Đang đồng bộ…">
                  🔄 Đồng bộ ngay
                </AsyncButton>
                <AsyncButton className="btn-ghost" onClick={quetNhom} busyLabel="AI đang xét nhóm…">
                  🔎 Quét nhóm khách
                </AsyncButton>
                <button className="btn-ghost text-rose-600" onClick={dangXuat}>
                  Đăng xuất
                </button>
              </>
            )}
          </div>
        </div>

        {(st.status === 'waiting_qr' || st.status === 'scanned') && anhQR && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-brand-100 bg-white p-4">
            <img src={anhQR} alt="Mã QR đăng nhập Zalo" className="h-56 w-56" />
            <p className="text-center text-sm text-ink-soft">
              {st.status === 'scanned' ? 'Đã quét — bấm Đăng nhập trên điện thoại.' : 'Mở Zalo trên điện thoại → biểu tượng QR → quét mã này.'}
            </p>
          </div>
        )}

        <p className="text-xs text-ink-muted">
          App chạy <b>mỗi đêm</b> (22h–5h): đồng bộ một lượt, quét nhóm mới, rồi AI xem xét các cuộc đã bật — lưu ý, yêu cầu của khách nào ổn
          thì đưa thẳng vào kho, điều chưa chắc thì vào tab Chờ duyệt.
        </p>
        <p className="text-xs text-ink-muted">
          <b>Nhóm khách</b>: AI tự nhận ra nhóm làm việc với khách (tên kiểu “TÊN KH - MT DIGITAL”, tên khác AI tự phán đoán), khớp với khách
          trong CRM — chưa có thì tạo mới — rồi bật học và <b>kéo lịch sử cũ</b> (~200 tin gần nhất mỗi nhóm). <b>Chat 1-1</b>: Zalo không cho
          lấy tin cũ trước lúc đăng nhập, chỉ có tin từ lúc kết nối trở đi.
        </p>
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Cuộc trò chuyện ({st.threads.length})</h3>
            <p className="text-xs text-ink-muted">
              Chat 1-1 mặc định <b>không học</b> — chỉ đếm số tin. Bật <b>Học</b> ở cuộc nào là khách thì app mới lưu nội dung, và ban đêm AI
              rút lưu ý, yêu cầu của khách đó vào kho tri thức. Nhóm khách AI bật sẵn; anh tắt/bật tay thì AI không đổi lại.
            </p>
          </div>
          {cuocBat.length > 0 && (
            <AsyncButton className="btn-ghost text-sm" onClick={() => rut()} busyLabel="AI đang đọc…">
              Rút tri thức ngay
            </AsyncButton>
          )}
        </div>
        {st.threads.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {LOC.map(([k, nhanLoc, so]) => (
              <button
                key={k}
                className={`rounded-full border px-3 py-1 text-xs ${locHienTai === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-ink-soft'}`}
                onClick={() => setLoc(k)}
              >
                {nhanLoc} ({so})
              </button>
            ))}
            <input className="input max-w-[12rem] py-1 text-sm" placeholder="Tìm tên…" value={tim} onChange={(e) => setTim(e.target.value)} />
          </div>
        )}
        {st.threads.length === 0 ? (
          <EmptyState icon="💬" text={st.coPhien ? 'Chưa có tin nào. Bấm Đồng bộ ngay hoặc Quét nhóm khách.' : 'Đăng nhập Zalo để bắt đầu.'} />
        ) : hien.length === 0 ? (
          <EmptyState icon="🔍" text="Không có cuộc nào khớp bộ lọc." />
        ) : (
          <ul className="divide-y">
            {hien.map((c) => (
              <li key={c.threadId} className="space-y-1.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {c.isGroup && <Badge variant="neutral">👥 Nhóm</Badge>}
                      <span className="truncate font-medium">{c.name || `(chưa rõ tên) ${c.threadId.slice(-6)}`}</span>
                    </div>
                    <div className="text-xs text-ink-faint">
                      {c.msgCount} tin{c.lastMsgAt ? ` · gần nhất ${ngayGio(c.lastMsgAt)}` : ''}
                      {c.enabled && c.chuaRut > 0 ? ` · ${c.chuaRut} tin chưa rút` : ''}
                      {c.isGroup && c.enabled && !c.historyDone ? ' · chờ kéo lịch sử' : ''}
                    </div>
                    {c.isGroup && c.aiChecked && c.aiNote && <div className="text-xs text-ink-muted">🤖 {c.aiNote}</div>}
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={c.enabled} onChange={(e) => suaCuoc(c, { enabled: e.target.checked })} />
                    Học
                  </label>
                </div>
                {c.enabled && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="input max-w-xs py-1 text-sm"
                      placeholder="Khách hàng trong CRM (vd: Savax Door)"
                      value={khach[c.threadId] ?? ''}
                      onChange={(e) => setKhach({ ...khach, [c.threadId]: e.target.value })}
                      onBlur={() => (khach[c.threadId] ?? '') !== c.customer && suaCuoc(c, { customer: khach[c.threadId] ?? '' })}
                    />
                    {c.chuaRut > 0 && (
                      <AsyncButton className="btn-ghost px-2 py-1 text-xs" onClick={() => rut(c.threadId)} busyLabel="…">
                        Rút ngay
                      </AsyncButton>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
