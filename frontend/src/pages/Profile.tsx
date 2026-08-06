import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserCircle,
  ShieldCheck,
  Mail,
  Calendar,
  KeyRound,
  Check,
  Pencil,
  Save,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../components/Languagecontext';
import { useTheme } from '../components/ThemeContext';
import { api } from '../services/api';

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'nav_dashboard',
  patients: 'nav_patients',
  calendar: 'nav_calendar',
  financials: 'nav_financials',
  settings: 'nav_settings',
  admin: 'nav_admin_users',
};

const Profile = () => {
  const { user, logout, isAdmin, canView, refreshUser } = useAuth();
  const { t } = useLanguage();
  const { colors } = useTheme();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Editable account details
  const [displayName, setDisplayName] = useState(user?.role_label ?? '');
  const [editEmail, setEditEmail] = useState(user?.email ?? '');
  const [accountPassword, setAccountPassword] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountMessage, setAccountMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handleAccountSave = async () => {
    setAccountMessage(null);
    const email = editEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAccountMessage({ ok: false, text: t('auth_error_invalid_email') });
      return;
    }
    // Changing the login email requires the current password.
    if (email !== user?.email && !accountPassword) {
      setAccountMessage({ ok: false, text: t('profile_password_required') });
      return;
    }
    setSavingAccount(true);
    try {
      await api.updateMe({
        role_label: displayName.trim() || undefined,
        email,
        current_password: email !== user?.email ? accountPassword : undefined,
      });
      await refreshUser();
      setAccountPassword('');
      setAccountMessage({ ok: true, text: t('profile_account_saved') });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setAccountMessage({ ok: false, text: status === 409 ? t('profile_email_taken') : t('auth_error_generic') });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword.length < 8) {
      setMessage({ ok: false, text: t('profile_password_short') });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ ok: false, text: t('profile_password_mismatch') });
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setMessage({ ok: true, text: t('profile_password_changed') });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setMessage({ ok: false, text: status === 400 ? t('profile_password_wrong') : t('auth_error_generic') });
    } finally {
      setSaving(false);
    }
  };

  const card: React.CSSProperties = {
    background: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: '14px',
    padding: '22px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: `1px solid ${colors.border}`,
    fontSize: '14px',
    boxSizing: 'border-box',
    background: colors.bgInput,
    color: colors.text,
  };

  const infoRow = (icon: React.ReactNode, label: string, value: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ color: colors.textMuted, display: 'flex' }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ fontSize: '14px', color: colors.text, marginTop: 1 }}>{value}</div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '32px', maxWidth: '640px', margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 700, color: colors.text }}>
        {t('profile_title')}
      </h2>
      <p style={{ margin: '0 0 24px', color: colors.textSecondary, fontSize: '14px' }}>
        {t('profile_subtitle')}
      </p>

      {/* ── Account card ── */}
      <div style={{ ...card, marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: colors.accent, color: colors.accentText, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <UserCircle size={28} />
          </div>
          <div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: colors.text }}>
              {user?.role_label || user?.email}
            </div>
            <div style={{ fontSize: '13px', color: colors.textSecondary }}>
              {user?.email}
            </div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            {isAdmin ? (
              <span style={{ fontSize: '11px', fontWeight: 700, background: '#ede9fe', color: '#6d28d9', padding: '4px 12px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ShieldCheck size={12} /> {t('admin_role_badge')}
              </span>
            ) : (
              <span style={{ fontSize: '11px', fontWeight: 700, background: colors.bgInput, color: colors.textSecondary, padding: '4px 12px', borderRadius: '999px' }}>
                {user?.role_label || user?.role}
              </span>
            )}
          </div>
        </div>

        {infoRow(<Mail size={14} />, t('auth_email'), user?.email ?? '—')}
        {infoRow(<ShieldCheck size={14} />, t('profile_role'), user?.role_label ? `${user.role_label} (${user.role})` : user?.role ?? '—')}
        {infoRow(<Calendar size={14} />, t('profile_member_since'), user ? new Date(user.created_at).toLocaleDateString() : '—')}

        {/* Permissions summary */}
        <div style={{ padding: '9px 0' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            {t('profile_permissions')}
          </div>
          {isAdmin || !user?.permissions ? (
            <span style={{ fontSize: '13px', color: colors.textSecondary }}>{t('profile_full_access')}</span>
          ) : user.permissions.length === 0 ? (
            <span style={{ fontSize: '13px', color: colors.danger }}>{t('profile_no_access')}</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {user.permissions.filter(p => canView(p)).map(p => (
                <span key={p} style={{ fontSize: '12px', fontWeight: 600, background: colors.accentHover, color: colors.accent, padding: '3px 10px', borderRadius: '999px' }}>
                  {t(PAGE_LABELS[p] as any) ?? p}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Account details (editable) ── */}
      <div style={{ ...card, marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Pencil size={16} color={colors.accent} />
          <span style={{ fontWeight: 700, fontSize: '15px', color: colors.text }}>{t('profile_edit_account')}</span>
        </div>

        {accountMessage && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: accountMessage.ok ? colors.successBg : '#fee2e2',
            border: `1px solid ${accountMessage.ok ? colors.success : '#fecaca'}`,
            borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
            color: accountMessage.ok ? colors.success : '#b91c1c', fontSize: '13px', fontWeight: 600,
          }}>
            {accountMessage.ok ? <Check size={14} /> : null}
            {accountMessage.text}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
              {t('profile_display_name')}
            </label>
            <input
              type="text"
              style={inputStyle}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('profile_name_placeholder')}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
              {t('auth_email')}
            </label>
            <input
              type="email"
              style={inputStyle}
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
              {t('profile_current_password')}
            </label>
            <input
              type="password"
              style={inputStyle}
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              autoComplete="current-password"
              placeholder={t('profile_password_required_hint')}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleAccountSave}
              disabled={savingAccount}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: colors.accent, color: colors.accentText, border: 'none',
                borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Save size={14} /> {savingAccount ? t('saving') : t('save_changes')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Change password card ── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <KeyRound size={16} color={colors.accent} />
          <span style={{ fontWeight: 700, fontSize: '15px', color: colors.text }}>{t('profile_change_password')}</span>
        </div>

        {message && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: message.ok ? colors.successBg : '#fee2e2',
            border: `1px solid ${message.ok ? colors.success : '#fecaca'}`,
            borderRadius: '8px', padding: '10px 12px', marginBottom: '14px',
            color: message.ok ? colors.success : '#b91c1c', fontSize: '13px', fontWeight: 600,
          }}>
            {message.ok ? <Check size={14} /> : null}
            {message.text}
          </div>
        )}

        <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
              {t('profile_current_password')}
            </label>
            <input
              type="password"
              style={inputStyle}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
              {t('profile_new_password')}
            </label>
            <input
              type="password"
              style={inputStyle}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
              {t('profile_confirm_password')}
            </label>
            <input
              type="password"
              style={inputStyle}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: 'none', border: `1px solid ${colors.border}`, color: colors.danger,
                borderRadius: '8px', padding: '9px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              <LogOut size={14} /> {t('auth_logout')}
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: colors.accent, color: colors.accentText, border: 'none',
                borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {saving ? t('saving') : t('save_changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Profile;
