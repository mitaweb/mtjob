import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { enablePush, pushStatus, type PushStatus } from '../lib/push';
import { useToast } from '../components/Toaster';
import { Badge, EmptyState, SkeletonRows } from '../components/ui';
import PushDiag from '../components/PushDiag';
import type { NotificationItem } from '../lib/types';
import { GIO_VN, NGAY_GIO_VN } from '../lib/gio';

// Gom thông báo theo nhóm để không bị trôi lẫn lộn — duyệt đơn là nhóm ồn nhất nên tách riêng.
type Group = 'request' | 'report' | 'remind' | 'work';

interface GroupDef {
  key: Group;
  label: string;
  types: string[];
  /** Trang mở khi bấm vào thông báo của nhóm này. */
  to: string;
  hint: string;
}

const GROUPS: GroupDef[] = [
  {
    key: 'request',
    label: '📋 Duyệt đơn',
    types: ['request'],
    to: '/approvals',
    hint: 'Đơn xin nghỉ / làm online cần duyệt và kết quả duyệt.',
  },
  {
    key: 'report',
    label: '📊 Báo cáo',
    types: ['daily', 'daily_team', 'daily_all', 'monthly', 'monthly_payroll'],
    to: '/dashboard',
    hint: 'Báo cáo công việc hằng ngày và hằng tháng.',
  },
  {
    key: 'remind',
    label: '⏰ Nhắc hẹn',
    types: ['reminder', 'appointment', 'finance_due', 'customer_birthday'],
    to: '/chat',
    hint: 'Nhắc hẹn cá nhân, lịch hẹn khách, thu tiền, sinh nhật khách.',
  },
  {
    key: 'work',
    label: '✅ Công việc',
    types: ['task_done', 'task_assigned', 'attendance', 'kyluat', 'brain_question', 'brain_answer', 'brain_pending', 'zalo_hoi'],
    to: '/chat',
    hint: 'Việc được giao, việc hoàn thành, chấm công, kho tri thức.',
  },
];

/** Cộng số chưa đọc của các loại thuộc một nhóm. */
function sumTypes(counts: Record<string, number>, g: Group): number {
  const def = GROUPS.find((x) => x.key === g)!;
  return def.types.reduce((s, t) => s + (counts[t] || 0), 0);
}

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('vi-VN', GIO_VN)
    : d.toLocaleString('vi-VN', NGAY_GIO_VN);
};

/**
 * Trang liên quan của TỪNG thông báo (anh Tâm 12/10/2026: "bấm vào mở trang liên quan thì ra ô chat, không
 * đúng chỗ") — trước đây mọi thông báo trong nhóm đều mở chung một trang.
 */
function noiDen(n: NotificationItem, macDinh: string): string {
  const ref = n.refId || '';
  if (ref.startsWith('ZR-K-')) return `/crm?kh=${encodeURIComponent(ref.slice(5))}`; // nhắc việc của một khách
  switch (n.type) {
    case 'reminder':
      return '/chat?nhac=1'; // nhắc hẹn cá nhân → mở danh sách nhắc hẹn
    case 'appointment':
    case 'customer_birthday':
      return '/crm';
    case 'finance_due':
      return '/finance';
    case 'attendance':
      return '/attendance';
    case 'kyluat':
      return '/scores';
    case 'zalo_hoi':
      return '/brain?tab=zalo';
    case 'brain_question':
      return '/brain?tab=hoi';
    case 'brain_pending':
      return '/brain?tab=duyet';
    case 'brain_answer':
      return '/brain';
    default:
      return macDinh;
  }
}

