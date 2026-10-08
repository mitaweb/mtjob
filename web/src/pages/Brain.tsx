import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { upload } from '@vercel/blob/client';
import { api, getToken } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import { useToast } from '../components/Toaster';
import { Badge, EmptyState, PageHeader, SkeletonRows, type BadgeVariant } from '../components/ui';
import { useAuth } from '../lib/auth';
import {
  QuyTacKho,
  TabKho,
  TabKhach,
  TabGopY,
  TabDanhSach,
  TabCauHoi,
  DonKhoCu,
  type Nhom,
} from '../components/BrainKho';
import BrainZalo from '../components/BrainZalo';

interface Chunk {
  id: string;
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  customer: string;
  createdAt: string;
}

interface Profile {
  key: string;
  customer: string;
  summary: string;
  builtAt: string;
}

interface Doc {
  id: string;
  kind: string;
  name: string;
  customer: string;
  uploadedName: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  error: string;
  transcript: string;
  createdAt: string;
}

interface Stats {
  enabled: boolean;
  needsMigrate?: boolean;
  reason?: string;
  total: number;
  bySource: Array<{ sourceType: string; count: number }>;
  remaining: number;
}

const SOURCE_VI: Record<string, string> = {
  item: 'Mục tri thức (đã phân loại)',
  note: 'Bạn chốt từ hội thoại',
  auto: 'AI tự ghi nhận',
  sheet: 'Bảng từ Google Sheets',
  profile: 'Hồ sơ khách (tổng hợp)',
  customer_note: 'Lưu ý khách hàng',
  customer: 'Hồ sơ khách hàng',
  appointment: 'Lịch hẹn',
  task: 'Ghi chú công việc',
  chat: 'Hội thoại với trợ lý',
  document: 'Tài liệu',
};

const SOURCE_VARIANT: Record<string, BadgeVariant> = {
  item: 'success',
  note: 'info',
  auto: 'neutral',
  sheet: 'warn',
  profile: 'success',
  customer_note: 'info',
  customer: 'success',
  appointment: 'warn',
  task: 'neutral',
  chat: 'info',
  document: 'success',
};

const STATUS_VI: Record<Doc['status'], { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Đang chờ', variant: 'neutral' },
  processing: { label: 'AI đang đọc…', variant: 'warn' },
  done: { label: 'Đã vào kho', variant: 'success' },
  error: { label: 'Lỗi', variant: 'danger' },
};

const ACCEPT = '.pdf,.txt,.md,.csv,.jpg,.jpeg,.png,.webp';
const ROWS_PER_GROUP = 12; // hiện gọn, còn lại bấm xem thêm

const fmtD = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

/** Bỏ dòng ngữ cảnh "[Tiêu đề — KH: X — ngày]" ở đầu đoạn khi hiển thị (đã có ở cột riêng). */
function body(content: string): string {
  const nl = content.indexOf('\n');
  return nl > 0 && content.startsWith('[') ? content.slice(nl + 1) : content;
}

/** Một dòng tóm tắt cho danh sách gom nhóm. */
function oneLine(c: Chunk): string {
  return body(c.content).replace(/\s+/g, ' ').trim();
}

