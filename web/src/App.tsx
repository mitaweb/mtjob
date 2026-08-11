import { lazy, Suspense, type ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import type { Role } from './lib/types';
import Layout from './components/Layout';
import GlobalLoading from './components/GlobalLoading';
import { ToastProvider } from './components/Toaster';

// Tách bundle theo trang: mỗi trang tải khi cần (recharts chỉ tải khi mở Dashboard).
const Login = lazy(() => import('./pages/Login'));
const Chat = lazy(() => import('./pages/Chat'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Scores = lazy(() => import('./pages/Scores'));
const Payroll = lazy(() => import('./pages/Payroll'));
const AdminPayroll = lazy(() => import('./pages/AdminPayroll'));
const Finance = lazy(() => import('./pages/Finance'));
const CRM = lazy(() => import('./pages/CRM'));
const CustomerNotes = lazy(() => import('./pages/CustomerNotes'));
const Projects = lazy(() => import('./pages/Projects'));
const Brain = lazy(() => import('./pages/Brain'));
const Requests = lazy(() => import('./pages/Requests'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Admin = lazy(() => import('./pages/Admin'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Profile = lazy(() => import('./pages/Profile'));
const Guide = lazy(() => import('./pages/Guide'));
const TeamMembers = lazy(() => import('./pages/TeamMembers'));

/** Fallback khi đang tải chunk trang: thanh chạy trên đỉnh (cùng style GlobalLoading). */
function RouteFallback() {
  return (
    <div className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-brand-100">
      <div className="loadingbar h-full w-1/3 bg-brand-600" />
    </div>
  );
}

/** Trang mặc định theo vai trò: giám đốc/admin -> Tổng quan, còn lại -> Trợ lý. */
function homeFor(role?: Role): string {
  if (role === 'accountant') return '/finance';
  if (role === 'sale') return '/crm';
  return role === 'director' || role === 'admin' ? '/dashboard' : '/chat';
}

function Protected({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-ink-muted">Đang tải…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user?.role)} replace />;
}

export default function App() {
  return (
    <ToastProvider>
      <GlobalLoading />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/scores" element={<Scores />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route
          path="/payroll-admin"
          element={
            <Protected roles={['director', 'admin']}>
              <AdminPayroll />
            </Protected>
          }
        />
        <Route
          path="/finance"
          element={
            <Protected roles={['director', 'admin', 'accountant']}>
              <Finance />
            </Protected>
          }
        />
        <Route
          path="/crm"
          element={
            <Protected roles={['sale', 'director', 'admin']}>
              <CRM />
            </Protected>
          }
        />
        <Route
          path="/projects"
          element={
            <Protected roles={['member', 'leader', 'director', 'admin', 'sale']}>
              <Projects />
            </Protected>
          }
        />
        <Route path="/customer-notes" element={<CustomerNotes />} />
        <Route path="/brain" element={<Brain />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/profile" element={<Profile />} />
        {/* Hướng dẫn: ai cũng vào được, nội dung tự lọc theo vai. */}
        <Route path="/guide" element={<Guide />} />
        {/* Chỉ leader: giám đốc/quản trị đã có mục Quản trị đầy đủ hơn. */}
        <Route
          path="/team-members"
          element={
            <Protected roles={['leader']}>
              <TeamMembers />
            </Protected>
          }
        />
        <Route
          path="/approvals"
          element={
            <Protected roles={['leader', 'director', 'admin']}>
              <Approvals />
            </Protected>
          }
        />
        <Route
          path="/dashboard"
          element={
            <Protected roles={['leader', 'director', 'admin']}>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/admin"
          element={
            <Protected roles={['admin', 'director']}>
              <Admin />
            </Protected>
          }
        />
      </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ToastProvider>
  );
}
