import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import { useToast } from '../components/Toaster';
import { Badge, EmptyState, PageHeader, SkeletonRows, type BadgeVariant } from '../components/ui';

interface Chunk {
  id: string;
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  customer: string;
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

interface Profile {
  key: string;
  customer: string;
  summary: string;
  builtAt: string;
}

const SOURCE_VI: Record<string, string> = {
  profile: 'Hồ sơ khách (tổng hợp)',
  customer_note: 'Lưu ý khách hàng',
  customer: 'Hồ sơ khách hàng',
  appointment: 'Lịch hẹn',
  task: 'Ghi chú công việc',
  chat: 'Hội thoại với trợ lý',
  document: 'Tài liệu',
};

const SOURCE_VARIANT: Record<string, BadgeVariant> = {
  profile: 'success',
  customer_note: 'info',
  customer: 'success',
  appointment: 'warn',
  task: 'neutral',
  chat: 'info',
  document: 'success',
};

const fmtD = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

/** Bỏ dòng ngữ cảnh "[Tiêu đề — KH: X — ngày]" ở đầu đoạn khi hiển thị (đã có ở cột riêng). */
function body(content: string): string {
  const nl = content.indexOf('\n');
  return nl > 0 && content.startsWith('[') ? content.slice(nl + 1) : content;
}

export default function Brain() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [openProfile, setOpenProfile] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [canDelete, setCanDelete] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  async function loadStats() {
    const [s, p] = await Promise.all([
      api<Stats>('/brain/stats'),
      api<{ profiles: Profile[] }>('/brain/profiles'),
    ]);
    setStats(s);
    setProfiles(p.profiles);
  }
  async function loadChunks() {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('q', keyword.trim());
    if (source) params.set('source', source);
    const r = await api<{ chunks: Chunk[]; canDelete: boolean }>(`/brain/chunks?${params}`);
    setChunks(r.chunks);
    setCanDelete(r.canDelete);
  }

  useEffect(() => {
    Promise.all([loadStats(), loadChunks()])
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Lọc lại khi đổi loại nguồn (từ khoá thì đợi bấm Tìm).
    loadChunks().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  async function search() {
    try {
      await loadChunks();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeChunk(id: string) {
    if (!window.confirm('Xoá mục này khỏi kho tri thức? Trợ lý sẽ không dùng nó để trả lời nữa.')) return;
    try {
      await api(`/brain/chunks/${id}`, { method: 'DELETE' });
      setChunks((l) => l.filter((c) => c.id !== id));
      toast.success('Đã xoá khỏi kho');
      await loadStats();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function sweepNow() {
    try {
      const r = await api<{ ingested: number; remaining: number }>('/brain/backfill', { body: {} });
      toast.success(
        r.ingested > 0
          ? `Đã nạp thêm ${r.ingested} mục${r.remaining > 0 ? `, còn ${r.remaining} mục` : ' — kho đã đầy đủ'}`
          : 'Không còn dữ liệu cũ nào cần nạp',
      );
      await Promise.all([loadStats(), loadChunks()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="🧠 Kho tri thức"
        desc="Những gì trợ lý AI đang ghi nhớ — tự động thu thập từ lưu ý khách hàng, CRM, ghi chú công việc và hội thoại."
        action={
          stats?.enabled && stats.remaining > 0 ? (
            <AsyncButton className="btn-ghost" onClick={sweepNow} busyLabel="Đang nạp…">
              Nạp ngay
            </AsyncButton>
          ) : null
        }
      />

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
              <span className="text-sm text-slate-500">mục đang được ghi nhớ</span>
            </div>
            {stats.remaining > 0 ? (
              <span className="text-sm text-amber-600">
                Còn {stats.remaining} mục đang chờ nạp — kho tự nạp dần khi mọi người dùng app.
              </span>
            ) : (
              <span className="text-sm text-emerald-600">Đã nạp đầy đủ dữ liệu hiện có ✓</span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.bySource.map((s) => (
              <button
                key={s.sourceType}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  source === s.sourceType
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
                onClick={() => setSource(source === s.sourceType ? '' : s.sourceType)}
              >
                {SOURCE_VI[s.sourceType] || s.sourceType}: <b>{s.count}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hồ sơ 360° — AI tự tổng hợp mọi thứ biết về từng khách */}
      {profiles.length > 0 && (
        <div className="card">
          <h2 className="font-semibold">📋 Hồ sơ khách hàng ({profiles.length})</h2>
          <p className="mb-3 text-sm text-slate-500">
            Bản tổng hợp tự động từ lưu ý, hồ sơ CRM, lịch hẹn và công việc đã làm. Trợ lý dùng bản này
            để trả lời khi anh hỏi về một khách cụ thể.
          </p>
          <ul className="divide-y">
            {profiles.map((p) => (
              <li key={p.key} className="py-2">
                <button
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setOpenProfile(openProfile === p.key ? null : p.key)}
                >
                  <span className="font-medium text-slate-800">{p.customer}</span>
                  <span className="whitespace-nowrap text-xs text-slate-400">
                    cập nhật {fmtD(p.builtAt)} {openProfile === p.key ? '▲' : '▼'}
                  </span>
                </button>
                {openProfile === p.key && (
                  <p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
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
          {source && (
            <button className="btn-ghost whitespace-nowrap" onClick={() => setSource('')}>
              Bỏ lọc “{SOURCE_VI[source] || source}”
            </button>
          )}
        </div>
      </div>

      {loading && <SkeletonRows rows={4} />}

      {!loading && chunks.length === 0 && stats?.enabled && (
        <div className="card">
          <EmptyState
            icon="🧠"
            text={
              keyword || source
                ? 'Không tìm thấy mục nào khớp.'
                : 'Kho chưa có gì. Cứ lưu lưu ý khách hàng hoặc ghi chú công việc — kho sẽ tự đầy.'
            }
          />
        </div>
      )}

      {chunks.map((c) => (
        <div key={c.id} className="card">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <div className="font-medium">{c.title || SOURCE_VI[c.sourceType] || c.sourceType}</div>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-slate-500">
                <Badge variant={SOURCE_VARIANT[c.sourceType] || 'neutral'}>
                  {SOURCE_VI[c.sourceType] || c.sourceType}
                </Badge>
                {c.customer && <span>KH: {c.customer}</span>}
                <span>{fmtD(c.createdAt)}</span>
              </div>
            </div>
            {canDelete && (
              <button className="text-xs text-rose-600 underline whitespace-nowrap" onClick={() => removeChunk(c.id)}>
                xoá khỏi kho
              </button>
            )}
          </div>
          <p
            className={`mt-2 whitespace-pre-wrap text-sm text-slate-600 ${open === c.id ? '' : 'line-clamp-3'}`}
            onClick={() => setOpen(open === c.id ? null : c.id)}
            role="button"
          >
            {body(c.content)}
          </p>
        </div>
      ))}
    </div>
  );
}
