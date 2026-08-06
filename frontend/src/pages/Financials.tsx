import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import { api, toLocalNaiveISO } from '../services/api';
import type { Payment, PaymentCreate, Patient, Treatment, TreatmentSession } from '../services/api';
import { useLanguage } from "../components/Languagecontext"; // <-- adjust path
import { useTheme } from "../components/ThemeContext";
import { useClinicSettings } from "../components/ClinicSettings";
import { 
  DollarSign,
  TrendingUp, 
  Clock, 
  Plus, 
  Trash2, 
  X, 
  CreditCard, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Download,
  PieChart,
  BarChart3,
  Users,
  FileText,
  Receipt,
  Percent,
  Wallet,
  Banknote,
  CalendarRange,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart as RePieChart, Pie, Cell, Legend } from 'recharts';

type TabType = 'Overview' | 'Transactions' | 'Reports' | 'Pending' | 'Balances';
const TABS: TabType[] = ['Overview', 'Transactions', 'Reports', 'Pending', 'Balances'];

const COLORS = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--danger)', '#8b5cf6', '#ec4899'];

// Financial summary type from API
type FinancialSummary = {
  total_collected: number;
  total_pending: number;
  total_billed: number;
  total_outstanding: number;
  collection_rate: number;
  discounts_given: number;
  sessions_completed: number;
  avg_per_visit: number;
  aging: Record<string, number>;
  patient_balances: Array<{
    patient_id: number;
    first_name: string;
    last_name: string;
    balance: number;
  }>;
};

