import { Link } from 'react-router-dom';
import { useLanguage } from '../components/Languagecontext';

const Forbidden = () => {
  const { t } = useLanguage();

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">403</h1>
        <p className="auth-subtitle">{t('auth_forbidden')}</p>
        <Link to="/" className="submit-btn auth-submit" style={{ textAlign: 'center' }}>
          {t('back')}
        </Link>
      </div>
    </div>
  );
};

export default Forbidden;
