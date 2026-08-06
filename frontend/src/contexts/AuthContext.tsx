import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  setApiToken,
  setUnauthorizedHandler,
  restoreSession,
  type AuthUser,
} from '../services/api';

// No interaction for this long => forced sign-out (inactivity protection).
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

interface AuthContextValue {
  user: AuthUser | null;
  isAdmin: boolean;
  loading: boolean;
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  canView: (page: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // JWT lives in memory only (no localStorage/sessionStorage) -- the
  // smallest attack surface. Sessions survive reloads through the HttpOnly
  // refresh cookie, which JS can never read.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);

  const logout = useCallback(() => {
    // Fire-and-forget: record the sign-out in the audit trail and revoke
    // the refresh cookie server-side, then drop the token locally
    // regardless of the response.
    api.logout().catch(() => {});
    setApiToken(null);
    setUser(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const { access_token, user: me } = await api.login(email, password);
      setApiToken(access_token);
      setUser(me);
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      return await api.register(email, password);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const me = await api.getMe();
    setUser(me);
  }, []);

  // ---- session restore on app mount ----
  useEffect(() => {
    let cancelled = false;
    restoreSession().then(async (restored) => {
      if (cancelled) return;
      if (restored) {
        try {
          await refreshUser();
        } catch {
          logout();
        }
      }
      if (!cancelled) setRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshUser, logout]);

  // ---- inactivity auto-logout ----
  const lastActivityRef = useRef(Date.now());
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    const resetTimer = () => {
      lastActivityRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    const interval = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_TIMEOUT_MS) {
        logoutRef.current();
      }
    }, 60 * 1000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      window.clearInterval(interval);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const onUnauthorized = () => {
      setApiToken(null);
      setUser(null);
    };
    setUnauthorizedHandler(onUnauthorized);
    // Page-level access: admins always have everything; regular users are
    // limited to the pages an admin granted them. NULL permissions = all.
    const canView = (page: string): boolean => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (!user.permissions) return true;
      return user.permissions.includes(page);
    };
    return {
      user,
      isAdmin: user?.role === 'admin',
      loading,
      restoring,
      login,
      register,
      logout,
      refreshUser,
      canView,
    };
  }, [user, loading, restoring, login, register, logout, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
