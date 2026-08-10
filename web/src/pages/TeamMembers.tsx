import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../components/Toaster';
import AsyncButton from '../components/AsyncButton';
import { Badge, EmptyState, PageHeader, SkeletonRows } from '../components/ui';

// Leader tự lập tài khoản cho thành viên phòng mình (anh Tâm 4/8/2026).
//
// KHÔNG có lương ở màn hình này, và cũng không có ở dữ liệu máy chủ trả về — ẩn trên giao
// diện thôi thì mở tab Network ra là đọc được.

interface TeamMember {
  id: string;
  fullName: string;
  username: string;
  position: string;
  role: string;
  dob: string;
  joinDate: string;
  active: boolean;
}

const VAI: Record<string, string> = {
  member: 'Nhân viên',
  leader: 'Leader',
  director: 'Giám đốc',
  admin: 'Quản trị',
  accountant: 'Kế toán',
  sale: 'Account',
};

const blankNew = () => ({
  fullName: '',
  username: '',
  password: '',
  position: '',
  dob: '',
  joinDate: '',
});

const fmtNgay = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');

export default function TeamMembers() {
  const toast = useToast();
  const [teamId, setTeamId] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ReturnType<typeof blankNew> | null>(null);
  const [vuaTao, setVuaTao] = useState<{ fullName: string; username: string } | null>(null);

  async function load() {
    const r = await api<{ teamId: string; members: TeamMember[] }>('/team/members');
    setTeamId(r.teamId);
    setMembers(r.members);
  }

  useEffect(() => {
    load()
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!form) return;
    if (!form.fullName.trim()) return toast.error('Nhập họ tên.');
    if (form.password.trim().length < 6) return toast.error('Mật khẩu ít nhất 6 ký tự.');
    try {
      const r = await api<{ username: string }>('/team/members', {
        body: {
          fullName: form.fullName.trim(),
          username: form.username.trim(),
          position: form.position.trim(),
          dob: form.dob,
          joinDate: form.joinDate,
          password: form.password,
        },
      });
      // Hiện lại tài khoản vừa lập: tên đăng nhập có thể do máy tự sinh từ họ tên, không
      // nói ra thì leader không biết đưa cái gì cho bạn mới.
      setVuaTao({ fullName: form.fullName.trim(), username: r.username });
      setForm(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Nhân sự phòng tôi"
        desc={
          teamId
            ? `Lập tài khoản cho thành viên phòng ${teamId}. Lương và bảo hiểm do giám đốc đặt.`
            : 'Bạn chưa được gán phòng ban nào.'
        }
        action={
          teamId ? (
            <button className="btn-primary text-sm" onClick={() => setForm(blankNew())}>
              + Thêm thành viên
            </button>
          ) : null
        }
      />

      {!loading && !teamId && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
          Bạn chưa được gán phòng ban nào nên chưa lập tài khoản cho ai được. Nhờ giám đốc gán phòng trước.
        </div>
      )}

      {vuaTao && (
        <div className="card border-emerald-200 bg-emerald-50">
          <div className="text-sm text-emerald-900">
            Đã lập tài khoản cho <b>{vuaTao.fullName}</b>. Tên đăng nhập:{' '}
            <b className="font-mono">{vuaTao.username}</b> — đưa kèm mật khẩu bạn vừa đặt, và nhắc bạn ấy
            đổi mật khẩu sau khi đăng nhập lần đầu.
          </div>
          <button className="btn-ghost mt-2 px-3 py-1 text-sm" onClick={() => setVuaTao(null)}>
            Đã hiểu
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Thành viên ({members.length})</h2>
        {loading ? (
          <SkeletonRows rows={4} />
        ) : members.length === 0 ? (
          <EmptyState icon="👥" text="Phòng bạn chưa có thành viên nào." />
        ) : (
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="whitespace-nowrap">
                <th className="w-8 py-1 pr-2">#</th>
                <th className="pr-2">Họ tên</th>
                <th className="pr-2">Tài khoản</th>
                <th className="pr-2">Chức vụ</th>
                <th className="pr-2">Vai trò</th>
                <th className="pr-2">Ngày vào</th>
                <th className="pr-2">Ngày sinh</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className={`border-t ${m.active ? '' : 'text-slate-400'}`}>
                  <td className="py-1.5 pr-2 text-slate-400">{i + 1}</td>
                  <td className="pr-2 font-medium text-slate-800">
                    {m.fullName}
                    {!m.active && <span className="ml-2 text-xs text-slate-400">đã nghỉ</span>}
                  </td>
                  <td className="pr-2 font-mono text-xs">{m.username}</td>
                  <td className="pr-2">{m.position || '—'}</td>
                  <td className="pr-2">
                    <Badge variant={m.role === 'leader' ? 'info' : 'neutral'}>{VAI[m.role] || m.role}</Badge>
                  </td>
                  <td className="pr-2">{fmtNgay(m.joinDate)}</td>
                  <td className="pr-2">{fmtNgay(m.dob)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Cần sửa thông tin, đổi phòng, đặt lương hay cho nghỉ thì nhờ giám đốc — phần đó nằm ở mục Quản trị.
        </p>
      </div>

      {form && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
          onClick={() => setForm(null)}
        >
          <div className="card my-8 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 font-semibold">Thêm thành viên phòng {teamId}</h2>
            <p className="mb-3 text-xs text-slate-500">
              Bạn mới sẽ là <b>nhân viên</b> của phòng <b>{teamId}</b>. Lương và bảo hiểm do giám đốc đặt sau.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="tv-hoten">
                  Họ tên
                </label>
                <input
                  id="tv-hoten"
                  className="input"
                  placeholder="vd: Trần Thị An Thùy"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="tv-taikhoan">
                  Tài khoản đăng nhập
                </label>
                <input
                  id="tv-taikhoan"
                  className="input font-mono text-sm"
                  placeholder="bỏ trống để tự sinh"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="tv-matkhau">
                  Mật khẩu ban đầu
                </label>
                <input
                  id="tv-matkhau"
                  className="input"
                  type="password"
                  placeholder="ít nhất 6 ký tự"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="tv-chucvu">
                  Chức vụ
                </label>
                <input
                  id="tv-chucvu"
                  className="input"
                  placeholder="vd: Chuyên viên Content"
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="tv-ngayvao">
                  Ngày vào làm
                </label>
                <input
                  id="tv-ngayvao"
                  className="input"
                  type="date"
                  value={form.joinDate}
                  onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label" htmlFor="tv-ngaysinh">
                  Ngày sinh
                </label>
                <input
                  id="tv-ngaysinh"
                  className="input"
                  type="date"
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                />
              </div>
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Bỏ trống tài khoản thì máy tự đặt từ họ tên — “Lương Thị Thu Hà” thành <b>luongha</b>. Ngày vào
              làm dùng để tính công, nên điền đúng ngay từ đầu.
            </p>

            <div className="mt-4 flex gap-2">
              <AsyncButton className="btn-primary" onClick={save} busyLabel="Đang lập…">
                Lập tài khoản
              </AsyncButton>
              <button className="btn-ghost" onClick={() => setForm(null)}>
                Huỷ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
