import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import { api } from "../services/api";
import type {
    Patient,
    Appointment,
    AppointmentStatusType,
    Treatment,
} from "../services/api";
import moment from "moment";

import {
    Calendar as BigCalendar,
    momentLocalizer
} from 'react-big-calendar';

import type { View } from 'react-big-calendar';
import { useLanguage } from "../components/Languagecontext";
import { useTheme } from "../components/ThemeContext";

import "react-big-calendar/lib/css/react-big-calendar.css";
import { useNavigate } from "react-router-dom";
import {
    CreditCard,
    User,
    Phone,
    AlertTriangle,
    Clock,
    Stethoscope,
    CheckCircle,
    XCircle,
    CalendarClock,
    ChevronRight,
    ClipboardList,
    Activity,
} from "lucide-react";

const localizer = momentLocalizer(moment);

type TodayAppointment = Appointment & {
    title: string;
    start: Date;
    end: Date;
    patient: Patient | undefined;
};

const STATUS_COLORS: Record<string, string> = {
    Scheduled: 'var(--accent)',
    'In Treatment': '#9333ea',
    Completed: 'var(--success)',
    Canceled: 'var(--danger)',
    'No-Show': 'var(--warning)',
};

const STATUS_BG: Record<string, string> = {
    Scheduled: 'var(--accent-hover)',
    'In Treatment': '#faf5ff',
    Completed: 'var(--success-bg)',
    Canceled: 'var(--danger-bg)',
    'No-Show': 'var(--warning-bg)',
};

const STATUS_KEY_MAP: Record<string, string> = {
    Scheduled: 'status_scheduled',
    'In Treatment': 'status_in_treatment',
    Completed: 'status_completed',
    Canceled: 'status_canceled',
    'No-Show': 'status_no_show',
};

const ALL_STATUSES: AppointmentStatusType[] = [
    'Scheduled', 'In Treatment', 'Completed', 'Canceled', 'No-Show'
];

const getInitials = (patient?: Patient) => {
    if (!patient) return '?';
    return `${patient.first_name[0] ?? ''}${patient.last_name[0] ?? ''}`.toUpperCase();
};

