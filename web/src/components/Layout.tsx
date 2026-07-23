import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Banknote,
  CalendarCheck,
  CheckSquare,
  FileText,
  Landmark,
  LayoutDashboard,
  MessageCircle,
  Settings,
  Star,
  StickyNote,
  Brain,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import Brand from './Brand';
import type { Role } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
}

// Giám đốc không làm task → ẩn Chấm công / Điểm; nhưng VẪN có Trợ lý để giao việc + hỏi dữ liệu.
const NAV: NavItem[] = [
  { to: '/chat', label: 'Trợ lý', icon: MessageCircle },
  { to: '/attendance', label: 'Chấm công', icon: CalendarCheck, roles: ['member', 'leader', 'admin'] },
  { to: '/scores', label: 'Điểm', icon: Star, roles: ['member', 'leader', 'admin'] },
  { to: '/payroll', label: 'Lương', icon: Wallet, roles: ['member', 'leader'] },
  { to: '/payroll-admin', label: 'Bảng lương', icon: Banknote, roles: ['director', 'admin'] },
  { to: '/finance', label: 'Tài chính', icon: Landmark, roles: ['director', 'admin', 'accountant'] },
  { to: '/crm', label: 'Khách hàng', icon: Users, roles: ['sale', 'director', 'admin'] },
  { to: '/customer-notes', label: 'Lưu ý KH', icon: StickyNote },
  { to: '/brain', label: 'Kho tri thức', icon: Brain },
  // Giám đốc không nộp đơn cho ai duyệt → ẩn Đơn từ, chỉ giữ Duyệt đơn.
  { to: '/requests', label: 'Đơn từ', icon: FileText, roles: ['member', 'leader', 'sale', 'accountant', 'admin'] },
  { to: '/approvals', label: 'Duyệt đơn', icon: CheckSquare, roles: ['leader', 'director', 'admin'] },
  { to: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard, roles: ['leader', 'director', 'admin'] },
  { to: '/admin', label: 'Quản trị', icon: Settings, roles: ['admin', 'director'] },
  { to: '/inbox', label: 'Thông báo', icon: Bell },
];

const ROLE_LABEL: Record<string, string> = {
  member: 'Nhân viên',
  leader: 'Trưởng nhóm',
  director: 'Giám đốc',
  admin: 'Quản trị',
  accountant: 'Kế toán',
  sale: 'Account',
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
  const initial = (user?.fullName || '?').trim().charAt(0).toUpperCase();

  // Số thông báo chưa đọc trên chuông. Dùng endpoint đếm (chỉ trả về con số) thay vì
  // tải cả danh sách. Tải lại khi đổi trang nên đọc xong ở Inbox quay ra là số tự cập nhật.
  useEffect(() => {
    if (!user) return;
    api<{ total: number }>('/notifications/unread-counts')
      .then((r) => setUnread(r.total || 0))
      .catch(() => undefined);
  }, [user, location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col bg-white">
      <div className="px-5 py-5">
        <Brand variant="dark" compact />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
              }`
            }
          >
            <n.icon size={18} aria-hidden className="shrink-0" />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-100 p-3">
        <button
          onClick={() => {
            setOpen(false);
            navigate('/profile');
          }}
          className="w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-100"
        >
          <div className="h-9 w-9 shrink-0 rounded-full bg-brand-600 text-white grid place-items-center text-sm font-semibold">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-700 truncate">{user?.fullName}</div>
            <div className="text-xs text-slate-400">{ROLE_LABEL[user?.role || ''] || user?.role}</div>
          </div>
        </button>
        <button
          onClick={logout}
          className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition"
        >
          ⎋ Đăng xuất
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Sidebar cố định (desktop) */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 border-r border-slate-100">{sidebar}</aside>

      {/* Drawer (mobile) */}
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-slate-100 shadow-card transition-transform duration-200 lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </aside>

      {/* Khu vực chính */}
      <div className="lg:pl-64 flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4">
            <button
              className="lg:hidden grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              onClick={() => setOpen(true)}
              aria-label="Mở menu"
            >
              ☰
            </button>
            <div className="lg:hidden">
              <Brand variant="dark" compact />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <NavLink
                to="/inbox"
                className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label={unread > 0 ? `Thông báo (${unread} chưa đọc)` : 'Thông báo'}
              >
                <Bell size={20} aria-hidden />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </NavLink>
              <NavLink
                to="/profile"
                className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white"
                aria-label="Hồ sơ cá nhân"
              >
                {initial}
              </NavLink>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
