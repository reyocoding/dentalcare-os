import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, Mail, Lock, UserPlus, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../components/Languagecontext';

const Register = () => {
  const { t } = useLanguage();
  const { register, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Synchronous guard: state updates are async, so a double-click could
  // slip two requests through before `loading` flips the button disabled.
  const submittingRef = useRef(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);

    if (password.length < 8) {
      setError(t('auth_password_short'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth_password_mismatch'));
      return;
    }

    submittingRef.current = true;
    try {
      const user = await register(email, password);
      setDone(user.email);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) setError(t('auth_email_taken'));
      else setError(t('auth_error_generic'));
    } finally {
      submittingRef.current = false;
    }
  };

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <Stethoscope size={28} />
          </div>
          <h1 className="auth-title">{t('register_pending_title')}</h1>
          <p className="auth-subtitle">
            {t('register_pending_body')}
          </p>

          <div className="auth-pending">
            <Clock size={40} />
            <div>
              <strong>{done}</strong>
              <p style={{ margin: '4px 0 0' }}>{t('register_pending_hint')}</p>
            </div>
          </div>

          <Link to="/login" className="submit-btn auth-submit" style={{ textDecoration: 'none', textAlign: 'center' }}>
            {t('auth_sign_in')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <Stethoscope size={28} />
        </div>
        <h1 className="auth-title">{t('auth_register_title')}</h1>
        <p className="auth-subtitle">{t('auth_register_subtitle')}</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="reg-email">{t('auth_email')}</label>
            <div className="auth-field">
              <span className="auth-field-icon"><Mail size={16} /></span>
              <input
                id="reg-email"
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
            <label htmlFor="reg-password">{t('auth_password')}</label>
            <div className="auth-field">
              <span className="auth-field-icon"><Lock size={16} /></span>
              <input
                id="reg-password"
                type="password"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="reg-confirm">{t('auth_confirm_password')}</label>
            <div className="auth-field">
              <span className="auth-field-icon"><Lock size={16} /></span>
              <input
                id="reg-confirm"
                type="password"
                className="input-field"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
          </div>

          <button type="submit" className="submit-btn auth-submit" disabled={loading}>
            {loading ? t('auth_loading') : (
              <>
                {t('auth_create_account')} <UserPlus size={16} />
              </>
            )}
          </button>
        </form>

        <p className="auth-switch">
          {t('auth_have_account')} <Link to="/login">{t('auth_sign_in')}</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
