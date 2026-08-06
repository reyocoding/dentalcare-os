import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plus, X, Calendar, Phone, Mail, MapPin, AlertTriangle, Trash2,
  CreditCard, CalendarClock, CheckCircle2, Pencil, Repeat, Ban,
  LayoutDashboard, ScanLine, CalendarDays, Stethoscope, DollarSign,
  FileText, Activity, User, Clock,   ChevronRight, Heart,
  Shield, Pill, Upload, MessageSquare, Send, Edit3, Briefcase, Download, Info,
} from "lucide-react";
import { api, API_BASE_URL } from "../services/api";
import { TeethChart } from "./TeethChart";
import { DateTimePicker } from "../components/DateTimePicker";
import DayOverviewPanel from "../components/DayOverviewPanel";
import DurationPicker from "../components/DurationPicker";
import { OdontogramSelector } from "../components/OdontogramSelector";
import { GenderToggle, DobField } from "../components/PatientFields";
import { useLanguage } from "../components/Languagecontext";
import { useTheme } from "../components/ThemeContext";
import { useClinicSettings } from "../components/ClinicSettings";
import type { ToothRecord } from "../services/api";import type {
  TreatmentCreate, TreatmentSession, SessionStatusType, Appointment as AppointmentType, PatientDocument,
} from "../services/api";
import moment from "moment";
import type { Patient, Appointment, Payment, Treatment, PatientTimeline } from "../services/api";

const PHONE_RE = /^[+]?[\d\s\-().]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateField(name: string, value: string, t: (key: any) => string): string | null {
  switch (name) {
    case 'first_name':
    case 'last_name':
      if (!value.trim()) return t('field_required');
      if (value.trim().length < 2) return t('field_too_short');
      return null;
    case 'phone_number':
    case 'emergency_contact_phone':
      if (!value) return null;
      if (!PHONE_RE.test(value.trim())) return t('field_invalid_phone');
      return null;
    case 'email':
      if (!value) return null;
      if (!EMAIL_RE.test(value.trim())) return t('field_invalid_email');
      return null;
    default:
      return null;
  }
}

function validateForm(data: Record<string, string | undefined>, t: (key: any) => string): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of ['first_name', 'last_name', 'phone_number', 'email', 'emergency_contact_phone']) {
    const err = validateField(key, data[key] || '', t);
    if (err) errors[key] = err;
  }
  return errors;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type TabType = "Overview" | "Odontogram" | "Appointments" | "Treatments" | "Payments" | "Documents" | "Timeline";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = ["var(--accent)","#16a34a","#9333ea","#dc2626","#ea580c","#0891b2","#0d9488","#7c3aed"];

const getAvatarColor = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};

const getInitials = (p: Patient) =>
  `${p.first_name[0] ?? ""}${p.last_name[0] ?? ""}`.toUpperCase();

const getAge = (dob?: string | null): number | null => {
  if (!dob) return null;
  return moment().diff(moment(dob), "years");
};

// ─── Status/style maps ───────────────────────────────────────────────────────

const APPT_STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Scheduled:     { bg: "var(--accent-hover)", text: "var(--accent)", dot: "var(--accent)" },
  "In Treatment":{ bg: "#faf5ff", text: "#9333ea", dot: "#9333ea" },
  Completed:     { bg: "#f0fdf4", text: "#16a34a", dot: "#16a34a" },
  Canceled:      { bg: "#fef2f2", text: "#dc2626", dot: "#ef4444" },
  "No-Show":     { bg: "#fffbeb", text: "#b45309", dot: "#f59e0b" },
};

const APPT_STATUS_KEY: Record<string, string> = {
  Scheduled: 'status_scheduled',
  'In Treatment': 'status_in_treatment',
  Completed: 'status_completed',
  Canceled: 'status_canceled',
  'No-Show': 'status_no_show',
};

const TREATMENT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Planned:   { bg: "#fef9c3", text: "#854d0e" },
  Ongoing:   { bg: "#dbeafe", text: "#1e40af" },
  Completed: { bg: "#dcfce7", text: "#166534" },
  Canceled:  { bg: "#fee2e2", text: "#991b1b" },
};

const TREATMENT_STATUS_KEY: Record<string, string> = {
  Planned: 'status_planned',
  Ongoing: 'status_ongoing',
  Completed: 'status_completed',
  Canceled: 'status_canceled',
};

