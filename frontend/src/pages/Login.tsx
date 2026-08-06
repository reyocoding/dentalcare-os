import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Stethoscope, Mail, Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../components/Languagecontext';

const Login = () => {
  const { t } = useLanguage();
  const { login, loading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const from = (location.state as { from?: string } | null)?.from ?? '/';

  // Session restored from the refresh cookie while sitting on this page.
  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 403 ? t('login_pending_approval') : status === 401 ? t('auth_invalid_credentials') : t('auth_error_generic'));
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Stethoscope size={28} />
        </div>
        <h1 className="auth-title">{t('app_name')}</h1>
        <p className="auth-subtitle">{t('auth_login_subtitle')}</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="login-email">{t('auth_email')}</label>
            <div className="auth-field">
              <span className="auth-field-icon"><Mail size={16} /></span>
              <input
                id="login-email"
                type="email"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="login-password">{t('auth_password')}</label>
            <div className="auth-field">
              <span className="auth-field-icon"><Lock size={16} /></span>
              <input
                id="login-password"
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          <button type="submit" className="submit-btn auth-submit" disabled={loading}>
            {loading ? t('auth_loading') : (
              <>
                {t('auth_sign_in')} <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <p className="auth-switch">
          {t('auth_no_account')} <Link to="/register">{t('auth_register_link')}</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
