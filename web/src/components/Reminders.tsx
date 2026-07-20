import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge } from './ui';

// Nhắc hẹn cá nhân: chỉ người tạo nhận được thông báo.

export type RepeatKind = 'once' | 'daily' | 'weekly' | 'monthly';

export interface Reminder {
  id: string;
  title: string;
  atTime: string;
  repeatKind: RepeatKind;
  onDate: string;
  weekday: number;
  dayOfMonth: number;
  active: boolean;
}

const REPEATS: Array<{ key: RepeatKind; label: string }> = [
  { key: 'daily', label: 'Hằng ngày' },
  { key: 'weekly', label: 'Hằng tuần' },
  { key: 'monthly', label: 'Hằng tháng' },
  { key: 'once', label: 'Một lần' },
];
const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export function describe(r: Reminder): string {
  switch (r.repeatKind) {
    case 'daily':
      return `Hằng ngày lúc ${r.atTime}`;
    case 'weekly':
      return `Hằng tuần ${WEEKDAYS[r.weekday] || ''} lúc ${r.atTime}`;
    case 'monthly':
      return `Hằng tháng ngày ${r.dayOfMonth} lúc ${r.atTime}`;
    default:
      return `Một lần ngày ${r.onDate} lúc ${r.atTime}`;
  }
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function Reminders({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [atTime, setAtTime] = useState('08:00');
  const [repeatKind, setRepeatKind] = useState<RepeatKind>('daily');
  const [onDate, setOnDate] = useState(todayIso());
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);

  async function load() {
    const r = await api<{ reminders: Reminder[] }>('/reminders');
    setList(r.reminders);
  }
  useEffect(() => {
    load()
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (!title.trim()) return toast.error('Nhập nội dung cần nhắc.');
    try {
      await api('/reminders', {
        body: { title: title.trim(), atTime, repeatKind, onDate, weekday, dayOfMonth },
      });
      setTitle('');
      toast.success('Đã đặt nhắc hẹn');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function toggle(r: Reminder) {
    try {
      await api(`/reminders/${r.id}/toggle`, { body: { active: !r.active } });
      setList((l) => l.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Xoá nhắc hẹn này?')) return;
    try {
      await api(`/reminders/${id}`, { method: 'DELETE' });
      setList((l) => l.filter((x) => x.id !== id));
      toast.success('Đã xoá');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div className="card my-8 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">⏰ Nhắc hẹn của tôi</h2>
          <button className="btn-ghost px-2 py-1 text-sm" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">Chỉ mình bạn nhận được thông báo của các nhắc hẹn này.</p>

        {/* Tạo mới */}
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <input
            className="input py-1.5"
            placeholder="Nhắc gì? vd: Đăng bài X Salon"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-slate-500">
              Giờ nhắc
              <input className="input py-1" type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">
              Lặp lại
              <select
                className="input py-1"
                value={repeatKind}
                onChange={(e) => setRepeatKind(e.target.value as RepeatKind)}
              >
                {REPEATS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {repeatKind === 'weekly' && (
              <label className="text-xs text-slate-500">
                Vào thứ
                <select className="input py-1" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {repeatKind === 'monthly' && (
              <label className="text-xs text-slate-500">
                Ngày trong tháng
                <input
                  className="input py-1"
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                />
              </label>
            )}
            {repeatKind === 'once' && (
              <label className="text-xs text-slate-500">
                Ngày
                <input className="input py-1" type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
              </label>
            )}
          </div>
          <AsyncButton className="btn-primary" onClick={create} busyLabel="Đang đặt…">
            ＋ Đặt nhắc hẹn
          </AsyncButton>
        </div>

        {/* Danh sách */}
        <ul className="mt-3 divide-y">
          {loading && <li className="py-3 text-sm text-slate-500">Đang tải…</li>}
          {!loading && list.length === 0 && (
            <li className="py-3 text-sm text-slate-500">
              Chưa có nhắc hẹn nào. Bạn cũng có thể nhắn thẳng cho trợ lý: “nhắc tôi đăng bài X Salon 8h hằng ngày”.
            </li>
          )}
          {list.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className={`text-sm font-medium ${r.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                  {r.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <Badge variant={r.active ? 'success' : 'neutral'}>{r.active ? 'Đang bật' : 'Đã tắt'}</Badge>
                  {describe(r)}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button className="text-brand-600 underline" onClick={() => toggle(r)}>
                  {r.active ? 'tắt' : 'bật'}
                </button>
                <button className="text-rose-600 underline" onClick={() => remove(r.id)}>
                  xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
