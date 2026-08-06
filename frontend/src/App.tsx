import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import Patients from './pages/Patients';
import CalendarPage from './pages/Calendar'; 
import Financials from './pages/Financials';
import Dashboard from './pages/Dashboard';
import PatientProfile from './pages/PatientProfile';
import Settings from "./pages/Settings";
import Login from './pages/Login';
import Register from './pages/Register';
import Forbidden from './pages/Forbidden';
import AdminPanel from './pages/AdminPanel';
import Profile from './pages/Profile';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from "./components/Languagecontext"; // Keep an eye on the lowercase 'c' in 'Languagecontext' if you hit an import error!
import { ThemeProvider } from "./components/ThemeContext";
import { ClinicSettingsProvider } from "./components/ClinicSettings";
import './App.css'

const LoadingScreen = () => {
  const { t } = useLanguage();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <p>{t('loading')}</p>
      </div>
    </div>
  );
};

// Which permission key gates each route. Paths are matched by prefix.
const PAGE_KEYS: { prefix: string; key: string }[] = [
  { prefix: '/patients', key: 'patients' },
  { prefix: '/patient/', key: 'patients' },
  { prefix: '/calendar', key: 'calendar' },
  { prefix: '/financials', key: 'financials' },
  { prefix: '/dashboard', key: 'dashboard' },
  { prefix: '/settings', key: 'settings' },
  { prefix: '/admin', key: 'admin' },
];

const ProtectedLayout = ({ children }: { children?: ReactNode }) => {
  const { user, loading, restoring, canView } = useAuth();
  const location = useLocation();
  if (loading || restoring) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  const gate = PAGE_KEYS.find((p) => location.pathname === p.prefix || location.pathname.startsWith(p.prefix));
  if (gate && !canView(gate.key)) return <Navigate to="/forbidden" replace />;
  return <Layout>{children ?? <Outlet />}</Layout>;
};

const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { user, isAdmin, loading, restoring } = useAuth();
  if (loading || restoring) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
};

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ClinicSettingsProvider>
          <AuthProvider>
            <Router>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/forbidden" element={<Forbidden />} />
                <Route element={<ProtectedLayout />}>
                  <Route path="/" element={<Navigate to="/patients" replace />} />
                  <Route path="/patients" element={<Patients />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/financials" element={<Financials />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/patient/:id" element={<PatientProfile />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route
                    path="/admin"
                    element={
                      <AdminRoute>
                        <AdminPanel />
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={<Navigate to="/admin" replace />}
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Router>
          </AuthProvider>
        </ClinicSettingsProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