const SESSION_STATUS_STYLE: Record<SessionStatusType, { bg: string; border: string; text: string; dot: string }> = {
  Unscheduled: { bg: "var(--bg-input)", border: "var(--border)", text: "var(--text-secondary)", dot: "var(--text-muted)" },
  Scheduled:   { bg: "var(--accent-hover)", border: "#bfdbfe", text: "#1e40af", dot: "var(--accent)" },
  Completed:   { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534", dot: "#16a34a" },
  Canceled:    { bg: "#fef2f2", border: "#fecaca", text: "#991b1b", dot: "#ef4444" },
};

const SESSION_STATUS_KEY: Record<string, string> = {
  Unscheduled: 'status_unscheduled',
  Scheduled: 'status_scheduled',
  Completed: 'status_completed',
  Canceled: 'status_canceled',
};

const TIMELINE_ICONS: Record<string, React.ReactNode> = {
  "Visit Completed": <CheckCircle2 size={14} />,
  "Appointment":     <CalendarDays size={14} />,
  "Treatment":       <Stethoscope size={14} />,
  "Payment":         <DollarSign size={14} />,
  "Note":            <MessageSquare size={14} />,
};

const TIMELINE_COLORS: Record<string, string> = {
  "Visit Completed": "#16a34a",
  "Appointment":     "var(--accent)",
  "Treatment":       "#9333ea",
  "Payment":         "#0891b2",
  "Note":            "var(--text-secondary)",
};

// ─── Shared styles ────────────────────────────────────────────────────────────

const s = {
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "14px",
    padding: "20px",
  } as React.CSSProperties,
  addBtn: {
    display: "flex", alignItems: "center", gap: "6px",
    background: "var(--accent)", color: "#fff", border: "none",
    borderRadius: "8px", padding: "8px 14px",
    fontSize: "13px", fontWeight: 600, cursor: "pointer",
  } as React.CSSProperties,
  secondaryBtn: {
    display: "flex", alignItems: "center", gap: "6px",
    background: "var(--bg-input)", color: "var(--text)", border: "1px solid var(--border)",
    borderRadius: "8px", padding: "8px 12px",
    fontSize: "13px", fontWeight: 600, cursor: "pointer",
  } as React.CSSProperties,
  input: {
    width: "100%", padding: "10px 12px", borderRadius: "8px",
    border: "1px solid var(--border)", fontSize: "14px",
    boxSizing: "border-box" as const, outline: "none", fontFamily: "inherit",
    background: "var(--bg-card)", color: "var(--text)",
  } as React.CSSProperties,
  textarea: {
    width: "100%", padding: "10px 12px", borderRadius: "8px",
    border: "1px solid var(--border)", fontSize: "14px", minHeight: "80px",
    resize: "vertical" as const, boxSizing: "border-box" as const, fontFamily: "inherit",
    background: "var(--bg-card)", color: "var(--text)",
  } as React.CSSProperties,
  label: { display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" } as React.CSSProperties,
  field: { marginBottom: "14px" } as React.CSSProperties,
  modalOverlay: {
    position: "fixed" as const, inset: 0, background: "rgba(15,23,42,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px",
  } as React.CSSProperties,
  modalBox: {
    background: "var(--bg-card)", borderRadius: "14px", padding: "24px",
    width: "100%", maxWidth: "500px", maxHeight: "90vh", overflowY: "auto" as const,
    boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
  } as React.CSSProperties,
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" } as React.CSSProperties,
  modalActions: { display: "flex", justifyContent: "flex-end", gap: "10px", marginBottom: "20px" } as React.CSSProperties,
  errorBanner: {
    background: "#fee2e2", color: "#991b1b", padding: "10px 14px",
    borderRadius: "8px", fontSize: "13px", marginBottom: "14px",
  } as React.CSSProperties,
  warnBanner: {
    background: "#fef3c7", color: "#92400e", padding: "10px 14px",
    borderRadius: "8px", fontSize: "13px", marginBottom: "14px",
    display: "flex", alignItems: "center", gap: "8px",
  } as React.CSSProperties,
  emptyState: { textAlign: "center" as const, padding: "48px 16px", color: "var(--text-muted)" },
  sectionLabel: {
    fontSize: "11px", fontWeight: 700, color: "var(--text-muted)",
    textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: "12px",
  } as React.CSSProperties,
};

// ─── Schedule presets ─────────────────────────────────────────────────────────

const SCHEDULE_PRESETS = [
  { label: "Tomorrow",   daysFromNow: 1 },
  { label: "In 3 days",  daysFromNow: 3 },
  { label: "Next week",  daysFromNow: 7 },
  { label: "In 2 weeks", daysFromNow: 14 },
];

const SCHEDULE_PRESET_KEY: Record<string, string> = {
  "Tomorrow": "sch_tomorrow",
  "In 3 days": "sch_in_3",
  "Next week": "sch_next_week",
  "In 2 weeks": "sch_in_2_weeks",
};

const BULK_INTERVALS: { label: string; value: "weekly" | "biweekly" | "monthly" }[] = [
  { label: "Every week",    value: "weekly" },
  { label: "Every 2 weeks", value: "biweekly" },
  { label: "Every month",   value: "monthly" },
];

const BULK_INTERVAL_KEY: Record<string, string> = {
  "Every week": "sch_weekly",
  "Every 2 weeks": "sch_biweekly",
  "Every month": "sch_monthly",
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const StatTile = ({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) => (
  <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px 20px" }}>
    <div style={{ fontSize: "22px", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>{label}</div>
    {sub && <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>{sub}</div>}
  </div>
);

const InfoRow = ({ icon, label, value }: { icon?: React.ReactNode; label: string; value?: string | null }) => (
  <div style={{ display: "flex", gap: "10px", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
    {icon && <span style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}>{icon}</span>}
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: "14px", color: value ? "var(--text)" : "var(--text-muted)", marginTop: "2px" }}>{value || "—"}</div>
    </div>
  </div>
);



// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const PatientProfile = () => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const { formatMoney, currency } = useClinicSettings();
  const { id } = useParams();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabType>("Overview");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [patient, setPatient]           = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [payments, setPayments]         = useState<Payment[]>([]);
  const [treatments, setTreatments]     = useState<Treatment[]>([]);
  const [timeline, setTimeline]         = useState<PatientTimeline[]>([]);
  const [selectedTreatment, setSelectedTreatment] = useState<Treatment | null>(null);
  const [sessions, setSessions]         = useState<TreatmentSession[]>([]);
  const [toothRecords, setToothRecords] = useState<Record<number, ToothRecord>>({});

  // Edit patient modal
  const [showEditModal, setShowEditModal]   = useState(false);
  const [editForm, setEditForm]             = useState<Partial<Patient>>({});
  const [savingEdit, setSavingEdit]         = useState(false);
  const [editErrors, setEditErrors]         = useState<Record<string, string>>({});

  // Documents
  const [patientDocuments, setPatientDocuments] = useState<PatientDocument[]>([]);
  const [uploadingDoc, setUploadingDoc]         = useState(false);
  const [previewDoc, setPreviewDoc]             = useState<PatientDocument | null>(null);
  const fileInputRef                           = useRef<HTMLInputElement>(null);

  // Quick note
  const [quickNote, setQuickNote]           = useState("");
  const [savingNote, setSavingNote]         = useState(false);

  // Treatment modal
  const [showTreatmentModal, setShowTreatmentModal] = useState(false);
  const [savingTreatment, setSavingTreatment]       = useState(false);
  const [treatmentError, setTreatmentError]         = useState<string | null>(null);
  const [editingTreatmentId, setEditingTreatmentId] = useState<number | null>(null);

  // Schedule modal
  const [showScheduleModal, setShowScheduleModal]   = useState(false);
  const [schedulingSession, setSchedulingSession]   = useState<TreatmentSession | null>(null);
  const [scheduleDatetime, setScheduleDatetime]     = useState("");
  const [scheduleDuration, setScheduleDuration]     = useState(30);
  const [schedulingSlot, setSchedulingSlot]         = useState(false);
  const [scheduleError, setScheduleError]           = useState<string | null>(null);
  const [bulkMode, setBulkMode]                     = useState(false);
  const [bulkInterval, setBulkInterval]             = useState<"weekly"|"biweekly"|"monthly">("weekly");
  // Collision detection (opt-in via Settings -- some clinics share the
  // calendar across more than one office, so the default is OFF).
  const { collisionCheck } = useClinicSettings();
  const [allAppointments, setAllAppointments]       = useState<AppointmentType[]>([]);
  const [scheduleCollision, setScheduleCollision]   = useState(false);

  // Complete modal
  const [showCompleteModal, setShowCompleteModal]   = useState(false);
  const [completingSession, setCompletingSession]   = useState<TreatmentSession | null>(null);
  const [completeForm, setCompleteForm]             = useState({ procedure_done: "", notes: "", cost: 0, visit_date: "" });
  const [savingComplete, setSavingComplete]         = useState(false);
  const [completeError, setCompleteError]           = useState<string | null>(null);

  // Rename
  const [renamingSessionId, setRenamingSessionId]   = useState<number | null>(null);
  const [renameDraft, setRenameDraft]               = useState("");
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);

  // Treatment form
  const emptyTreatmentForm: TreatmentCreate = {
    patient_id: Number(id), tooth_number: undefined, diagnosis: "", procedure: "",
    treatment_plan: "", prescribed_medication: "", treatment_notes: "",
    total_sessions_required: 1, sessions_completed: 0, total_cost: 0, status: "Planned",
  };
  const [treatmentForm, setTreatmentForm] = useState<TreatmentCreate>(emptyTreatmentForm);
  const [treatmentTeeth, setTreatmentTeeth] = useState<number[]>([]);
  const [sessionCosts, setSessionCosts] = useState<number[]>([]);
  const costsTouched = useRef(false);

  const [costInput, setCostInput] = useState("");

  // Split the total cost evenly across the required sessions, keeping
  // whole (integer) amounts: the remainder goes to the first session(s),
  // e.g. 100 / 3 -> 34, 33, 33.
  const evenSplit = (total: number, n: number): number[] => {
    const count = Math.max(1, Math.round(n));
    const whole = Math.round(total);
    const base = Math.floor(whole / count);
    const remainder = whole - base * count;
    return Array.from({ length: count }, (_, i) => (i < remainder ? base + 1 : base));
  };

  const splitEvenly = () => {
    setSessionCosts(evenSplit(treatmentForm.total_cost || 0, treatmentForm.total_sessions_required ?? 1));
  };

  // Change the session count (preset chips / custom input). Keeps an even
  // split unless the doctor has hand-tuned individual session costs.
  const setSessionCount = (n: number) => {
    setTreatmentForm(prev => ({ ...prev, total_sessions_required: Math.max(1, n) }));
    if (costsTouched.current) return;
    setSessionCosts(evenSplit(treatmentForm.total_cost || 0, n));
  };

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => { loadData(); }, [id]); // eslint-disable-line

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [patientData, appointmentData, paymentData, treatmentData, timelineData, teethData, docsData] =
        await Promise.all([
          api.getPatientById(Number(id)),
          api.getPatientAppointments(Number(id)),
          api.getPatientPayments(Number(id)),
          api.getPatientTreatments(Number(id)),
          api.getPatientTimeline(Number(id)),
          api.getPatientTeeth(Number(id)),
          api.getPatientDocuments(Number(id)),
        ]);
      setPatient(patientData);
      setAppointments(appointmentData);
      setPayments(paymentData);
      setTreatments(treatmentData);
      setTimeline(timelineData);
      const byTooth: Record<number, ToothRecord> = {};
      teethData.forEach(r => { byTooth[r.tooth_number] = r; });
      setToothRecords(byTooth);
      setPatientDocuments(docsData);
    } catch (err) {
      console.error(err);
      // Don't leave the page on an infinite spinner -- show a retry state.
      setLoadError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // ── Treatment helpers ─────────────────────────────────────────────────────

  const openTreatmentModal = () => {
    setTreatmentError(null);
    setEditingTreatmentId(null);
    setTreatmentForm(emptyTreatmentForm);
    setTreatmentTeeth([]);
    setSessionCosts([]);
    costsTouched.current = false;
    setCostInput("");
    setShowTreatmentModal(true);
  };

  const openEditTreatmentModal = (trt: Treatment) => {
    setTreatmentError(null);
    setEditingTreatmentId(trt.id);
    setTreatmentForm({
      patient_id: trt.patient_id,
      tooth_number: trt.tooth_number,
      diagnosis: trt.diagnosis || "",
      procedure: trt.procedure || "",
      treatment_plan: trt.treatment_plan || "",
      prescribed_medication: trt.prescribed_medication || "",
      treatment_notes: trt.treatment_notes || "",
      total_sessions_required: trt.total_sessions_required,
      sessions_completed: trt.sessions_completed,
      total_cost: trt.total_cost,
      status: trt.status,
    });
    setTreatmentTeeth(trt.tooth_numbers?.length ? trt.tooth_numbers : (trt.tooth_number ? [trt.tooth_number] : []));
    setSessionCosts([]);
    costsTouched.current = false;
    setCostInput(trt.total_cost ? String(trt.total_cost) : "");
    setShowTreatmentModal(true);
  };

  const saveTreatment = async () => {
    if (!treatmentForm.diagnosis?.trim() || !treatmentForm.procedure?.trim()) {
      setTreatmentError("Diagnosis and procedure are required."); return;
    }
    setTreatmentError(null); setSavingTreatment(true);
    try {
      const payload: TreatmentCreate = {
        ...treatmentForm,
        tooth_number: treatmentTeeth.length ? treatmentTeeth[0] : treatmentForm.tooth_number,
        tooth_numbers: treatmentTeeth.length ? treatmentTeeth : undefined,
        session_costs: sessionCosts.length ? sessionCosts : undefined,
      };
      if (editingTreatmentId) {
        await api.updateTreatment(editingTreatmentId, payload);
        setShowTreatmentModal(false);
        const editingId = editingTreatmentId;
        setEditingTreatmentId(null);
        if (selectedTreatment?.id === editingId) {
          await refreshSelectedTreatment(editingId);
        } else {
          await loadData();
        }
      } else {
        const created = await api.createTreatment(payload);
        setShowTreatmentModal(false);
        setEditingTreatmentId(null);
        // The treatment itself was saved -- a failing follow-up fetch must
        // NOT surface as "failed to save" (which invites a retry that
        // duplicates the treatment). Best-effort refresh instead.
        try {
          await loadData();
          const freshSessions = await api.getTreatmentSessions(created.id);
          setSelectedTreatment(created); setSessions(freshSessions);
          setActiveTab("Treatments");
        } catch {
          await loadData();
        }
      }
    } catch { setTreatmentError("Failed to save treatment. Please try again."); }
    finally { setSavingTreatment(false); }
  };

  const lastTreatmentClick = useRef<number | null>(null);

  const selectTreatment = async (t: Treatment) => {
    setSelectedTreatment(t); setSessionActionError(null);
    lastTreatmentClick.current = t.id;
    const clickedId = t.id;
    try {
      const sessions = await api.getTreatmentSessions(t.id);
      // A slow response for an older click must not overwrite the session
      // list of the treatment the user ended up on.
      if (lastTreatmentClick.current === clickedId) setSessions(sessions);
    } catch { if (lastTreatmentClick.current === clickedId) setSessions([]); }
  };

  const refreshSelectedTreatment = async (treatmentId: number) => {
    const [freshSessions, freshTreatments, freshAppointments] = await Promise.all([
      api.getTreatmentSessions(treatmentId),
      api.getPatientTreatments(Number(id)),
      api.getPatientAppointments(Number(id)),
    ]);
    setSessions(freshSessions); setTreatments(freshTreatments); setAppointments(freshAppointments);
    const updated = freshTreatments.find(t => t.id === treatmentId);
    if (updated) setSelectedTreatment(updated);
  };

  const deleteTreatment = async (t: Treatment) => {
    if (!window.confirm(`Delete "${t.procedure || "this treatment"}" and all its sessions?`)) return;
    try {
      await api.deleteTreatment(t.id);
      if (selectedTreatment?.id === t.id) { setSelectedTreatment(null); setSessions([]); }
      await loadData();
    } catch { alert("Failed to delete treatment."); }
  };

  // ── Session helpers ───────────────────────────────────────────────────────

  const findAppointmentForSession = (sessionId: number): AppointmentType | undefined =>
    appointments.find(a => a.session_id === sessionId && a.status !== "Canceled");

  const addExtraSession = async () => {
    if (!selectedTreatment) return;
    try { await api.createTreatmentSession({ treatment_id: selectedTreatment.id }); await refreshSelectedTreatment(selectedTreatment.id); }
    catch { setSessionActionError("Failed to add an extra session."); }
  };

  // ── Document helpers ──────────────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    if (!id) return;
    setUploadingDoc(true);
    try {
      const doc = await api.uploadDocument(Number(id), file);
      setPatientDocuments(prev => [doc, ...prev]);
    } catch {
      alert("Failed to upload file.");
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDocument = async (docId: number) => {
    if (!window.confirm("Delete this document?")) return;
    try {
      await api.deleteDocument(docId);
      setPatientDocuments(prev => prev.filter(d => d.id !== docId));
    } catch {
      alert("Failed to delete document.");
    }
  };

  const docUrl = (doc: PatientDocument) => `${API_BASE_URL}/documents/${doc.id}/download`;
  const isImage = (doc: PatientDocument) => doc.file_type?.startsWith("image/");

  const confirmRename = async (session: TreatmentSession) => {
    try {
      await api.updateTreatmentSession(session.id, { label: renameDraft.trim() || undefined });
      setRenamingSessionId(null);
      if (selectedTreatment) await refreshSelectedTreatment(selectedTreatment.id);
    } catch { setSessionActionError("Failed to rename session."); }
  };

  const cancelSessionBooking = async (session: TreatmentSession) => {
    const appt = findAppointmentForSession(session.id);
    if (!appt) return;
    if (!window.confirm(`Cancel the booking for "${session.label || `Session ${session.session_number}`}"?`)) return;
    try {
      await api.updateAppointment(appt.id, { patient_id: appt.patient_id, appointment_datetime: appt.appointment_datetime, duration_minutes: appt.duration_minutes, status: "Canceled" });
      if (selectedTreatment) await refreshSelectedTreatment(selectedTreatment.id);
    } catch { setSessionActionError("Failed to cancel the booking."); }
  };

  const deleteSessionSlot = async (session: TreatmentSession) => {
    if (!window.confirm(`Remove "${session.label || `Session ${session.session_number}`}" entirely?`)) return;
    try {
      await api.deleteTreatmentSession(session.id);
      if (selectedTreatment) await refreshSelectedTreatment(selectedTreatment.id);
    } catch { setSessionActionError("Failed to remove session."); }
  };

  const chargeForSession = (session: TreatmentSession) =>
    navigate(`/financials?patient=${id}&treatment=${session.treatment_id}&session=${session.id}`);

  // ── Schedule modal ────────────────────────────────────────────────────────

  // Smart slot detection: getNextAvailableSlot only inspects ONE day, so a
  // fully-booked day would make the modal fall back to 9:00 of a random day
  // that may itself be booked. Search several days forward and return the
  // first genuinely free slot.
  const findNextFreeSlot = async (startDay: moment.Moment, duration: number, maxDays = 21): Promise<string> => {
    for (let i = 0; i < maxDays; i++) {
      const day = moment(startDay).add(i, "days");
      const slot = await api.getNextAvailableSlot(day.format("YYYY-MM-DD"), duration);
      if (slot) return slot;
    }
    return "";
  };

  const lastBookedSessionEnd = (session: TreatmentSession): moment.Moment => {
    // Keep the treatment order: start the search AFTER the last booked
    // session of this treatment that precedes this one.
    let lastEnd = moment(0);
    for (const a of appointments) {
      if (
        a.session_id &&
        a.treatment_id === session.treatment_id &&
        a.session_number !== undefined &&
        a.session_number < session.session_number &&
        a.status !== "Canceled" && a.status !== "No-Show"
      ) {
        const end = moment(a.appointment_datetime).add(a.duration_minutes || 0, "minutes");
        if (end.isAfter(lastEnd)) lastEnd = end;
      }
    }
    return lastEnd.isAfter(moment(0)) ? moment(lastEnd).add(1, "day").startOf("day") : moment().add(1, "day").startOf("day");
  };

  const openScheduleModal = async (session: TreatmentSession) => {
    setSchedulingSession(session); setScheduleError(null);
    setBulkMode(false); setBulkInterval("weekly");
    setScheduleDuration(session.duration_minutes || 30);
    setScheduleCollision(false);
    if (collisionCheck) {
      // Needed for the live collision warning while editing the time.
      api.getAllAppointments().then(setAllAppointments).catch(() => setAllAppointments([]));
    }
    try {
      const startDay = lastBookedSessionEnd(session);
      const slot = await findNextFreeSlot(startDay, session.duration_minutes || 30);
      setScheduleDatetime(slot
        ? moment(slot).format("YYYY-MM-DDTHH:mm")
        : startDay.hour(9).minute(0).format("YYYY-MM-DDTHH:mm"));
    } catch { setScheduleDatetime(moment().add(1,"day").hour(9).minute(0).format("YYYY-MM-DDTHH:mm")); }
    setShowScheduleModal(true);
  };

  const applyPreset = async (daysFromNow: number) => {
    if (!schedulingSession) return;
    try {
      const startDay = moment().add(daysFromNow, "day").startOf("day");
      const slot = await findNextFreeSlot(startDay, scheduleDuration);
      setScheduleDatetime(slot
        ? moment(slot).format("YYYY-MM-DDTHH:mm")
        : startDay.hour(9).minute(0).format("YYYY-MM-DDTHH:mm"));
    } catch {}
  };

  // Auto-slot: when a new date is picked in the schedule modal, compute the
  // first free slot of that day (for the current duration) and prefill it.
  const handleScheduleDateChange = async (dateStr: string) => {
    const currentDate = scheduleDatetime ? moment(scheduleDatetime).format("YYYY-MM-DD") : "";
    if (currentDate === dateStr) return;
    try {
      const slot = await api.getNextAvailableSlot(dateStr, scheduleDuration);
      setScheduleDatetime(slot
        ? moment(slot).format("YYYY-MM-DDTHH:mm")
        : `${dateStr}T09:00`);
    } catch {
      setScheduleDatetime(`${dateStr}T09:00`);
    }
  };

  // Live collision warning: when the opt-in collision check is ON, flag any
  // time that overlaps another patient's appointment (excluding the session's
  // own booking when rescheduling).
  useEffect(() => {
    if (!showScheduleModal || !collisionCheck || !scheduleDatetime || !schedulingSession) {
      setScheduleCollision(false);
      return;
    }
    const ownAppt = findAppointmentForSession(schedulingSession.id);
    const start = moment(scheduleDatetime);
    const end = moment(start).add(scheduleDuration || 30, "minutes");
    setScheduleCollision(allAppointments.some(a =>
      a.id !== ownAppt?.id &&
      a.status !== "Canceled" && a.status !== "No-Show" &&
      moment(a.appointment_datetime).isBefore(end) &&
      moment(a.appointment_datetime).add(a.duration_minutes || 0, "minutes").isAfter(start)));
  }, [showScheduleModal, collisionCheck, scheduleDatetime, scheduleDuration, allAppointments, schedulingSession, appointments]);

  const remainingUnscheduled = () =>
    sessions.filter(s => s.status === "Unscheduled").sort((a,b) => a.session_number - b.session_number);

  const confirmSchedule = async () => {
    if (!schedulingSession || !patient) return;
    if (!scheduleDatetime) { setScheduleError("Pick a date and time."); return; }
    setSchedulingSlot(true); setScheduleError(null);
    try {
      // Rescheduling an already-booked session must MOVE the existing
      // appointment -- creating a new one leaves the old booking behind
      // and the session ends up with two live appointments.
      const existingAppt = findAppointmentForSession(schedulingSession.id);
      const datetime = moment(scheduleDatetime).format("YYYY-MM-DDTHH:mm:ss");

      // Opt-in collision check (Settings > Scheduling). When ON, refuse
      // times that overlap another patient's appointment -- a clinic with
      // more than one office may share this calendar, so the default is OFF.
      if (collisionCheck && !bulkMode) {
        const start = moment(scheduleDatetime);
        const end = moment(start).add(scheduleDuration || 30, "minutes");
        const clash = allAppointments.some(a =>
          a.id !== existingAppt?.id &&
          a.status !== "Canceled" && a.status !== "No-Show" &&
          moment(a.appointment_datetime).isBefore(end) &&
          moment(a.appointment_datetime).add(a.duration_minutes || 0, "minutes").isAfter(start));
        if (clash) {
          const slot = await findNextFreeSlot(moment(scheduleDatetime).startOf("day"), scheduleDuration);
          if (slot) setScheduleDatetime(moment(slot).format("YYYY-MM-DDTHH:mm"));
          setScheduleError(t("sch_collision_blocked"));
          return;
        }
      }

      if (existingAppt) {
        await api.updateAppointment(existingAppt.id, {
          patient_id: patient.id,
          appointment_datetime: datetime,
          duration_minutes: scheduleDuration,
          status: "Scheduled",
        });
      } else if (!bulkMode) {
        await api.createAppointment({ patient_id: patient.id, appointment_datetime: datetime, duration_minutes: scheduleDuration, session_id: schedulingSession.id, status: "Scheduled" });
      } else {
        const unit = bulkInterval === "monthly" ? "months" : "weeks";
        const step = bulkInterval === "biweekly" ? 2 : 1;
        const toSchedule = remainingUnscheduled().filter(s => s.session_number >= schedulingSession.session_number);
        let cursor = moment(scheduleDatetime);
        for (const sess of toSchedule) {
          const slot = await api.getNextAvailableSlot(cursor.format("YYYY-MM-DD"), sess.duration_minutes || scheduleDuration)
            .catch(() => cursor.format("YYYY-MM-DDTHH:mm:ss"));
          const slotIso = slot ? slot : cursor.format("YYYY-MM-DDTHH:mm:ss");
          await api.createAppointment({ patient_id: patient.id, appointment_datetime: moment(slotIso).format("YYYY-MM-DDTHH:mm:ss"), duration_minutes: sess.duration_minutes || scheduleDuration, session_id: sess.id, status: "Scheduled" });
          cursor = cursor.add(step, unit as any);
        }
      }
      setShowScheduleModal(false);
      if (selectedTreatment) await refreshSelectedTreatment(selectedTreatment.id);
    } catch { setScheduleError("Failed to schedule — that slot may be booked. Try another time."); }
    finally { setSchedulingSlot(false); }
  };

  // ── Complete modal ────────────────────────────────────────────────────────

  const openCompleteModal = (session: TreatmentSession) => {
    setCompletingSession(session); setCompleteError(null);
    // Editing an already-completed session must keep the REAL visit date --
    // defaulting to "now" would silently overwrite it on save.
    setCompleteForm({
      procedure_done: session.procedure_done || session.label || `Session ${session.session_number}`,
      notes: session.notes || "",
      cost: session.cost || 0,
      visit_date: session.visit_date
        ? moment(session.visit_date).format("YYYY-MM-DDTHH:mm")
        : moment().format("YYYY-MM-DDTHH:mm"),
    });
    setShowCompleteModal(true);
  };

  const confirmComplete = async () => {
    if (!completingSession) return;
    if (!completeForm.procedure_done.trim()) { setCompleteError("Describe what was done."); return; }
    setSavingComplete(true); setCompleteError(null);
    try {
      await api.updateTreatmentSession(completingSession.id, { status: "Completed", procedure_done: completeForm.procedure_done, notes: completeForm.notes || undefined, cost: completeForm.cost || 0, visit_date: moment(completeForm.visit_date).format("YYYY-MM-DDTHH:mm:ss") });
      setShowCompleteModal(false);
      if (selectedTreatment) await refreshSelectedTreatment(selectedTreatment.id);
    } catch { setCompleteError("Failed to save. Please try again."); }
    finally { setSavingComplete(false); }
  };

  // ── Edit patient ──────────────────────────────────────────────────────────

  const openEditModal = () => {
    if (!patient) return;
    setEditForm({ ...patient });
    setEditErrors({});
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    if (!patient) return;
    const errors = validateForm(editForm as unknown as Record<string, string | undefined>, t);
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }
    setSavingEdit(true);
    try {
      await api.updatePatient(patient.id, editForm as any);
      setShowEditModal(false);
      await loadData();
    } catch { alert("Failed to save changes."); }
    finally { setSavingEdit(false); }
  };

  // ── Quick note ────────────────────────────────────────────────────────────

  const submitQuickNote = async () => {
    if (!patient || !quickNote.trim()) return;
    setSavingNote(true);
    try {
      await api.createTimelineEvent({ patient_id: patient.id, event_type: "Note", description: quickNote.trim() });
      setQuickNote("");
      const fresh = await api.getPatientTimeline(patient.id);
      setTimeline(fresh);
    } catch { alert("Failed to save note."); }
    finally { setSavingNote(false); }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // LOADING
  // ─────────────────────────────────────────────────────────────────────────

  if (loading || !patient) {
    return (
      <div style={{ padding: "80px", textAlign: "center", color: colors.textMuted }}>
        {loadError ? (
          <>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
            <div style={{ marginBottom: "16px", color: "#dc2626" }}>{t("patient_fail_load")}</div>
            <button
              onClick={() => loadData()}
              style={{
                padding: "10px 18px", borderRadius: "8px", border: "none",
                background: colors.accent, color: colors.accentText, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t("dash_retry")}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⏳</div>
            <div>{t("loading")}</div>
          </>
        )}
      </div>
    );
  }

  // ─── Computed values ──────────────────────────────────────────────────────

  const avatarColor = getAvatarColor(patient.first_name + patient.last_name);
  const age = getAge(patient.date_of_birth);
  const totalPaid = payments.filter(p => p.status === "Completed").reduce((sum, p) => sum + p.amount, 0);
  const totalPending = payments.filter(p => p.status === "Pending").reduce((sum, p) => sum + p.amount, 0);
  // Canceled treatments were never delivered -- they must not inflate the
  // billed amount (and therefore the outstanding balance).
  const totalBilled = treatments
    .filter(t => t.status !== "Canceled")
    .reduce((sum, t) => sum + t.total_cost, 0);
  const balance = totalBilled - totalPaid;
  const activeTreatments = treatments.filter(t => t.status === "Planned" || t.status === "Ongoing");
  const now = new Date();
  const upcomingAppointments = appointments
    .filter(a => new Date(a.appointment_datetime) >= now && a.status !== "Canceled" && a.status !== "No-Show")
    .sort((a, b) => new Date(a.appointment_datetime).getTime() - new Date(b.appointment_datetime).getTime());
  // Past visits = appointments whose date has passed. Status alone (e.g. a
  // No-Show/Completed marker on a FUTURE-dated row) must not dump it here.
  const pastAppointments = appointments
    .filter(a => new Date(a.appointment_datetime) < now)
    .sort((a, b) => new Date(b.appointment_datetime).getTime() - new Date(a.appointment_datetime).getTime());

  // ─── Tab definitions ──────────────────────────────────────────────────────

  const TABS: { id: TabType; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "Overview",     label: t("prof_tab_overview"),     icon: <LayoutDashboard size={15} /> },
    { id: "Odontogram",   label: t("prof_tab_odontogram"),   icon: <ScanLine size={15} /> },
    { id: "Appointments", label: t("prof_tab_appointments"), icon: <CalendarDays size={15} />, count: appointments.length },
    { id: "Treatments",   label: t("prof_tab_treatments"),   icon: <Stethoscope size={15} />,  count: treatments.length },
    { id: "Payments",     label: t("prof_tab_payments"),     icon: <DollarSign size={15} />,   count: payments.length },
    { id: "Documents",    label: t("prof_tab_documents"),    icon: <FileText size={15} /> },
    { id: "Timeline",     label: t("prof_tab_timeline"),     icon: <Activity size={15} />,     count: timeline.length },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: colors.bgInput, padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* ── BACK ─────────────────────────────────────────────────────────── */}
      <button onClick={() => navigate(-1)} style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", color: colors.textSecondary, cursor: "pointer", fontSize: "14px", fontWeight: 500, alignSelf: "flex-start" }}>
        <ArrowLeft size={17} /> {t("prof_back")}
      </button>

      {/* ── PATIENT HEADER ───────────────────────────────────────────────── */}
      <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
        {/* Colour strip */}
        <div style={{ height: 6, background: `linear-gradient(90deg, ${avatarColor}, ${avatarColor}88)` }} />

        <div style={{ padding: "24px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Avatar */}
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: avatarColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 700, flexShrink: 0, boxShadow: `0 0 0 4px ${avatarColor}22` }}>
            {getInitials(patient)}
          </div>

          {/* Name + demo + contact */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: colors.text }}>
                {patient.first_name} {patient.last_name}
              </h1>
              {patient.gender && (
                <span style={{ fontSize: "12px", fontWeight: 600, background: colors.bgInput, color: colors.textSecondary, padding: "2px 10px", borderRadius: "999px" }}>
                  {patient.gender}
                </span>
              )}
              {age !== null && (
                <span style={{ fontSize: "12px", fontWeight: 600, background: colors.accentHover, color: colors.accent, padding: "2px 10px", borderRadius: "999px" }}>
                  {age} {t("patients_yrs")}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: "20px", marginTop: "10px", flexWrap: "wrap" }}>
              {patient.phone_number && (
                <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px", color: colors.textSecondary }}>
                  <Phone size={13} color={colors.textMuted} /> {patient.phone_number}
                </span>
              )}
              {patient.email && (
                <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px", color: colors.textSecondary }}>
                  <Mail size={13} color={colors.textMuted} /> {patient.email}
                </span>
              )}
              {patient.date_of_birth && (
                <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "13px", color: colors.textSecondary }}>
                  <Calendar size={13} color={colors.textMuted} /> {t("prof_dob")}: {patient.date_of_birth}
                </span>
              )}
            </div>

            {/* Allergy alert */}
            {patient.allergies && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "10px", background: "#fee2e2", color: "#991b1b", padding: "5px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600 }}>
                <AlertTriangle size={14} /> {t("prof_allergy_alert")}: {patient.allergies}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <button onClick={openEditModal} style={s.secondaryBtn}>
              <Edit3 size={14} /> {t("prof_edit")}
            </button>
            <button onClick={openTreatmentModal} style={s.secondaryBtn}>
              <Stethoscope size={14} /> {t("prof_new_treatment")}
            </button>
            <button onClick={() => navigate("/calendar")} style={s.addBtn}>
              <CalendarDays size={14} /> {t("prof_book_apt")}
            </button>
          </div>
        </div>

        {/* ── Stat tiles strip ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", borderTop: "1px solid #f1f5f9" }}>
          {[
            { label: t("prof_total_visits"),       value: appointments.length.toString(),      color: colors.accent },
            { label: t("prof_active_treatments"),  value: activeTreatments.length.toString(),  color: "#9333ea" },
            { label: t("prof_total_paid"),         value: formatMoney(totalPaid), color: "#16a34a" },
            { label: t("prof_balance"),value: formatMoney(balance),   color: balance > 0 ? "#dc2626" : "#16a34a" },
          ].map((tile, i, arr) => (
            <div key={tile.label} style={{ padding: "14px 20px", borderRight: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
              <div style={{ fontSize: "18px", fontWeight: 700, color: tile.color }}>{tile.value}</div>
              <div style={{ fontSize: "11px", color: colors.textMuted, marginTop: "2px" }}>{tile.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── TAB BAR ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "4px", background: colors.bgCard, border: "1px solid var(--border)", borderRadius: "12px", padding: "4px", overflowX: "auto" }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "8px 14px", borderRadius: "8px", border: "none",
                background: active ? colors.accent : "transparent",
                color: active ? "#fff" : colors.textSecondary,
                fontSize: "13px", fontWeight: active ? 700 : 500,
                cursor: "pointer", whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span style={{ background: active ? "rgba(255,255,255,0.25)" : colors.border, color: active ? "#fff" : colors.textSecondary, borderRadius: "999px", padding: "0 6px", fontSize: "11px", fontWeight: 700 }}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: OVERVIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "Overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Two-column grid: Patient Info + Medical */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

            {/* Patient Info */}
            <div style={s.card}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <User size={16} color={colors.accent} />
                <span style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("prof_patient_info")}</span>
              </div>
              <InfoRow icon={<Phone size={13} />}     label={t("prof_phone")}       value={patient.phone_number} />
              <InfoRow icon={<Mail size={13} />}      label={t("prof_email")}       value={patient.email} />
              <InfoRow icon={<MapPin size={13} />}    label={t("prof_address")}     value={patient.address} />
              <InfoRow icon={<Calendar size={13} />}  label={t("prof_dob")} value={patient.date_of_birth ? `${patient.date_of_birth}${age !== null ? ` (${age} ${t("patients_yrs")})` : ""}` : null} />
              <InfoRow icon={<Briefcase size={13} />} label={t("prof_occupation")}  value={patient.occupation} />
              <InfoRow icon={<Shield size={13} />}    label={t("prof_emergency")} value={patient.emergency_contact_name ? `${patient.emergency_contact_name} · ${patient.emergency_contact_phone || "—"}` : null} />
            </div>

            {/* Medical Info */}
            <div style={s.card}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                <Heart size={16} color="#dc2626" />
                <span style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("prof_medical_info")}</span>
              </div>

              {patient.allergies ? (
                <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 12px", marginBottom: "12px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <AlertTriangle size={15} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("prof_allergy_alert")}</div>
                    <div style={{ fontSize: "14px", color: "#b91c1c", marginTop: "3px" }}>{patient.allergies}</div>
                  </div>
                </div>
              ) : (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "8px 12px", marginBottom: "12px", fontSize: "13px", color: "#16a34a", fontWeight: 600 }}>
                  {t("prof_no_allergies")}
                </div>
              )}
              <InfoRow icon={<Pill size={13} />} label={t("prof_medications")} value={patient.current_medications} />
              <InfoRow label={t("prof_medical_history")}    value={patient.medical_history} />
              {patient.notes && <InfoRow label={t("prof_notes")} value={patient.notes} />}
            </div>
          </div>

          {/* Upcoming appointments + Quick Note side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

            {/* Upcoming appointments */}
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <CalendarDays size={16} color={colors.accent} />
                  <span style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("prof_upcoming_apts")}</span>
                </div>
                <button onClick={() => setActiveTab("Appointments")} style={{ background: "none", border: "none", color: colors.accent, fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "3px" }}>
                  {t("view_all")} <ChevronRight size={13} />
                </button>
              </div>
              {upcomingAppointments.length === 0 ? (
                <div style={{ ...s.emptyState, padding: "24px" }}>
                  <CalendarDays size={28} style={{ opacity: 0.2, marginBottom: 8 }} />
                  <div style={{ fontSize: "13px" }}>{t("prof_no_upcoming")}</div>
                </div>
              ) : (
                upcomingAppointments.slice(0, 4).map(a => {
                  const sc = APPT_STATUS_COLORS[a.status] || APPT_STATUS_COLORS.Scheduled;
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: "1px solid #f8fafc" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: sc.dot, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: colors.text }}>{moment(a.appointment_datetime).format("ddd, MMM D · HH:mm")}</div>
                        {a.reason && <div style={{ fontSize: "12px", color: colors.textSecondary }}>{a.reason}</div>}
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: 600, background: sc.bg, color: sc.text, padding: "2px 8px", borderRadius: "999px" }}>{t(APPT_STATUS_KEY[a.status] as any)}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Note */}
            <div style={s.card}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                <MessageSquare size={16} color={colors.textSecondary} />
                <span style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("prof_quick_note")}</span>
              </div>
              <textarea
                placeholder={t("prof_note_placeholder")}
                value={quickNote}
                onChange={e => setQuickNote(e.target.value)}
                style={{ ...s.textarea, minHeight: "90px", marginBottom: "10px" }}
              />
              <button
                onClick={submitQuickNote}
                disabled={savingNote || !quickNote.trim()}
                style={{ ...s.addBtn, opacity: (!quickNote.trim() || savingNote) ? 0.6 : 1 }}
              >
                <Send size={14} /> {savingNote ? t("saving") : t("prof_add_note")}
              </button>

              {/* Recent timeline events */}
              {timeline.length > 0 && (
                <div style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid #f1f5f9" }}>
                  <div style={s.sectionLabel}>{t("prof_recent_activity")}</div>
                  {timeline.slice(0, 3).map(ev => {
                    const color = TIMELINE_COLORS[ev.event_type] ?? colors.textSecondary;
                    const icon = TIMELINE_ICONS[ev.event_type] ?? <Activity size={10} />;
                    const eventLabel =
                      ev.event_type === "Visit Completed" ? t("status_completed") :
                      ev.event_type === "Appointment" ? t("cal_title") :
                      ev.event_type === "Treatment" ? t("prof_tab_treatments") :
                      ev.event_type === "Payment" ? t("prof_tab_payments") :
                      ev.event_type === "Note" ? t("prof_quick_note") :
                      ev.event_type;
                    return (
                      <div key={ev.id} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "flex-start" }}>
                        <div style={{ width: 20, height: 20, borderRadius: "50%", background: color + "22", border: `2px solid ${color}`, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                          {icon}
                        </div>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: colors.text }}>{eventLabel}</div>
                          <div style={{ fontSize: "12px", color: colors.textSecondary }}>{ev.description}</div>
                        </div>
                      </div>
                    );
                  })}
                  <button onClick={() => setActiveTab("Timeline")} style={{ marginTop: "4px", background: "none", border: "none", color: colors.accent, fontSize: "12px", fontWeight: 600, cursor: "pointer", padding: 0 }}>
                    {t("prof_view_timeline")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: ODONTOGRAM
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "Odontogram" && (
        <div style={s.card}>
          <TeethChart patientId={Number(id)} />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: APPOINTMENTS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "Appointments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
            {[
              { label: "Total",    value: appointments.length,                                         color: colors.text },
              { label: "Upcoming", value: upcomingAppointments.length,                                 color: colors.accent },
              { label: "Completed",value: appointments.filter(a=>a.status==="Completed").length,        color: "#16a34a" },
              { label: "No-Show",  value: appointments.filter(a=>a.status==="No-Show").length,         color: "#f59e0b" },
            ].map(t => <StatTile key={t.label} label={t.label} value={t.value.toString()} color={t.color} />)}
          </div>

          {/* Upcoming */}
          <div style={s.card}>
            <div style={{ fontWeight: 700, fontSize: "15px", color: colors.text, marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Clock size={16} color={colors.accent} /> {t("prof_upcoming_apts")} ({upcomingAppointments.length})
            </div>
            {upcomingAppointments.length === 0 ? (
              <div style={s.emptyState}>{t("prof_no_upcoming")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {upcomingAppointments.map(a => {
                  const sc = APPT_STATUS_COLORS[a.status] || APPT_STATUS_COLORS.Scheduled;
                  const treatment = treatments.find(t => t.id === a.treatment_id);
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px", borderRadius: "10px", background: sc.bg, border: `1px solid ${sc.dot}33` }}>
                      <div style={{ textAlign: "center", minWidth: 48 }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: sc.text, textTransform: "uppercase" }}>{moment(a.appointment_datetime).format("MMM")}</div>
                        <div style={{ fontSize: "22px", fontWeight: 700, color: sc.dot, lineHeight: 1 }}>{moment(a.appointment_datetime).format("D")}</div>
                        <div style={{ fontSize: "11px", color: sc.text }}>{moment(a.appointment_datetime).format("HH:mm")}</div>
                      </div>
                      <div style={{ width: 1, height: 40, background: `${sc.dot}33` }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: colors.text, fontSize: "14px" }}>
                          {a.reason || "Appointment"}
                          {a.session_number && <span style={{ color: colors.textMuted, fontWeight: 400, fontSize: "12px", marginLeft: 8 }}>Session {a.session_number}</span>}
                        </div>
                        {treatment && <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: 2 }}>{treatment.procedure}</div>}
                        <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: 2 }}>{a.duration_minutes} {t("duration_min")}</div>
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: 700, background: "white", color: sc.text, padding: "4px 10px", borderRadius: "999px", border: `1px solid ${sc.dot}44` }}>{t(APPT_STATUS_KEY[a.status] as any)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Past */}
          <div style={s.card}>
            <div style={{ fontWeight: 700, fontSize: "15px", color: colors.text, marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Activity size={16} color={colors.textSecondary} /> Past Visits ({pastAppointments.length})
            </div>
            {pastAppointments.length === 0 ? (
              <div style={s.emptyState}>No past appointments.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: colors.bgInput }}>
                    {[t("date_time"), t("dash_reason"), t("duration"), t("cal_status")].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: colors.textSecondary, fontSize: "12px", border: "none" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pastAppointments.map(a => {
                    const sc = APPT_STATUS_COLORS[a.status] || APPT_STATUS_COLORS.Scheduled;
                    return (
                      <tr key={a.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 500, color: colors.text }}>
                          {moment(a.appointment_datetime).format("MMM D, YYYY · HH:mm")}
                        </td>
                        <td style={{ padding: "10px 12px", color: colors.textSecondary }}>
                          {a.reason || "—"}
                          {a.session_number && <span style={{ color: colors.textMuted, marginLeft: 6, fontSize: "11px" }}>Session {a.session_number}</span>}
                        </td>
                        <td style={{ padding: "10px 12px", color: colors.textSecondary }}>{a.duration_minutes} {t("duration_min")}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 700, background: sc.bg, color: sc.text, padding: "3px 10px", borderRadius: "999px" }}>{t(APPT_STATUS_KEY[a.status] as any)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TREATMENTS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "Treatments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: colors.text }}>
              {t("prof_tab_treatments")} <span style={{ color: colors.textMuted, fontWeight: 400, fontSize: "14px" }}>({treatments.length})</span>
            </h3>
            <button style={s.addBtn} onClick={openTreatmentModal}>
              <Plus size={15} /> {t("prof_new_treatment")}
            </button>
          </div>

          {treatments.length === 0 ? (
            <div style={{ ...s.card, ...s.emptyState }}>
              <Stethoscope size={32} style={{ opacity: 0.2, marginBottom: 10 }} />
              <div>{t("trt_no_treatments")}</div>
              <button style={{ ...s.addBtn, margin: "12px auto 0" }} onClick={openTreatmentModal}>
                <Plus size={14} /> {t("trt_create_first")}
              </button>
            </div>
          ) : (
            treatments.map(trt => {
              const pct = trt.total_sessions_required > 0
                ? Math.min(100, Math.round((trt.sessions_completed / trt.total_sessions_required) * 100)) : 0;
              const tc = TREATMENT_STATUS_COLORS[trt.status] || { bg: colors.bgInput, text: colors.textSecondary };
              const isSelected = selectedTreatment?.id === trt.id;
              return (
                <div key={trt.id} style={{ ...s.card, cursor: "pointer", border: isSelected ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`, background: isSelected ? colors.accentHover : colors.bgCard, transition: "all 0.15s ease" }} onClick={() => selectTreatment(trt)}>
                  {/* Header row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "16px", color: colors.text }}>
                        {trt.procedure || "Unnamed Treatment"}
                        {trt.tooth_number && <span style={{ fontWeight: 400, color: colors.textMuted, fontSize: "13px", marginLeft: 8 }}>· {t("trt_tooth_selected")}{trt.tooth_number}</span>}
                      </div>
                      {trt.diagnosis && <div style={{ fontSize: "13px", color: colors.textSecondary, marginTop: 3 }}>{trt.diagnosis}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button style={{ ...s.secondaryBtn, fontSize: "12px" }} onClick={e => { e.stopPropagation(); openEditTreatmentModal(trt); }}>
                        <Pencil size={13} /> {t("trt_edit")}
                      </button>
                      <span style={{ fontSize: "11px", fontWeight: 700, background: tc.bg, color: tc.text, padding: "4px 10px", borderRadius: "999px" }}>{t(TREATMENT_STATUS_KEY[trt.status] as any)}</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: colors.textSecondary, marginBottom: 5 }}>
                      <span>{trt.sessions_completed} {t("trt_of")} {trt.total_sessions_required} {t("trt_sessions_completed")}</span>
                      <span style={{ fontWeight: 700, color: pct === 100 ? "#16a34a" : colors.accent }}>{pct}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: "999px", background: colors.border, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#16a34a" : colors.accent, borderRadius: "999px", transition: "width 0.3s ease" }} />
                    </div>
                  </div>

                  {/* Footer row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: "14px", color: colors.text, fontWeight: 600 }}>
                      {formatMoney(trt.total_cost)}
                    </span>
                    <button style={{ ...s.secondaryBtn, color: "#dc2626", fontSize: "12px" }} onClick={e => { e.stopPropagation(); deleteTreatment(trt); }}>
                      <Trash2 size={13} /> {t("delete")}
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {/* Sessions panel */}
          {selectedTreatment && (
            <div style={{ ...s.card, marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("trt_sessions_panel")}</div>
                  <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: 2 }}>{selectedTreatment.procedure}</div>
                </div>
                <button style={s.secondaryBtn} onClick={addExtraSession}>
                  <Plus size={14} /> {t("trt_add_session")}
                </button>
              </div>

              {sessionActionError && <div style={s.errorBanner}>{sessionActionError}</div>}

              {sessions.length === 0 ? (
                <div style={s.emptyState}>{t("trt_no_sessions")}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {sessions.slice().sort((a,b) => a.session_number - b.session_number).map(session => {
                    const ss = SESSION_STATUS_STYLE[session.status];
                    const isRenaming = renamingSessionId === session.id;
                    return (
                      <div key={session.id} style={{ border: `1px solid ${ss.border}`, background: ss.bg, borderRadius: "10px", padding: "14px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 200 }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: ss.dot, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 700, flexShrink: 0 }}>
                              {session.session_number}
                            </div>
                            <div style={{ flex: 1 }}>
                              {isRenaming ? (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <input autoFocus style={{ ...s.input, padding: "6px 8px", fontSize: "13px" }} value={renameDraft} onChange={e => setRenameDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && confirmRename(session)} />
                                  <button style={s.secondaryBtn} onClick={() => confirmRename(session)}><CheckCircle2 size={14} /></button>
                                </div>
                              ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <strong style={{ fontSize: "14px", color: colors.text }}>{session.label || `Session ${session.session_number}`}</strong>
                                  <button title={t("edit")} onClick={() => { setRenamingSessionId(session.id); setRenameDraft(session.label || `Session ${session.session_number}`); }} style={{ background: "none", border: "none", cursor: "pointer", color: colors.textMuted, padding: 0 }}>
                                    <Pencil size={11} />
                                  </button>
                                </div>
                              )}
                              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ fontSize: "11px", fontWeight: 700, color: ss.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t(SESSION_STATUS_KEY[session.status] as any)}</span>
                                {session.visit_date && <span style={{ fontSize: "12px", color: colors.textSecondary }}>{moment(session.visit_date).format("ddd, MMM D · h:mm A")}</span>}
                                {session.status === "Completed" && session.cost > 0 && <span style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>{formatMoney(session.cost)}</span>}
                              </div>
                              {session.status === "Completed" && session.procedure_done && (
                                <p style={{ margin: "6px 0 0", fontSize: "13px", color: colors.text }}>{session.procedure_done}</p>
                              )}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {session.status === "Unscheduled" && (
                              <>
                                <button style={s.addBtn} onClick={() => openScheduleModal(session)}><CalendarClock size={13} /> {t("trt_schedule")}</button>
                                <button style={s.secondaryBtn} onClick={() => openCompleteModal(session)}><CheckCircle2 size={13} /> {t("trt_mark_done")}</button>
                                <button title={t("trt_remove")} onClick={() => deleteSessionSlot(session)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 6 }}><Trash2 size={14} /></button>
                              </>
                            )}
                            {session.status === "Scheduled" && (
                              <>
                                <button style={s.secondaryBtn} onClick={() => openScheduleModal(session)}><CalendarClock size={13} /> {t("trt_reschedule")}</button>
                                <button style={s.addBtn} onClick={() => openCompleteModal(session)}><CheckCircle2 size={13} /> {t("trt_mark_done")}</button>
                                <button title={t("trt_cancel_booking")} onClick={() => cancelSessionBooking(session)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 6 }}><Ban size={14} /></button>
                              </>
                            )}
                            {session.status === "Completed" && (
                              <>
                                <button style={s.secondaryBtn} onClick={() => chargeForSession(session)}><CreditCard size={13} /> {t("trt_charge")}</button>
                                <button style={s.secondaryBtn} onClick={() => openCompleteModal(session)}><Pencil size={13} /> {t("trt_edit")}</button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: PAYMENTS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "Payments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
            <StatTile label={t("pay_total_billed")}   value={formatMoney(totalBilled)}   color={colors.text} />
            <StatTile label={t("pay_total_paid")}     value={formatMoney(totalPaid)}     color="#16a34a" />
            <StatTile label={t("pay_pending")}        value={formatMoney(totalPending)}  color="#f59e0b" />
            <StatTile label={t("pay_outstanding")}    value={formatMoney(balance)}       color={balance > 0 ? "#dc2626" : "#16a34a"} sub={balance > 0 ? t("pay_owes") : t("pay_settled")} />
          </div>

          {/* Ledger */}
          <div style={s.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("pay_ledger")}</span>
              <button style={s.addBtn} onClick={() => navigate(`/financials?patient=${id}`)}>
                <Plus size={14} /> {t("pay_record")}
              </button>
            </div>

            {payments.length === 0 ? (
              <div style={s.emptyState}>
                <DollarSign size={32} style={{ opacity: 0.2, marginBottom: 10 }} />
                <div>{t("pay_no_payments")}</div>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: colors.bgInput }}>
                    {[t("pay_date"), t("pay_description"), t("pay_method"), t("pay_amount"), t("pay_status")].map(h => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: colors.textSecondary, fontSize: "12px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...payments]
                    // null payment_date must sort last (treated as epoch 0)
                    // instead of producing NaN ordering.
                    .sort((a, b) => (new Date(b.payment_date ?? 0).getTime()) - (new Date(a.payment_date ?? 0).getTime()))
                    .map(p => (
                    <tr key={p.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "11px 12px", color: colors.textSecondary }}>{p.payment_date ? moment(p.payment_date).format("MMM D, YYYY") : "—"}</td>
                      <td style={{ padding: "11px 12px", color: colors.textSecondary, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description || "—"}</td>
                      <td style={{ padding: "11px 12px", color: colors.textSecondary }}>{p.method}</td>
                      <td style={{ padding: "11px 12px", fontWeight: 700, color: colors.text }}>{formatMoney(p.amount)}</td>
                      <td style={{ padding: "11px 12px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, background: p.status === "Completed" ? "#dcfce7" : "#fef9c3", color: p.status === "Completed" ? "#166534" : "#854d0e", padding: "3px 9px", borderRadius: "999px" }}>
                          {p.status === "Completed" ? t("status_completed") : t("pay_pending")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ borderTop: `2px solid ${colors.border}` }}>
                  <tr>
                    <td colSpan={3} style={{ padding: "12px", fontWeight: 700, fontSize: "13px", color: colors.text }}>{t("pay_total_collected")}</td>
                    <td style={{ padding: "12px", fontWeight: 700, color: "#16a34a", fontSize: "15px" }}>{formatMoney(totalPaid)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: DOCUMENTS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "Documents" && (
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("doc_title")}</div>
              <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: 2 }}>{t("doc_subtitle")}</div>
            </div>
            <span style={{ fontSize: "12px", color: colors.textMuted }}>{patientDocuments.length} {t("tl_events")?.replace("events","files") ?? "files"}</span>
          </div>

          {/* Upload area */}
          <div
            style={{ border: "2px dashed #cbd5e1", borderRadius: "12px", padding: "32px 24px", textAlign: "center", background: colors.bgInput, marginBottom: 16, cursor: uploadingDoc ? "wait" : "pointer", opacity: uploadingDoc ? 0.6 : 1 }}
            onClick={() => !uploadingDoc && fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={async e => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file && !uploadingDoc) await handleUpload(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={async e => {
                const file = e.target.files?.[0];
                if (file) await handleUpload(file);
                e.target.value = '';
              }}
            />
            <div style={{ width: 52, height: 52, borderRadius: "12px", background: colors.accentHover, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              {uploadingDoc ? <div style={{ width: 24, height: 24, border: `3px solid ${colors.border}`, borderTopColor: colors.accent, borderRadius: "50%" }} /> : <Upload size={24} color={colors.accent} />}
            </div>
            <div style={{ fontWeight: 700, fontSize: "15px", color: colors.text, marginBottom: 6 }}>{uploadingDoc ? "Uploading…" : t("doc_upload_title")}</div>
            <div style={{ fontSize: "13px", color: colors.textSecondary, marginBottom: 16, whiteSpace: "pre-line" }}>{t("doc_upload_hint")}</div>
            <button style={{ ...s.addBtn, margin: "0 auto", pointerEvents: uploadingDoc ? "none" : "auto" }}>
              <Upload size={14} /> {t("doc_choose")}
            </button>
          </div>

          {/* File list */}
          {patientDocuments.length === 0 ? (
            <div style={{ ...s.emptyState, padding: "24px" }}>
              <FileText size={28} style={{ opacity: 0.2, marginBottom: 8 }} />
              <div style={{ fontSize: "13px" }}>{t("doc_no_documents")}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {patientDocuments.map(doc => (
                <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: colors.bgInput, borderRadius: "10px", border: `1px solid ${colors.border}`, cursor: "pointer" }} onClick={() => setPreviewDoc(doc)}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                    {isImage(doc) ? (
                      <img src={docUrl(doc)} alt="" style={{ width: 40, height: 40, borderRadius: "8px", objectFit: "cover", flexShrink: 0, background: colors.border }} />
                    ) : (
                      <FileText size={20} color={colors.accent} style={{ flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "13px", color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.file_name}</div>
                      <div style={{ fontSize: "11px", color: colors.textMuted }}>{new Date(doc.uploaded_at).toLocaleDateString()} &middot; {doc.file_type}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => window.open(docUrl(doc), '_blank')} style={{ width: 32, height: 32, borderRadius: "8px", border: "none", background: colors.accentHover, color: colors.accent, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Download size={14} />
                    </button>
                    <button onClick={() => handleDeleteDocument(doc.id)} style={{ width: 32, height: 32, borderRadius: "8px", border: "none", background: "#fef2f2", color: "#ef4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: DOCUMENT PREVIEW
      ══════════════════════════════════════════════════════════════════════ */}
      {previewDoc && (
        <div style={s.modalOverlay} onClick={() => setPreviewDoc(null)}>
          <div style={{ ...s.modalBox, maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewDoc.file_name}</h2>
              <button onClick={() => setPreviewDoc(null)} style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}><X size={20} /></button>
            </div>
            <div style={{ fontSize: "12px", color: colors.textMuted, marginBottom: 16 }}>{new Date(previewDoc.uploaded_at).toLocaleString()} &middot; {previewDoc.file_type}</div>
            {isImage(previewDoc) ? (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", background: colors.bgInput, borderRadius: "10px", minHeight: 200, maxHeight: "60vh", overflow: "hidden" }}>
                <img src={docUrl(previewDoc)} alt={previewDoc.file_name} style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: "8px" }} />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 16px", background: colors.bgInput, borderRadius: "10px", border: `1px solid ${colors.border}` }}>
                <FileText size={48} color={colors.textMuted} style={{ marginBottom: 12 }} />
                <div style={{ fontSize: "14px", color: colors.textSecondary, marginBottom: 4 }}>No preview available</div>
                <div style={{ fontSize: "12px", color: colors.textMuted }}>Click download to view the file</div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
              <button onClick={() => { handleDeleteDocument(previewDoc.id); setPreviewDoc(null); }} style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: "#fef2f2", color: "#ef4444", fontWeight: 600, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Trash2 size={14} /> Delete
              </button>
              <a href={docUrl(previewDoc)} download={previewDoc.file_name} style={{ textDecoration: "none" }}>
                <button style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: colors.accent, color: "#fff", fontWeight: 600, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <Download size={14} /> Download
                </button>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TIMELINE
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "Timeline" && (
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: "15px", color: colors.text }}>{t("tl_title")}</div>
            <span style={{ fontSize: "12px", color: colors.textMuted }}>{timeline.length} {t("tl_events")}</span>
          </div>

          {timeline.length === 0 ? (
            <div style={s.emptyState}>
              <Activity size={32} style={{ opacity: 0.2, marginBottom: 10 }} />
              <div>{t("tl_no_events")}</div>
            </div>
          ) : (
            <div style={{ position: "relative", paddingLeft: 32 }}>
              {/* Vertical line */}
              <div style={{ position: "absolute", left: 10, top: 8, bottom: 8, width: 2, background: colors.border, borderRadius: 2 }} />

              {timeline.map((ev, i) => {
                const color = TIMELINE_COLORS[ev.event_type] ?? colors.textSecondary;
                const icon = TIMELINE_ICONS[ev.event_type] ?? <Activity size={13} />;
                const eventLabel =
                  ev.event_type === "Visit Completed" ? t("status_completed") :
                  ev.event_type === "Appointment" ? t("cal_title") :
                  ev.event_type === "Treatment" ? t("prof_tab_treatments") :
                  ev.event_type === "Payment" ? t("prof_tab_payments") :
                  ev.event_type === "Note" ? t("prof_quick_note") :
                  ev.event_type;
                return (
                  <div key={ev.id} style={{ position: "relative", marginBottom: i < timeline.length - 1 ? 20 : 0 }}>
                    {/* Dot */}
                    <div style={{ position: "absolute", left: -28, top: 2, width: 20, height: 20, borderRadius: "50%", background: color + "22", border: `2px solid ${color}`, color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {icon}
                    </div>
                    {/* Content */}
                    <div style={{ background: colors.bgInput, borderRadius: "10px", padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div>
                          <span style={{ fontSize: "12px", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{eventLabel}</span>
                          <div style={{ fontSize: "14px", color: colors.text, marginTop: 3 }}>{ev.description}</div>
                        </div>
                        <span style={{ fontSize: "11px", color: colors.textMuted, flexShrink: 0, marginTop: 2 }}>
                          {moment(ev.created_at).format("MMM D, YYYY")}
                        </span>
                      </div>
                      <div style={{ fontSize: "11px", color: colors.textMuted, marginTop: 5 }}>
                        {moment(ev.created_at).fromNow()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: EDIT PATIENT
      ══════════════════════════════════════════════════════════════════════ */}
      {showEditModal && (
        <div style={s.modalOverlay} onClick={() => setShowEditModal(false)}>
          <div style={{ ...s.modalBox, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>{t("prof_edit")}</h2>
              <button onClick={() => setShowEditModal(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {[["first_name",t("form_first_name")],["last_name",t("form_last_name")],["phone_number",t("form_phone")],["email",t("form_email")],["occupation",t("form_occupation")],["emergency_contact_name",t("form_emergency_contact")],["emergency_contact_phone",t("form_emergency_phone")]].map(([key, label]) => (
                <div key={key} style={s.field}>
                  <label style={s.label}>{label}</label>
                  <input style={{ ...s.input, ...(editErrors[key] ? { borderColor: '#ef4444' } : {}) }} value={(editForm as any)[key] ?? ""} onChange={e => { setEditForm(p => ({ ...p, [key]: e.target.value })); setEditErrors(p => { const n = { ...p }; delete n[key]; return n; }); }} type="text" />
                  {editErrors[key] && <span style={{ color: '#ef4444', fontSize: '12px', marginTop: '2px', display: 'block' }}>{editErrors[key]}</span>}
                </div>
              ))}
              <div style={s.field}>
                <label style={s.label}>{t("form_dob")}</label>
                <DobField value={(editForm as any).date_of_birth ?? ""} onChange={val => setEditForm(p => ({ ...p, date_of_birth: val }))} />
              </div>
              <div style={s.field}>
                <label style={s.label}>{t("form_gender")}</label>
                <GenderToggle value={(editForm as any).gender ?? ""} onChange={val => setEditForm(p => ({ ...p, gender: val }))} />
              </div>
            </div>
            {[["address",t("form_address")],["allergies",t("form_allergies")],["current_medications",t("form_medications")],["medical_history",t("form_medical_history")],["notes",t("form_notes")]].map(([key, label]) => (
              <div key={key} style={s.field}>
                <label style={s.label}>{label}</label>
                <textarea style={s.textarea} value={(editForm as any)[key] ?? ""} onChange={e => setEditForm(p => ({ ...p, [key]: e.target.value }))} />
              </div>
            ))}
            <div style={s.modalActions}>
              <button style={s.secondaryBtn} onClick={() => setShowEditModal(false)}>{t("cancel")}</button>
              <button style={s.addBtn} onClick={saveEdit} disabled={savingEdit}>{savingEdit ? t("saving") : t("save_changes")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: SCHEDULE SESSION
      ══════════════════════════════════════════════════════════════════════ */}
      {showScheduleModal && schedulingSession && (
        <div style={s.modalOverlay} onClick={() => setShowScheduleModal(false)}>
          <div style={{ ...s.modalBox, maxWidth: 1000 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>{t("sch_title")}: "{schedulingSession.label || `Session ${schedulingSession.session_number}`}"</h2>
              <button onClick={() => setShowScheduleModal(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            {scheduleError && <div style={s.errorBanner}>{scheduleError}</div>}
            {/* Smart detection: how many sessions of this treatment still
                need a booking -- helps spot bulk-scheduling candidates. */}
            {remainingUnscheduled().length > 0 && (
              <div style={{ ...s.warnBanner, marginTop: -8, background: "var(--bg-input)", color: "var(--text-secondary)", border: "1px dashed var(--border)" }}>
                <Info size={14} /> {remainingUnscheduled().length} {t("sch_left_sessions")}
              </div>
            )}
            <div style={s.field}>
              <label style={s.label}>{t("sch_quick_pick")}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SCHEDULE_PRESETS.map(p => (
                  <button key={p.label} type="button" onClick={() => applyPreset(p.daysFromNow)} style={{ padding: "5px 12px", borderRadius: "999px", border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text, fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                    {t(SCHEDULE_PRESET_KEY[p.label] as any)}
                  </button>
                ))}
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("cal_date_time")}</label>
              <DateTimePicker mode="datetime" value={scheduleDatetime} onChange={setScheduleDatetime} onDateChange={handleScheduleDateChange} label="" required />
              <DayOverviewPanel
                date={scheduleDatetime ? scheduleDatetime.slice(0, 10) : ""}
                durationMinutes={scheduleDuration}
                excludeAppointmentId={schedulingSession ? findAppointmentForSession(schedulingSession.id)?.id : undefined}
                onPickTime={(time) => {
                  const dateStr = scheduleDatetime ? scheduleDatetime.slice(0, 10) : moment().format("YYYY-MM-DD");
                  setScheduleDatetime(`${dateStr}T${time}`);
                }}
              />
              {collisionCheck && scheduleCollision && (
                <div style={{ ...s.warnBanner, marginTop: 8, marginBottom: 0 }}>
                  <AlertTriangle size={14} /> {t("sch_collision_warn")}
                </div>
              )}
            </div>
            <div style={s.field}>
              <DurationPicker
                value={scheduleDuration}
                onChange={setScheduleDuration}
                label={t("sch_duration")}
                min={5}
                max={180}
              />
            </div>
            {remainingUnscheduled().filter(s => s.session_number > schedulingSession.session_number).length > 0 && (
              <div style={{ border: "1px dashed #cbd5e1", borderRadius: 8, padding: 12, marginBottom: 14, background: colors.bgInput }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "13px", fontWeight: 600, color: colors.text, cursor: "pointer" }}>
                  <input type="checkbox" checked={bulkMode} onChange={e => setBulkMode(e.target.checked)} />
                  <Repeat size={14} /> {t("sch_bulk")}
                </label>
                {bulkMode && (
                  <div style={{ marginTop: 10 }}>
                    <label style={s.label}>{t("sch_cadence")}</label>
                    <select style={s.input} value={bulkInterval} onChange={e => setBulkInterval(e.target.value as any)}>
                      {BULK_INTERVALS.map(i => <option key={i.value} value={i.value}>{t(BULK_INTERVAL_KEY[i.label] as any)}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
            <div style={s.modalActions}>
              <button style={s.secondaryBtn} onClick={() => setShowScheduleModal(false)}>{t("cancel")}</button>
              <button style={s.addBtn} onClick={confirmSchedule} disabled={schedulingSlot}>
                {schedulingSlot ? t("sch_scheduling") : bulkMode ? t("sch_schedule_all") : t("sch_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: COMPLETE SESSION
      ══════════════════════════════════════════════════════════════════════ */}
      {showCompleteModal && completingSession && (
        <div style={s.modalOverlay} onClick={() => setShowCompleteModal(false)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>
                {completingSession.status === "Completed" ? t("cmp_edit") : t("cmp_complete")}: "{completingSession.label || `Session ${completingSession.session_number}`}"
              </h2>
              <button onClick={() => setShowCompleteModal(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            {completeError && <div style={s.errorBanner}>{completeError}</div>}
            <div style={s.field}>
              <label style={s.label}>{t("cmp_visit_date")}</label>
              <DateTimePicker mode="datetime" value={completeForm.visit_date} onChange={val => setCompleteForm({ ...completeForm, visit_date: val })} label="" />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("cmp_procedure_done")}</label>
              <input style={s.input} placeholder={t("cmp_procedure_placeholder")} value={completeForm.procedure_done} onChange={e => setCompleteForm({ ...completeForm, procedure_done: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("cmp_session_cost")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input style={{ ...s.input, flex: 1 }} type="text" inputMode="numeric" placeholder="0"
                  value={completeForm.cost ? String(completeForm.cost) : ""}
                  onChange={e => {
                    const digits = e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
                    setCompleteForm({ ...completeForm, cost: digits ? Number(digits) : 0 });
                  }} />
                <span style={{ fontSize: 13, color: colors.textSecondary, whiteSpace: "nowrap" }}>{currency.symbol}</span>
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("cmp_notes")}</label>
              <textarea style={s.textarea} placeholder={t("cmp_notes_placeholder")} value={completeForm.notes} onChange={e => setCompleteForm({ ...completeForm, notes: e.target.value })} />
            </div>
            <div style={s.modalActions}>
              <button style={s.secondaryBtn} onClick={() => setShowCompleteModal(false)}>{t("cancel")}</button>
              <button style={s.addBtn} onClick={confirmComplete} disabled={savingComplete}>{savingComplete ? t("saving") : t("save")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: NEW TREATMENT
      ══════════════════════════════════════════════════════════════════════ */}
      {showTreatmentModal && (
        <div style={s.modalOverlay} onClick={() => setShowTreatmentModal(false)}>
          <div style={{ ...s.modalBox, maxWidth: 1000 }} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: 700 }}>{editingTreatmentId ? t("trt_edit") : t("prof_new_treatment")}</h2>
              <button onClick={() => setShowTreatmentModal(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            </div>
            {treatmentError && <div style={s.errorBanner}>{treatmentError}</div>}
            <div style={s.field}>
              <label style={s.label}>{t("trt_select_tooth")}</label>
              <OdontogramSelector
                selectedTeeth={treatmentTeeth}
                onToggle={num => setTreatmentTeeth(prev => prev.includes(num) ? prev.filter(t => t !== num) : [...prev, num])}
                conditions={Object.fromEntries(Object.entries(toothRecords).map(([n, r]) => [Number(n), r.condition]))}
              />
              <input style={{ ...s.input, fontSize: "12px", color: colors.textSecondary, marginTop: 6 }} readOnly
                value={treatmentTeeth.length ? `${t("trt_tooth_selected")}${treatmentTeeth.join(", ")}` : t("trt_no_tooth")} />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_diagnosis")} *</label>
              <input style={s.input} placeholder={t("trt_diagnosis_placeholder")} value={treatmentForm.diagnosis} onChange={e => setTreatmentForm({ ...treatmentForm, diagnosis: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_procedure")} *</label>
              <input style={s.input} placeholder={t("trt_procedure_placeholder")} value={treatmentForm.procedure} onChange={e => setTreatmentForm({ ...treatmentForm, procedure: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_plan")}</label>
              <textarea style={s.textarea} placeholder={t("trt_plan_placeholder")} value={treatmentForm.treatment_plan} onChange={e => setTreatmentForm({ ...treatmentForm, treatment_plan: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_medication")}</label>
              <input style={s.input} placeholder={t("trt_medication_placeholder")} value={treatmentForm.prescribed_medication} onChange={e => setTreatmentForm({ ...treatmentForm, prescribed_medication: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_notes")}</label>
              <textarea style={s.textarea} placeholder={t("trt_notes_placeholder")} value={treatmentForm.treatment_notes} onChange={e => setTreatmentForm({ ...treatmentForm, treatment_notes: e.target.value })} />
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_sessions_required")}</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  {[1, 2, 3, 5].map(n => {
                  const active = treatmentForm.total_sessions_required === n;
                  return (
                    <button key={n} type="button" onClick={() => setSessionCount(n)}
                      style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
                        border: active ? `2px solid var(--accent)` : "1px solid var(--border)",
                        background: active ? "var(--accent-hover)" : "var(--bg-card)",
                        color: active ? "var(--accent)" : "var(--text-secondary)" }}>
                      {n} {n > 1 ? t("trt_sessions") : t("trt_session")}
                    </button>
                  );
                })}
              </div>
              <input style={s.input} type="number" min={1} max={20} value={treatmentForm.total_sessions_required} onChange={e => setSessionCount(Number(e.target.value))} />
              <p style={{ margin: "5px 0 0", fontSize: "11px", color: colors.textMuted }}>{t("trt_sessions_hint")}</p>
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_total_cost")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={costInput}
                  onChange={e => {
                    // Keep the field in sync with its own digits. Stripping
                    // the leading zero turns a "0200" mistype into "200".
                    const digits = e.target.value.replace(/[^\d]/g, "");
                    const cleaned = digits.replace(/^0+(?=\d)/, "");
                    setCostInput(cleaned);
                    setTreatmentForm({ ...treatmentForm, total_cost: cleaned ? Number(cleaned) : 0 });
                    costsTouched.current = false;
                    if (cleaned) setSessionCosts(evenSplit(Number(cleaned), treatmentForm.total_sessions_required ?? 1));
                  }}
                />
                <span style={{ fontSize: 13, color: colors.textSecondary, whiteSpace: "nowrap" }}>{currency.symbol}</span>
              </div>
            </div>
            <div style={s.field}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={s.label}>{t("trt_cost_per_session")}</label>
                <button type="button" onClick={splitEvenly} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--accent)", padding: 0 }}>{t("trt_split_evenly")}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                {Array.from({ length: Math.max(1, treatmentForm.total_sessions_required ?? 1) }).map((_, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                      {t("trt_session")} {i + 1}
                    </div>
                    <input style={s.input} type="text" inputMode="numeric" value={sessionCosts[i] ?? ""}
                      placeholder="0"
                      onChange={e => {
                        costsTouched.current = true;
                        const digits = e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
                        setSessionCosts(prev => { const next = [...prev]; next[i] = digits ? Number(digits) : 0; return next; });
                      }} />
                  </div>
                ))}
              </div>
            </div>
            <div style={s.field}>
              <label style={s.label}>{t("trt_status")}</label>
              <select style={s.input} value={treatmentForm.status} onChange={e => setTreatmentForm({ ...treatmentForm, status: e.target.value })}>
                <option value="Planned">{t("status_planned")}</option>
                <option value="Ongoing">{t("status_ongoing")}</option>
                <option value="Completed">{t("status_completed")}</option>
                <option value="Canceled">{t("status_canceled")}</option>
              </select>
            </div>
            <div style={s.modalActions}>
              <button style={s.secondaryBtn} onClick={() => setShowTreatmentModal(false)}>{t("cancel")}</button>
              <button style={s.addBtn} onClick={saveTreatment} disabled={savingTreatment}>{savingTreatment ? t("saving") : editingTreatmentId ? t("save_changes") : t("trt_create")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientProfile;