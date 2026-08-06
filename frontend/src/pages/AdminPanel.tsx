import { useEffect, useMemo, useState } from 'react';
import {
  Users,
  ShieldCheck,
  UserPlus,
  Stethoscope,
  CalendarCheck,
  DollarSign,
  FileText,
  Activity,
  Trash2,
  RefreshCw,
  Settings2,
  Download,
  Check,
  X,
  Clock,
  KeyRound,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart as RePieChart,
  Pie,
  Cell,
} from 'recharts';
import { api, type AdminStats, type AuditLog, type AuthUser } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../components/Languagecontext';
import { useTheme } from '../components/ThemeContext';
import { useClinicSettings } from '../components/ClinicSettings';

type Tab = 'overview' | 'users' | 'logs';

const ACTION_LABELS: Record<string, string> = {
  register: 'admin_log_register',
  register_approved: 'admin_log_register_approved',
  login: 'admin_log_login',
  login_failed: 'admin_log_login_failed',
  logout: 'admin_log_logout',
  admin_created: 'admin_log_admin_created',
  user_deleted: 'admin_log_user_deleted',
  role_changed: 'admin_log_role_changed',
  access_changed: 'admin_log_access_changed',
  password_changed: 'admin_log_password_changed',
  password_change_failed: 'admin_log_password_change_failed',
  password_reset: 'admin_log_password_reset',
  post: 'admin_log_create',
  put: 'admin_log_update',
  delete: 'admin_log_delete',
};

const STATUS_COLORS: Record<string, string> = {
  Scheduled: '#3b82f6',
  'In Treatment': '#9333ea',
  Completed: '#10b981',
  Canceled: '#ef4444',
  'No-Show': '#f59e0b',
};

// Pages an admin can grant/deny per user (keys must match the route guard
// in App.tsx).
export const PAGES: { key: string; labelKey: string }[] = [
  { key: 'dashboard', labelKey: 'nav_dashboard' },
  { key: 'patients', labelKey: 'nav_patients' },
  { key: 'calendar', labelKey: 'nav_calendar' },
  { key: 'financials', labelKey: 'nav_financials' },
  { key: 'settings', labelKey: 'nav_settings' },
  { key: 'admin', labelKey: 'nav_admin_users' },
];

const OverviewTab = ({ stats }: { stats: AdminStats }) => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const { formatMoney } = useClinicSettings();

  const cards = [
    { label: t('admin_stat_users'), value: stats.users, icon: <Users size={16} />, color: colors.accent, bg: colors.accentHover },
    { label: t('admin_stat_pending'), value: stats.pending_approvals, icon: <Clock size={16} />, color: '#b45309', bg: '#fef3c7' },
    { label: t('admin_stat_admins'), value: stats.admins, icon: <ShieldCheck size={16} />, color: '#9333ea', bg: '#faf5ff' },
    { label: t('admin_stat_patients'), value: stats.patients, icon: <UserPlus size={16} />, color: '#0891b2', bg: '#ecfeff' },
    { label: t('admin_stat_appointments'), value: stats.appointments, icon: <CalendarCheck size={16} />, color: colors.success, bg: colors.successBg },
    { label: t('admin_stat_today'), value: stats.today_appointments, icon: <Activity size={16} />, color: '#f59e0b', bg: '#fef3c7' },
    { label: t('admin_stat_treatments'), value: stats.treatments, icon: <Stethoscope size={16} />, color: '#0891b2', bg: '#ecfeff' },
    { label: t('admin_stat_sessions'), value: stats.sessions_completed, icon: <Activity size={16} />, color: '#0ea5e9', bg: '#e0f2fe' },
    { label: t('admin_stat_collected'), value: formatMoney(stats.total_collected), icon: <DollarSign size={16} />, color: colors.success, bg: colors.successBg },
    { label: t('admin_stat_30d'), value: formatMoney(stats.collected_30d), icon: <DollarSign size={16} />, color: '#059669', bg: '#d1fae5' },
    { label: t('admin_stat_documents'), value: stats.documents, icon: <FileText size={16} />, color: '#64748b', bg: '#f1f5f9' },
    { label: t('admin_stat_payments'), value: stats.payments, icon: <DollarSign size={16} />, color: '#0f766e', bg: '#ccfbf1' },
    { label: t('admin_stat_audit'), value: stats.audit_events, icon: <Activity size={16} />, color: '#7c3aed', bg: '#ede9fe' },
  ];

  const regSeries = useMemo(() => {
    const days: { day: string; users: number; revenue: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ day: key.slice(5), users: stats.registrations_30d[key] ?? 0, revenue: stats.revenue_30d[key] ?? 0 });
    }
    return days;
  }, [stats]);

  const statusPie = useMemo(
    () =>
      Object.entries(stats.appointment_status_counts)
        .map(([name, value]) => ({ name, value }))
        .filter((d) => d.value > 0),
    [stats]
  );

  const cardStyle = {
    background: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    minWidth: 0,
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '12px' }}>
        {cards.map((c) => (
          <div key={c.label} style={cardStyle}>
            <div style={{ width: 34, height: 34, borderRadius: '10px', background: c.bg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {c.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: colors.text, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.value}</div>
              <div style={{ fontSize: '11px', color: colors.textSecondary, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '16px' }}>
        <div style={{ background: colors.bgCard, border: `1px solid ${colors.border}`, borderRadius: '14px', padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: colors.text, marginBottom: '12px' }}>{t('admin_chart_activity')}</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={regSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: colors.textSecondary }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: colors.textSecondary }} width={30} />
              <Tooltip />
              <Bar dataKey="users" name={t('admin_series_registrations')} fill={colors.accent} radius={[3, 3, 0, 0]} />
              <Bar dataKey="revenue" name={t('admin_series_revenue')} fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: colors.bgCard, border: `1px solid ${colors.border}`, borderRadius: '14px', padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: colors.text, marginBottom: '12px' }}>{t('admin_chart_statuses')}</div>
          {statusPie.length === 0 ? (
            <div style={{ color: colors.textMuted, fontSize: '13px', textAlign: 'center', padding: '60px 0' }}>{t('no_data')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <RePieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                  {statusPie.map((s) => (
                    <Cell key={s.name} fill={STATUS_COLORS[s.name] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip />
              </RePieChart>
            </ResponsiveContainer>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '4px' }}>
            {statusPie.map((s) => (
              <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: colors.textSecondary }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLORS[s.name] ?? '#94a3b8' }} />
                {s.name} ({s.value})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const UsersTab = () => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Access editor modal
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [accessLabel, setAccessLabel] = useState('');
  const [accessFull, setAccessFull] = useState(true);
  const [accessPages, setAccessPages] = useState<string[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);

  // Password reset modal
  const [resettingUser, setResettingUser] = useState<AuthUser | null>(null);
  const [resetPass, setResetPass] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.getUsers());
    } catch {
      setError(t('auth_error_generic'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openAccessEditor = (u: AuthUser) => {
    setEditingUser(u);
    setAccessLabel(u.role_label || '');
    setAccessFull(!u.permissions);
    setAccessPages(u.permissions || PAGES.map((p) => p.key));
    setError(null);
  };

  const saveAccess = async () => {
    if (!editingUser) return;
    setSavingAccess(true);
    setError(null);
    try {
      const permissions = accessFull ? null : accessPages;
      const updated = await api.updateUserSettings(editingUser.id, {
        role_label: accessLabel.trim() || undefined,
        permissions,
      });
      setUsers((prev) => prev.map((x) => (x.id === editingUser.id ? updated : x)));
      setEditingUser(null);
    } catch {
      setError(t('auth_error_generic'));
    } finally {
      setSavingAccess(false);
    }
  };

  const changeRole = async (u: AuthUser, nextRole: string) => {
    if (nextRole === u.role) return;
    if (u.role === 'admin' && !window.confirm(`${t('admin_demote_confirm')} ${u.email}?`)) {
      return;
    }
    setBusyId(u.id);
    setError(null);
    try {
      await api.updateUserRole(u.id, nextRole);
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, role: nextRole as AuthUser['role'] } : x))
      );
    } catch {
      setError(t('auth_error_generic'));
    } finally {
      setBusyId(null);
    }
  };

  const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'admin', label: t('role_admin') },
    { value: 'dentist', label: t('role_dentist') },
    { value: 'hygienist', label: t('role_hygienist') },
    { value: 'receptionist', label: t('role_receptionist') },
    { value: 'user', label: t('role_user') },
  ];

  const handleDelete = async (u: AuthUser) => {
    if (!window.confirm(`${t('admin_delete_confirm')} ${u.email}?`)) return;
    setBusyId(u.id);
    setError(null);
    try {
      await api.deleteUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch {
      setError(t('auth_error_generic'));
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = async (u: AuthUser) => {
    if (!window.confirm(`${t('admin_approve_confirm')} ${u.email}?`)) return;
    setBusyId(u.id);
    setError(null);
    try {
      const updated = await api.approveUser(u.id);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch {
      setError(t('auth_error_generic'));
    } finally {
      setBusyId(null);
    }
  };

  const openReset = (u: AuthUser) => {
    setResettingUser(u);
    setResetPass('');
    setResetConfirm('');
    setError(null);
  };

  const submitReset = async () => {
    if (!resettingUser) return;
    if (resetPass.length < 8) {
      setError(t('auth_password_short'));
      return;
    }
    if (resetPass !== resetConfirm) {
      setError(t('auth_password_mismatch'));
      return;
    }
    setResetting(true);
    setError(null);
    try {
      await api.resetUserPassword(resettingUser.id, resetPass);
      setResettingUser(null);
      setError(t('admin_reset_success'));
    } catch {
      setError(t('auth_error_generic'));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      {error && <div className="auth-error">{error}</div>}
      {loading ? (
        <p>{t('loading')}</p>
      ) : (
        <table className="admin-users-table">
          <thead>
            <tr>
              <th>{t('auth_email')}</th>
              <th>{t('auth_role')}</th>
              <th>{t('admin_created_at')}</th>
              <th>{t('admin_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.email}
                  {u.id === me?.id && <span className="admin-me-badge">{t('admin_you')}</span>}
                  {!u.is_approved && <span className="admin-pending-badge">{t('admin_pending')}</span>}
                  {u.role_label && (
                    <div style={{ fontSize: '12px', color: colors.textMuted, marginTop: 2 }}>
                      {u.role_label}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`admin-role-badge ${u.role}`}>
                    {ROLE_OPTIONS.find((r) => r.value === u.role)?.label ?? u.role}
                  </span>
                </td>
                <td>{new Date(u.created_at).toLocaleString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {!u.is_approved && (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busyId === u.id}
                        onClick={() => handleApprove(u)}
                      >
                        <Check size={14} />
                        {t('admin_approve')}
                      </button>
                    )}
                    <button
                      className="btn-icon"
                      title={t('admin_access')}
                      disabled={busyId === u.id}
                      onClick={() => openAccessEditor(u)}
                    >
                      <Settings2 size={16} />
                    </button>
                    <select
                      className="admin-role-select"
                      value={u.role}
                      disabled={u.id === me?.id || busyId === u.id}
                      onChange={(e) => changeRole(u, e.target.value)}
                      title={t('auth_role')}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <button
                      className="btn-icon"
                      title={t('admin_reset_password')}
                      disabled={u.id === me?.id || busyId === u.id}
                      onClick={() => openReset(u)}
                    >
                      <KeyRound size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      title={t('delete')}
                      disabled={u.id === me?.id || busyId === u.id}
                      onClick={() => handleDelete(u)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Access editor modal ── */}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-content" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('admin_access_title')}</h3>
              <button className="close-btn" onClick={() => setEditingUser(null)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '0 24px 24px' }}>
              <p style={{ fontSize: '13px', color: colors.textSecondary, margin: '0 0 16px' }}>
                {editingUser.email}
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
                  {t('admin_role_label')}
                </label>
                <input
                  className="input-field"
                  value={accessLabel}
                  onChange={(e) => setAccessLabel(e.target.value)}
                  placeholder={t('admin_role_label_placeholder')}
                />
                <p style={{ margin: '5px 0 0', fontSize: '11px', color: colors.textMuted }}>
                  {t('admin_role_label_hint')}
                </p>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '8px' }}>
                  {t('admin_permissions')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: colors.text, cursor: 'pointer', marginBottom: '8px', padding: '9px 12px', borderRadius: '8px', background: accessFull ? colors.accentHover : colors.bgInput, border: `1px solid ${accessFull ? colors.accent : colors.border}` }}>
                  <input type="checkbox" checked={accessFull} onChange={(e) => setAccessFull(e.target.checked)} />
                  {t('admin_full_access')}
                </label>
                {!accessFull && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', background: colors.bgInput, borderRadius: '8px', border: `1px solid ${colors.border}` }}>
                    {PAGES.map((p) => (
                      <label key={p.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: colors.text, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={accessPages.includes(p.key)}
                          onChange={(e) => {
                            setAccessPages((prev) =>
                              e.target.checked
                                ? [...prev, p.key]
                                : prev.filter((k) => k !== p.key)
                            );
                          }}
                        />
                        {t(p.labelKey as any)}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>
                  {t('cancel')}
                </button>
                <button className="btn btn-primary" onClick={saveAccess} disabled={savingAccess}>
                  <Check size={14} />
                  {savingAccess ? t('saving') : t('save_changes')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Password reset modal ── */}
      {resettingUser && (
        <div className="modal-overlay" onClick={() => setResettingUser(null)}>
          <div className="modal-content" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t('admin_reset_password_title')}</h3>
              <button className="close-btn" onClick={() => setResettingUser(null)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '0 24px 24px' }}>
              <p style={{ fontSize: '13px', color: colors.textSecondary, margin: '0 0 16px' }}>
                {resettingUser.email}
              </p>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
                  {t('profile_new_password')}
                </label>
                <input
                  className="input-field"
                  type="password"
                  value={resetPass}
                  onChange={(e) => setResetPass(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: colors.textSecondary, marginBottom: '6px' }}>
                  {t('profile_confirm_password')}
                </label>
                <input
                  className="input-field"
                  type="password"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button className="btn btn-secondary" onClick={() => setResettingUser(null)}>
                  {t('cancel')}
                </button>
                <button className="btn btn-primary" onClick={submitReset} disabled={resetting}>
                  <KeyRound size={14} />
                  {resetting ? t('saving') : t('admin_reset_password')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ACTION_STYLE: Record<string, { bg: string; color: string }> = {
  login: { bg: '#d1fae5', color: '#047857' },
  logout: { bg: '#e2e8f0', color: '#475569' },
  login_failed: { bg: '#fee2e2', color: '#b91c1c' },
  register: { bg: '#dbeafe', color: '#1d4ed8' },
  register_approved: { bg: '#d1fae5', color: '#047857' },
  admin_created: { bg: '#ede9fe', color: '#6d28d9' },
  user_deleted: { bg: '#fee2e2', color: '#b91c1c' },
  role_changed: { bg: '#fef3c7', color: '#b45309' },
  access_changed: { bg: '#ede9fe', color: '#6d28d9' },
  password_changed: { bg: '#d1fae5', color: '#047857' },
  password_change_failed: { bg: '#fee2e2', color: '#b91c1c' },
  password_reset: { bg: '#fef3c7', color: '#b45309' },
};

const LogsTab = () => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const page = await api.getAuditLogs({ limit: 200, search: search || undefined, action: actionFilter || undefined });
      setLogs(page.logs);
      setTotal(page.total);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [search, actionFilter]);

  const actionKey = (a: string) => ACTION_LABELS[a] ?? a;

  const exportLogs = async () => {
    setExporting(true);
    try {
      const all: AuditLog[] = [];
      for (let skip = 0; skip < Math.max(total, 1); skip += 1000) {
        const page = await api.getAuditLogs({ skip, limit: 1000, search: search || undefined, action: actionFilter || undefined });
        all.push(...page.logs);
      }
      const headers = ['ID', 'Time', 'User', 'Action', 'Resource', 'Details', 'IP'];
      const rows = all.map((l) => [
        l.id,
        new Date(l.created_at).toLocaleString(),
        l.user_email ?? '',
        l.action,
        l.resource ? `${l.resource}${l.resource_id ? ` #${l.resource_id}` : ''}` : '',
        l.details ?? '',
        l.ip_address ?? '',
      ]);
      const csv = [headers, ...rows]
        .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'audit_logs_export.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setLogs([]);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          className="input-field"
          placeholder={t('admin_logs_search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 220px' }}
        />
        <select
          className="input-field"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          style={{ width: 'auto' }}
        >
          <option value="">{t('admin_logs_all_actions')}</option>
          {Object.keys(ACTION_LABELS).map((a) => (
            <option key={a} value={a}>{t(ACTION_LABELS[a] as any)}</option>
          ))}
        </select>
        <button className="btn-icon" onClick={load} title={t('admin_refresh')} style={{ alignSelf: 'center' }}>
          <RefreshCw size={16} />
        </button>
        <button
          className="btn-icon"
          onClick={exportLogs}
          disabled={exporting || total === 0}
          title={t('admin_export_logs')}
          style={{ alignSelf: 'center' }}
        >
          <Download size={16} />
        </button>
      </div>

      <div style={{ fontSize: '12px', color: colors.textMuted }}>
        {t('admin_logs_total')}: {total}
      </div>

      {loading ? (
        <p>{t('loading')}</p>
      ) : logs.length === 0 ? (
        <p style={{ color: colors.textMuted }}>{t('no_data')}</p>
      ) : (
        <div style={{ maxHeight: '62vh', overflowY: 'auto', borderRadius: '12px', border: `1px solid ${colors.border}` }}>
          <table className="admin-users-table" style={{ borderRadius: 0 }}>
            <thead>
              <tr>
                <th>{t('admin_log_time')}</th>
                <th>{t('admin_log_user')}</th>
                <th>{t('admin_log_action')}</th>
                <th>{t('admin_log_resource')}</th>
                <th>{t('admin_log_details')}</th>
                <th>{t('admin_log_ip')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const style = ACTION_STYLE[l.action];
                return (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(l.created_at).toLocaleString()}</td>
                    <td>{l.user_email ?? '—'}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 9px',
                          borderRadius: '999px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: style?.bg ?? '#f1f5f9',
                          color: style?.color ?? '#475569',
                        }}
                      >
                        {t(actionKey(l.action) as any)}
                      </span>
                    </td>
                    <td style={{ fontSize: '12px' }}>
                      {l.resource ?? '—'}
                      {l.resource_id ? ` #${l.resource_id}` : ''}
                    </td>
                    <td style={{ fontSize: '12px', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.details ?? ''}>
                      {l.details ?? '—'}
                    </td>
                    <td style={{ fontSize: '12px' }}>{l.ip_address ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const AdminPanel = () => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    api.getAdminStats().then(setStats).catch(() => setStats(null));
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: t('admin_tab_overview') },
    { key: 'users', label: t('admin_tab_users') },
    { key: 'logs', label: t('admin_tab_logs') },
  ];

  return (
    <div className="admin-users-page">
      <h2>{t('admin_title')}</h2>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', borderBottom: `1px solid ${colors.border}`, paddingBottom: '10px' }}>
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            style={{
              padding: '8px 16px',
              borderRadius: '9px',
              border: 'none',
              background: tab === tb.key ? colors.accent : 'transparent',
              color: tab === tb.key ? colors.accentText : colors.textSecondary,
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (stats ? <OverviewTab stats={stats} /> : <p>{t('loading')}</p>)}
      {tab === 'users' && <UsersTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  );
};

export default AdminPanel;
