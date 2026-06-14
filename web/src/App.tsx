import type { ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import type { Role } from './lib/types';
import Layout from './components/Layout';
import GlobalLoading from './components/GlobalLoading';
import Login from './pages/Login';
import Chat from './pages/Chat';
import Attendance from './pages/Attendance';
import Scores from './pages/Scores';
import Payroll from './pages/Payroll';
import AdminPayroll from './pages/AdminPayroll';
import Finance from './pages/Finance';
import CRM from './pages/CRM';
import Requests from './pages/Requests';
import Approvals from './pages/Approvals';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Inbox from './pages/Inbox';
import Profile from './pages/Profile';

/** Trang mặc định theo vai trò: giám đốc/admin -> Tổng quan, còn lại -> Trợ lý. */
function homeFor(role?: Role): string {
  if (role === 'accountant') return '/finance';
  if (role === 'sale') return '/crm';
  return role === 'director' || role === 'admin' ? '/dashboard' : '/chat';
}

function Protected({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-slate-500">Đang tải…</div>;
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
    <>
      <GlobalLoading />
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
        <Route path="/requests" element={<Requests />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/profile" element={<Profile />} />
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
    </>
  );
}