/** Tab "Tài liệu & dữ liệu": tài liệu tải lên, hồ sơ 360° khách, và mọi đoạn đang ghi nhớ (dạng thô). */
function DuLieuKho() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [canDelete, setCanDelete] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [openProfile, setOpenProfile] = useState<string | null>(null);
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [docCustomer, setDocCustomer] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadOverview() {
    const [s, p, d] = await Promise.all([
      api<Stats>('/brain/stats'),
      api<{ profiles: Profile[] }>('/brain/profiles'),
      api<{ documents: Doc[] }>('/brain/documents'),
    ]);
    setStats(s);
    setProfiles(p.profiles);
    setDocs(d.documents);
  }
  async function loadChunks() {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('q', keyword.trim());
    const r = await api<{ chunks: Chunk[]; canDelete: boolean }>(`/brain/chunks?${params}`);
    setChunks(r.chunks);
    setCanDelete(r.canDelete);
  }

  useEffect(() => {
    Promise.all([loadOverview(), loadChunks()])
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Còn tài liệu đang xử lý → tự làm mới để anh thấy trạng thái đổi, không phải F5.
  useEffect(() => {
    if (!docs.some((d) => d.status === 'pending' || d.status === 'processing')) return;
    const t = setTimeout(() => {
      loadOverview().catch(() => undefined);
    }, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  // Gom các mục theo loại nguồn: mỗi nhóm 1 ô, không rải mỗi mục một ô.
  const groups = useMemo(() => {
    const m = new Map<string, Chunk[]>();
    for (const c of chunks) {
      if (c.sourceType === 'profile') continue; // hồ sơ đã có khối riêng ở trên
      const arr = m.get(c.sourceType) || [];
      arr.push(c);
      m.set(c.sourceType, arr);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [chunks]);

  async function search() {
    try {
      await loadChunks();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeChunk(id: string) {
    if (!window.confirm('Xoá mục này khỏi kho? Trợ lý sẽ không dùng nó để trả lời nữa.')) return;
    try {
      await api(`/brain/chunks/${id}`, { method: 'DELETE' });
      setChunks((l) => l.filter((c) => c.id !== id));
      toast.success('Đã xoá khỏi kho');
      await loadOverview();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const blob = await upload(f.name, f, {
          access: 'public',
          handleUploadUrl: '/api/brain/upload',
          clientPayload: getToken() || '',
        });
        await api('/brain/documents', {
          body: { url: blob.url, name: f.name, mime: f.type, customer: docCustomer.trim() },
        });
      }
      toast.success('Đã tải lên — AI đang đọc nội dung, vài chục giây nữa sẽ vào kho.');
      setDocCustomer('');
      await loadOverview();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function retryDoc(id: string) {
    try {
      await api(`/brain/documents/${id}/retry`, { body: {} });
      toast.success('Đang xử lý lại…');
      setDocs((l) => l.map((d) => (d.id === id ? { ...d, status: 'processing', error: '' } : d)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeDoc(id: string) {
    if (!window.confirm('Xoá tài liệu này và nội dung của nó khỏi kho?')) return;
    try {
      await api(`/brain/documents/${id}`, { method: 'DELETE' });
      setDocs((l) => l.filter((d) => d.id !== id));
      toast.success('Đã xoá tài liệu');
      await loadOverview();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function sweepNow() {
    try {
      const r = await api<{ ingested: number; remaining: number }>('/brain/backfill', { body: {} });
      toast.success(
        r.ingested > 0
          ? `Đã nạp thêm ${r.ingested} mục${r.remaining > 0 ? `, còn ${r.remaining}` : ' — kho đã đầy đủ'}`
          : 'Không còn dữ liệu cũ nào cần nạp',
      );
      await Promise.all([loadOverview(), loadChunks()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {stats?.enabled && stats.remaining > 0 && (
        <div className="flex justify-end">
          <AsyncButton className="btn-ghost" onClick={sweepNow} busyLabel="Đang nạp…">
            Nạp ngay
          </AsyncButton>
        </div>
      )}

      {stats && !stats.enabled && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
          <div className="font-medium">Kho tri thức chưa sẵn sàng</div>
          <p className="mt-1">{stats.reason || 'Chưa cấu hình.'}</p>
          {stats.needsMigrate && (
            <a className="btn-primary mt-3 inline-flex" href="/admin">
              Mở trang Quản trị
            </a>
          )}
        </div>
      )}

      {stats?.enabled && (
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <span className="text-2xl font-bold text-brand-600">{stats.total}</span>{' '}
              <span className="text-sm text-ink-muted">đoạn đang được ghi nhớ (mục tri thức + hồ sơ + tài liệu)</span>
            </div>
            {stats.remaining > 0 ? (
              <span className="text-sm text-amber-700">Còn {stats.remaining} mục đang chờ nạp (tự nạp dần)</span>
            ) : (
              <span className="text-sm text-emerald-700">Đã nạp đầy đủ ✓</span>
            )}
          </div>
        </div>
      )}

      {/* Tải tài liệu lên */}
      <div className="card">
        <h2 className="font-semibold">📎 Tải tài liệu vào kho</h2>
        <p className="mb-3 text-sm text-ink-muted">
          PDF, ảnh chụp (hợp đồng, báo giá), file text — tối đa 10MB. AI sẽ đọc nội dung và đưa vào kho để
          trả lời được các câu hỏi trong tài liệu.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label className="label" htmlFor="doc-customer">
              Gắn với khách hàng (tuỳ chọn)
            </label>
            <input
              id="doc-customer"
              className="input"
              placeholder="vd: Ba Spa"
              value={docCustomer}
              onChange={(e) => setDocCustomer(e.target.value)}
            />
          </div>
          <p className="w-full text-xs text-ink-muted">
            Excel/Google Sheets: dán link sheet thẳng cho trợ lý (“cập nhật sheet này vào kho”) hoặc xuất ra
            CSV rồi tải lên — dữ liệu bảng giữ được quan hệ hàng–cột nên tra cứu chính xác hơn PDF.
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <button
            className="btn-primary whitespace-nowrap"
            disabled={uploading || !stats?.enabled}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Đang tải lên…' : '＋ Chọn tệp'}
          </button>
        </div>

        {docs.length > 0 && (
          <ul className="mt-3 divide-y border-t border-brand-100 pt-1">
            {docs.map((d) => (
              <li key={d.id} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setOpenDoc(openDoc === d.id ? null : d.id)}
                  >
                    <div className="truncate text-sm font-medium text-ink">
                      {d.kind === 'pdf' ? '📄' : d.kind === 'image' ? '🖼' : '📃'} {d.name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <Badge variant={STATUS_VI[d.status].variant}>{STATUS_VI[d.status].label}</Badge>
                      {d.customer && <span>KH: {d.customer}</span>}
                      <span>{d.uploadedName}</span>
                      <span>{fmtD(d.createdAt)}</span>
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-2 text-xs">
                    {d.status === 'error' && (
                      <button className="text-brand-600 underline" onClick={() => retryDoc(d.id)}>
                        xử lý lại
                      </button>
                    )}
                    <button className="text-rose-600 underline" onClick={() => removeDoc(d.id)}>
                      xoá
                    </button>
                  </div>
                </div>
                {d.status === 'error' && d.error && (
                  <p className="mt-1 text-xs text-rose-600">{d.error}</p>
                )}
                {openDoc === d.id && d.transcript && (
                  <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
                    {d.transcript}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Hồ sơ 360° */}
      {profiles.length > 0 && (
        <div className="card">
          <h2 className="font-semibold">📋 Hồ sơ khách hàng ({profiles.length})</h2>
          <p className="mb-2 text-sm text-ink-muted">
            Bản tổng hợp tự động từ lưu ý khách hàng, CRM và lịch hẹn.
          </p>
          <ul className="divide-y">
            {profiles.map((p) => (
              <li key={p.key} className="py-2">
                <button
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setOpenProfile(openProfile === p.key ? null : p.key)}
                >
                  <span className="font-medium text-ink">{p.customer}</span>
                  <span className="whitespace-nowrap text-xs text-ink-faint">
                    {fmtD(p.builtAt)} {openProfile === p.key ? '▲' : '▼'}
                  </span>
                </button>
                {openProfile === p.key && (
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
                    {p.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="flex gap-2 flex-wrap">
          <input
            className="input"
            placeholder="Tìm trong kho (vd: tên khách, gói dịch vụ…)"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
          />
          <AsyncButton className="btn-primary whitespace-nowrap" onClick={search} busyLabel="Đang tìm…">
            Tìm
          </AsyncButton>
        </div>
      </div>

      {loading && <SkeletonRows rows={4} />}

      {!loading && groups.length === 0 && stats?.enabled && (
        <div className="card">
          <EmptyState
            icon="🧠"
            text={keyword ? 'Không tìm thấy mục nào khớp.' : 'Kho chưa có gì. Cứ lưu lưu ý khách hàng hoặc tải tài liệu lên — kho sẽ tự đầy.'}
          />
        </div>
      )}

      {/* Mỗi loại nguồn = 1 ô, danh sách gọn bên trong */}
      {groups.map(([type, items]) => {
        const isCollapsed = collapsed[type];
        const shown = expanded[type] ? items : items.slice(0, ROWS_PER_GROUP);
        return (
          <div key={type} className="card">
            <button
              className="flex w-full items-center justify-between gap-2 text-left"
              onClick={() => setCollapsed((s) => ({ ...s, [type]: !s[type] }))}
            >
              <span className="flex items-center gap-2 font-semibold">
                <Badge variant={SOURCE_VARIANT[type] || 'neutral'}>{SOURCE_VI[type] || type}</Badge>
                <span className="text-sm font-normal text-ink-muted">{items.length} mục</span>
              </span>
              <span className="text-xs text-ink-faint">{isCollapsed ? '▼' : '▲'}</span>
            </button>

            {!isCollapsed && (
              <>
                <ul className="mt-2 divide-y">
                  {shown.map((c) => (
                    <li key={c.id} className="py-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setOpenChunk(openChunk === c.id ? null : c.id)}
                        >
                          <span className="block truncate text-sm text-ink-soft">{oneLine(c)}</span>
                          <span className="text-xs text-ink-faint">
                            {c.customer ? `${c.customer} · ` : ''}
                            {fmtD(c.createdAt)}
                          </span>
                        </button>
                        {canDelete && (
                          <button
                            className="shrink-0 text-xs text-rose-600 underline"
                            onClick={() => removeChunk(c.id)}
                          >
                            xoá
                          </button>
                        )}
                      </div>
                      {openChunk === c.id && (
                        <p className="mt-1 whitespace-pre-wrap rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
                          {body(c.content)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                {items.length > ROWS_PER_GROUP && (
                  <button
                    className="mt-2 text-sm text-brand-600 underline"
                    onClick={() => setExpanded((s) => ({ ...s, [type]: !s[type] }))}
                  >
                    {expanded[type] ? 'Thu gọn' : `Xem thêm ${items.length - ROWS_PER_GROUP} mục`}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Trang Kho tri thức: "bộ não thứ hai" của công ty (anh Tâm 4/10/2026) ──

type TabKey = 'kho' | 'khach' | 'gop' | 'duyet' | 'hoi' | 'rieng' | 'zalo' | 'tailieu';

export default function Brain() {
  const { user } = useAuth();
  const isDirector = user?.role === 'director' || user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'kho';
  const [nhomList, setNhomList] = useState<Nhom[]>([]);
  const [dem, setDem] = useState({ pending: 0, openQuestions: 0 });
  const [needsMigrate, setNeedsMigrate] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  async function taiNhom() {
    const r = await api<{ categories: Nhom[]; pending: number; openQuestions: number; needsMigrate?: boolean }>('/brain/categories');
    setNhomList(r.categories);
    setDem({ pending: r.pending, openQuestions: r.openQuestions });
    setNeedsMigrate(!!r.needsMigrate);
  }
  useEffect(() => {
    taiNhom().catch(() => undefined);
  }, [reloadKey]);
  const doi = () => setReloadKey((k) => k + 1);

  // Tab Zalo: CHỈ giám đốc (anh Tâm 8/10/2026: "chỉ giám đốc thấy được tab zalo này thôi") — kể cả
  // admin cũng không. Máy chủ chặn tương tự ở /api/zalo.
  const laGiamDoc = user?.role === 'director';
  const tabs: Array<{ key: TabKey; label: string; chiGd?: boolean; chiGiamDoc?: boolean }> = [
    { key: 'kho', label: '📘 Kho' },
    { key: 'khach', label: '👤 Khách hàng' },
    { key: 'gop', label: '✍️ Đóng góp' },
    { key: 'duyet', label: `⏳ Chờ duyệt${dem.pending ? ` (${dem.pending})` : ''}`, chiGd: true },
    { key: 'hoi', label: `❓ Câu hỏi${dem.openQuestions ? ` (${dem.openQuestions})` : ''}`, chiGd: true },
    { key: 'rieng', label: '🔒 Riêng anh', chiGd: true },
    { key: 'zalo', label: '💬 Zalo', chiGiamDoc: true },
    { key: 'tailieu', label: '📎 Tài liệu & dữ liệu' },
  ];
  const hien = tabs.filter((t) => (t.chiGiamDoc ? laGiamDoc : !t.chiGd || isDirector));
  const dangXem = hien.some((t) => t.key === tab) ? tab : 'kho';

  return (
    <div className="space-y-4">
      <PageHeader
        title="🧠 Kho tri thức"
        desc="Bộ não thứ hai của công ty — trợ lý AI trả lời nhân viên từ đây. Mỗi mục được AI đọc, xếp nhóm, gắn đúng khách và quyết định ai xem được."
      />

      {needsMigrate && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
          Kho tri thức cần cập nhật cấu trúc. Vào <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b>.
        </div>
      )}

      {/* Thanh tab cuộn ngang riêng — không làm cả trang tràn ngang trên điện thoại. */}
      <div className="-mx-1 overflow-x-auto">
        <div className="flex gap-1.5 px-1 pb-1">
          {hien.map((t) => (
            <button
              key={t.key}
              className={`whitespace-nowrap rounded-xl border px-3 py-1.5 text-sm ${
                dangXem === t.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200 bg-white text-ink-soft'
              }`}
              onClick={() => setParams(t.key === 'kho' ? {} : { tab: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isDirector && <DonKhoCu onChanged={doi} />}

      {dangXem === 'kho' && (
        <>
          <QuyTacKho />
          <TabKho nhomList={nhomList} isDirector={isDirector} reloadKey={reloadKey} onChanged={doi} />
        </>
      )}
      {dangXem === 'khach' && <TabKhach nhomList={nhomList} isDirector={isDirector} onChanged={doi} />}
      {dangXem === 'gop' && (
        <>
          <QuyTacKho />
          <TabGopY nhomList={nhomList} onChanged={doi} />
        </>
      )}
      {dangXem === 'duyet' && <TabDanhSach status="pending" nhomList={nhomList} rong="Không có mục nào chờ duyệt." onChanged={doi} />}
      {dangXem === 'hoi' && <TabCauHoi onChanged={doi} />}
      {dangXem === 'rieng' && (
        <TabDanhSach status="published" category="rieng" nhomList={nhomList} rong="Chưa có mục riêng nào." onChanged={doi} />
      )}
      {dangXem === 'zalo' && laGiamDoc && <BrainZalo />}
      {dangXem === 'tailieu' && <DuLieuKho />}
    </div>
  );
}