export default function Inbox() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Bấm thông báo đẩy mở thẳng đúng tab (vd nhắc hẹn → /inbox?tab=remind — anh Tâm 11/10/2026: "bấm vào thông
  // báo thì ra trang Chat chứ không ra tab thông báo").
  const [params] = useSearchParams();
  const tabUrl = params.get('tab');
  const [tab, setTab] = useState<Group>(
    tabUrl === 'request' || tabUrl === 'report' || tabUrl === 'remind' || tabUrl === 'work' ? tabUrl : 'request',
  );
  const [unread, setUnread] = useState<Record<Group, number>>({ request: 0, report: 0, remind: 0, work: 0 });
  const [push, setPush] = useState<PushStatus>('off');

  useEffect(() => {
    pushStatus().then(setPush).catch(() => undefined);
  }, []);

  /** Tải riêng từng nhóm: nhóm ồn (duyệt đơn) không lấn chỗ nhóm khác. */
  async function loadGroup(g: Group) {
    const def = GROUPS.find((x) => x.key === g)!;
    const r = await api<{ notifications: NotificationItem[] }>(
      `/notifications?types=${def.types.join(',')}&limit=50`,
    );
    setItems(r.notifications);
  }

  /** Số chưa đọc lấy từ máy chủ nên đếm đúng toàn bộ, không phụ thuộc số bản ghi tải về. */
  async function loadCounts() {
    const r = await api<{ counts: Record<string, number> }>('/notifications/unread-counts');
    setUnread({
      request: sumTypes(r.counts, 'request'),
      report: sumTypes(r.counts, 'report'),
      remind: sumTypes(r.counts, 'remind'),
      work: sumTypes(r.counts, 'work'),
    });
    return r.counts;
  }

  // Lần đầu: đếm trước để biết mở tab nào, rồi mới tải danh sách của tab đó.
  useEffect(() => {
    // Mở từ thông báo (?tab=) → đã biết tab: tải danh sách CÙNG LÚC với số đếm, không phải chờ (12/10/2026).
    if (tabUrl && GROUPS.some((g) => g.key === tabUrl)) {
      Promise.all([loadCounts(), loadGroup(tabUrl as Group)])
        .catch((e) => toast.error((e as Error).message))
        .finally(() => setLoading(false));
      return;
    }
    loadCounts()
      .then((counts) => {
        // Có ?tab= (bấm từ thông báo đẩy) thì mở đúng tab đó; không thì tab đầu tiên còn tin chưa đọc.
        const first = tabUrl && GROUPS.some((g) => g.key === tabUrl) ? (tabUrl as Group) : (GROUPS.find((g) => sumTypes(counts, g.key) > 0)?.key ?? 'request');
        setTab(first);
        return loadGroup(first);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đổi tab → tải danh sách của nhóm đó (bỏ qua lần đầu vì effect trên đã tải).
  useEffect(() => {
    if (loading) return;
    setItems([]);
    loadGroup(tab).catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const current = GROUPS.find((g) => g.key === tab)!;
  const shown = items;

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
    setItems((list) => list.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((u) => ({ ...u, [tab]: Math.max(0, u[tab] - 1) }));
  }

  async function markGroupRead() {
    try {
      await api('/notifications/read-all', { body: { types: current.types } });
      const now = new Date().toISOString();
      setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt || now })));
      setUnread((u) => ({ ...u, [tab]: 0 }));
      toast.success(`Đã đánh dấu đã đọc nhóm ${current.label}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Thông báo</h1>
        {push === 'on' ? (
          <span className="text-sm text-emerald-700" title="Thiết bị này đã nhận được thông báo đẩy">
            🔔 Đã bật thông báo đẩy
          </span>
        ) : push === 'unsupported' ? (
          <span className="text-sm text-ink-faint">Trình duyệt không hỗ trợ thông báo đẩy</span>
        ) : push === 'blocked' ? (
          <span className="text-sm text-amber-700" title="Mở cài đặt trình duyệt để cho phép lại">
            🔕 Trình duyệt đang chặn thông báo
          </span>
        ) : (
          <button
            className="btn-ghost text-sm"
            onClick={() =>
              enablePush()
                .then((r) => {
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.message);
                  return pushStatus().then(setPush);
                })
                .catch((e) => toast.error((e as Error).message))
            }
          >
            🔔 Bật đẩy
          </button>
        )}
      </div>

      <PushDiag />

      {/* Tabs theo nhóm — duyệt đơn tách riêng cho khỏi lẫn với báo cáo và nhắc hẹn */}
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-brand-100 p-1">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === g.key ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink-soft'
            }`}
            onClick={() => setTab(g.key)}
          >
            {g.label}
            {unread[g.key] > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 text-xs text-white">{unread[g.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-ink-muted">{current.hint}</span>
        {unread[tab] > 0 && (
          <button className="whitespace-nowrap text-xs text-brand-600 underline" onClick={markGroupRead}>
            Đánh dấu đã đọc ({unread[tab]})
          </button>
        )}
      </div>

      {loading && <SkeletonRows rows={4} />}

      {!loading && shown.length === 0 && (
        <div className="card">
          <EmptyState icon="🔕" text={`Chưa có thông báo nào trong nhóm ${current.label}.`} />
        </div>
      )}

      {shown.map((n) => (
        <div
          key={n.id}
          role="button"
          className={`card cursor-pointer ${n.readAt ? 'opacity-70' : 'border-brand-200'}`}
          onClick={() => !n.readAt && markRead(n.id)}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">
              {!n.readAt && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-500 align-middle" />}
              {n.title}
            </span>
            <span className="whitespace-nowrap text-xs text-ink-faint">{fmtWhen(n.createdAt)}</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm">{n.body}</div>
          <button
            className="mt-2 text-xs text-brand-600 underline"
            onClick={(e) => {
              e.stopPropagation();
              if (!n.readAt) markRead(n.id);
              navigate(noiDen(n, current.to));
            }}
          >
            Mở {current.key === 'request' ? 'trang duyệt đơn' : 'trang liên quan'} →
          </button>
        </div>
      ))}

      {!loading && shown.length > 0 && (
        <p className="text-center text-xs text-ink-faint">
          Hiển thị {shown.length} thông báo gần nhất của nhóm này.
        </p>
      )}
    </div>
  );
}
