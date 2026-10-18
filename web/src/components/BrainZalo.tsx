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
  /** Lời anh giải thích cho AI về cuộc này. */
  anhGhiChu: string;
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
  const [choQR, setChoQR] = useState(0); // mốc ms bắt đầu chờ QR (0 = không chờ)
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "⚡ Cập nhật ngay": dòng tiến trình + cờ dừng.
  const [tienTrinh, setTienTrinh] = useState<string[]>([]);
  const [dangXuLy, setDangXuLy] = useState(false);
  // Tin gần đây đang mở xem, theo từng cuộc.
  const [dangXem, setDangXem] = useState<Record<string, TinXem[]>>({});
  // Lời anh giải thích cho AI (anh Tâm 11/10/2026: "những chỗ phân vân này anh sẽ comment vào để phần mềm hiểu").
  const [giaiThich, setGiaiThich] = useState<Record<string, string>>({});
  const [moGiaiThich, setMoGiaiThich] = useState<Record<string, boolean>>({});
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
        // Mỗi lần máy chủ chỉ lấy một phần (≤ 10 lô) cho vừa thời gian — còn tin thì lấy tiếp.
        for (let lan = 0; lan < 10 && !dung.current; lan++) {
          ghi(lan ? 'Lấy tiếp tin mới…' : 'Đang đồng bộ tin mới từ Zalo…');
          const s = await api<{ ok: boolean; note: string; conTin?: boolean }>('/zalo/sync', { body: {} });
          ghi(s.note);
          await tai();
          if (!s.ok || !s.conTin) break;
        }
      }
      let dungYen = 0;
      let truoc = '';
      let loiLienTiep = 0;
      for (let lan = 0; lan < 40 && !dung.current; lan++) {
        let r: { ok: boolean; buoc: string; note: string; con: { nhom: number; doc: number } };
        try {
          r = await api('/zalo/process', { body: {} });
          loiLienTiep = 0;
        } catch (e) {
          // Một lượt lỗi (vd máy chủ quá giờ khi tin dồn nhiều) → làm tiếp lượt sau; lỗi 3 lần liền mới dừng.
          loiLienTiep++;
          ghi(`Lượt này lỗi (${(e as Error).message.slice(0, 120)}) — ${loiLienTiep < 3 ? 'làm tiếp…' : 'dừng, app tự làm tiếp ở nền.'}`);
          if (loiLienTiep >= 3) break;
          continue;
        }
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
          ghi('Không tiến thêm được — app tự làm tiếp ở lượt sau.');
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

  async function suaCuoc(c: Cuoc, patch: { enabled?: boolean; customer?: string; ghiChu?: string }) {
    if (
      patch.enabled === false &&
      !c.aiHoi &&
      !window.confirm(`Cho AI bỏ qua "${c.name || c.threadId}"? Nội dung tin đã lưu của cuộc này sẽ bị xoá, AI thôi đọc (tri thức đã vào kho vẫn giữ).`)
    )
      return;
    try {
      await api(`/zalo/threads/${encodeURIComponent(c.threadId)}`, { body: patch });
      if (patch.ghiChu !== undefined && patch.enabled === undefined) toast.success('Đã lưu — AI sẽ đọc lời anh mỗi lần đọc cuộc này');
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
            {st.lastSync && (
              <p className="text-xs text-ink-faint">
                Đồng bộ gần nhất: {ngayGio(st.lastSync)}
                {st.coPhien && (
                  <>
                    {' · '}
                    <button className="underline hover:text-rose-600" onClick={dangXuat}>
                      đăng xuất Zalo
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
          {(!st.coPhien || st.status === 'expired') && (
            <AsyncButton className="btn-primary" onClick={dangNhap} busyLabel="…" disabled={!st.configured || !!choQR}>
              Đăng nhập Zalo
            </AsyncButton>
          )}
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
          <b>Mọi thứ tự chạy</b> — đồng bộ 30 phút/lần (đêm chỉ 5h sáng), tự lọc bỏ nhóm không liên quan, AI đọc tin mới, học việc công ty
          vào kho, cập nhật khách trong CRM, nhắc anh việc chưa làm. Anh chỉ cần quyết các cuộc <b>❓ AI hỏi</b>.
        </p>
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Cuộc trò chuyện ({dem.tat_ca})</h3>
            <p className="text-xs text-ink-muted">
              AI tự quyết học / bỏ qua. Ô <b>Học</b> chỉ để anh sửa khi AI xếp sai — AI ghi nhớ để lần sau tự quyết giống anh. Cuộc đang
              bỏ qua mà có tin công việc mới (báo giá, hợp đồng, dự án…) thì app tự mở lại cho AI đọc; cuộc anh đã tự bỏ qua thì AI hỏi anh.
            </p>
          </div>
          {dangXuLy ? (
            <button className="btn-ghost text-sm text-rose-600" onClick={() => (dung.current = true)}>
              ⏹ Dừng
            </button>
          ) : (
            <button className="btn-ghost text-sm" onClick={xuLyNgay} title="Không cần bấm — app tự chạy. Bấm khi muốn cập nhật ngay.">
              ⚡ Cập nhật ngay
            </button>
          )}
        </div>
        {tienTrinh.length > 0 && (
          <div className="mb-3 max-h-48 overflow-y-auto rounded-xl bg-brand-50 p-3 text-xs text-ink-soft">
            {tienTrinh.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
            {dangXuLy && <div className="text-ocean-700">⏳ AI đang làm…</div>}
          </div>
        )}
        {(dem.tat_ca > 0 || tim) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {LOC.map(([k, nhanLoc, so]) => (
              <button
                key={k}
                className={`rounded-full border px-3 py-1 text-xs ${locHienTai === k ? 'border-brand-500 bg-brand-50 text-ocean-700' : 'border-line text-ink-soft'}`}
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
                              ? 'AI chưa đọc — bấm ⚡ Đọc & phân loại ngay, hoặc AI tự đọc ở lượt tới'
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
                    <textarea
                      className="input mt-2 min-h-[3.5rem] text-sm"
                      placeholder="Anh giải thích cho AI (không bắt buộc) — vd: Nhi Lê là bạn trong BNI New Day, việc slide là hỗ trợ BNI, không phải khách; cuộc kiểu này thì học / bỏ qua…"
                      value={giaiThich[c.threadId] ?? c.anhGhiChu}
                      onChange={(e) => setGiaiThich({ ...giaiThich, [c.threadId]: e.target.value })}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <AsyncButton
                        className="btn-primary px-3 py-1 text-sm"
                        onClick={() => suaCuoc(c, { enabled: true, ghiChu: giaiThich[c.threadId] ?? c.anhGhiChu })}
                        busyLabel="…"
                      >
                        ✓ Học
                      </AsyncButton>
                      <AsyncButton
                        className="btn-ghost px-3 py-1 text-sm text-rose-600"
                        onClick={() => suaCuoc(c, { enabled: false, ghiChu: giaiThich[c.threadId] ?? c.anhGhiChu })}
                        busyLabel="…"
                      >
                        ✗ Bỏ qua
                      </AsyncButton>
                    </div>
                  </div>
                )}
                {!c.aiHoi && c.anhGhiChu && !moGiaiThich[c.threadId] && (
                  <div className="text-xs text-ink-muted">💬 Anh: {c.anhGhiChu}</div>
                )}
                <div className="flex flex-wrap gap-3">
                  {(c.aiHoi || c.chuaRut > 0 || c.enabled) && (
                    <button className="text-xs text-ocean-600 underline" onClick={() => xemTin(c)}>
                      {dangXem[c.threadId] ? 'Ẩn tin' : 'Xem tin gần đây'}
                    </button>
                  )}
                  {!c.aiHoi && (
                    <button className="text-xs text-ocean-600 underline" onClick={() => setMoGiaiThich({ ...moGiaiThich, [c.threadId]: !moGiaiThich[c.threadId] })}>
                      💬 {c.anhGhiChu ? 'Sửa lời giải thích' : 'Giải thích cho AI'}
                    </button>
                  )}
                </div>
                {!c.aiHoi && moGiaiThich[c.threadId] && (
                  <div className="flex flex-wrap items-start gap-2">
                    <textarea
                      className="input min-h-[3rem] max-w-xl flex-1 text-sm"
                      placeholder="vd: Đây là nhóm nội bộ team Ads — học quy trình, không phải khách"
                      value={giaiThich[c.threadId] ?? c.anhGhiChu}
                      onChange={(e) => setGiaiThich({ ...giaiThich, [c.threadId]: e.target.value })}
                    />
                    <AsyncButton
                      className="btn-primary px-3 py-1 text-sm"
                      onClick={async () => {
                        await suaCuoc(c, { ghiChu: giaiThich[c.threadId] ?? c.anhGhiChu });
                        setMoGiaiThich({ ...moGiaiThich, [c.threadId]: false });
                      }}
                      busyLabel="…"
                    >
                      Lưu
                    </AsyncButton>
                  </div>
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
                {c.enabled && c.customer && <div className="text-xs text-ink-muted">Khách: {c.customer}</div>}
              </li>
            ))}
          </ul>
        )}
        <PhanTrang trang={trang} tong={dem[locHienTai]} co={CO_TRANG} onDoi={(t) => doiBoLoc({ trang: t })} />
      </div>
    </div>
  );
}
