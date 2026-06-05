import type { ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import type { Role } from './lib/types';
import Layout from './components/Layout';
import Login from './pages/Login';
import Chat from './pages/Chat';
import Attendance from './pages/Attendance';
import Scores from './pages/Scores';
import Payroll from './pages/Payroll';
import Requests from './pages/Requests';
import Approvals from './pages/Approvals';
import Dashboard from './pages/Dashboard';
import Admin from './pages/Admin';
import Inbox from './pages/Inbox';
import Profile from './pages/Profile';

function Protected({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-slate-500">Đang tải…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/chat" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/attendance" element={<Attendance />} />
        <Route path="/scores" element={<Scores />} />
        <Route path="/payroll" element={<Payroll />} />
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
  );
}
