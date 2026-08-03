import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from './Toaster';
import { EmptyState, SkeletonRows } from './ui';
import AsyncButton from './AsyncButton';
import type { Role, User } from '../lib/types';

// Nhân sự và lương nhập thẳng ở đây, không qua Google Sheet nữa (anh Tâm chốt 29/7/2026).
//
// Sửa thì sửa ngay trong ô như Google Sheet — đó là việc làm hằng ngày. Thêm người mới
// thì mở hộp thoại riêng, vì người mới có những thứ chỉ nhập đúng một lần (mật khẩu ban
// đầu, tên đăng nhập) mà nhét vào bảng thì chín mươi phần trăm thời gian không ai đụng.

// `User` là hình dạng dùng chung cho mọi vai; bản của Quản trị có thêm lương/BHXH/ngày
// vào làm — `publicMember` ở máy chủ chỉ cắt mật khẩu và email nên các trường này có sẵn.
type AdminMember = User & {
  active: boolean;
  salary: number;
  bhxh: number;
  joinDate: string | null;
};

const TEAMS = ['', 'Ads', 'Content', 'SEO'];

const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'member', label: 'Nhân viên' },
  { value: 'leader', label: 'Leader' },
  { value: 'sale', label: 'Account' },
  { value: 'accountant', label: 'Kế toán' },
  { value: 'director', label: 'Giám đốc' },
  { value: 'admin', label: 'Quản trị' },
];

/** Các trường sửa được trong bảng. Tách riêng để so sánh dirty cho gọn. */
interface Editable {
  fullName: string;
  username: string;
  position: string;
  teamId: string;
  role: Role;
  salary: number;
  bhxh: number;
  joinDate: string;
  dob: string;
}

const editableOf = (m: AdminMember): Editable => ({
  fullName: m.fullName || '',
  username: m.username || '',
  position: m.position || '',
  teamId: m.teamId || '',
  role: m.role,
  salary: m.salary || 0,
  bhxh: m.bhxh || 0,
  joinDate: m.joinDate || '',
  dob: m.dob || '',
});

const blankNew = () => ({ ...editableOf({ role: 'member' } as AdminMember), password: '' });

const same = (a: Editable, b: Editable) => (Object.keys(a) as Array<keyof Editable>).every((k) => a[k] === b[k]);

/** Ô nhập trong bảng — viền mảnh để bảng vẫn đọc được như bảng, không thành rừng ô. */
const CELL = 'w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-slate-200 focus:border-brand-400 focus:bg-white focus:outline-none';

