import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge } from './ui';
import TimeInput from './TimeInput';
import MyCalendar from './MyCalendar';

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
  /** Nhắc một lần đã qua ngày — việc xong rồi, máy chủ tự đánh dấu. */
  done?: boolean;
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
  // Mở lịch ngay tại đây: đang đặt hẹn mà phải đóng bảng này đi xem lịch rồi quay lại
  // gõ lại từ đầu thì không ai xem. Lịch chồng lên trên, đóng lại là còn nguyên.
  const [xemLich, setXemLich] = useState(false);
  // Máy chủ đã báo trùng giờ cho đúng lịch đang nhập — bấm lần nữa là đặt chồng.
  const [daCanhBao, setDaCanhBao] = useState(false);

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
        body: { title: title.trim(), atTime, repeatKind, onDate, weekday, dayOfMonth, boQuaTrung: daCanhBao },
      });
      setTitle('');
      setDaCanhBao(false);
      toast.success('Đã đặt nhắc hẹn');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
      // 409 = trùng giờ. Đã báo rồi thì lần bấm sau cho đi luôn; lỗi khác (mạng, máy chủ)
      // KHÔNG được mở cửa — nếu không thì mất mạng một lần là lần sau bỏ qua kiểm trùng.
      if (e instanceof ApiError && e.status === 409) setDaCanhBao(true);
    }
  }

  /** Đổi giờ hay kiểu lặp là thành lịch khác — phải kiểm trùng lại từ đầu. */
  function doiLich<T>(dat: (v: T) => void) {
    return (v: T) => {
      dat(v);
      setDaCanhBao(false);
    };
  }

  async function toggle(r: Reminder) {
    try {
      await api(`/reminders/${r.id}/toggle`, { body: { active: !r.active } });
      setList((l) => l.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** `imLang`: dùng khi dọn hàng loạt — đã hỏi một lần rồi, không hỏi lại từng cái. */
  async function remove(id: string, imLang = false) {
    if (!imLang && !window.confirm('Xoá nhắc hẹn này?')) return;
    try {
      await api(`/reminders/${id}`, { method: 'DELETE' });
      setList((l) => l.filter((x) => x.id !== id));
      if (!imLang) toast.success('Đã xoá');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Hẹn một lần đã qua ngày thì tách khỏi danh sách chính (anh Tâm 2/8/2026).
  const daXong = list.filter((r) => r.done);
  const dangTheoDoi = list.filter((r) => !r.done);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4"
        onClick={onClose}
      >
      <div className="card hien-len my-8 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">⏰ Nhắc hẹn của tôi</h2>
          <div className="flex shrink-0 gap-1">
            <button className="btn-ghost whitespace-nowrap px-2 py-1 text-sm" onClick={() => setXemLich(true)}>
              📆 Lịch
            </button>
            <button className="btn-ghost px-2 py-1 text-sm" onClick={onClose}>
              ✕ Đóng
            </button>
          </div>
        </div>
        <p className="mb-3 text-sm text-ink-muted">Chỉ mình bạn nhận được thông báo của các nhắc hẹn này.</p>

        {/* Tạo mới */}
        <div className="space-y-2 rounded-xl bg-brand-50 p-3">
          <input
            className="input py-1.5"
            placeholder="Nhắc gì? vd: Đăng bài X Salon"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-ink-muted">
              Giờ nhắc
              <TimeInput className="max-w-[7rem] py-1" value={atTime} onChange={doiLich(setAtTime)} />
            </label>
            <label className="text-xs text-ink-muted">
              Lặp lại
              <select
                className="input py-1"
                value={repeatKind}
                onChange={(e) => doiLich(setRepeatKind)(e.target.value as RepeatKind)}
              >
                {REPEATS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {repeatKind === 'weekly' && (
              <label className="text-xs text-ink-muted">
                Vào thứ
                <select className="input py-1" value={weekday} onChange={(e) => doiLich(setWeekday)(Number(e.target.value))}>
                  {WEEKDAYS.map((w, i) => (
                    <option key={w} value={i}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {repeatKind === 'monthly' && (
              <label className="text-xs text-ink-muted">
                Ngày trong tháng
                <input
                  className="input py-1"
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => doiLich(setDayOfMonth)(Number(e.target.value))}
                />
              </label>
            )}
            {repeatKind === 'once' && (
              <label className="text-xs text-ink-muted">
                Ngày
                <input className="input py-1" type="date" value={onDate} onChange={(e) => doiLich(setOnDate)(e.target.value)} />
              </label>
            )}
          </div>
          <AsyncButton
            className={daCanhBao ? 'btn bg-amber-500 text-ink hover:bg-amber-400' : 'btn-primary'}
            onClick={create}
            busyLabel="Đang đặt…"
          >
            {daCanhBao ? '⚠️ Vẫn đặt (trùng giờ)' : '＋ Đặt nhắc hẹn'}
          </AsyncButton>
        </div>

        {/* Danh sách đang theo dõi — lịch đã qua gom xuống mục riêng bên dưới. */}
        <ul className="mt-3 divide-y">
          {loading && <li className="py-3 text-sm text-ink-muted">Đang tải…</li>}
          {!loading && dangTheoDoi.length === 0 && (
            <li className="py-3 text-sm text-ink-muted">
              {daXong.length > 0
                ? 'Không còn hẹn nào sắp tới. Các hẹn đã qua nằm ở mục bên dưới.'
                : 'Chưa có nhắc hẹn nào. Bạn cũng có thể nhắn thẳng cho trợ lý: “nhắc tôi đăng bài X Salon 8h hằng ngày”.'}
            </li>
          )}
          {dangTheoDoi.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className={`text-sm font-medium ${r.active ? 'text-ink' : 'text-ink-faint line-through'}`}>
                  {r.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
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

        {/* Hẹn đã qua: gấp lại cho gọn, vẫn tra được và xoá được. */}
        {daXong.length > 0 && (
          <details className="mt-3 border-t border-brand-100 pt-2">
            <summary className="cursor-pointer text-sm text-ink-muted">✓ Đã xong ({daXong.length})</summary>
            <ul className="mt-1 divide-y">
              {daXong.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-ink-faint line-through">{r.title}</div>
                    <div className="mt-0.5 text-xs text-ink-faint">{describe(r)}</div>
                  </div>
                  <button className="shrink-0 text-xs text-rose-600 underline" onClick={() => remove(r.id)}>
                    xoá
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="mt-2 text-xs text-rose-600 underline"
              onClick={async () => {
                if (!window.confirm(`Xoá hẳn ${daXong.length} nhắc hẹn đã xong?`)) return;
                for (const r of daXong) await remove(r.id, true);
                await load();
              }}
            >
              Dọn hết {daXong.length} hẹn đã xong
            </button>
          </details>
        )}
        </div>
      </div>

      {/* Lịch là anh em RUỘT của lớp phủ trên, không nằm trong nó: nằm trong thì bấm ra
          nền lịch sẽ đóng luôn bảng nhắc hẹn, mất hết chữ đang gõ. Đặt sau để vẽ đè lên. */}
      {xemLich && <MyCalendar onClose={() => setXemLich(false)} />}
    </>
  );
}
