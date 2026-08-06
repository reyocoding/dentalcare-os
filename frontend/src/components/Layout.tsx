import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import moment from 'moment';
import { LogOut, Maximize, Minimize, ShieldCheck, UserCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useLanguage } from './Languagecontext';
import { useAuth } from '../contexts/AuthContext';

interface LayoutProps {
  children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const { language, t } = useLanguage();
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  // Fullscreen toggle -- tracks the actual browser state (Esc exits too).
  const [isFullscreen, setIsFullscreen] = useState(() =>
    Boolean(document.fullscreenElement)
  );
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  // Refresh the date at midnight (and use the selected app language, not
  // the browser locale -- ar/fr users get their own format).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setTimeout(() => setNow(new Date()), 60000);
    return () => clearTimeout(timer);
  }, [now]);

  const dateText = (() => {
    switch (language) {
      case 'fr':
        return moment(now).locale('fr').format('dddd D MMMM YYYY');
      case 'ar':
        return moment(now).locale('ar').format('dddd D MMMM YYYY');
      default:
        return moment(now).locale('en').format('dddd, MMMM D, YYYY');
    }
  })();

  // Collapsible sidebar -- persisted so the user's preference survives
  // reloads (guarded: storage can be restricted).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dental_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggleSidebar = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('dental_sidebar_collapsed', next ? '1' : '0');
      } catch {}
      return next;
    });
  };

  return (
    <div className="app-container">
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
      <main className="main-content">
        <header className="top-header">
          <div className="header-info">
            <span className="date-display">{dateText}</span>
          </div>
          <div className="header-user">
            {isAdmin && <ShieldCheck className="header-user-icon" size={16} />}
            <button
              className="header-user-email"
              onClick={() => navigate('/profile')}
              title={t('nav_profile')}
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <UserCircle size={15} />
              <span>{user?.email}</span>
            </button>
            <button
              className="header-icon-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}
              aria-label={isFullscreen ? t('fullscreen_exit') : t('fullscreen_enter')}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
            <button
              className="header-logout-btn"
              onClick={handleLogout}
              title={t('auth_logout')}
              aria-label={t('auth_logout')}
            >
              <LogOut size={16} />
              <span>{t('auth_logout')}</span>
            </button>
          </div>
        </header>
        <div className="content-area">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