export default function MemberTable() {
  const { user } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState<AdminMember[]>([]);
  const [draft, setDraft] = useState<Record<string, Editable>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<ReturnType<typeof blankNew> | null>(null);
  const [pwd, setPwd] = useState<Record<string, string>>({});
  const [killing, setKilling] = useState<{ m: AdminMember; typed: string; foot?: Footprint } | null>(null);

  async function load() {
    const r = await api<{ members: AdminMember[] }>('/admin/members');
    setMembers(r.members);
    setDraft(Object.fromEntries(r.members.map((m) => [m.id, editableOf(m)])));
  }

  useEffect(() => {
    load()
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (id: string, patch: Partial<Editable>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));

  const dirty = (m: AdminMember) => !!draft[m.id] && !same(draft[m.id]!, editableOf(m));

  async function saveRow(m: AdminMember) {
    const d = draft[m.id];
    if (!d) return;
    if (!d.fullName.trim()) return toast.error('Họ tên không được để trống.');
    try {
      await api('/admin/members', { body: { id: m.id, ...d, active: m.active } });
      await load();
      toast.success(`Đã lưu ${d.fullName}.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addMember() {
    if (!adding?.fullName.trim()) return toast.error('Nhập họ tên.');
    if (adding.password && adding.password.length < 6) return toast.error('Mật khẩu ít nhất 6 ký tự.');
    try {
      const r = await api<{ username: string }>('/admin/members', {
        body: { ...adding, password: adding.password || undefined, active: true },
      });
      setAdding(null);
      await load();
      toast.success(`Đã thêm ${adding.fullName} — tài khoản ${r.username}.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Cho nghỉ việc / nhận lại: chỉ đổi cờ active, giữ nguyên mọi dữ liệu. */
  async function setActive(m: AdminMember, active: boolean) {
    try {
      await api('/admin/members', { body: { id: m.id, ...editableOf(m), active } });
      await load();
      toast.success(active ? `Đã nhận lại ${m.fullName}.` : `Đã cho ${m.fullName} nghỉ việc.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function openKill(m: AdminMember) {
    setKilling({ m, typed: '' });
    try {
      setKilling({ m, typed: '', foot: await api<Footprint>(`/admin/members/${m.id}/footprint`) });
    } catch {
      // Không lấy được số thì vẫn cho xoá, chỉ là hộp thoại không nói được con số.
    }
  }

  async function confirmKill() {
    if (!killing) return;
    try {
      await api(`/admin/members/${killing.m.id}`, { method: 'DELETE' });
      setKilling(null);
      await load();
      toast.success(`Đã xoá ${killing.m.fullName} khỏi hệ thống.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function savePassword(id: string) {
    const password = (pwd[id] || '').trim();
    if (password.length < 6) return toast.error('Mật khẩu ít nhất 6 ký tự.');
    try {
      await api(`/admin/members/${id}/password`, { body: { password } });
      setPwd((p) => ({ ...p, [id]: '' }));
      toast.success('Đã đặt mật khẩu.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const working = members.filter((m) => m.active);
  const retired = members.filter((m) => !m.active);

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Nhân sự ({working.length})</h2>
          <p className="text-xs text-slate-500">
            Sửa thẳng trong ô rồi bấm Lưu ở cuối dòng. Mức lương đổi ở đây là bảng lương tính lại ngay.
          </p>
        </div>
        <button className="btn-primary text-sm" onClick={() => setAdding(blankNew())}>
          + Thêm nhân sự
        </button>
      </div>

      {loading ? (
        <SkeletonRows rows={5} />
      ) : working.length === 0 ? (
        <EmptyState icon="👥" text="Chưa có nhân sự nào." />
      ) : (
        // Bảng rộng hơn màn hình là chuyện thường — cho cuộn ngang thay vì bóp cột làm
        // cắt mất họ tên và chức vụ (anh Tâm 3/8/2026).
        <div className="overflow-x-auto">
          <table className="w-full min-w-[92rem] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="whitespace-nowrap">
                <th className="w-48 py-1 pr-2">Họ tên</th>
                <th className="w-32 pr-2">Tài khoản</th>
                <th className="w-44 pr-2">Chức vụ</th>
                <th className="w-28 pr-2">Phòng</th>
                <th className="w-32 pr-2">Vai trò</th>
                <th className="w-32 pr-2 text-right">Mức lương</th>
                <th className="w-32 pr-2 text-right">BHXH</th>
                <th className="w-36 pr-2">Ngày vào</th>
                <th className="w-36 pr-2">Ngày sinh</th>
                <th className="w-28"></th>
              </tr>
            </thead>
            <tbody>
              {working.map((m) => {
                const d = draft[m.id];
                if (!d) return null;
                const changed = dirty(m);
                return (
                  <tr key={m.id} className={`border-t align-middle ${changed ? 'bg-amber-50/60' : ''}`}>
                    <td className="py-1 pr-2">
                      <input className={CELL} value={d.fullName} onChange={(e) => set(m.id, { fullName: e.target.value })} />
                    </td>
                    <td className="pr-2">
                      <input
                        className={`${CELL} font-mono text-xs`}
                        value={d.username}
                        onChange={(e) => set(m.id, { username: e.target.value })}
                      />
                    </td>
                    <td className="pr-2">
                      <input className={CELL} value={d.position} onChange={(e) => set(m.id, { position: e.target.value })} />
                    </td>
                    <td className="pr-2">
                      <select className={CELL} value={d.teamId} onChange={(e) => set(m.id, { teamId: e.target.value })}>
                        {TEAMS.map((t) => (
                          <option key={t} value={t}>{t || '—'}</option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-2">
                      <select className={CELL} value={d.role} onChange={(e) => set(m.id, { role: e.target.value as Role })}>
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-2">
                      <input
                        className={`${CELL} text-right`}
                        type="number"
                        min={0}
                        step={100000}
                        value={d.salary || ''}
                        onChange={(e) => set(m.id, { salary: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="pr-2">
                      <input
                        className={`${CELL} text-right`}
                        type="number"
                        min={0}
                        step={100000}
                        value={d.bhxh || ''}
                        onChange={(e) => set(m.id, { bhxh: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td className="pr-2">
                      <input className={CELL} type="date" value={d.joinDate} onChange={(e) => set(m.id, { joinDate: e.target.value })} />
                    </td>
                    <td className="pr-2">
                      <input className={CELL} type="date" value={d.dob} onChange={(e) => set(m.id, { dob: e.target.value })} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {/* Nút Lưu chỉ hiện khi có thay đổi — đây là bảng lương, không tự lưu theo từng phím gõ. */}
                      {changed ? (
                        <div className="flex items-center justify-end gap-1">
                          <AsyncButton className="btn-primary px-2 py-1 text-xs" busyLabel="…" onClick={() => saveRow(m)}>
                            Lưu
                          </AsyncButton>
                          <button
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100"
                            onClick={() => setDraft((x) => ({ ...x, [m.id]: editableOf(m) }))}
                          >
                            Bỏ
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title="Cho nghỉ việc (ẩn đi, giữ nguyên dữ liệu)"
                            onClick={() => setActive(m, false)}
                          >
                            Cho nghỉ
                          </button>
                          <button
                            className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Xoá hẳn khỏi hệ thống"
                            aria-label={`Xoá hẳn ${m.fullName}`}
                            onClick={() => openKill(m)}
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Đổi ô <b>Tài khoản</b> là người đó phải đăng nhập bằng tên mới. Đặt vai trò <b>Leader</b> kèm phòng thì
        người đó thành leader của phòng đó luôn.
      </p>

      {/* Đặt mật khẩu — tách khỏi bảng vì hoạ hoằn mới dùng, để trong bảng thì thừa một cột. */}
      {!loading && working.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-500">🔑 Đặt lại mật khẩu</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {working.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-sm text-slate-600">{m.fullName}</span>
                <input
                  className="input py-1 text-xs"
                  type="password"
                  placeholder="mật khẩu mới"
                  value={pwd[m.id] || ''}
                  onChange={(e) => setPwd((p) => ({ ...p, [m.id]: e.target.value }))}
                />
                <AsyncButton className="btn-ghost shrink-0 px-2 py-1 text-xs" busyLabel="…" onClick={() => savePassword(m.id)}>
                  Lưu
                </AsyncButton>
              </div>
            ))}
          </div>
        </details>
      )}

      {retired.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-600">Đã nghỉ ({retired.length})</h3>
          <div className="space-y-1">
            {retired.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">{m.fullName}</span>
                <span className="text-xs text-slate-400">{m.position || m.teamId}</span>
                <button className="text-xs text-brand-600 underline" onClick={() => setActive(m, true)}>
                  Nhận lại
                </button>
                <button className="text-xs text-rose-600 underline" onClick={() => openKill(m)}>
                  Xoá hẳn
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && <AddMemberDialog value={adding} onChange={setAdding} onSave={addMember} onClose={() => setAdding(null)} />}

      {killing && (
        <KillDialog
          state={killing}
          isSelf={killing.m.id === user?.id}
          onType={(typed) => setKilling({ ...killing, typed })}
          onConfirm={confirmKill}
          onClose={() => setKilling(null)}
        />
      )}
    </div>
  );
}

interface Footprint {
  tasks: number;
  attendanceDays: number;
  payrollMonths: number;
}

/** Hộp thoại thêm người mới — gom cả những trường chỉ nhập một lần. */
function AddMemberDialog({
  value,
  onChange,
  onSave,
  onClose,
}: {
  value: ReturnType<typeof blankNew>;
  onChange: (v: ReturnType<typeof blankNew>) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div className="card my-8 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-semibold">Thêm nhân sự</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Họ tên</label>
            <input className="input" value={value.fullName} onChange={(e) => onChange({ ...value, fullName: e.target.value })} />
          </div>
          <div>
            <label className="label">Tài khoản đăng nhập</label>
            <input
              className="input font-mono text-sm"
              placeholder="bỏ trống để tự sinh"
              value={value.username}
              onChange={(e) => onChange({ ...value, username: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Mật khẩu ban đầu</label>
            <input
              className="input"
              type="password"
              placeholder="ít nhất 6 ký tự"
              value={value.password}
              onChange={(e) => onChange({ ...value, password: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Chức vụ</label>
            <input
              className="input"
              placeholder="vd: Chuyên viên Content"
              value={value.position}
              onChange={(e) => onChange({ ...value, position: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Phòng</label>
            <select className="input" value={value.teamId} onChange={(e) => onChange({ ...value, teamId: e.target.value })}>
              {TEAMS.map((t) => (
                <option key={t} value={t}>{t || '— Không thuộc phòng nào —'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Vai trò</label>
            <select className="input" value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Mức lương</label>
            <input
              className="input"
              type="number"
              min={0}
              step={100000}
              value={value.salary || ''}
              onChange={(e) => onChange({ ...value, salary: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label className="label">Mức đóng BHXH</label>
            <input
              className="input"
              type="number"
              min={0}
              step={100000}
              value={value.bhxh || ''}
              onChange={(e) => onChange({ ...value, bhxh: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label className="label">Ngày vào làm</label>
            <input className="input" type="date" value={value.joinDate} onChange={(e) => onChange({ ...value, joinDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Ngày sinh</label>
            <input className="input" type="date" value={value.dob} onChange={(e) => onChange({ ...value, dob: e.target.value })} />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Bỏ trống tài khoản thì máy tự đặt từ họ tên — “Lương Thị Thu Hà” thành <b>luongha</b>. Chưa đặt mật khẩu
          thì người đó chưa đăng nhập được, đặt sau ở mục 🔑 cũng được.
        </p>
        <div className="mt-4 flex gap-2">
          <AsyncButton className="btn-primary" busyLabel="Đang lưu…" onClick={onSave}>Thêm</AsyncButton>
          <button className="btn-ghost" onClick={onClose}>Huỷ</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hộp xác nhận xoá hẳn. Bắt gõ đúng họ tên: xoá nhân sự không có đường lui, một cú bấm
 * nhầm không được phép là đủ.
 */
function KillDialog({
  state,
  isSelf,
  onType,
  onConfirm,
  onClose,
}: {
  state: { m: { id: string; fullName: string }; typed: string; foot?: Footprint };
  isSelf: boolean;
  onType: (v: string) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const { m, typed, foot } = state;
  const ok = typed.trim().toLowerCase() === m.fullName.trim().toLowerCase();

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div className="card my-8 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 font-semibold text-rose-700">Xoá hẳn {m.fullName}?</h2>

        {isSelf ? (
          <p className="text-sm text-slate-600">
            Đây là tài khoản bạn đang đăng nhập — không tự xoá được.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Xoá hẳn khỏi hệ thống, <b>không khôi phục được</b>. Nếu chỉ là nghỉ việc thì bấm “Cho nghỉ” sẽ
              giữ lại được mọi thứ.
            </p>

            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
              <div className="font-medium text-slate-700">Sẽ giữ lại (vẫn còn tên trong báo cáo cũ):</div>
              <ul className="mt-1 list-disc pl-5 text-slate-600">
                <li>{foot ? `${foot.tasks} việc đã làm` : 'việc đã làm'}</li>
                <li>{foot ? `${foot.attendanceDays} ngày chấm công` : 'lịch sử chấm công'}</li>
                <li>{foot ? `${foot.payrollMonths} tháng bảng lương` : 'bảng lương các tháng cũ'}</li>
              </ul>
              <div className="mt-2 font-medium text-slate-700">Sẽ mất:</div>
              <ul className="mt-1 list-disc pl-5 text-slate-600">
                <li>tài khoản đăng nhập</li>
                <li>thông báo và nhắc hẹn cá nhân</li>
              </ul>
            </div>

            <label className="label mt-3">
              Gõ đúng họ tên <b>{m.fullName}</b> để xác nhận
            </label>
            <input className="input" value={typed} onChange={(e) => onType(e.target.value)} placeholder={m.fullName} />
          </>
        )}

        <div className="mt-4 flex gap-2">
          {!isSelf && (
            <AsyncButton
              className="btn-primary bg-rose-600 hover:bg-rose-700 disabled:opacity-40"
              busyLabel="Đang xoá…"
              disabled={!ok}
              onClick={onConfirm}
            >
              Xoá hẳn
            </AsyncButton>
          )}
          <button className="btn-ghost" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
