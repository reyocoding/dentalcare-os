import { useEffect, useState } from 'react';
import {
    Calendar as BigCalendar,
    momentLocalizer,
    type View
} from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { X, Info, User, Calendar } from 'lucide-react';
import { api } from '../services/api';
import { DateTimePicker } from '../components/DateTimePicker';
import DayOverviewPanel from '../components/DayOverviewPanel';
import DurationPicker from '../components/DurationPicker';

import { useLanguage } from '../components/Languagecontext'; // <-- adjust path to your hook
import { useTheme } from "../components/ThemeContext";
import type { Patient, AppointmentStatusType, Treatment, TreatmentSession } from '../services/api';

const localizer = momentLocalizer(moment);

const STATUS_COLORS: Record<string, string> = {
  Scheduled: 'var(--accent)',
  'In Treatment': '#9333ea',
  Completed: '#16a34a',
  Canceled: '#ef4444',
  'No-Show': '#f59e0b',
};

// Maps API status values to your translation keys
const STATUS_KEY_MAP: Record<string, string> = {
  Scheduled: 'status_scheduled',
  'In Treatment': 'status_in_treatment',
  Completed: 'status_completed',
  Canceled: 'status_canceled',
  'No-Show': 'status_no_show',
};

const CalendarPage = () => {
  const { t } = useLanguage();
  const { colors } = useTheme();

  const [events, setEvents] = useState<any[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  // Form state
  const [patientId, setPatientId] = useState<string>('');
  const [appointmentTime, setAppointmentTime] = useState<string>('');
  const [duration, setDuration] = useState<number>(30);
  const [recurrence, setRecurrence] = useState<string>('none');
  const [status, setStatus] = useState<AppointmentStatusType>('Scheduled');

  // Treatment / session linking
  const [patientTreatments, setPatientTreatments] = useState<Treatment[]>([]);
  const [linkedTreatmentId, setLinkedTreatmentId] = useState<string>('');
  const [availableSessions, setAvailableSessions] = useState<TreatmentSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [linkedSessionLabel, setLinkedSessionLabel] = useState<string>('');

  const [calendarView, setCalendarView] = useState<View>('month');
  const [calendarDate, setCalendarDate] = useState<Date>(new Date());

  // Derived state: Get the 7 most recently added patients (assuming higher ID = newer)
  const recentPatients = [...patients].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 7);

  useEffect(() => {
    if (!patientId) {
      setPatientTreatments([]);
      setLinkedTreatmentId('');
      return;
    }
    api.getPatientTreatments(Number(patientId))
      .then((treatments) => {
        const active = treatments.filter(
          (t) => t.status === 'Planned' || t.status === 'Ongoing'
        );
        setPatientTreatments(active);
      })
      .catch((err) => console.error('Failed to load patient treatments', err));
  }, [patientId]);

  useEffect(() => {
    if (selectedEvent) return; 
    if (!linkedTreatmentId) {
      setAvailableSessions([]);
      setSelectedSessionId('');
      return;
    }
    api.getTreatmentSessions(Number(linkedTreatmentId))
      .then((sessions) => {
        const unscheduled = sessions
          .filter((s) => s.status === 'Unscheduled')
          .sort((a, b) => a.session_number - b.session_number);
        setAvailableSessions(unscheduled);
        setSelectedSessionId(unscheduled.length > 0 ? String(unscheduled[0].id) : '');
      })
      .catch((err) => console.error('Failed to load treatment sessions', err));
  }, [linkedTreatmentId]);

  const loadAppointments = async () => {
    try {
      const data = await api.getAllAppointments();
      const formattedEvents = data.map((apt) => {
        const patient = patients.find((p) => p.id === apt.patient_id);
        return {
          id: apt.id,
          title: patient
            ? `${patient.first_name} ${patient.last_name}${apt.session_number ? ` (Session ${apt.session_number})` : ''}`
            : `Patient ${apt.patient_id}`,
          start: new Date(apt.appointment_datetime),
          end: moment(apt.appointment_datetime)
            .add(apt.duration_minutes, 'minutes')
            .toDate(),
          patient_id: apt.patient_id,
          status: apt.status,
          treatment_id: apt.treatment_id,
          session_id: apt.session_id,
          session_number: apt.session_number,
          duration_minutes: apt.duration_minutes,
        };
      });
      setEvents(formattedEvents);
    } catch (error) {
      console.error('Failed to load appointments', error);
    }
  };

  const loadPatients = async () => {
    try {
      const data = await api.getPatients(0, 10000);
      setPatients(data);
    } catch (error) {
      console.error('Failed to load patients', error);
    }
  };

  // Re-map appointment titles once the patient list arrives (or changes).
  useEffect(() => {
    if (patients.length > 0) {
      loadAppointments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients]);

  useEffect(() => {
    loadPatients();
    // Load appointments regardless of whether the patient fetch succeeds --
    // a failed patient fetch must not leave the calendar permanently empty.
    // The [patients] effect above re-maps titles once patients arrive.
    loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetFormState = () => {
    setSelectedEvent(null);
    setPatientId('');
    setDuration(30);
    setRecurrence('none');
    setStatus('Scheduled');
    setLinkedTreatmentId('');
    setAvailableSessions([]);
    setSelectedSessionId('');
    setLinkedSessionLabel('');
  };

  const handleSelectSlot = async (slotInfo: any) => {
    resetFormState();
    const clicked = moment(slotInfo.start);
    // Honour the clicked time whenever it is free (P19): the previous
    // behaviour always jumped to the first free slot of the day and
    // ignored the selected duration.
    const clickedEnd = moment(clicked).add(duration, 'minutes');
    const clashes = events.some((ev) => {
      const s = moment(ev.start);
      const e = moment(ev.end);
      return clicked.isBefore(e) && clickedEnd.isAfter(s);
    });
    if (!clashes) {
      setAppointmentTime(clicked.format("YYYY-MM-DDTHH:mm"));
      setIsModalOpen(true);
      return;
    }
    try {
      const nextSlot = await api.getNextAvailableSlot(clicked.format("YYYY-MM-DD"), duration);
      setAppointmentTime(nextSlot
        ? moment(nextSlot).format("YYYY-MM-DDTHH:mm")
        : clicked.format("YYYY-MM-DDTHH:mm"));
    } catch (e) {
      setAppointmentTime(clicked.format("YYYY-MM-DDTHH:mm"));
    }
    setIsModalOpen(true);
  };

  // Auto-slot: the moment a NEW date is picked (day view or the calendar
  // popover), compute that day's free times for the selected duration and
  // prefill the first one into the time field. Re-picking the same date
  // must not move an already-chosen time.
  const handleDateChange = async (dateStr: string) => {
    const currentDate = appointmentTime ? moment(appointmentTime).format('YYYY-MM-DD') : '';
    if (currentDate === dateStr) return;
    try {
      const slot = await api.getNextAvailableSlot(dateStr, duration);
      setAppointmentTime(slot
        ? moment(slot).format('YYYY-MM-DDTHH:mm')
        : `${dateStr}T09:00`);
    } catch {
      setAppointmentTime(`${dateStr}T09:00`);
    }
  };

  const handleSelectEvent = async (event: any) => {
    setSelectedEvent(event);
    setPatientId(event.patient_id.toString());
    setAppointmentTime(moment(event.start).format('YYYY-MM-DDTHH:mm'));
    setDuration(event.duration_minutes || 30);
    setStatus(event.status || 'Scheduled');
    setLinkedTreatmentId(event.treatment_id ? String(event.treatment_id) : '');
    setSelectedSessionId(event.session_id ? String(event.session_id) : '');
    setAvailableSessions([]);

    if (event.treatment_id) {
      try {
        const [treatments, sessions] = await Promise.all([
          api.getPatientTreatments(event.patient_id),
          api.getTreatmentSessions(event.treatment_id),
        ]);
        const treatment = treatments.find((t) => t.id === event.treatment_id);
        const session = sessions.find((s) => s.id === event.session_id);
        setLinkedSessionLabel(
          `${treatment?.procedure || 'Treatment'} — ${session?.label || `Session ${event.session_number || ''}`}`
        );
      } catch {
        setLinkedSessionLabel(`Session ${event.session_number || ''}`);
      }
    } else {
      setLinkedSessionLabel('');
    }
    setIsModalOpen(true);
  };

  const handleCreateAppointment = async () => {
    if (!patientId || !appointmentTime) {
      alert('Please select a patient and a date/time.');
      return;
    }

    const localDate = moment(appointmentTime).format('YYYY-MM-DDTHH:mm:ss');
    const patientIdNum = parseInt(patientId);
    const sessionId = !selectedEvent && selectedSessionId ? parseInt(selectedSessionId) : undefined;

    try {
      if (selectedEvent) {
        await api.updateAppointment(selectedEvent.id, {
          patient_id: patientIdNum,
          appointment_datetime: localDate,
          duration_minutes: duration,
          status: status,
        });
      } else {
        const baseAppointment = {
          patient_id: patientIdNum,
          duration_minutes: duration,
          status: 'Scheduled' as AppointmentStatusType,
          session_id: sessionId,
        };

        if (recurrence === 'none') {
          // Session-linked bookings should carry the treatment context in
          // reason, otherwise the calendar event is a bare stub.
          const linked = linkedTreatmentId
            ? patientTreatments.find((t) => t.id === Number(linkedTreatmentId))
            : undefined;
          const reason = sessionId
            ? `${linked?.procedure || 'Treatment'} — ${availableSessions.find((s) => s.id === sessionId)?.label || `Session ${selectedSessionId}`}`
            : undefined;
          await api.createAppointment({
            ...baseAppointment,
            appointment_datetime: localDate,
            reason,
          });
        } else {
          let interval: moment.unitOfTime.DurationConstructor = 'days';
          let count = 0;
          if (recurrence === 'daily') {
            interval = 'days';
            count = 30;
          } else if (recurrence === 'weekly') {
            interval = 'weeks';
            count = 8;
          } else if (recurrence === 'monthly') {
            interval = 'months';
            count = 6;
          }

          for (let i = 0; i < count; i++) {
            const date = moment(localDate).add(i, interval).format('YYYY-MM-DDTHH:mm:ss');
            try {
              await api.createAppointment({
                ...baseAppointment,
                session_id: undefined,
                appointment_datetime: date,
              });
            } catch (err) {
              console.error(`Failed to create occurrence ${i + 1}`, err);
              alert(`Stopped after ${i} of ${count} occurrences — a conflicting slot was hit.`);
              break;
            }
          }
        }
      }
      setIsModalOpen(false);
      loadAppointments();
    } catch (err) {
      console.error(err);
      alert('Failed to save appointment. That slot may already be booked.');
    }
  };

  const handleDeleteAppointment = async (id: number) => {
    if (!id) return;
    const confirmDelete = window.confirm('Are you sure you want to delete this appointment?');
    if (!confirmDelete) return;
    try {
      await api.deleteAppointment(id);
      setIsModalOpen(false);
      loadAppointments();
    } catch (error) {
      console.error('Failed to delete appointment', error);
    }
  };

  const eventStyleGetter = (event: any) => {
    const color = STATUS_COLORS[event.status] || STATUS_COLORS.Scheduled;
    return {
      style: {
        backgroundColor: color,
        borderRadius: '6px',
        border: 'none',
        opacity: event.status === 'Canceled' ? 0.5 : 1,
        textDecoration: event.status === 'Canceled' ? 'line-through' : 'none',
      },
    };
  };

  return (
    <div className="page-card">
      <h2>{t("cal_title")}</h2>

      <div style={{ display: 'flex', gap: '16px', margin: '10px 0 4px', flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLORS).map(([label, color]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: colors.textSecondary }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, display: 'inline-block' }} />
            {t(STATUS_KEY_MAP[label] as any)}
          </div>
        ))}
      </div>

      <BigCalendar
        localizer={localizer}
        events={events}
        selectable
        view={calendarView}
        onView={(view: View) => setCalendarView(view)}
        date={calendarDate}
        onNavigate={(newDate) => setCalendarDate(newDate)}
        views={['day', 'week', 'month', 'agenda']}
        onSelectSlot={handleSelectSlot}
        onSelectEvent={handleSelectEvent}
        eventPropGetter={eventStyleGetter}
        step={30}
        timeslots={2}
        min={moment().set({ hour: 7, minute: 0, second: 0 }).toDate()}
        max={moment().set({ hour: 20, minute: 0, second: 0 }).toDate()}
        style={{ height: '650px', marginTop: '20px' }}
      />

      {isModalOpen && (
        <div className="modal-overlay" style={{ backgroundColor: 'rgba(0,0,0,0.4)', position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ background: colors.bgCard, borderRadius: '12px', width: '100%', maxWidth: '1000px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', overflow: 'hidden' }}>
            
            <div className="modal-header" style={{ padding: '20px 24px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.bgInput }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: colors.text }}>
                <Calendar size={20} className="text-blue-600" />
                {selectedEvent ? t("cal_manage_apt") : t("cal_new_apt")}
              </h3>
              <button className="close-btn" onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSecondary }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '24px', maxHeight: '75vh', overflowY: 'auto' }}>

              {/* --- PATIENT SELECTION WITH RECENT CHIPS --- */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontWeight: 600, color: colors.text }}>
                  <User size={16} /> {t("cal_select_patient")}
                </label>
                
                {!selectedEvent && recentPatients.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <span style={{ fontSize: '12px', color: colors.textMuted, display: 'flex', alignItems: 'center', marginRight: '4px' }}>{t("cal_recent")}</span>
                    {recentPatients.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPatientId(String(p.id))}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '16px',
                          fontSize: '12px',
                          fontWeight: patientId === String(p.id) ? 600 : 400,
                          border: patientId === String(p.id) ? `1px solid var(--accent-color, ${colors.accent})` : `1px solid ${colors.border}`,
                          backgroundColor: patientId === String(p.id) ? colors.accentHover : colors.bgInput,
                          color: patientId === String(p.id) ? colors.accent : colors.textSecondary,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        {p.first_name} {p.last_name}
                      </button>
                    ))}
                  </div>
                )}

                <select
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  disabled={!!selectedEvent}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}
                >
                  <option value="">{t("cal_search_all")}</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* --- DATE & TIME --- */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontWeight: 600, color: colors.text }}>
                  <Calendar size={16} /> {t("cal_date_time")}
                </label>
                <DateTimePicker
                    mode="datetime"
                    value={appointmentTime}
                    onChange={(val) => setAppointmentTime(val)}
                    onDateChange={handleDateChange}
                    label=""
                    required
                />
                <DayOverviewPanel
                  date={appointmentTime ? appointmentTime.slice(0, 10) : ''}
                  durationMinutes={duration}
                  excludeAppointmentId={selectedEvent?.id}
                  onPickTime={(time) => {
                    const dateStr = appointmentTime ? appointmentTime.slice(0, 10) : moment().format('YYYY-MM-DD');
                    setAppointmentTime(`${dateStr}T${time}`);
                  }}
                />
              </div>

              {/* --- UI UPGRADE: DURATION PRESETS --- */}
              <div style={{ marginBottom: '24px' }}>
                <DurationPicker
                  value={duration}
                  onChange={setDuration}
                  label={t("cal_duration")}
                />
              </div>

              <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '24px 0' }} />

              {/* Treatment Links and Existing Logic Below */}
              {selectedEvent && linkedSessionLabel && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                    background: colors.accentHover,
                    color: colors.accent,
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    marginBottom: '20px',
                  }}
                >
                  <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '2px' }}>{t("cal_linked_treatment")}</strong>
                    {linkedSessionLabel}
                  </div>
                </div>
              )}

              {!selectedEvent && patientId && recurrence === 'none' && (
                <div style={{ padding: '16px', backgroundColor: colors.bgInput, borderRadius: '8px', marginBottom: '20px', border: `1px solid ${colors.border}` }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>
                    {t("cal_link_treatment")}
                  </label>
                  <select
                    value={linkedTreatmentId}
                    onChange={(e) => setLinkedTreatmentId(e.target.value)}
                    style={{ width: '100%', padding: '10px', marginBottom: linkedTreatmentId ? '12px' : '0', borderRadius: '6px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}
                  >
                    <option value="">{t("cal_not_linked")}</option>
                    {patientTreatments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.procedure || 'Treatment'} ({t.sessions_completed}/{t.total_sessions_required} done)
                      </option>
                    ))}
                  </select>

                  {linkedTreatmentId && (
                    availableSessions.length > 0 ? (
                      <>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '14px' }}>
                          {t("cal_which_session")}
                        </label>
                        <select
                          value={selectedSessionId}
                          onChange={(e) => setSelectedSessionId(e.target.value)}
                          style={{ width: '100%', padding: '10px', borderRadius: '6px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}
                        >
                          {availableSessions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label || `Session ${s.session_number}`}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <p style={{ fontSize: '13px', color: colors.danger, margin: 0 }}>
                        {t("cal_no_sessions")}
                      </p>
                    )
                  )}
                </div>
              )}

              {!selectedEvent && recurrence !== 'none' && (
                <p style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '16px', padding: '10px', backgroundColor: colors.bgInput, borderRadius: '6px' }}>
                  {t("cal_recurring_warning")}
                </p>
              )}

              {!selectedEvent && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: colors.text }}>{t("cal_repeat")}</label>
                  <select
                    value={recurrence}
                    onChange={(e) => {
                      setRecurrence(e.target.value);
                      if (e.target.value !== 'none') {
                        setLinkedTreatmentId('');
                        setSelectedSessionId('');
                      }
                    }}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}
                  >
                    <option value="none">{t("cal_one_time")}</option>
                    <option value="daily">{t("cal_daily")}</option>
                    <option value="weekly">{t("cal_weekly")}</option>
                    <option value="monthly">{t("cal_monthly")}</option>
                  </select>
                </div>
              )}

              {selectedEvent && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: colors.text }}>{t("cal_status")}</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as AppointmentStatusType)}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: `1px solid ${colors.border}`, background: colors.bgInput, color: colors.text }}
                  >
                    <option value="Scheduled">{t("status_scheduled")}</option>
                    <option value="In Treatment">{t("status_in_treatment")}</option>
                    <option value="Completed">{t("status_completed")}</option>
                    <option value="Canceled">{t("status_canceled")}</option>
                    <option value="No-Show">{t("status_no_show")}</option>
                  </select>
                  {linkedSessionLabel && status === 'Completed' && (
                    <p style={{ fontSize: '12px', color: colors.success, marginTop: '6px', marginBottom: 0 }}>
                      {t("cal_will_complete")}
                    </p>
                  )}
                  {linkedSessionLabel && status === 'Canceled' && (
                    <p style={{ fontSize: '12px', color: colors.danger, marginTop: '6px', marginBottom: 0 }}>
                      {t("cal_will_free")}
                    </p>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '32px' }}>
                <button
                  className="submit-btn"
                  onClick={handleCreateAppointment}
                  style={{ flex: 2, padding: '12px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--accent-color, #2563eb)', color: 'white', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s' }}
                >
                  {selectedEvent ? t("cal_update") : t("cal_save")}
                </button>
                {selectedEvent && (
                  <button
                    onClick={() => handleDeleteAppointment(selectedEvent.id)}
                    style={{ flex: 1, padding: '12px', backgroundColor: colors.dangerBg, color: colors.danger, border: `1px solid ${colors.border}`, borderRadius: '8px', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
                  >
                    {t("delete")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarPage;