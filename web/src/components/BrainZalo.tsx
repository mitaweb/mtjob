// Tab Zalo của Kho tri thức (anh Tâm 5/10, 8/10, 10/10/2026): đăng nhập Zalo cá nhân bằng QR; AI tự đọc
// mọi cuộc — công việc thì học + cập nhật khách + nhắc việc, cá nhân thì bỏ qua. Trước 10/10: chọn cuộc
// trò chuyện nào cho app "học", rút tri thức vào kho. Nhóm khách ("TÊN KH - MT DIGITAL") do AI tự
// nhận ra, khớp/tạo khách ở CRM và kéo lịch sử cũ. Chỉ giám đốc.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge, EmptyState, PhanTrang, SkeletonRows, type BadgeVariant } from './ui';

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
  /** AI phân vân (50:50) — chờ anh quyết. */
  aiHoi: boolean;
  /** 'hoc' | 'bo' khi anh đã tự quyết. */
  anhQuyet: string;
  tomTat: string;
}

interface TinXem {
  msgId: string;
  fromSelf: boolean;
  sender: string;
  content: string;
  ts: string;
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
  /** Số cuộc theo từng bộ lọc (đã áp ô tìm). */
  dem?: Record<Loc, number>;
  /** Bộ lọc máy chủ đã dùng (chưa chọn gì thì máy chủ tự chọn). */
  loc?: Loc;
}

const CO_TRANG = 30;

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

type Loc = 'hoi' | 'hoc' | 'bo' | 'nhom' | 'rieng' | 'tat_ca';