const Dashboard = () => {
    const { t } = useLanguage(); // ✅ Moved inside component
    const { colors } = useTheme();
    const navigate = useNavigate();

    const [, setPatients] = useState<Patient[]>([]);
    const [appointments, setAppointments] = useState<TodayAppointment[]>([]);
    const [allAppointments, setAllAppointments] = useState<TodayAppointment[]>([]);
    const [selectedAppointment, setSelectedAppointment] = useState<TodayAppointment | null>(null);
    const [calendarView, setCalendarView] = useState<View>("day");
    const [calendarDate, setCalendarDate] = useState<Date>(new Date());
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [displayOrder, setDisplayOrder] = useState<number[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [updating, setUpdating] = useState(false);
    const [statusFilter, setStatusFilter] = useState("All");
    const [treatmentMap, setTreatmentMap] = useState<Map<number, string>>(new Map());

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoadError(null);
        try {
            const today = moment().startOf('day').toDate();
            const nextWeek = moment().add(7, 'days').endOf('day').toDate();

            const [patientData, appointmentData] = await Promise.all([
                api.getPatients(0, 10000),
                api.getAppointmentsForRange(today, nextWeek),
            ]);
            setPatients(patientData);

            const patientIds = [...new Set(appointmentData.map(a => a.patient_id))];
            const treatmentPromises = patientIds.map(pid =>
                api.getPatientTreatments(pid).catch(() => [] as Treatment[])
            );
            const allTreatments = (await Promise.all(treatmentPromises)).flat();
            const tMap = new Map<number, string>();
            for (const t of allTreatments) {
                if (t.id && t.procedure) tMap.set(t.id, t.procedure);
            }
            setTreatmentMap(tMap);

            const formatted: TodayAppointment[] = appointmentData.map(a => {
                const patient = patientData.find(p => p.id === a.patient_id);
                return {
                    ...a,
                    title: patient ? `${patient.first_name} ${patient.last_name}` : t("unknown"),
                    start: new Date(a.appointment_datetime),
                    end: moment(a.appointment_datetime).add(a.duration_minutes, "minutes").toDate(),
                    patient,
                };
            });

            setAllAppointments(formatted);

            const todayStr = moment().format("YYYY-MM-DD");
            setAppointments(formatted.filter(
                a => moment(a.start).format("YYYY-MM-DD") === todayStr
            ));
            setDisplayOrder(null);

            setSelectedAppointment(prev => {
                if (!prev) return prev;
                return formatted.find(a => a.id === prev.id) || null;
            });
        } catch (err) {
            console.error("Failed to load dashboard data", err);
            setLoadError(err instanceof Error ? err.message : "Unknown error");
        }
    };

    const selectAppointment = (appointment: TodayAppointment) => {
        setSelectedAppointment(prev => prev?.id === appointment.id ? null : appointment);
    };

    const updateStatus = async (appointment: TodayAppointment, newStatus: AppointmentStatusType) => {
        setUpdating(true);
        try {
            await api.updateAppointment(appointment.id, {
                patient_id: appointment.patient_id,
                appointment_datetime: moment(appointment.start).format("YYYY-MM-DDTHH:mm:ss"),
                duration_minutes: appointment.duration_minutes,
                status: newStatus,
            });
            await loadData();
        } catch (err) {
            console.error("Failed to update appointment status", err);
        } finally {
            setUpdating(false);
        }
    };

    const completeAndGoToPayment = (appointment: TodayAppointment) => {
        // Only navigate with the prefill params -- the session is NOT marked
        // completed here. It gets completed when the payment is actually
        // saved (create_payment handles that), so closing/cancelling the
        // payment modal leaves everything untouched.
        const sessionId = appointment.session_id ?? null;
        navigate(
            `/financials?patient=${appointment.patient_id}` +
            (appointment.treatment_id ? `&treatment=${appointment.treatment_id}` : '') +
            (sessionId ? `&session=${sessionId}` : '') +
            `&date=${moment(appointment.start).format("YYYY-MM-DDTHH:mm:ss")}`
        );
    };

    const handleDragStart = (index: number) => setDragIndex(index);
    const handleDragOver = (e: DragEvent, index: number) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === index) return;
        setDisplayOrder(prev => {
            const current = prev ?? filteredAppointments.map(a => a.id);
            const updated = [...current];
            const [moved] = updated.splice(dragIndex, 1);
            updated.splice(index, 0, moved);
            return updated;
        });
        setDragIndex(index);
    };
    const handleDragEnd = () => setDragIndex(null);

    const filteredAppointments = appointments.filter(
        a => statusFilter === "All" || a.status === statusFilter
    );

    // Dragging only reshuffles the *displayed* list (an id-order overlay)
    // -- it is a cosmetic reorder that is not persisted. Operating on the
    // filtered array directly would otherwise splice wrong indexes into the
    // master list whenever a status filter is active.
    const displayedAppointments = (() => {
        if (displayOrder === null) return filteredAppointments;
        const byId = new Map(appointments.map(a => [a.id, a]));
        const ordered = displayOrder
            .map(id => byId.get(id))
            .filter((a): a is TodayAppointment => !!a);
        return ordered;
    })();

    const counts = {
        All: appointments.length,
        Scheduled: appointments.filter(a => a.status === 'Scheduled').length,
        'In Treatment': appointments.filter(a => a.status === 'In Treatment').length,
        Completed: appointments.filter(a => a.status === 'Completed').length,
        Canceled: appointments.filter(a => a.status === 'Canceled').length,
        'No-Show': appointments.filter(a => a.status === 'No-Show').length,
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "24px", minHeight: "100vh", background: colors.bgInput }}>

            {/* ── LOAD ERROR BANNER ── */}
            {loadError && (
                <div style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "12px 16px", borderRadius: "10px",
                    background: "#fef2f2", border: "1px solid #fecaca",
                    color: "#b91c1c", fontSize: "14px",
                }}>
                    <AlertTriangle size={18} />
                    <div style={{ flex: 1 }}>
                        {t("dash_load_error")}{loadError}
                    </div>
                    <button
                        onClick={() => loadData()}
                        style={{
                            padding: "6px 14px", borderRadius: "8px", border: "none",
                            background: "#b91c1c", color: "#fff", fontSize: "13px",
                            fontWeight: 600, cursor: "pointer",
                        }}
                    >
                        {t("dash_retry")}
                    </button>
                </div>
            )}

            {/* ── STAT PILLS ROW ── */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                {[
                    { label: t("dash_todays_patients"), value: appointments.length, color: colors.accent, bg: colors.accentHover, icon: <User size={16} /> },
                    { label: t("dash_in_progress"), value: counts['In Treatment'], color: "#9333ea", bg: "#faf5ff", icon: <Activity size={16} /> },
                    { label: t("dash_completed"), value: counts['Completed'], color: colors.success, bg: colors.successBg, icon: <CheckCircle size={16} /> },
                    { label: t("dash_remaining"), value: counts['Scheduled'], color: colors.warning, bg: colors.warningBg, icon: <Clock size={16} /> },
                ].map(stat => (
                    <div key={stat.label} style={{
                        flex: "1 1 140px",
                        background: colors.bgCard,
                        border: `1px solid ${colors.border}`,
                        borderRadius: "12px",
                        padding: "16px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                    }}>
                        <div style={{ width: 36, height: 36, borderRadius: "10px", background: stat.bg, color: stat.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {stat.icon}
                        </div>
                        <div>
                            <div style={{ fontSize: "22px", fontWeight: 700, color: colors.text, lineHeight: 1 }}>{stat.value}</div>
                            <div style={{ fontSize: "12px", color: colors.textSecondary, marginTop: "3px" }}>{stat.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── MAIN GRID ── */}
            <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "20px", alignItems: "start" }}>

                {/* ── LEFT: TODAY'S QUEUE ── */}
                <div style={{ background: colors.bgCard, borderRadius: "14px", border: `1px solid ${colors.border}`, overflow: "hidden" }}>

                    {/* Header */}
                    <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${colors.bgInput}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: colors.text }}>
                                {t("dash_todays_queue")}
                            </h3>
                            <span style={{ fontSize: "12px", color: colors.textSecondary, fontWeight: 500 }}>
                                {moment().format("ddd, MMM D")}
                            </span>
                        </div>

                        {/* Pill filters */}
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            {(["All", ...ALL_STATUSES] as string[]).map(s => {
                                const active = statusFilter === s;
                                const color = s === "All" ? colors.text : STATUS_COLORS[s];
                                const count = (counts as any)[s] ?? 0;
                                if (s !== "All" && count === 0) return null;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => {
                                            setStatusFilter(s);
                                            setDisplayOrder(null);
                                        }}
                                        style={{
                                            padding: "4px 10px",
                                            borderRadius: "999px",
                                            border: active ? `1.5px solid ${color}` : `1.5px solid ${colors.border}`,
                                            background: active ? (s === "All" ? colors.bgInput : STATUS_BG[s]) : "transparent",
                                            color: active ? color : colors.textSecondary,
                                            fontSize: "12px",
                                            fontWeight: active ? 700 : 500,
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "4px",
                                            transition: "all 0.12s ease",
                                        }}
                                    >
                                        {s === "All" ? t("patients_all") : t(STATUS_KEY_MAP[s] as any)}
                                        <span style={{
                                            background: active ? color : colors.border,
                                            color: active ? colors.accentText : colors.textSecondary,
                                            borderRadius: "999px",
                                            padding: "0 5px",
                                            fontSize: "10px",
                                            fontWeight: 700,
                                            minWidth: "16px",
                                            textAlign: "center",
                                        }}>
                                            {count}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Patient list */}
                    <div style={{ maxHeight: "520px", overflowY: "auto" }}>
                        {displayedAppointments.length === 0 ? (
                            <div style={{ padding: "40px 16px", textAlign: "center", color: colors.textMuted, fontSize: "14px" }}>
                                <CalendarClock size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                                <div>{t("dash_no_appointments")}</div>
                            </div>
                        ) : (
                            displayedAppointments.map((appointment, index) => {
                                const isSelected = selectedAppointment?.id === appointment.id;
                                const color = STATUS_COLORS[appointment.status] || STATUS_COLORS.Scheduled;
                                return (
                                    <div
                                        key={appointment.id}
                                        draggable
                                        onDragStart={() => handleDragStart(index)}
                                        onDragOver={(e) => handleDragOver(e, index)}
                                        onDragEnd={handleDragEnd}
                                        onClick={() => selectAppointment(appointment)}
                                        style={{
                                            padding: "12px 16px",
                                            borderBottom: `1px solid ${colors.bgInput}`,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "12px",
                                            cursor: "pointer",
                                            background: isSelected ? colors.accentHover : "transparent",
                                            borderLeft: isSelected ? `3px solid ${color}` : "3px solid transparent",
                                            transition: "background 0.1s ease",
                                            opacity: dragIndex === index ? 0.5 : 1,
                                            position: "relative",
                                        }}
                                    >
                                        <div style={{
                                            width: 36, height: 36, borderRadius: "50%",
                                            background: STATUS_BG[appointment.status] || colors.bgInput,
                                            color: color,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            fontSize: "12px", fontWeight: 700, flexShrink: 0,
                                        }}>
                                            {getInitials(appointment.patient)}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: "14px", color: colors.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {appointment.title}
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                                                <Clock size={11} color={colors.textMuted} />
                                                <span style={{ fontSize: "12px", color: colors.textSecondary }}>
                                                    {moment(appointment.start).format("HH:mm")} · {appointment.duration_minutes}{t("duration_min")}
                                                </span>
                                            </div>
                                            {(appointment.session_number || appointment.treatment_id) && (
                                                <div style={{ fontSize: "11px", color: colors.accent, marginTop: "2px", fontWeight: 500 }}>
                                                    {appointment.session_number && `${t("trt_tooth_selected")} ${appointment.session_number}`}
                                                    {appointment.session_number && treatmentMap.get(appointment.treatment_id ?? 0) && ' · '}
                                                    {treatmentMap.get(appointment.treatment_id ?? 0)}
                                                </div>
                                            )}
                                        </div>

                                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                                            <span style={{
                                                width: 8, height: 8, borderRadius: "50%",
                                                background: color, display: "inline-block",
                                            }} />
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ── RIGHT: CALENDAR + DETAIL PANEL ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

                    <div style={{ background: colors.bgCard, borderRadius: "14px", border: `1px solid ${colors.border}`, padding: "16px", overflow: "hidden" }}>
                        <BigCalendar
                            localizer={localizer}
                            events={allAppointments}
                            view={calendarView}
                            onView={setCalendarView}
                            date={calendarDate}
                            onNavigate={(newDate) => setCalendarDate(newDate)}
                            views={["day", "week"]}
                            step={30}
                            timeslots={2}
                            // Bound to the VIEWED date, not today -- otherwise
                            // appointments outside 07:00-20:00 on later days
                            // get clipped by today's window.
                            min={moment(calendarDate).set({ hour: 7, minute: 0, second: 0 }).toDate()}
                            max={moment(calendarDate).set({ hour: 20, minute: 0, second: 0 }).toDate()}
                            eventPropGetter={(event: any) => ({
                                style: {
                                    backgroundColor: STATUS_COLORS[event.status] || STATUS_COLORS.Scheduled,
                                    borderRadius: '6px',
                                    border: 'none',
                                    opacity: event.status === 'Canceled' ? 0.4 : 1,
                                    textDecoration: event.status === 'Canceled' ? 'line-through' : 'none',
                                    fontSize: '12px',
                                },
                            })}
                            onSelectEvent={(event: any) => selectAppointment(event)}
                            style={{ height: 380 }}
                        />
                    </div>

                    {selectedAppointment ? (
                        <div style={{
                            background: colors.bgCard,
                            borderRadius: "14px",
                            border: `1px solid ${colors.border}`,
                            overflow: "hidden",
                        }}>
                            <div style={{
                                height: 4,
                                background: STATUS_COLORS[selectedAppointment.status] || STATUS_COLORS.Scheduled,
                            }} />

                            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>

                                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                                    <div style={{
                                        width: 48, height: 48, borderRadius: "50%",
                                        background: STATUS_BG[selectedAppointment.status] || colors.bgInput,
                                        color: STATUS_COLORS[selectedAppointment.status] || colors.text,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        fontSize: "17px", fontWeight: 700, flexShrink: 0, border: `2px solid ${colors.border}`,
                                    }}>
                                        {getInitials(selectedAppointment.patient)}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: "17px", color: colors.text }}>
                                            {selectedAppointment.title}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                                            <span style={{
                                                fontSize: "11px", fontWeight: 700,
                                                padding: "2px 10px", borderRadius: "999px",
                                        background: STATUS_BG[selectedAppointment.status] || colors.bgInput,
                                        color: STATUS_COLORS[selectedAppointment.status] || colors.text,
                                                border: `1px solid ${STATUS_COLORS[selectedAppointment.status] || colors.border}`,
                                                letterSpacing: "0.03em",
                                            }}>
                                                {t(STATUS_KEY_MAP[selectedAppointment.status] as any)}
                                            </span>
                                            {selectedAppointment.treatment_id && treatmentMap.get(selectedAppointment.treatment_id) && (
                                                <span style={{
                                                    fontSize: "11px", fontWeight: 600,
                                                    padding: "2px 10px", borderRadius: "999px",
                                                    background: colors.accentHover, color: colors.accent,
                                                    border: `1px solid ${colors.border}`,
                                                }}>
                                                    {t("trt_tooth_selected")} {selectedAppointment.session_number} · {treatmentMap.get(selectedAppointment.treatment_id)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => navigate(`/patient/${selectedAppointment.patient_id}`)}
                                        style={{
                                            display: "flex", alignItems: "center", gap: "4px",
                                            background: "none", border: `1px solid ${colors.border}`, borderRadius: "8px",
                                            padding: "6px 12px", color: colors.textSecondary, fontSize: "13px",
                                            fontWeight: 600, cursor: "pointer",
                                        }}
                                    >
                                        {t("prof_back")} <ChevronRight size={14} />
                                    </button>
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                                    <InfoTile icon={<Clock size={14} />} label={t("time")} value={moment(selectedAppointment.start).format("HH:mm")} />
                                    <InfoTile icon={<ClipboardList size={14} />} label={t("duration")} value={`${selectedAppointment.duration_minutes} ${t("duration_min")}`} />
                                    {selectedAppointment.session_number ? (
                                        <InfoTile
                                            icon={<Activity size={14} />}
                                            label={t("trt_tooth_selected")}
                                            value={treatmentMap.get(selectedAppointment.treatment_id ?? 0)
                                                ? `${selectedAppointment.session_number} · ${treatmentMap.get(selectedAppointment.treatment_id ?? 0)}`
                                                : `${selectedAppointment.session_number}`}
                                        />
                                    ) : (
                                        <InfoTile
                                            icon={<Phone size={14} />}
                                            label={t("prof_phone")}
                                            value={selectedAppointment.patient?.phone_number || "—"}
                                        />
                                    )}
                                </div>

                                {(selectedAppointment.session_number || (selectedAppointment.treatment_id && treatmentMap.get(selectedAppointment.treatment_id))) && (
                                    <div style={{
                                        display: "flex", alignItems: "flex-start", gap: "8px",
                                        background: colors.accentHover, border: `1px solid ${colors.border}`,
                                        borderRadius: "8px", padding: "10px 12px",
                                    }}>
                                        <Stethoscope size={15} color={colors.accent} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <div>
                                            <div style={{ fontSize: "12px", fontWeight: 700, color: colors.text }}>{t("prof_tab_treatments")}</div>
                                            <div style={{ fontSize: "13px", color: colors.textSecondary, marginTop: "2px" }}>
                                                {selectedAppointment.session_number && `${t("trt_tooth_selected")} ${selectedAppointment.session_number}`}
                                                {selectedAppointment.session_number && treatmentMap.get(selectedAppointment.treatment_id ?? 0) && ' · '}
                                                {treatmentMap.get(selectedAppointment.treatment_id ?? 0)}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {selectedAppointment.patient?.allergies && (
                                    <div style={{
                                        display: "flex", alignItems: "flex-start", gap: "8px",
                                        background: colors.dangerBg, border: `1px solid ${colors.border}`,
                                        borderRadius: "8px", padding: "10px 12px",
                                    }}>
                                        <AlertTriangle size={15} color={colors.danger} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <div>
                                            <div style={{ fontSize: "12px", fontWeight: 700, color: colors.danger }}>{t("dash_allergy_alert")}</div>
                                            <div style={{ fontSize: "13px", color: colors.danger, marginTop: "2px" }}>{selectedAppointment.patient.allergies}</div>
                                        </div>
                                    </div>
                                )}

                                {selectedAppointment.reason && (
                                    <div style={{ background: colors.bgInput, borderRadius: "8px", padding: "10px 12px" }}>
                                        <div style={{ fontSize: "11px", fontWeight: 600, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>{t("dash_reason")}</div>
                                        <div style={{ fontSize: "14px", color: colors.text }}>{selectedAppointment.reason}</div>
                                    </div>
                                )}

                                <div>
                                    <div style={{ fontSize: "11px", fontWeight: 700, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                                        {t("dash_update_status")}
                                    </div>
                                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                        {ALL_STATUSES.map(s => {
                                            const active = selectedAppointment.status === s;
                                            const color = STATUS_COLORS[s];
                                            return (
                                                <button
                                                    key={s}
                                                    disabled={updating}
                                                    onClick={() => updateStatus(selectedAppointment, s)}
                                                    style={{
                                                        padding: "6px 12px",
                                                        borderRadius: "999px",
                                                        border: active ? `1.5px solid ${color}` : `1.5px solid ${colors.border}`,
                                                        background: active ? STATUS_BG[s] : "transparent",
                                                        color: active ? color : colors.textSecondary,
                                                        fontSize: "12px",
                                                        fontWeight: active ? 700 : 500,
                                                        cursor: updating ? "not-allowed" : "pointer",
                                                        opacity: updating ? 0.6 : 1,
                                                        transition: "all 0.12s ease",
                                                    }}
                                                >
                                                    {t(STATUS_KEY_MAP[s] as any)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div style={{ display: "flex", gap: "8px", paddingTop: "4px", borderTop: `1px solid ${colors.bgInput}` }}>
                                    <button
                                        disabled={updating}
                                        onClick={() => completeAndGoToPayment(selectedAppointment)}
                                        style={{
                                            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                                            gap: "7px", padding: "10px", borderRadius: "9px",
                                            border: "none", background: colors.accent, color: colors.accentText,
                                            fontSize: "13px", fontWeight: 600, cursor: updating ? "not-allowed" : "pointer",
                                            opacity: updating ? 0.7 : 1,
                                        }}
                                    >
                                        <CreditCard size={15} /> {t("dash_complete_payment")}
                                    </button>
                                    <button
                                        onClick={() => navigate(`/patient/${selectedAppointment.patient_id}`)}
                                        style={{
                                            display: "flex", alignItems: "center", gap: "6px",
                                            padding: "10px 14px", borderRadius: "9px",
                                            border: `1px solid ${colors.border}`, background: colors.bgInput,
                                            color: colors.textSecondary, fontSize: "13px", fontWeight: 600, cursor: "pointer",
                                        }}
                                    >
                                        <Stethoscope size={15} /> {t("dash_full_profile")}
                                    </button>
                                    <button
                                        onClick={() => updateStatus(selectedAppointment, "Canceled")}
                                        disabled={updating}
                                        title={t("dash_cancel_appointment")}
                                        style={{
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            width: 40, height: 40, borderRadius: "9px",
                                            border: `1px solid ${colors.border}`, background: colors.dangerBg,
                                            color: colors.danger, cursor: "pointer", flexShrink: 0,
                                        }}
                                    >
                                        <XCircle size={16} />
                                    </button>
                                </div>

                            </div>
                        </div>
                    ) : (
                        <div style={{
                            background: colors.bgCard, borderRadius: "14px", border: `1px dashed ${colors.border}`,
                            padding: "32px", textAlign: "center", color: colors.textMuted,
                        }}>
                            <User size={28} style={{ opacity: 0.25, marginBottom: 8 }} />
                            <div style={{ fontSize: "14px" }}>{t("dash_select_patient")}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const InfoTile = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => {
    const { colors } = useTheme();
    return (
    <div style={{ background: colors.bgInput, borderRadius: "8px", padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 600, color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "5px" }}>
            {icon} {label}
        </div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: colors.text }}>{value}</div>
    </div>
    );
};

export default Dashboard;