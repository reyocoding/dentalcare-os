import { useEffect, useState, useCallback } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDebounce } from 'use-debounce';
import { Virtuoso } from 'react-virtuoso';
import { api } from '../services/api';
import { OdontogramSelector } from "../components/OdontogramSelector";
import { DateTimePicker } from '../components/DateTimePicker';
import DayOverviewPanel from '../components/DayOverviewPanel';
import DurationPicker from '../components/DurationPicker';
import { GenderToggle, DobField } from '../components/PatientFields';
import { TOOTH_PATHS } from "../pages/teethPaths";
import { useLanguage } from "../components/Languagecontext";
import { useTheme } from "../components/ThemeContext";
import type { Patient, PatientCreate } from '../services/api';
import {
  Search,
  UserPlus,
  Phone,
  Mail,
  MapPin,
  Shield,
  Heart,
  ChevronRight,
  ChevronLeft,
  Check,
  Calendar,
  Clock,
  X,
  Pencil,
  Trash2,
} from 'lucide-react';

const PAGE_SIZE = 25;
type TabType = 'all' | 'recent';

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

const Patients = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { colors } = useTheme();

  // --- Pagination & Search ---
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 400);
  const [loading, setLoading] = useState(true);

  // --- Tabs & Filters ---
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [genderFilter, setGenderFilter] = useState('All');
  const [ageFilter, setAgeFilter] = useState('All');

  // --- Add Wizard ---
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 4;
  const [formData, setFormData] = useState<PatientCreate>({
    first_name: '',
    last_name: '',
    gender: '',
    phone_number: '',
    email: '',
    address: '',
    date_of_birth: '',
    occupation: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    allergies: '',
    current_medications: '',
    medical_history: '',
    notes: '',
    profile_photo: '',
  });
  const [toothConditions, setToothConditions] = useState<Record<number, string>>({});
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [appointmentData, setAppointmentData] = useState({
    date: '',
    time: '',
    duration: 30,
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // --- Edit Patient ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [editForm, setEditForm] = useState<PatientCreate>({
    first_name: '',
    last_name: '',
    gender: '',
    phone_number: '',
    email: '',
    address: '',
    date_of_birth: '',
    occupation: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    allergies: '',
    current_medications: '',
    medical_history: '',
    notes: '',
    profile_photo: '',
  });
  const [editingSubmitting, setEditingSubmitting] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // --- Data Loading ---
  // Gender/age filters are applied server-side so pagination totals and the
  // visible page always agree (previously "3 of 120").
  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const [data, count] = await Promise.all([
        api.getPatients(
          page * PAGE_SIZE,
          PAGE_SIZE,
          debouncedSearch || undefined,
          activeTab === 'recent' ? 'created_desc' : undefined,
          genderFilter !== 'All' ? genderFilter : undefined,
          ageFilter !== 'All' ? ageFilter : undefined
        ),
        api.getPatientsCount(
          debouncedSearch || undefined,
          genderFilter !== 'All' ? genderFilter : undefined,
          ageFilter !== 'All' ? ageFilter : undefined
        ),
      ]);
      setPatients(data);
      setTotal(count);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, activeTab, genderFilter, ageFilter]);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  // The "Recent" tab must count/filter patients from *all* pages, not just
  // the current page. Fetch the full list (newest first) once per load.
  const [recentPatients, setRecentPatients] = useState<Patient[]>([]);
  useEffect(() => {
    if (activeTab !== 'recent' || debouncedSearch) return;
    let cancelled = false;
    api.getPatients(0, 10000, undefined, 'created_desc')
      .then((data) => { if (!cancelled) setRecentPatients(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab, debouncedSearch, total]);

  // --- Handlers ---
  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleAppointmentChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setAppointmentData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
    setEditErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const resetAddForm = () => {
    setFormData({
      first_name: '',
      last_name: '',
      gender: '',
      phone_number: '',
      email: '',
      address: '',
      date_of_birth: '',
      occupation: '',
      emergency_contact_name: '',
      emergency_contact_phone: '',
      allergies: '',
      current_medications: '',
      medical_history: '',
      notes: '',
      profile_photo: '',
    });
    setToothConditions({});
    setSelectedTooth(null);
    setAppointmentData({ date: '', time: '', duration: 30, reason: '' });
    setFormErrors({});
    setCurrentStep(0);
  };

  // Auto-slot: picking a date computes that day's first free slot for the
  // selected duration and prefills the time field (still editable).
  const handleAppointmentDateChange = async (dateStr: string) => {
    setAppointmentData(prev => ({ ...prev, date: dateStr }));
    try {
      const slot = await api.getNextAvailableSlot(dateStr, appointmentData.duration);
      setAppointmentData(prev => ({ ...prev, date: dateStr, time: slot ? slot.slice(11, 16) : '' }));
    } catch {
      setAppointmentData(prev => ({ ...prev, date: dateStr }));
    }
  };

  const handleSubmit = async (e?: FormEvent, skipAppointment = false) => {
    e?.preventDefault();
    const errors = validateForm(formData as unknown as Record<string, string | undefined>, t);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setCurrentStep(0);
      return;
    }

    // "Save & Schedule" with a date but no time would otherwise silently
    // drop the appointment -- ask for the missing time instead.
    if (!skipAppointment && appointmentData.date && !appointmentData.time) {
      alert(t('patient_fail_missing_time'));
      return;
    }

    setSubmitting(true);
    let patientId: number | null = null;
    try {
      const newPatient = await api.createPatient(formData);
      patientId = newPatient.id;

      const toothEntries = Object.entries(toothConditions);
      if (toothEntries.length > 0) {
        await Promise.all(
          toothEntries.map(([toothNum, condition]) =>
            api.createToothRecord({
              patient_id: newPatient.id,
              tooth_number: parseInt(toothNum),
              condition,
              notes: '',
            })
          )
        );
      }

      if (!skipAppointment && appointmentData.date && appointmentData.time) {
        const datetime = `${appointmentData.date}T${appointmentData.time}:00`;
        await api.createAppointment({
          patient_id: newPatient.id,
          appointment_datetime: datetime,
          duration_minutes: appointmentData.duration,
          reason: appointmentData.reason || t('apt_reason_placeholder'),
          status: 'Scheduled',
        });
      }

      resetAddForm();
      setIsAddModalOpen(false);
      loadPatients();
    } catch (error) {
      console.error('Error creating patient:', error);
      // The patient may already exist (tooth records / appointment failed
      // after creation). Claiming "Failed to create patient" would tempt the
      // user to retry and duplicate the patient.
      alert(patientId ? t('patient_fail_partial') : t('patient_fail_create'));
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (patient: Patient) => {
    setEditingPatient(patient);
    setEditForm({
      first_name: patient.first_name,
      last_name: patient.last_name,
      gender: patient.gender || '',
      phone_number: patient.phone_number || '',
      email: patient.email || '',
      address: patient.address || '',
      date_of_birth: patient.date_of_birth || '',
      occupation: patient.occupation || '',
      emergency_contact_name: patient.emergency_contact_name || '',
      emergency_contact_phone: patient.emergency_contact_phone || '',
      allergies: patient.allergies || '',
      current_medications: patient.current_medications || '',
      medical_history: patient.medical_history || '',
      notes: patient.notes || '',
      profile_photo: patient.profile_photo || '',
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingPatient) return;
    const errors = validateForm(editForm as unknown as Record<string, string | undefined>, t);
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }
    setEditingSubmitting(true);
    try {
      await api.updatePatient(editingPatient.id, editForm);
      setIsEditModalOpen(false);
      setEditingPatient(null);
      loadPatients();
    } catch (error) {
      console.error('Error updating patient:', error);
      alert(t('patient_fail_update'));
    } finally {
      setEditingSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t('patient_delete_confirm'))) return;
    try {
      await api.deletePatient(id);
      // Deleting the last row on the last page would leave a dead empty
      // page -- step back one page first.
      if (patients.length === 1 && page > 0) {
        setPage(page - 1);
      } else {
        loadPatients();
      }
    } catch (error) {
      console.error('Error deleting patient:', error);
      alert(t('patient_fail_delete'));
    }
  };

  const canGoNext = () => {
    if (currentStep === 0) {
      // Same rules as the server (and the final submit): names must be at
      // least 2 chars. The wizard must not let a doomed form through.
      return !validateField('first_name', formData.first_name, t)
        && !validateField('last_name', formData.last_name, t);
    }
    return true;
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <>
            <h4 className="section-title">{t('form_personal_contact')}</h4>
            <div className="form-row">
              <div className="form-group">
                <label>{t('form_first_name')} *</label>
                <input
                  type="text"
                  name="first_name"
                  required
                  value={formData.first_name}
                  onChange={handleInputChange}
                  className="input-field"
                  style={formErrors.first_name ? { borderColor: colors.danger } : undefined}
                />
                {formErrors.first_name && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{formErrors.first_name}</span>}
              </div>
              <div className="form-group">
                <label>{t('form_last_name')} *</label>
                <input
                  type="text"
                  name="last_name"
                  required
                  value={formData.last_name}
                  onChange={handleInputChange}
                  className="input-field"
                  style={formErrors.last_name ? { borderColor: colors.danger } : undefined}
                />
                {formErrors.last_name && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{formErrors.last_name}</span>}
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('form_gender')}</label>
                <GenderToggle
                  value={formData.gender || ''}
                  onChange={(val) => {
                    setFormData((prev) => ({ ...prev, gender: val }));
                    setFormErrors((prev) => {
                      const next = { ...prev };
                      delete next.gender;
                      return next;
                    });
                  }}
                />
              </div>
              <div className="form-group">
                <label>{t('form_dob')}</label>
                <DobField
                  value={formData.date_of_birth || ''}
                  onChange={(val) => {
                    setFormData((prev) => ({ ...prev, date_of_birth: val }));
                    setFormErrors((prev) => {
                      const next = { ...prev };
                      delete next.date_of_birth;
                      return next;
                    });
                  }}
                />
              </div>
            </div>
            <div className="form-group">
              <label><Phone size={14} className="label-icon" /> {t('form_phone')}</label>
              <input
                type="text"
                name="phone_number"
                value={formData.phone_number}
                onChange={handleInputChange}
                className="input-field"
                style={formErrors.phone_number ? { borderColor: colors.danger } : undefined}
              />
              {formErrors.phone_number && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{formErrors.phone_number}</span>}
            </div>
            <div className="form-group">
              <label><Mail size={14} className="label-icon" /> {t('form_email')}</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="input-field"
                style={formErrors.email ? { borderColor: colors.danger } : undefined}
              />
              {formErrors.email && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{formErrors.email}</span>}
            </div>
            <div className="form-group">
              <label><MapPin size={14} className="label-icon" /> {t('form_address')}</label>
              <textarea
                name="address"
                rows={2}
                value={formData.address}
                onChange={handleInputChange}
                className="input-field"
              />
            </div>
            <div className="form-group">
              <label>{t('form_occupation')}</label>
              <input
                type="text"
                name="occupation"
                value={formData.occupation}
                onChange={handleInputChange}
                className="input-field"
              />
            </div>
          </>
        );

      case 1:
        return (
          <>
            <h4 className="section-title">{t('form_medical_emergency')}</h4>
            <div className="form-group">
              <label><Heart size={14} className="label-icon" /> {t('form_allergies')}</label>
              <textarea
                name="allergies"
                rows={2}
                value={formData.allergies}
                onChange={handleInputChange}
                placeholder={t('form_allergies_placeholder')}
                className="input-field"
              />
            </div>
            <div className="form-group">
              <label>{t('form_medications')}</label>
              <textarea
                name="current_medications"
                rows={2}
                value={formData.current_medications}
                onChange={handleInputChange}
                className="input-field"
              />
            </div>
            <div className="form-group">
              <label>{t('form_medical_history')}</label>
              <textarea
                name="medical_history"
                rows={3}
                value={formData.medical_history}
                onChange={handleInputChange}
                className="input-field"
              />
            </div>
            <hr style={{ margin: '16px 0' }} />
            <h4 style={{ marginBottom: '12px' }}>{t('form_emergency_section')}</h4>
            <div className="form-row">
              <div className="form-group">
                <label><Shield size={14} className="label-icon" /> {t('form_emergency_contact')}</label>
                <input
                  type="text"
                  name="emergency_contact_name"
                  value={formData.emergency_contact_name}
                  onChange={handleInputChange}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>{t('form_emergency_phone')}</label>
                <input
                  type="text"
                  name="emergency_contact_phone"
                  value={formData.emergency_contact_phone}
                  onChange={handleInputChange}
                  className="input-field"
                  style={formErrors.emergency_contact_phone ? { borderColor: colors.danger } : undefined}
                />
                {formErrors.emergency_contact_phone && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{formErrors.emergency_contact_phone}</span>}
              </div>
            </div>
            <div className="form-group">
              <label>{t('form_notes')}</label>
              <textarea
                name="notes"
                rows={2}
                value={formData.notes}
                onChange={handleInputChange}
                className="input-field"
              />
            </div>
          </>
        );

      case 2:
        return (
          <>
            <h4 className="section-title">{t('odon_step_title')}</h4>
            <p style={{ color: colors.textSecondary, fontSize: '0.9rem', marginBottom: '16px' }}>
              {t('odon_step_hint')}
            </p>

            <OdontogramSelector
              selectedTooth={selectedTooth ?? undefined}
              onSelect={setSelectedTooth}
              conditions={toothConditions}
            />

            {selectedTooth !== null && (
              <div style={{ padding: '16px', background: colors.bgInput, borderRadius: '8px', border: `1px solid ${colors.border}`, marginTop: '12px' }}>
                {(() => {
                  const fdi = TOOTH_PATHS.find(t => t.toothNumber === selectedTooth)?.fdiNumber;
                  return (
                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                      {t('odon_condition_for')} #{fdi} (Universal #{selectedTooth})
                    </label>
                  );
                })()}
                <select
                  value={toothConditions[selectedTooth] || 'Healthy'}
                  onChange={(e) => {
                    setToothConditions((prev) => ({
                      ...prev,
                      [selectedTooth]: e.target.value,
                    }));
                  }}
                  className="input-field"
                >
                  <option value="Healthy">✅ {t('condition_healthy')}</option>
                  <option value="Caries">🦷 {t('condition_caries')}</option>
                  <option value="Filling">🔄 {t('condition_filling')}</option>
                  <option value="Crown">👑 {t('condition_crown')}</option>
                  <option value="Root Canal">⚕️ {t('condition_root_canal')}</option>
                  <option value="Implant">🔩 {t('condition_implant')}</option>
                  <option value="Missing">❌ {t('condition_missing')}</option>
                  <option value="Extracted">🦷 {t('condition_extracted')}</option>
                  <option value="Other">📌 {t('condition_other')}</option>
                </select>
                <button
                  type="button"
                  onClick={() => setSelectedTooth(null)}
                  style={{ marginTop: '8px', background: 'none', border: 'none', color: colors.textSecondary, cursor: 'pointer', fontSize: '13px' }}
                >
                  ✕ {t('close')}
                </button>
              </div>
            )}

            {Object.keys(toothConditions).length > 0 && (
              <div style={{ marginTop: '12px', padding: '12px', background: colors.accentHover, borderRadius: '8px', fontSize: '13px', color: colors.text }}>
                <strong>{Object.keys(toothConditions).length}</strong> {t('odon_marked')}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t('odon_clear_confirm'))) {
                      setToothConditions({});
                      setSelectedTooth(null);
                    }
                  }}
                  style={{ marginLeft: '12px', background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', fontWeight: 600 }}
                >
                  {t('odon_clear_all')}
                </button>
              </div>
            )}
          </>
        );

      case 3:
        return (
          <>
            <h4 className="section-title">{t('apt_step_title')}</h4>
            <p style={{ color: colors.textSecondary, fontSize: '0.9rem', marginBottom: '16px' }}>
              {t('apt_step_hint')}
            </p>
            <div className="form-row">
              <div className="form-group">
                <label><Calendar size={14} className="label-icon" /> {t('date')}</label>
                <DateTimePicker
                  mode="date"
                  value={appointmentData.date}
                  onChange={(val) => setAppointmentData(prev => ({ ...prev, date: val }))}
                  onDateChange={handleAppointmentDateChange}
                  label={t('date')}
                />
              </div>
              <div className="form-group">
                <label><Clock size={14} className="label-icon" /> {t('time')}</label>
                <DateTimePicker
                  mode="time"
                  value={appointmentData.time}
                  onChange={(val) => setAppointmentData(prev => ({ ...prev, time: val }))}
                  label={t('time')}
                />
              </div>
            </div>
            <DayOverviewPanel
              date={appointmentData.date}
              durationMinutes={appointmentData.duration}
              onPickTime={(time) => setAppointmentData(prev => ({ ...prev, time }))}
            />
            <div className="form-row">
              <div className="form-group">
                <label>{t('apt_duration_minutes')}</label>
                <DurationPicker
                  value={appointmentData.duration}
                  onChange={(duration) => setAppointmentData(prev => ({ ...prev, duration }))}
                />
              </div>
              <div className="form-group">
                <label>{t('apt_reason')}</label>
                <input
                  type="text"
                  name="reason"
                  value={appointmentData.reason}
                  onChange={handleAppointmentChange}
                  placeholder={t('apt_reason_placeholder')}
                  className="input-field"
                />
              </div>
            </div>
            <div style={{ marginTop: '12px', color: colors.textSecondary, fontSize: '0.85rem' }}>
              {t('apt_step_tip')}
            </div>
          </>
        );

      default:
        return null;
    }
  };

  // --- Client-side filters on current page ---
  // On the "Recent" tab use the full (all-pages) recent list so filtering is
  // not limited to the 25 rows of the current page.
  const sourcePatients = activeTab === 'recent' ? recentPatients : patients;
  const filteredPatients = sourcePatients.filter((patient) => {
    if (activeTab === 'recent') {
      const created = new Date(patient.created_at);
      const diffDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 7) return false;
    }
    if (genderFilter !== 'All' && patient.gender !== genderFilter) return false;
    if (ageFilter !== 'All') {
      if (!patient.date_of_birth) return false;
      const age = Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
      let matches = false;
      if (ageFilter === '0-12') matches = age >= 0 && age <= 12;
      else if (ageFilter === '13-18') matches = age >= 13 && age <= 18;
      else if (ageFilter === '19-40') matches = age >= 19 && age <= 40;
      else if (ageFilter === '40+') matches = age >= 40;
      if (!matches) return false;
    }
    return true;
  });

  const allCount = total;
  const recentCount = recentPatients.filter(p => {
    const created = new Date(p.created_at);
    const diffDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= 7;
  }).length;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="patients-container" style={{ padding: '24px' }}>
      {/* --- Action Bar --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} style={{ position: 'absolute', left: 10, top: 10, color: colors.textMuted }} />
          <input
            type="text"
            placeholder={t('patients_search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // Searching while on page 3 would otherwise render
              // "page 4 of 1" with an empty table.
              setPage(0);
            }}
            style={{ width: '100%', padding: '10px 10px 10px 36px', borderRadius: '8px', border: `1px solid ${colors.border}`, fontSize: '14px', background: colors.bgInput, color: colors.text }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={genderFilter}
            onChange={(e) => { setGenderFilter(e.target.value); setPage(0); }}
            style={{ padding: '10px', borderRadius: '8px', border: `1px solid ${colors.border}`, fontSize: '14px', background: colors.bgCard, color: colors.text }}
          >
            <option value="All">{t('patients_all_genders')}</option>
            <option value="Male">{t('patients_male')}</option>
            <option value="Female">{t('patients_female')}</option>
          </select>
          <select
            value={ageFilter}
            onChange={(e) => { setAgeFilter(e.target.value); setPage(0); }}
            style={{ padding: '10px', borderRadius: '8px', border: `1px solid ${colors.border}`, fontSize: '14px', background: colors.bgCard, color: colors.text }}
          >
            <option value="All">{t('patients_all_ages')}</option>
            <option value="0-12">{t('patients_child')}</option>
            <option value="13-18">{t('patients_teen')}</option>
            <option value="19-40">{t('patients_adult')}</option>
            <option value="40+">{t('patients_senior')}</option>
          </select>
          <button
            onClick={() => setIsAddModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: colors.accent, color: colors.accentText, border: 'none', borderRadius: '8px', padding: '10px 16px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
          >
            <UserPlus size={18} /> {t('patients_add')}
          </button>
        </div>
      </div>

      {/* --- Tabs --- */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: `2px solid ${colors.border}`, marginBottom: '20px' }}>
        <button
          onClick={() => { setActiveTab('all'); setPage(0); }}
          style={{
            padding: '10px 20px',
            borderRadius: '8px 8px 0 0',
            marginBottom: '-2px',
            border: 'none',
            borderBottom: activeTab === 'all' ? `2px solid ${colors.accent}` : '2px solid transparent',
            background: activeTab === 'all' ? colors.accentHover : 'transparent',
            color: activeTab === 'all' ? colors.accent : colors.textSecondary,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          {t('patients_all')} ({allCount})
        </button>
        <button
          onClick={() => { setActiveTab('recent'); setPage(0); }}
          style={{
            padding: '10px 20px',
            borderRadius: '8px 8px 0 0',
            marginBottom: '-2px',
            border: 'none',
            borderBottom: activeTab === 'recent' ? `2px solid ${colors.accent}` : '2px solid transparent',
            background: activeTab === 'recent' ? colors.accentHover : 'transparent',
            color: activeTab === 'recent' ? colors.accent : colors.textSecondary,
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          {t('patients_recent')} ({recentCount})
        </button>
      </div>

      {/* --- Stats --- */}
      <div style={{ marginBottom: '12px', fontSize: '14px', color: colors.textSecondary }}>
        {loading ? t('loading') : `${t('patients_showing')} ${filteredPatients.length} ${t('patients_of')} ${total}`}
      </div>

      {/* --- Virtualised Table --- */}
      <div style={{ background: colors.bgCard, borderRadius: '12px', border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 2fr 1.5fr 1fr',
          background: colors.bgInput,
          padding: '12px 16px',
          fontWeight: 600,
          color: colors.textSecondary,
          borderBottom: `1px solid ${colors.border}`,
          fontSize: '14px',
        }}>
          <span>{t('patients_col_name')}</span>
          <span>{t('patients_col_phone')}</span>
          <span>{t('patients_col_age')}</span>
          <span>{t('patients_col_medical')}</span>
          <span>{t('patients_col_registered')}</span>
          <span>{t('patients_col_actions')}</span>
        </div>

        {loading && patients.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: colors.textMuted }}>{t('loading')}</div>
        ) : filteredPatients.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: colors.textMuted }}>{t('patients_no_found')}</div>
        ) : (
          <Virtuoso
            style={{ height: '500px' }}
            data={filteredPatients}
            itemContent={(_, patient) => {
              const age = patient.date_of_birth
                ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
                : null;
              return (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 2fr 1.5fr 1fr',
                  padding: '12px 16px',
                  borderBottom: `1px solid ${colors.bgInput}`,
                  alignItems: 'center',
                  fontSize: '14px',
                  color: colors.text,
                }}>
                  <span
                    style={{ color: colors.accent, fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => navigate(`/patient/${patient.id}`)}
                    title={t('view_patient_profile')}
                  >
                    {patient.first_name} {patient.last_name}
                  </span>
                  <span>{patient.phone_number || '—'}</span>
                  <span>{age !== null ? `${age} ${t('patients_yrs')}` : '—'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={patient.medical_history || ''}>
                    {patient.medical_history || t('patients_no_conditions')}
                  </span>
                  <span>{new Date(patient.created_at).toLocaleDateString()}</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => openEditModal(patient)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textSecondary, padding: '4px' }}
                      title={t('edit')}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(patient.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.danger, padding: '4px' }}
                      title={t('delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>

      {/* --- Pagination --- */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '20px', alignItems: 'center' }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: `1px solid ${colors.border}`,
              background: page === 0 ? colors.bgInput : colors.bgCard,
              cursor: page === 0 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: '14px', color: colors.textSecondary, fontWeight: 500 }}>
            {t('page')} {page + 1} {t('patients_of')} {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: `1px solid ${colors.border}`,
              background: page >= totalPages - 1 ? colors.bgInput : colors.bgCard,
              cursor: page >= totalPages - 1 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* --- Add Patient Modal (Wizard) --- */}
      {isAddModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '1000px' }}>
            <div className="modal-header">
              <h3>{t('patients_register_new')}</h3>
              <button className="close-btn" onClick={() => { resetAddForm(); setIsAddModalOpen(false); }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={(e) => handleSubmit(e, false)}>
              <div style={{ padding: '0 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}>
                  {Array.from({ length: totalSteps }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: '32px',
                        height: '4px',
                        borderRadius: '2px',
                        background: i === currentStep ? colors.accent : i < currentStep ? colors.success : colors.border,
                        transition: 'background 0.3s',
                      }}
                    />
                  ))}
                </div>

                <div style={{ textAlign: 'center', marginBottom: '16px', fontSize: '13px', color: colors.textMuted }}>
                  {t('patients_step')} {currentStep + 1} {t('patients_of_steps')} {totalSteps}
                </div>

                <div style={{ minHeight: '300px' }}>{renderStep()}</div>

                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '24px',
                  paddingTop: '16px',
                  borderTop: `1px solid ${colors.border}`,
                }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
                    className="btn"
                    style={{
                      background: currentStep === 0 ? colors.bgInput : colors.accent,
                      color: currentStep === 0 ? colors.textMuted : colors.accentText,
                      cursor: currentStep === 0 ? 'default' : 'pointer',
                    }}
                    disabled={currentStep === 0}
                  >
                    <ChevronLeft size={16} /> {t('back')}
                  </button>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    {currentStep === totalSteps - 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSubmit(undefined, true)}
                          className="btn btn-secondary"
                          disabled={submitting}
                        >
                          {t('apt_skip_finish')}
                        </button>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          disabled={submitting}
                          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Check size={16} />
                          {submitting ? t('saving') : t('apt_save_schedule')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCurrentStep((prev) => Math.min(totalSteps - 1, prev + 1))}
                        className="btn"
                        style={{
                          background: canGoNext() ? colors.accent : colors.border,
                          color: colors.accentText,
                          cursor: canGoNext() ? 'pointer' : 'default',
                        }}
                        disabled={!canGoNext()}
                      >
                        {t('next')} <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Edit Patient Modal --- */}
      {isEditModalOpen && editingPatient && (
        <div className="modal-overlay" onClick={() => setIsEditModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h3>{t('edit_patient')}</h3>
              <button className="close-btn" onClick={() => setIsEditModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="modal-body" style={{ padding: '0 24px 24px' }}>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('form_first_name')} *</label>
                  <input
                    type="text"
                    name="first_name"
                    value={editForm.first_name}
                    onChange={handleEditInputChange}
                    className="input-field"
                    required
                    style={editErrors.first_name ? { borderColor: colors.danger } : undefined}
                  />
                  {editErrors.first_name && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{editErrors.first_name}</span>}
                </div>
                <div className="form-group">
                  <label>{t('form_last_name')} *</label>
                  <input
                    type="text"
                    name="last_name"
                    value={editForm.last_name}
                    onChange={handleEditInputChange}
                    className="input-field"
                    required
                    style={editErrors.last_name ? { borderColor: colors.danger } : undefined}
                  />
                  {editErrors.last_name && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{editErrors.last_name}</span>}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('form_gender')}</label>
                  <GenderToggle
                    value={editForm.gender || ''}
                    onChange={(val) => setEditForm((prev) => ({ ...prev, gender: val }))}
                  />
                </div>
                <div className="form-group">
                  <label>{t('form_dob')}</label>
                  <DobField
                    value={editForm.date_of_birth || ''}
                    onChange={(val) => setEditForm((prev) => ({ ...prev, date_of_birth: val }))}
                  />
                </div>
              </div>
              <div className="form-group">
                <label><Phone size={14} /> {t('form_phone')}</label>
                <input
                  type="text"
                  name="phone_number"
                  value={editForm.phone_number}
                  onChange={handleEditInputChange}
                  className="input-field"
                  style={editErrors.phone_number ? { borderColor: colors.danger } : undefined}
                />
                {editErrors.phone_number && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{editErrors.phone_number}</span>}
              </div>
              <div className="form-group">
                <label><Mail size={14} /> {t('form_email')}</label>
                <input
                  type="email"
                  name="email"
                  value={editForm.email}
                  onChange={handleEditInputChange}
                  className="input-field"
                  style={editErrors.email ? { borderColor: colors.danger } : undefined}
                />
                {editErrors.email && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{editErrors.email}</span>}
              </div>
              <div className="form-group">
                <label><MapPin size={14} /> {t('form_address')}</label>
                <textarea
                  name="address"
                  rows={2}
                  value={editForm.address}
                  onChange={handleEditInputChange}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>{t('form_occupation')}</label>
                <input
                  type="text"
                  name="occupation"
                  value={editForm.occupation}
                  onChange={handleEditInputChange}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>{t('form_allergies')}</label>
                <textarea
                  name="allergies"
                  rows={2}
                  value={editForm.allergies}
                  onChange={handleEditInputChange}
                  className="input-field"
                  placeholder={t('form_allergies_placeholder')}
                />
              </div>
              <div className="form-group">
                <label>{t('form_medications')}</label>
                <textarea
                  name="current_medications"
                  rows={2}
                  value={editForm.current_medications}
                  onChange={handleEditInputChange}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>{t('form_medical_history')}</label>
                <textarea
                  name="medical_history"
                  rows={3}
                  value={editForm.medical_history}
                  onChange={handleEditInputChange}
                  className="input-field"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('form_emergency_contact')}</label>
                  <input
                    type="text"
                    name="emergency_contact_name"
                    value={editForm.emergency_contact_name}
                    onChange={handleEditInputChange}
                    className="input-field"
                  />
                </div>
                <div className="form-group">
                  <label>{t('form_emergency_phone')}</label>
                  <input
                    type="text"
                    name="emergency_contact_phone"
                    value={editForm.emergency_contact_phone}
                    onChange={handleEditInputChange}
                    className="input-field"
                    style={editErrors.emergency_contact_phone ? { borderColor: colors.danger } : undefined}
                  />
                  {editErrors.emergency_contact_phone && <span style={{ color: colors.danger, fontSize: '12px', marginTop: '4px', display: 'block' }}>{editErrors.emergency_contact_phone}</span>}
                </div>
              </div>
              <div className="form-group">
                <label>{t('form_notes')}</label>
                <textarea
                  name="notes"
                  rows={2}
                  value={editForm.notes}
                  onChange={handleEditInputChange}
                  className="input-field"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '16px', borderTop: `1px solid ${colors.border}` }}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsEditModalOpen(false)}>
                  {t('cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={editingSubmitting}>
                  {editingSubmitting ? t('saving') : t('save_changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Patients;