export default function BrainZalo() {
  const toast = useToast();
  const [loc, setLocState] = useState<Loc | ''>('');
  const [tim, setTim] = useState('');
  const [trang, setTrangState] = useState(1);
  const [st, setSt] = useState<TrangThai | null>(null);
  const [khach, setKhach] = useState<Record<string, string>>({});
  const [choQR, setChoQR] = useState(0); // mốc ms bắt đầu chờ QR (0 = không chờ)
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "⚡ Đọc & phân loại ngay": dòng tiến trình + cờ dừng.
  const [tienTrinh, setTienTrinh] = useState<string[]>([]);
  const [dangXuLy, setDangXuLy] = useState(false);
  // Tin gần đây đang mở xem, theo từng cuộc.
  const [dangXem, setDangXem] = useState<Record<string, TinXem[]>>({});
  const dung = useRef(false);
  // Bộ lọc hiện tại — tai() được gọi từ nhiều chỗ (cả vòng chờ QR), đọc qua ref cho khỏi cũ.
  const boLoc = useRef<{ loc: Loc | ''; tim: string; trang: number }>({ loc: '', tim: '', trang: 1 });

  async function tai() {
    const { loc: l, tim: t, trang: p } = boLoc.current;
    const qs = new URLSearchParams({ page: String(p), size: String(CO_TRANG) });
    if (l) qs.set('loc', l);
    if (t.trim()) qs.set('q', t.trim());
    const r = await api<TrangThai>(`/zalo/status?${qs}`);
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

  function doiBoLoc(p: Partial<{ loc: Loc | ''; tim: string; trang: number }>) {
    boLoc.current = { ...boLoc.current, ...p };
    if (p.loc !== undefined) setLocState(p.loc);
    if (p.trang !== undefined) setTrangState(p.trang);
    tai().catch((e) => toast.error((e as Error).message));
  }
  const setLoc = (l: Loc) => doiBoLoc({ loc: l, trang: 1 });

  // Gõ tìm: đợi ngừng gõ 350ms rồi mới hỏi máy chủ.
  useEffect(() => {
    if (tim === boLoc.current.tim) return;
    const h = setTimeout(() => doiBoLoc({ tim, trang: 1 }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tim]);

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

  /**
   * Đọc & phân loại ngay (anh Tâm 10/10/2026: "không cần chờ đến tối"): đồng bộ tin mới một lượt, rồi
   * gọi lặp từng bước ~40 giây — xét nhóm → AI đọc cuộc → AI xét lại mục chờ — tới khi xong.
   */
  async function xuLyNgay() {
    dung.current = false;
    setDangXuLy(true);
    const ghi = (d: string) => setTienTrinh((cu) => [...cu, `${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} · ${d}`]);
    setTienTrinh([]);
    try {
      if (st?.coPhien) {
        ghi('Đang đồng bộ tin mới từ Zalo…');
        const s = await api<{ ok: boolean; note: string }>('/zalo/sync', { body: {} });
        ghi(s.note);
        await tai();
      }
      let dungYen = 0;
      let truoc = '';
      for (let lan = 0; lan < 40 && !dung.current; lan++) {
        const r = await api<{ ok: boolean; buoc: string; note: string; con: { nhom: number; doc: number } }>('/zalo/process', { body: {} });
        ghi(`${r.note}${r.buoc !== 'xong' ? ` — còn ${r.con.nhom} việc nhóm, ${r.con.doc} cuộc chưa đọc` : ''}`);
        await tai();
        if (!r.ok) {
          toast.error(r.note.slice(0, 200));
          break;
        }
        if (r.buoc === 'xong') {
          toast.success('Đã đọc và phân loại xong');
          break;
        }
        const bay = `${r.buoc}:${r.con.nhom}:${r.con.doc}`;
        dungYen = bay === truoc ? dungYen + 1 : 0;
        truoc = bay;
        if (dungYen >= 3) {
          ghi('Không tiến thêm được — để đêm nay app tự làm tiếp.');
          break;
        }
      }
      if (dung.current) ghi('Đã dừng theo yêu cầu.');
    } catch (e) {
      ghi(`Lỗi: ${(e as Error).message}`);
      toast.error((e as Error).message);
    } finally {
      setDangXuLy(false);
    }
  }

  async function rut(threadId?: string) {
    try {
      const r = await api<{ cuoc: number; y: number; nhac?: number; caNhan?: number }>('/zalo/digest', { body: threadId ? { threadId } : {} });
      toast.success(
        r.cuoc
          ? `AI đã đọc ${r.cuoc} cuộc: ${r.y} ý vào kho${r.nhac ? `, ${r.nhac} nhắc việc cho anh` : ''}${r.caNhan ? `, ${r.caNhan} cuộc cá nhân bỏ qua` : ''}`
          : 'Không có tin mới để đọc',
      );
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

  /** Mở/đóng vài tin gần đây của một cuộc — để anh biết nội dung mà quyết. */
  async function xemTin(c: Cuoc) {
    if (dangXem[c.threadId]) {
      setDangXem((cu) => {
        const m = { ...cu };
        delete m[c.threadId];
        return m;
      });
      return;
    }
    try {
      const r = await api<{ messages: TinXem[] }>(`/zalo/threads/${encodeURIComponent(c.threadId)}/messages`);
      setDangXem((cu) => ({ ...cu, [c.threadId]: r.messages }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function suaCuoc(c: Cuoc, patch: { enabled?: boolean; customer?: string }) {
    if (
      patch.enabled === false &&
      !c.aiHoi &&
      !window.confirm(`Cho AI bỏ qua "${c.name || c.threadId}"? Nội dung tin đã lưu của cuộc này sẽ bị xoá, AI thôi đọc (tri thức đã vào kho vẫn giữ).`)
    )
      return;
    try {
      await api(`/zalo/threads/${encodeURIComponent(c.threadId)}`, { body: patch });
      if (c.aiHoi && patch.enabled !== undefined) {
        toast.success(patch.enabled ? `Đã chọn học "${c.name}" — AI sẽ đọc lại tin của cuộc này` : `Đã bỏ qua "${c.name}"`);
      }
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!st) return <div className="card"><SkeletonRows rows={4} /></div>;

  const nhan = NHAN[st.status] || NHAN.offline!;
  const anhQR = st.qr ? (st.qr.startsWith('data:') ? st.qr : `data:image/png;base64,${st.qr}`) : '';
  const dem: Record<Loc, number> = { hoi: 0, hoc: 0, bo: 0, nhom: 0, rieng: 0, tat_ca: 0, ...st.dem };
  const locHienTai: Loc = loc || st.loc || 'tat_ca';
  const hien = st.threads;
  const LOC: Array<[Loc, string, number]> = [
    ['hoi', '❓ Cần anh quyết', dem.hoi],
    ['hoc', 'Đang học', dem.hoc],
    ['bo', 'Bỏ qua', dem.bo],
    ['nhom', 'Nhóm', dem.nhom],
    ['rieng', 'Chat 1-1', dem.rieng],
    ['tat_ca', 'Tất cả', dem.tat_ca],
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
          App <b>tự đồng bộ 3 tiếng/lần</b> cả ngày. <b>Ban đêm</b> (22h–5h) AI <b>tự đọc mọi cuộc</b>, anh không cần bật gì:
        </p>
        <ul className="ml-4 list-disc text-xs text-ink-muted">
          <li>
            <b>Công việc</b> → tự học vào kho (yêu cầu, lưu ý, điều đã chốt của khách…); điều <b>phân vân</b> mới vào tab Chờ duyệt cho anh.
          </li>
          <li>
            <b>Cập nhật khách</b>: khớp khách trong CRM (khách mới thì tạo), thêm điều mới vào “Thông tin khách” — không xoá điều anh đã ghi.
          </li>
          <li>
            <b>Nhắc anh</b> khi có việc chưa làm — vd khách hỏi báo giá chưa trả lời, hứa gửi tài liệu, hẹn gọi lại (xem ở Nhắc hẹn).
          </li>
          <li>
            <b>Cá nhân</b> (gia đình, bạn bè, hội nhóm) → AI thôi đọc và xoá nội dung đã lưu.
          </li>
        </ul>
        <p className="text-xs text-ink-muted">
          <b>Nhóm khách</b>: AI tự nhận ra nhóm làm việc với khách (tên kiểu “TÊN KH - MT DIGITAL”, tên khác AI tự phán đoán), khớp với khách
          trong CRM — chưa có thì tạo mới — rồi bật học và <b>kéo lịch sử cũ</b> (~200 tin gần nhất mỗi nhóm). <b>Chat 1-1</b>: Zalo không cho
          lấy tin cũ trước lúc đăng nhập, chỉ có tin từ lúc kết nối trở đi.
        </p>
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Cuộc trò chuyện ({dem.tat_ca})</h3>
            <p className="text-xs text-ink-muted">
              AI <b>tự quyết</b>: liên quan công việc thì học, nhóm chợ / không liên quan thì bỏ qua không đọc. Chỉ cuộc AI phân vân
              (50:50) mới vào <b>❓ Cần anh quyết</b> — anh chọn Học / Bỏ qua, AI ghi nhớ để lần sau tự quyết giống anh. Ô <b>Học</b> để anh sửa
              khi AI xếp sai.
            </p>
          </div>
          {dangXuLy ? (
              <button className="btn-ghost text-sm text-rose-600" onClick={() => (dung.current = true)}>
                ⏹ Dừng
              </button>
            ) : (
              <button className="btn-primary text-sm" onClick={xuLyNgay}>
                ⚡ Đọc & phân loại ngay
              </button>
            )}
        </div>
        {tienTrinh.length > 0 && (
          <div className="mb-3 max-h-48 overflow-y-auto rounded-xl bg-brand-50 p-3 text-xs text-ink-soft">
            {tienTrinh.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
            {dangXuLy && <div className="text-brand-700">⏳ AI đang làm…</div>}
          </div>
        )}
        {(dem.tat_ca > 0 || tim) && (
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
        {dem.tat_ca === 0 && !tim ? (
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
                      {c.chuaRut > 0 ? ` · ${c.chuaRut} tin AI chưa đọc` : ''}
                      {c.isGroup && c.enabled && !c.historyDone ? ' · chờ kéo lịch sử' : ''}
                    </div>
                    {c.anhQuyet ? (
                      <div className="text-xs text-ink-muted">
                        👤 Anh đã chọn {c.anhQuyet === 'hoc' ? 'học' : 'bỏ qua'}
                        {c.tomTat ? ` — ${c.tomTat}` : ''}
                      </div>
                    ) : (
                      !c.aiHoi && (
                        <div className="text-xs text-ink-muted">
                          🤖{' '}
                          {c.aiChecked || /^(AI chưa rõ|Chưa rõ theo tên)/.test(c.aiNote)
                            ? c.aiNote || (c.enabled ? 'Đang học' : 'Bỏ qua')
                            : c.chuaRut > 0
                              ? 'AI chưa đọc — bấm ⚡ Đọc & phân loại ngay, hoặc đêm nay AI tự đọc'
                              : 'Chưa có nội dung để đọc (tin trước 10/10 chỉ được đếm, không lưu) — AI đọc khi có tin mới'}
                        </div>
                      )
                    )}
                  </div>
                  {!c.aiHoi && (
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={c.enabled} onChange={(e) => suaCuoc(c, { enabled: e.target.checked })} />
                      Học
                    </label>
                  )}
                </div>
                {c.aiHoi && (
                  <div className="rounded-xl bg-amber-50 p-3 text-sm">
                    <div className="text-amber-900">
                      ❓ <b>AI phân vân:</b> {c.aiNote.replace(/^Hỏi anh:\s*/, '')}
                    </div>
                    {c.tomTat && <div className="text-xs text-ink-soft">Nội dung: {c.tomTat}</div>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <AsyncButton className="btn-primary px-3 py-1 text-sm" onClick={() => suaCuoc(c, { enabled: true })} busyLabel="…">
                        ✓ Học
                      </AsyncButton>
                      <AsyncButton className="btn-ghost px-3 py-1 text-sm text-rose-600" onClick={() => suaCuoc(c, { enabled: false })} busyLabel="…">
                        ✗ Bỏ qua
                      </AsyncButton>
                    </div>
                  </div>
                )}
                {(c.aiHoi || c.chuaRut > 0 || c.enabled) && (
                  <button className="text-xs text-brand-600 underline" onClick={() => xemTin(c)}>
                    {dangXem[c.threadId] ? 'Ẩn tin' : 'Xem tin gần đây'}
                  </button>
                )}
                {dangXem[c.threadId] && (
                  <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl border border-brand-100 bg-white p-2 text-xs">
                    {dangXem[c.threadId]!.length === 0 ? (
                      <div className="text-ink-faint">Không có tin nào được lưu.</div>
                    ) : (
                      dangXem[c.threadId]!.map((t) => (
                        <div key={t.msgId}>
                          <span className="text-ink-faint">{ngayGio(new Date(Number(t.ts)).toISOString())} </span>
                          <b>{t.fromSelf ? 'Anh' : t.sender || c.name}:</b> {t.content}
                        </div>
                      ))
                    )}
                  </div>
                )}
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
                        Đọc ngay
                      </AsyncButton>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <PhanTrang trang={trang} tong={dem[locHienTai]} co={CO_TRANG} onDoi={(t) => doiBoLoc({ trang: t })} />
      </div>
    </div>
  );
}
