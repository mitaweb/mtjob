import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { enablePush } from '../lib/push';

export default function Profile() {
  const { user, logout } = useAuth();
  const [msg, setMsg] = useState('');

  return (
    <div className="space-y-4 max-w-md">
      <div className="card">
        <h1 className="text-lg font-bold mb-2">Hồ sơ</h1>
        <dl className="text-sm space-y-1">
          <Row k="Họ tên" v={user?.fullName} />
          <Row k="Email" v={user?.email} />
          <Row k="Chức vụ" v={user?.position} />
          <Row k="Team" v={user?.teamId} />
          <Row k="Vai trò" v={user?.role} />
        </dl>
      </div>
      <div className="card space-y-2">
        <button className="btn-primary w-full" onClick={() => enablePush().then((r) => setMsg(r.message))}>
          🔔 Bật thông báo đẩy
        </button>
        {msg && <div className="text-sm text-slate-600">{msg}</div>}
        <button className="btn-ghost w-full" onClick={logout}>
          Đăng xuất
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium">{v || '—'}</dd>
    </div>
  );
}