const Financials = () => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const { formatMoney } = useClinicSettings();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>('Overview');
  
  const [payments, setPayments] = useState<Payment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sessions, setSessions] = useState<TreatmentSession[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [, setLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [methodFilter, setMethodFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'lastMonth' | 'custom'>('month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const [patientTreatments, setPatientTreatments] = useState<Treatment[]>([]);
  const [treatmentSessions, setTreatmentSessions] = useState<TreatmentSession[]>([]);
  const [selectedTreatmentId, setSelectedTreatmentId] = useState<string>('');
  const consumedParams = useRef<string | null>(null);

  // Naive local wall-clock -- matches how the backend stores datetimes.
  // toISOString() would shift every payment by the tz offset (UTC+1: -1h).
  const toLocalISODateTime = (d: Date) => toLocalNaiveISO(d);
  const [formData, setFormData] = useState<PaymentCreate>({
    patient_id: 0,
    treatment_id: undefined,
    session_id: undefined,
    amount: 0,
    payment_date: toLocalISODateTime(new Date()),
    method: 'Cash',
    description: '',
    status: 'Completed',
  });

  const resetForm = () => {
    setFormData({
      patient_id: 0,
      treatment_id: undefined,
      session_id: undefined,
      amount: 0,
      payment_date: toLocalISODateTime(new Date()),
      method: 'Cash',
      description: '',
      status: 'Completed',
    });
    setPatientTreatments([]);
    setTreatmentSessions([]);
    setSelectedTreatmentId('');
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [paymentsData, patientsData, summaryData] = await Promise.all([
        api.getPayments(),
        api.getPatients(),
        api.getFinancialSummary(),
      ]);
      setPayments(paymentsData);
      setPatients(patientsData);
      setSummary(summaryData);
      
      const allTreatments = await Promise.all(
        patientsData.map(p => api.getPatientTreatments(p.id).catch(() => []))
      );
      const flatTreatments = allTreatments.flat();
      setTreatments(flatTreatments);
      
      const allSessions = await Promise.all(
        flatTreatments.map(t => api.getTreatmentSessions(t.id).catch(() => []))
      );
      const flatSessions = allSessions.flat();
      setSessions(flatSessions);
      
    } catch (error) {
      console.error('Error loading financial data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const paramsKey = searchParams.toString();
    if (paramsKey === consumedParams.current) return;
    const incomingPatientId = searchParams.get('patient');
    const incomingTreatmentId = searchParams.get('treatment');
    const incomingSessionId = searchParams.get('session');
    const incomingDate = searchParams.get('date');

    if (!incomingPatientId) return;
    consumedParams.current = paramsKey;

    (async () => {
      const sessionId = incomingSessionId ? Number(incomingSessionId) : undefined;
      let treatmentId = incomingTreatmentId ? Number(incomingTreatmentId) : undefined;
      let amount = 0;
      let description = '';
      let paymentDate = incomingDate || toLocalISODateTime(new Date());

      // Resolve the session (fall back to the global list, then fetch it)
      let session: TreatmentSession | undefined = sessionId
        ? sessions.find(s => s.id === sessionId)
        : undefined;
      if (!session && sessionId && treatmentId) {
        const list = await api.getTreatmentSessions(treatmentId).catch(() => [] as TreatmentSession[]);
        session = list.find(s => s.id === sessionId);
      }
      // sessions/treatments state may still be empty on the first load --
      // resolve from fresh fetches instead of giving up and prefilling
      // amount: 0.
      if (!session && sessionId && !treatmentId) {
        const patientId = Number(incomingPatientId);
        const fetchedTreatments = await api.getPatientTreatments(patientId).catch(() => [] as Treatment[]);
        for (const trt of fetchedTreatments) {
          const list = await api.getTreatmentSessions(trt.id).catch(() => [] as TreatmentSession[]);
          const found = list.find(s => s.id === sessionId);
          if (found) {
            session = found;
            treatmentId = trt.id;
            break;
          }
        }
      }
      if (session) {
        treatmentId = session.treatment_id;
        amount = session.cost || 0;
        if (session.procedure_done) description = `Session ${session.session_number}: ${session.procedure_done}`;
        if (session.visit_date) paymentDate = session.visit_date;
      }

      let treatment = treatments.find(trt => trt.id === treatmentId);
      if (!treatment && treatmentId) {
        const patientId = Number(incomingPatientId);
        const fetched = await api.getPatientTreatments(patientId).catch(() => [] as Treatment[]);
        treatment = fetched.find(trt => trt.id === treatmentId);
      }
      if (treatment) {
        if (!amount) amount = treatment.total_cost || 0;
        if (!description) description = treatment.procedure || '';
      }

      setFormData((prev) => ({
        ...prev,
        patient_id: Number(incomingPatientId),
        treatment_id: treatmentId,
        session_id: sessionId,
        amount,
        description,
        payment_date: paymentDate,
      }));
      if (treatmentId) setSelectedTreatmentId(String(treatmentId));
      setIsModalOpen(true);
      // Drop the prefill params from the URL (replace, not push) so the
      // same appointment can trigger the prefill again on a second
      // "Complete & Payment" click -- otherwise consumedParams never
      // changes and the effect is skipped forever.
      window.history.replaceState({}, '', '/financials');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  useEffect(() => {
    if (!formData.patient_id) {
      setPatientTreatments([]);
      return;
    }
    api
      .getPatientTreatments(formData.patient_id)
      .then(setPatientTreatments)
      .catch((err) => console.error('Failed to load patient treatments', err));
  }, [formData.patient_id]);

  useEffect(() => {
    if (!selectedTreatmentId) {
      setTreatmentSessions([]);
      return;
    }
    api
      .getTreatmentSessions(Number(selectedTreatmentId))
      .then(setTreatmentSessions)
      .catch((err) => console.error('Failed to load treatment sessions', err));
  }, [selectedTreatmentId]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'amount' || name === 'patient_id' ? Number(value) : value,
    }));
  };

  const handleTreatmentSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const treatment = patientTreatments.find((trt) => trt.id === Number(value));
    setSelectedTreatmentId(value);
    setFormData((prev) => ({
      ...prev,
      treatment_id: value ? Number(value) : undefined,
      session_id: undefined,
      amount: treatment?.total_cost ? treatment.total_cost : 0,
      description: treatment?.procedure ? treatment.procedure : prev.description,
    }));
  };

  const handleSessionSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const session = treatmentSessions.find((s) => s.id === Number(value));
    const treatment = patientTreatments.find((trt) => trt.id === Number(selectedTreatmentId));

    setFormData((prev) => ({
      ...prev,
      session_id: value ? Number(value) : undefined,
      amount: session?.cost
        ? session.cost
        : (treatment?.total_cost ? treatment.total_cost : prev.amount),
      description:
        session?.procedure_done
          ? `Session ${session.session_number}: ${session.procedure_done}`
          : (treatment?.procedure ? treatment.procedure : prev.description),
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (formData.patient_id === 0 || formData.amount <= 0) {
      alert(t("fin_patient_date_required"));
      return;
    }

    setSubmitting(true);
    try {
      await api.createPayment(formData);
      setIsModalOpen(false);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Failed to save payment:', error);
      alert(t("fin_save_error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (window.confirm(t("fin_delete_confirm"))) {
      await api.deletePayment(id);
      loadData();
    }
  };

  const handleQuickSettle = async (payment: Payment) => {
    try {
      // Send only what changed (PaymentUpdate is all-optional server-side)
      // and a local wall-clock date -- not a UTC toISOString() one.
      await api.updatePayment(payment.id, {
        status: 'Completed',
        payment_date: toLocalNaiveISO(new Date()),
      });
      loadData();
    } catch (error) {
      console.error('Failed to settle payment:', error);
      alert(t("fin_settle_error"));
    }
  };

  const getPatientName = (id: number) => {
    const p = patients.find((patient) => patient.id === id);
    return p ? `${p.first_name} ${p.last_name}` : `Patient #${id}`;
  };

  const isSessionPaid = (sessionId: number) => {
    // A session is only paid once completed payments actually cover its
    // cost -- a partial payment shouldn't mark it fully settled.
    const session = sessions.find(s => s.id === sessionId);
    const paid = payments
      .filter(p => p.session_id === sessionId && p.status === 'Completed')
      .reduce((sum, p) => sum + p.amount, 0);
    if (!session || session.cost <= 0) return paid > 0;
    return paid >= session.cost;
  };

  const isSessionPending = (sessionId: number) => {
    return payments.some((p) => p.session_id === sessionId && p.status === 'Pending');
  };

  const getDateRangeFilter = () => {
    const now = new Date();
    let start: Date;
    let end: Date = new Date();

    switch (dateRange) {
      case 'today':
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        end = new Date(now);
        end.setHours(23, 59, 59, 999);
        break;
      case 'week':
        start = new Date(now);
        start.setDate(now.getDate() - 7);
        break;
      case 'month':
        start = new Date(now);
        start.setMonth(now.getMonth() - 1);
        break;
      case 'lastMonth':
        // Previous CALENDAR month (Aug 2 -> Jul 1 - Jul 31), not the
        // rolling window "now-2mo to now-1mo" which skips the current
        // month's data entirely.
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
      case 'custom':
        // 'YYYY-MM-DD' alone is parsed as UTC midnight -- in UTC+1 the last
        // selected day would be almost entirely excluded. Force local time.
        start = customStartDate ? new Date(`${customStartDate}T00:00:00`) : new Date(0);
        end = customEndDate ? new Date(`${customEndDate}T23:59:59.999`) : new Date();
        break;
      default:
        start = new Date(0);
    }
    return { start, end };
  };

  const filterByDateRange = (payments: Payment[]) => {
    const { start, end } = getDateRangeFilter();
    return payments.filter(p => {
      const date = new Date(p.payment_date);
      return date >= start && date <= end;
    });
  };

  const completedPayments = payments.filter((p) => p.status === 'Completed');
  const pendingPayments = payments.filter((p) => p.status === 'Pending');

  // ── Period-aware metrics ────────────────────────────────────────────────
  // Every tile and chart respects the selected date range. The aging report
  // and patient balances stay all-time snapshots (they're balance-sheet
  // views, not period flows).
  const rangeCompleted = filterByDateRange(completedPayments);
  const rangePending = filterByDateRange(pendingPayments);

  const { start: rangeStart, end: rangeEnd } = getDateRangeFilter();
  const inRange = (dateStr?: string | null) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= rangeStart && d <= rangeEnd;
  };

  const totalRevenue = rangeCompleted.reduce((sum, p) => sum + (p.amount - (p.discount || 0)), 0);
  const pendingRevenue = rangePending.reduce((sum, p) => sum + (p.amount - (p.discount || 0)), 0);
  const discountsGiven = rangeCompleted.reduce((sum, p) => sum + (p.discount || 0), 0);

  // Billed within the period = cost of treatments delivered in it
  // (completed_date when set, otherwise start_date). Canceled treatments
  // were never delivered, so they never count as billed.
  const billedInRange = treatments.filter((trt) => {
    if (trt.status === 'Canceled') return false;
    return inRange(trt.completed_date ?? trt.start_date);
  });
  const totalBilled = billedInRange.reduce((sum, t) => sum + (t.total_cost || 0), 0);
  const totalOutstanding = Math.max(totalBilled - totalRevenue, 0);
  const collectionRate = totalBilled > 0
    ? Math.min(Math.round((totalRevenue / totalBilled) * 100), 100)
    : (totalRevenue > 0 ? 100 : 0);

  // Visits performed in the period, and the average per visit.
  const sessionsCompleted = sessions.filter(
    (s) => s.status === 'Completed' && inRange(s.visit_date)
  ).length;
  const avgPerVisit = sessionsCompleted > 0 ? totalRevenue / sessionsCompleted : 0;

  const methodRevenue = rangeCompleted.reduce((acc: Record<string, number>, curr) => {
    acc[curr.method] = (acc[curr.method] || 0) + curr.amount;
    return acc;
  }, {});
  const methodChartData = Object.entries(methodRevenue).map(([name, value]) => ({ name, value }));

  const treatmentRevenue = rangeCompleted.reduce((acc: Record<string, number>, curr) => {
    if (curr.treatment_id) {
      const treatment = treatments.find(trt => trt.id === curr.treatment_id);
      const name = treatment?.procedure || `Treatment #${curr.treatment_id}`;
      acc[name] = (acc[name] || 0) + curr.amount;
    }
    return acc;
  }, {});
  const treatmentChartData = Object.entries(treatmentRevenue)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const chartDataMap = rangeCompleted.reduce((acc: Record<string, number>, curr) => {
    const dateKey = typeof curr.payment_date === 'string' ? curr.payment_date.slice(0, 10) : String(curr.payment_date);
    acc[dateKey] = (acc[dateKey] || 0) + curr.amount;
    return acc;
  }, {});
  // Ascending by date so the chart reads left(older) -> right(newer);
  // slice(-30) then takes the most recent 30 days.
  const dailyChartData = Object.keys(chartDataMap)
    .map((date) => ({ date, revenue: chartDataMap[date] }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthlyDataMap = rangeCompleted.concat(rangePending).reduce((acc: Record<string, { collected: number; pending: number }>, curr) => {
    const monthKey = typeof curr.payment_date === 'string' ? curr.payment_date.slice(0, 7) : 'Unknown';
    if (!acc[monthKey]) acc[monthKey] = { collected: 0, pending: 0 };
    if (curr.status === 'Completed') acc[monthKey].collected += curr.amount;
    if (curr.status === 'Pending') acc[monthKey].pending += curr.amount;
    return acc;
  }, {});
  const monthlyReports = Object.entries(monthlyDataMap)
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Unpaid sessions: completed payments must cover the full cost -- a
  // Pending payment or a partial one doesn't settle the session.
  const unpaidSessions = sessions.filter(session => {
    if (session.cost <= 0) return false;
    const completedPaid = payments
      .filter(p => p.session_id === session.id && p.status === 'Completed')
      .reduce((sum, p) => sum + p.amount, 0);
    return completedPaid < session.cost;
  });

  const getAgeDays = (date: string) => {
    const diff = new Date().getTime() - new Date(date).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Aging of the true receivable comes from the server (aged by visit
  // date, not by when the payment record was made). Fall back to pending
  // payments only if the summary hasn't loaded yet.
  const agingBuckets = summary?.aging ?? null;
  const agingData = agingBuckets
    ? Object.entries(agingBuckets).map(([name, value]) => ({ name, value }))
    : (() => {
        const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
        pendingPayments.forEach(p => {
          const days = getAgeDays(p.payment_date);
          if (days <= 30) buckets['0-30'] += p.amount;
          else if (days <= 60) buckets['31-60'] += p.amount;
          else if (days <= 90) buckets['61-90'] += p.amount;
          else buckets['90+'] += p.amount;
        });
        return Object.entries(buckets).map(([name, value]) => ({ name, value }));
      })();
  const agingTotal = agingData.reduce((sum, { value }) => sum + value, 0);

  const filteredPayments = payments.filter((item) => {
    const patientName = getPatientName(item.patient_id).toLowerCase();
    const description = item.description || '';
    const matchesSearch = patientName.includes(searchQuery.toLowerCase()) || 
                          description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMethod = methodFilter === 'All' || item.method === methodFilter;
    const matchesStatus = statusFilter === 'All' || item.status === statusFilter;
    return matchesSearch && matchesMethod && matchesStatus;
  });
  
  const exportCSV = (data: Payment[], filename: string) => {
    const headers = [t("pay_date"), t("fin_patient"), t("pay_description"), t("pay_method"), t("pay_status"), t("pay_amount")];
    const rows = data.map(p => [
      new Date(p.payment_date).toLocaleDateString(),
      getPatientName(p.patient_id),
      p.description || '',
      p.method,
      p.status,
      p.amount.toFixed(2),
    ]);
    const headerRow = headers.map((v) => `"${v.replace(/"/g, '""')}"`).join(",");
    const csv = headerRow + "\n" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="financials-container" style={{ padding: '24px' }}>
      <div className="action-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, color: colors.text }}>{t("fin_title")}</h2>
          <p style={{ margin: '4px 0 0 0', color: colors.textSecondary, fontSize: '0.9rem' }}>
            {t("fin_subtitle")}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={() => exportCSV(payments, 'all_transactions')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: colors.bgInput, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '10px 16px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Download size={18} /> {t("fin_export")}
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: colors.accent, color: colors.accentText, border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={18} /> {t("fin_record_payment")}
          </button>
        </div>
      </div>

      {/* Period selector -- drives every tile and chart on the page */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px', padding: '12px 16px', background: colors.bgCard, borderRadius: '10px', border: `1px solid ${colors.border}` }}>
        <CalendarRange size={16} style={{ color: colors.textSecondary }} />
        <label style={{ fontWeight: 600, color: colors.textSecondary, fontSize: '0.9rem' }}>{t("fin_period")}</label>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as any)}
          style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}
        >
          <option value="today">{t("fin_today")}</option>
          <option value="week">{t("fin_this_week")}</option>
          <option value="month">{t("fin_this_month")}</option>
          <option value="lastMonth">{t("fin_last_month")}</option>
          <option value="custom">{t("fin_custom")}</option>
        </select>
        {dateRange === 'custom' && (
          <>
            <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }} />
            <span style={{ color: colors.textSecondary }}>to</span>
            <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }} />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: '4px', borderBottom: `2px solid ${colors.border}`, marginBottom: '24px', flexWrap: 'wrap' }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 500,
              color: activeTab === tab ? colors.accent : colors.textSecondary,
              borderBottom: activeTab === tab ? `2px solid ${colors.accent}` : '2px solid transparent',
              marginBottom: '-2px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {tab === 'Overview' && <PieChart size={16} />}
            {tab === 'Transactions' && <Search size={16} />}
            {tab === 'Reports' && <BarChart3 size={16} />}
            {tab === 'Pending' && <AlertCircle size={16} />}
            {tab === 'Balances' && <Users size={16} />}
            {t(`fin_tab_${tab.toLowerCase()}` as any)}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'Overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ padding: '12px', borderRadius: '10px', background: colors.accentHover, color: colors.accent }}><Receipt size={24} /></div>
              <div>
                <span style={{ fontSize: '0.85rem', color: colors.textSecondary }}>{t("fin_billed")}</span>
                <h3 style={{ margin: 0, fontSize: '1.4rem', color: colors.text }}>{formatMoney(totalBilled)}</h3>
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ padding: '12px', borderRadius: '10px', background: colors.successBg, color: colors.success }}><DollarSign size={24} /></div>
              <div>
                <span style={{ fontSize: '0.85rem', color: colors.textSecondary }}>{t("fin_collected")}</span>
                <h3 style={{ margin: 0, fontSize: '1.4rem', color: colors.text }}>{formatMoney(totalRevenue)}</h3>
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ padding: '12px', borderRadius: '10px', background: colors.warningBg, color: colors.warning }}><Wallet size={24} /></div>
              <div>
                <span style={{ fontSize: '0.85rem', color: colors.textSecondary }}>{t("fin_outstanding")}</span>
                <h3 style={{ margin: 0, fontSize: '1.4rem', color: colors.text }}>{formatMoney(totalOutstanding)}</h3>
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ padding: '12px', borderRadius: '10px', background: colors.dangerBg, color: colors.danger }}><TrendingUp size={24} /></div>
              <div>
                <span style={{ fontSize: '0.85rem', color: colors.textSecondary }}>{t("fin_collection_rate")}</span>
                <h3 style={{ margin: 0, fontSize: '1.4rem', color: colors.text }}>{collectionRate}%</h3>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: colors.bgCard, padding: '14px 16px', borderRadius: '10px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Clock size={18} style={{ color: colors.warning }} />
              <div>
                <span style={{ display: 'block', fontSize: '0.75rem', color: colors.textSecondary }}>{t("fin_tab_pending")}</span>
                <span style={{ fontWeight: 700, color: colors.text }}>{formatMoney(pendingRevenue)}</span>
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '14px 16px', borderRadius: '10px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Percent size={18} style={{ color: colors.accent }} />
              <div>
                <span style={{ display: 'block', fontSize: '0.75rem', color: colors.textSecondary }}>{t("fin_discounts")}</span>
                <span style={{ fontWeight: 700, color: colors.text }}>{formatMoney(discountsGiven)}</span>
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '14px 16px', borderRadius: '10px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <CheckCircle2 size={18} style={{ color: colors.success }} />
              <div>
                <span style={{ display: 'block', fontSize: '0.75rem', color: colors.textSecondary }}>{t("fin_visits")}</span>
                <span style={{ fontWeight: 700, color: colors.text }}>{sessionsCompleted}</span>
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '14px 16px', borderRadius: '10px', border: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Banknote size={18} style={{ color: colors.success }} />
              <div>
                <span style={{ display: 'block', fontSize: '0.75rem', color: colors.textSecondary }}>{t("fin_avg_visit")}</span>
                <span style={{ fontWeight: 700, color: colors.text }}>{formatMoney(avgPerVisit)}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}` }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px', color: colors.text, fontSize: '16px' }}>{t("fin_daily_revenue")}</h3>
              <div style={{ height: '250px' }}>
                {dailyChartData.length === 0 ? (
                  <div style={{ textAlign: 'center', color: colors.textMuted, padding: '60px 0' }}>{t("no_data")}</div>
                ) : (
                  <ResponsiveContainer>
                    <BarChart data={dailyChartData.slice(-30)}>
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                      <XAxis dataKey="date" stroke={colors.textMuted} fontSize={11} tick={{ fontSize: 10 }} />
                      <YAxis stroke={colors.textMuted} fontSize={11} />
                      <Tooltip formatter={(v: any) => formatMoney(v ?? 0)} />
                      <Bar dataKey="revenue" fill={colors.accent} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}` }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px', color: colors.text, fontSize: '16px' }}>{t("fin_revenue_method")}</h3>
              <div style={{ height: '250px' }}>
                {methodChartData.length === 0 ? (
                  <div style={{ textAlign: 'center', color: colors.textMuted, padding: '60px 0' }}>{t("no_data")}</div>
                ) : (
                  <ResponsiveContainer>
                    <RePieChart>
                      <Pie
                        data={methodChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {methodChartData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatMoney(v ?? 0)} />
                      <Legend />
                    </RePieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {treatmentChartData.length > 0 && (
            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}` }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px', color: colors.text, fontSize: '16px' }}>{t("fin_top_treatments")}</h3>
              <div style={{ height: '250px' }}>
                <ResponsiveContainer>
                  <BarChart data={treatmentChartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.border} horizontal={false} />
                    <XAxis type="number" stroke={colors.textMuted} fontSize={11} tickFormatter={(v: number) => (v ? v.toLocaleString() : '0')} />
                    <YAxis type="category" dataKey="name" stroke={colors.textMuted} fontSize={10} width={120} />
                    <Tooltip formatter={(v: any) => formatMoney(v ?? 0)} />
                    <Bar dataKey="value" fill={colors.accent} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 2: TRANSACTIONS */}
      {activeTab === 'Transactions' && (
        <div style={{ background: colors.bgCard, borderRadius: '12px', border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
          <div style={{ padding: '16px', background: colors.bgInput, borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '12px', color: colors.textMuted }} />
              <input
                type="text"
                placeholder={t("patients_search")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 36px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text, boxSizing: 'border-box' }}
              />
            </div>

            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}>
              <option value="All">{t("patients_all")}</option>
              <option value="Cash">{t("fin_method_cash")}</option>
              <option value="CIB / Card">{t("fin_method_card")}</option>
              <option value="Insurance">{t("fin_method_insurance")}</option>
            </select>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}>
              <option value="All">{t("patients_all")}</option>
              <option value="Completed">{t("fin_status_paid")}</option>
              <option value="Pending">{t("fin_status_pending")}</option>
            </select>

            <button 
              onClick={() => exportCSV(filteredPayments, 'transactions_export')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: colors.accent, color: colors.accentText, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}
            >
              <Download size={16} /> {t("fin_export")}
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead style={{ background: colors.bgInput, color: colors.textSecondary }}>
              <tr>
                <th style={{ padding: '12px 16px' }}>{t("pay_date")}</th>
                <th style={{ padding: '12px 16px' }}>{t("fin_patient")}</th>
                <th style={{ padding: '12px 16px' }}>{t("pay_description")}</th>
                <th style={{ padding: '12px 16px' }}>{t("pay_method")}</th>
                <th style={{ padding: '12px 16px' }}>{t("pay_status")}</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>{t("pay_amount")}</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>{t("fin_action")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: colors.textMuted }}>{t("patients_no_found")}</td></tr>
              ) : (
                filteredPayments.map((item) => (
                  <tr key={item.id} style={{ borderTop: `1px solid ${colors.bgInput}` }}>
                    <td style={{ padding: '12px 16px' }}>{new Date(item.payment_date).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 600 }}>{getPatientName(item.patient_id)}</td>
                    <td style={{ padding: '12px 16px', color: colors.textSecondary, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || ''}</td>
                    <td style={{ padding: '12px 16px' }}>{item.method}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, background: item.status === 'Completed' ? colors.successBg : colors.warningBg, color: item.status === 'Completed' ? colors.success : colors.warning }}>
                        {item.status === 'Completed' ? t("fin_status_paid") : t("fin_status_pending")}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 'bold' }}>{formatMoney(item.amount)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {item.status === 'Pending' && (
                          <button onClick={() => handleQuickSettle(item)} title={t("fin_status_paid")} style={{ background: colors.successBg, border: 'none', color: colors.success, padding: '6px', borderRadius: '6px', cursor: 'pointer' }}>
                            <CheckCircle2 size={16} />
                          </button>
                        )}
                        <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', padding: '6px' }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: REPORTS */}
      {activeTab === 'Reports' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
            <button
              onClick={() => exportCSV(filterByDateRange(payments), 'report_export')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: colors.accent, color: colors.accentText, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 500 }}
            >
              <Download size={16} /> {t("fin_export_report")}
            </button>
          </div>

          <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}`, marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '16px', color: colors.text }}>{t("fin_monthly_revenue")}</h3>
            <div style={{ height: '300px' }}>
              {monthlyReports.length === 0 ? (
                <div style={{ textAlign: 'center', color: colors.textMuted, padding: '60px 0' }}>{t("no_data")}</div>
              ) : (
                <ResponsiveContainer>
                  <BarChart data={monthlyReports}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                    <XAxis dataKey="month" stroke={colors.textMuted} fontSize={11} />
                    <YAxis stroke={colors.textMuted} fontSize={11} />
                    <Tooltip formatter={(v: any) => formatMoney(v ?? 0)} />
                    <Bar dataKey="collected" fill={colors.success} name={t("pay_total_paid")} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pending" fill={colors.warning} name={t("pay_pending")} radius={[4, 4, 0, 0]} />
                    <Legend wrapperStyle={{ color: colors.text }} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}` }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px', color: colors.text, fontSize: '16px' }}>{t("fin_revenue_method")}</h3>
              <div style={{ height: '200px' }}>
                {methodChartData.length === 0 ? (
                  <div style={{ textAlign: 'center', color: colors.textMuted, padding: '40px 0' }}>{t("no_data")}</div>
                ) : (
                  <ResponsiveContainer>
                    <RePieChart>
                      <Pie data={methodChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={80} dataKey="value">
                        {methodChartData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatMoney(v ?? 0)} />
                      <Legend />
                    </RePieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div style={{ background: colors.bgCard, padding: '20px', borderRadius: '12px', border: `1px solid ${colors.border}` }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px', color: colors.text, fontSize: '16px' }}>{t("fin_aging_report")}</h3>
              {agingTotal === 0 ? (
                <div style={{ textAlign: 'center', color: colors.textMuted, padding: '40px 0' }}>{t("fin_no_pending")}</div>
              ) : (
                <div>
                  {agingData.map(({ name, value }) => (
                    <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${colors.bgInput}` }}>
                      <span style={{ color: colors.textSecondary }}>{name} {t("duration_min")}</span>
                      <span style={{ fontWeight: 600 }}>{formatMoney(value)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: `2px solid ${colors.border}`, fontWeight: 700 }}>
                    <span>{t("fin_total_pending")}</span>
                    <span>{formatMoney(agingTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PENDING */}
      {activeTab === 'Pending' && (
        <div style={{ display: 'grid', gap: '20px' }}>
          <div style={{ background: colors.bgCard, borderRadius: '12px', border: `1px solid ${colors.border}`, padding: '20px' }}>
            <h3 style={{ marginTop: 0, color: colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText color={colors.danger} /> {t("fin_unpaid_sessions")} ({unpaidSessions.length})
            </h3>
            <p style={{ color: colors.textSecondary, fontSize: '0.9rem', marginBottom: '16px' }}>
              Sessions that have been performed but do not have a payment recorded.
            </p>
            
            {unpaidSessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: colors.textMuted }}>
                {t("fin_all_billed")}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {unpaidSessions.slice(0, 20).map((session) => {
                  const treatment = treatments.find(trt => trt.id === session.treatment_id);
                  const patient = patients.find(p => p.id === treatment?.patient_id);
                  return (
                    <div key={session.id} style={{ padding: '14px', borderRadius: '8px', border: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: colors.warningBg }}>
                      <div>
                        <strong>{patient ? `${patient.first_name} ${patient.last_name}` : t("unknown")}</strong>
                        <span style={{ display: 'block', fontSize: '0.85rem', color: colors.textSecondary }}>
                          {treatment?.procedure || 'Treatment'} – {t("trt_tooth_selected")}{session.session_number}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: colors.textMuted }}>
                          {session.visit_date ? new Date(session.visit_date).toLocaleDateString() : t("status_unscheduled")}
                        </span> 
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: colors.warning }}>
                          {formatMoney(session.cost || 0)}
                        </span>
                        <button 
                          onClick={() => {
                            const patientId = treatment?.patient_id;
                            if (patientId) {
                              setFormData({
                                patient_id: patientId,
                                treatment_id: session.treatment_id,
                                session_id: session.id,
                                amount: session.cost || 0,
                                payment_date: toLocalISODateTime(new Date()),
                                method: 'Cash',
                                description: `${t("trt_tooth_selected")} ${session.session_number}: ${session.procedure_done || ''}`,
                                status: 'Completed',
                              });
                              setSelectedTreatmentId(String(session.treatment_id));
                              api.getTreatmentSessions(session.treatment_id).then(setTreatmentSessions);
                              setIsModalOpen(true);
                            }
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: colors.accent, color: colors.accentText, border: 'none', borderRadius: '6px', padding: '8px 14px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          <CreditCard size={16} /> {t("fin_bill_now")}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {unpaidSessions.length > 20 && (
                  <div style={{ textAlign: 'center', color: colors.textMuted, padding: '8px' }}>
                    + {unpaidSessions.length - 20} {t("patients_showing")}...
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ background: colors.bgCard, borderRadius: '12px', border: `1px solid ${colors.border}`, padding: '20px' }}>
            <h3 style={{ marginTop: 0, color: colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle color={colors.warning} /> {t("fin_tab_pending")} ({pendingPayments.length})
            </h3>
            <p style={{ color: colors.textSecondary, fontSize: '0.9rem', marginBottom: '16px' }}>
              Payments that have been recorded but not yet collected.
            </p>
            
            {pendingPayments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: colors.textMuted }}>
                {t("fin_no_pending")}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {pendingPayments.map((item) => (
                  <div key={item.id} style={{ padding: '14px', borderRadius: '8px', border: `1px solid ${colors.warning}`, background: colors.warningBg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{getPatientName(item.patient_id)}</strong>
                      <span style={{ display: 'block', fontSize: '0.85rem', color: colors.textSecondary }}>{item.description || ''}</span>
                      <span style={{ fontSize: '0.8rem', color: colors.textMuted }}>
                        {t("pay_date")}: {new Date(item.payment_date).toLocaleDateString()} • {getAgeDays(item.payment_date)} {t("patients_yrs")} {t("ago")}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: colors.warning }}>{formatMoney(item.amount)}</span>
                      <button onClick={() => handleQuickSettle(item)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: colors.success, color: colors.accentText, border: 'none', borderRadius: '6px', padding: '8px 14px', fontWeight: 600, cursor: 'pointer' }}>
                        <CheckCircle2 size={16} /> {t("fin_collect")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: BALANCES — Server-side summary with Virtuoso */}
      {activeTab === 'Balances' && summary && (
        <div style={{ background: colors.bgCard, borderRadius: '12px', border: `1px solid ${colors.border}`, padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: colors.text, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px' }}>
              <Users size={20} /> {t("fin_patient_balances")}
            </h3>
            <span style={{ fontSize: '13px', color: colors.textSecondary, fontWeight: 500 }}>
              {summary.patient_balances.length} {t("patients_of")} {summary.patient_balances.length !== 1 ? 's' : ''} {t("fin_action")}
            </span>
          </div>

          {/* Summary pills */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <div style={{ padding: '14px', borderRadius: '10px', background: colors.successBg, border: `1px solid ${colors.success}` }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: colors.success, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t("fin_total_collected")}</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: colors.success, marginTop: '4px' }}>{formatMoney(summary.total_collected)}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '10px', background: colors.warningBg, border: `1px solid ${colors.warning}` }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: colors.warning, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t("fin_total_pending")}</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: colors.warning, marginTop: '4px' }}>{formatMoney(summary.total_pending)}</div>
            </div>
            <div style={{ padding: '14px', borderRadius: '10px', background: colors.accentHover, border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t("fin_collection_rate")}</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: colors.accent, marginTop: '4px' }}>{summary.collection_rate.toFixed(1)}%</div>
            </div>
          </div>

          {/* Virtualized list */}
          {summary.patient_balances.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: colors.textMuted }}>
              {t("fin_all_settled")}
            </div>
          ) : (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr',
                padding: '10px 16px',
                background: colors.bgInput,
                borderBottom: `1px solid ${colors.border}`,
                fontSize: '12px',
                fontWeight: 600,
                color: colors.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                <span>{t("fin_patient")}</span>
                <span style={{ textAlign: 'right' }}>{t("fin_balance")}</span>
                <span style={{ textAlign: 'right' }}>{t("fin_action")}</span>
              </div>
              <Virtuoso
                style={{ height: '400px' }}
                data={summary.patient_balances}
                itemContent={(_: number, p: { patient_id: number; first_name: string; last_name: string; balance: number }) => (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr',
                    padding: '12px 16px',
                    borderBottom: `1px solid ${colors.bgInput}`,
                    alignItems: 'center',
                    fontSize: '14px',
                  }}>
                    <span style={{ fontWeight: 600, color: colors.text }}>
                      {p.first_name} {p.last_name}
                    </span>
                    <span style={{ textAlign: 'right', color: colors.warning, fontWeight: 700 }}>
                      {formatMoney(p.balance)}
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => {
                          setFormData({
                            patient_id: p.patient_id,
                            treatment_id: undefined,
                            session_id: undefined,
                            amount: p.balance,
                            payment_date: toLocalISODateTime(new Date()),
                            method: 'Cash',
                            description: `${t("pay_owes")} ${p.first_name} ${p.last_name}`,
                            status: 'Completed',
                          });
                          setIsModalOpen(true);
                        }}
                        style={{
                          background: colors.accent,
                          color: colors.accentText,
                          border: 'none',
                          borderRadius: '6px',
                          padding: '6px 14px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {t("fin_record_payment_btn")}
                      </button>
                    </div>
                  </div>
                )}
              />
            </>
          )}
        </div>
      )}

      {/* MODAL */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: colors.bgCard, borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>{t("fin_record_payment")}</h3>
              <button onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '18px' }}>

              {/* ── 1. PATIENT (always required) ── */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: '8px' }}>{t("cal_select_patient")} *</label>
                <select name="patient_id" value={formData.patient_id} onChange={handleInputChange} required style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text, fontSize: '0.95rem' }}>
                  <option value={0}>-- {t("cal_select_patient")} --</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                  ))}
                </select>
              </div>

              {/* ── 2. TREATMENT + SESSION (only after a patient is picked) ── */}
              {formData.patient_id > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: '8px' }}>{t("fin_optional_details")}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <select value={selectedTreatmentId} onChange={handleTreatmentSelect} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}>
                      <option value="">{t("fin_treatment_optional")}</option>
                      {patientTreatments.map((trt) => (
                        <option key={trt.id} value={trt.id}>{trt.procedure || t("trt_unnamed")}</option>
                      ))}
                    </select>

                    <select value={formData.session_id ?? ''} onChange={handleSessionSelect} disabled={!selectedTreatmentId} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: selectedTreatmentId ? colors.bgInput : colors.bgCard, color: colors.text, opacity: selectedTreatmentId ? 1 : 0.6 }}>
                      <option value="">{t("fin_session_optional")}</option>
                      {treatmentSessions.map((s) => {
                        const paid = isSessionPaid(s.id);
                        const pending = isSessionPending(s.id);
                        const label = paid
                          ? `${t("trt_tooth_selected")} ${s.session_number} (${formatMoney(s.cost || 0)}) ✅`
                          : pending
                          ? `${t("trt_tooth_selected")} ${s.session_number} (${formatMoney(s.cost || 0)}) ⏳`
                          : `${t("trt_tooth_selected")} ${s.session_number} (${formatMoney(s.cost || 0)})`;
                        return (
                          <option key={s.id} value={s.id} disabled={paid}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {formData.session_id && isSessionPaid(formData.session_id) && (
                    <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: colors.success }}>✅ {t("fin_status_paid")}</p>
                  )}
                  {formData.session_id && isSessionPending(formData.session_id) && (
                    <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: colors.warning }}>⏳ {t("fin_status_pending")}</p>
                  )}
                </div>
              )}

              {/* ── 3. AMOUNT + DATE ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: '8px' }}>{t("fin_amount")} *</label>
                  <input type="number" name="amount" placeholder="4500" value={formData.amount || ''} onChange={handleInputChange} required style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text, boxSizing: 'border-box', fontSize: '1rem', fontWeight: 700 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: '8px' }}>{t("fin_date_time")}</label>
                  <input type="datetime-local" name="payment_date" value={formData.payment_date ? formData.payment_date.slice(0, 16) : ''} onChange={(e) => {
                    // datetime-local gives the local wall-clock; keep it as a
                    // naive local string. new Date('') -> Invalid Date would
                    // throw on .toISOString() when the field is cleared.
                    const v = e.target.value;
                    if (!v) {
                      setFormData((prev) => ({ ...prev, payment_date: toLocalNaiveISO(new Date()) }));
                    } else {
                      setFormData((prev) => ({ ...prev, payment_date: v }));
                    }
                  }} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text, boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* ── 4. METHOD + STATUS ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: '8px' }}>{t("fin_method")}</label>
                  <select name="method" value={formData.method} onChange={handleInputChange} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}>
                    <option value="Cash">{t("fin_method_cash")}</option>
                    <option value="CIB / Card">{t("fin_method_card")}</option>
                    <option value="Insurance">{t("fin_method_insurance")}</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: '8px' }}>{t("fin_status_label")}</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {(['Completed', 'Pending'] as const).map((st) => {
                      const active = formData.status === st;
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setFormData((prev) => ({ ...prev, status: st }))}
                          style={{
                            padding: '11px 0', borderRadius: '10px', border: `1.5px solid ${active ? (st === 'Completed' ? colors.success : colors.warning) : colors.border}`,
                            background: active ? (st === 'Completed' ? '#ecfdf5' : '#fffbeb') : colors.bgInput,
                            color: active ? (st === 'Completed' ? '#047857' : '#b45309') : colors.textSecondary,
                            fontWeight: active ? 700 : 500, fontSize: '0.85rem', cursor: 'pointer',
                          }}
                        >
                          {st === 'Completed' ? `✅ ${t("fin_status_paid")}` : `⏳ ${t("fin_status_pending")}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ── 5. DESCRIPTION (collapsed under a "more" feel) ── */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: '8px' }}>{t("fin_description")} <span style={{ fontWeight: 400, textTransform: 'none', color: colors.textMuted }}>({t("optional")})</span></label>
                <input type="text" name="description" placeholder={t("fin_description_placeholder")} value={formData.description} onChange={handleInputChange} style={{ width: '100%', padding: '12px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text, boxSizing: 'border-box' }} />
              </div>

              {/* ── SUMMARY + ACTIONS ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${colors.border}`, paddingTop: '14px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t("fin_total")}</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: colors.accent }}>
                    {formatMoney(formData.amount || 0)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }} style={{ padding: '11px 16px', borderRadius: '10px', border: `1px solid ${colors.border}`, background: colors.bgInput, cursor: 'pointer', fontWeight: 600, color: colors.textSecondary }}>{t("cancel")}</button>
                  <button type="submit" disabled={submitting} style={{ padding: '11px 20px', borderRadius: '10px', border: 'none', background: submitting ? colors.border : colors.accent, color: submitting ? colors.textMuted : colors.accentText, cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.9rem' }}>{submitting ? t("saving") : t("fin_save_payment")}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Financials;