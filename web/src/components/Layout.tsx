import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import Brand from './Brand';
import type { Role } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: Role[];
}

// Giám đốc không làm task → ẩn Trợ lý / Chấm công / Điểm.
const NAV: NavItem[] = [
  { to: '/chat', label: 'Trợ lý', icon: '💬', roles: ['member', 'leader', 'admin'] },
  { to: '/attendance', label: 'Chấm công', icon: '📍', roles: ['member', 'leader', 'admin'] },
  { to: '/scores', label: 'Điểm', icon: '⭐', roles: ['member', 'leader', 'admin'] },
  { to: '/payroll', label: 'Lương', icon: '💵', roles: ['member', 'leader'] },
  { to: '/payroll-admin', label: 'Bảng lương', icon: '💰', roles: ['director', 'admin'] },
  { to: '/finance', label: 'Tài chính', icon: '🧾', roles: ['director', 'admin', 'accountant'] },
  { to: '/requests', label: 'Đơn từ', icon: '📝' },
  { to: '/approvals', label: 'Duyệt đơn', icon: '✅', roles: ['leader', 'director', 'admin'] },
  { to: '/dashboard', label: 'Tổng quan', icon: '📊', roles: ['leader', 'director', 'admin'] },
  { to: '/admin', label: 'Quản trị', icon: '⚙️', roles: ['admin', 'director'] },
  { to: '/inbox', label: 'Thông báo', icon: '🔔' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 bg-brand-600 text-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Brand variant="light" compact />

          <button
            onClick={() => navigate('/profile')}
            className="text-sm bg-white/15 hover:bg-white/25 rounded-lg px-3 py-1.5"
          >
            {user?.fullName} ({user?.role})
          </button>
        </div>
        <nav className="mx-auto max-w-5xl px-2 pb-2 flex gap-1 overflow-x-auto">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${
                  isActive ? 'bg-white text-brand-700 font-semibold' : 'text-white/90 hover:bg-white/15'
                }`
              }
            >
              <span className="mr-1">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
          <button onClick={logout} className="ml-auto whitespace-nowrap rounded-lg px-3 py-1.5 text-sm hover:bg-white/15">
            ⎋ Thoát
          </button>
        </nav>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
