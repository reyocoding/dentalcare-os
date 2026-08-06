import axios, { type InternalAxiosRequestConfig } from 'axios';

// Dev default; for production builds set VITE_API_URL (see frontend/.env.example).
// Recommended production value: "/api" served by the Netlify proxy so the
// refresh cookie stays same-site.
export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://127.0.0.1:8000';

type RetryableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Refresh tokens travel in an HttpOnly SameSite cookie -- the browser
  // sends it automatically on same-site requests, so credentials must be
  // included for /auth/refresh to work.
  withCredentials: true,
});

// =====================================================
// AUTH TOKEN HANDLING
// Kept in memory only (per project requirement) -- survives navigation
// but not a full page reload. The AuthContext is the single owner; it
// calls setApiToken() to attach/detach the JWT from every request.
// Session persistence across reloads comes from the HttpOnly refresh
// cookie: on 401 we silently call /auth/refresh and retry once.
// =====================================================

let authToken: string | null = null;

export const setApiToken = (token: string | null) => {
  authToken = token;
};

let unauthorizedHandler: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  unauthorizedHandler = handler;
};

let refreshPromise: Promise<string | null> | null = null;

/** Exchange the HttpOnly refresh cookie for a new access token.
 *  Returns the token, or null when the refresh failed. Concurrent 401s
 *  share a single refresh call. */
const tryRefresh = async (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post<AuthTokenResponse>('/auth/refresh')
      .then((res) => {
        authToken = res.data.access_token;
        return authToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

apiClient.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    const status = response?.status;
    const req = config as RetryableConfig | undefined;

    // Refresh only once per request; never retry the refresh call itself.
    if (
      status === 401 &&
      req &&
      !req._retried &&
      !req.url?.startsWith('/auth/refresh')
    ) {
      req._retried = true;
      const newToken = await tryRefresh();
      if (newToken) {
        req.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(req);
      }
    }

    if (status === 401 && unauthorizedHandler) {
      unauthorizedHandler();
    }
    return Promise.reject(error);
  }
);

/** One-time session restore: called on app mount. Returns true when a
 *  refresh cookie exists and a session was silently restored. */
export const restoreSession = async (): Promise<boolean> => {
  const token = await tryRefresh();
  return token !== null;
};

/** Format a Date as naive local wall-clock time (YYYY-MM-DDTHH:mm:ss).
 *  The backend stores and compares naive local datetimes, so this is the
 *  only correct serialization -- toISOString() shifts to UTC. */
export const toLocalNaiveISO = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// =====================================================
// TYPESCRIPT INTERFACES
// =====================================================

export interface Patient {
  id: number;
  first_name: string;
  last_name: string;
  gender?: string;
  phone_number?: string;
  email?: string;
  address?: string;
  date_of_birth?: string;
  occupation?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  allergies?: string;
  current_medications?: string;
  medical_history?: string;
  notes?: string;
  profile_photo?: string;
  linked_user_id?: number;
  created_at: string;
}

export interface PatientCreate {
  first_name: string;
  last_name: string;
  gender?: string;
  phone_number?: string;
  email?: string;
  address?: string;
  date_of_birth?: string;
  occupation?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  allergies?: string;
  current_medications?: string;
  medical_history?: string;
  notes?: string;
  profile_photo?: string;
  linked_user_id?: number;
}

export type AppointmentStatusType =
  | "Scheduled"
  | "In Treatment"
  | "Completed"
  | "Canceled"
  | "No-Show";

export interface Appointment {
  id: number;
  patient_id: number;
  appointment_datetime: string;
  treatment_id?: number;
  session_id?: number;
  session_number?: number;
  duration_minutes: number;
  reason?: string;
  notes?: string;
  recurrence?: string;
  priority?: string;
  status: AppointmentStatusType;
}

export interface AppointmentCreate {
  patient_id: number;
  appointment_datetime: string;
  treatment_id?: number;
  session_id?: number;
  session_number?: number;
  duration_minutes?: number;
  reason?: string;
  notes?: string;
  recurrence?: string;
  priority?: string;
  status?: AppointmentStatusType;
}

export interface Treatment {
  id: number;
  patient_id: number;
  tooth_number?: number;
  tooth_numbers?: number[];
  diagnosis?: string;
  procedure?: string;
  treatment_plan?: string;
  prescribed_medication?: string;
  treatment_notes?: string;
  total_sessions_required: number;
  sessions_completed: number;
  total_cost: number;
  start_date?: string;
  completed_date?: string;
  status:
    | "Planned"
    | "Ongoing"
    | "Completed"
    | "Canceled";
}

export interface TreatmentCreate {
  patient_id: number;
  tooth_number?: number;
  tooth_numbers?: number[];
  diagnosis?: string;
  procedure?: string;
  treatment_plan?: string;
  prescribed_medication?: string;
  treatment_notes?: string;
  total_sessions_required?: number;
  sessions_completed?: number;
  total_cost?: number;
  session_costs?: number[];
  start_date?: string;
  completed_date?: string;
  status?: string;
}

export type SessionStatusType =
  | "Unscheduled"
  | "Scheduled"
  | "Completed"
  | "Canceled";

export interface TreatmentSession {
  id: number;
  treatment_id: number;
  session_number: number;
  label?: string;
  status: SessionStatusType;
  visit_date?: string;
  procedure_done?: string;
  notes?: string;
  next_visit?: string;
  cost: number;
  duration_minutes: number;
}

export interface TreatmentSessionCreate {
  treatment_id: number;
  session_number?: number;
  label?: string;
  status?: SessionStatusType;
  visit_date?: string;
  procedure_done?: string;
  notes?: string;
  next_visit?: string;
  cost?: number;
  duration_minutes?: number;
}

export interface TreatmentSessionUpdate {
  label?: string;
  status?: SessionStatusType;
  visit_date?: string;
  procedure_done?: string;
  notes?: string;
  next_visit?: string;
  cost?: number;
  duration_minutes?: number;
}

export interface ToothRecord {
  id: number;
  patient_id: number;
  tooth_number: number;
  condition:
    | "Healthy"
    | "Caries"
    | "Root Canal"
    | "Crown"
    | "Missing"
    | "Extracted"
    | "Implant"
    | "Other";
  notes?: string;
  treatment_status?: string;
  last_updated: string;
}

export interface ToothRecordCreate {
  patient_id: number;
  tooth_number: number;
  condition?: string;
  notes?: string;
  treatment_status?: string;
}

export interface Payment {
  id: number;
  patient_id: number;
  treatment_id?: number;
  session_id?: number;
  invoice_number?: string;
  amount: number;
  discount: number;
  payment_date: string;
  method: string;
  insurance_provider?: string;
  description?: string;
  receipt_path?: string;
  status: string;
}

export interface PaymentCreate {
  patient_id: number;
  treatment_id?: number;
  session_id?: number;
  invoice_number?: string;
  amount: number;
  discount?: number;
  payment_date?: string;
  method?: string;
  insurance_provider?: string;
  description?: string;
  receipt_path?: string;
  status?: string;
}

export interface PaymentUpdate {
  patient_id?: number;
  treatment_id?: number;
  session_id?: number;
  invoice_number?: string;
  amount?: number;
  discount?: number;
  payment_date?: string;
  method?: string;
  insurance_provider?: string;
  description?: string;
  receipt_path?: string;
  status?: string;
}

export interface PatientDocument {
  id: number;
  patient_id: number;
  file_name: string;
  file_type: string;
  file_path: string;
  description?: string;
  uploaded_at: string;
}

export interface PatientDocumentCreate {
  patient_id: number;
  file_name: string;
  file_type: string;
  file_path: string;
  description?: string;
}

export interface PatientTimeline {
  id: number;
  patient_id: number;
  event_type: string;
  description: string;
  created_at: string;
}

export interface PatientTimelineCreate {
  patient_id: number;
  event_type: string;
  description: string;
}

export interface AuthUser {
  id: number;
  email: string;
  role: 'user' | 'admin' | 'dentist' | 'hygienist' | 'receptionist';
  role_label?: string;
  permissions?: string[];
  is_active: boolean;
  is_approved: boolean;
  approved_at?: string;
  created_at: string;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface AuditLog {
  id: number;
  user_id?: number;
  user_email?: string;
  action: string;
  resource?: string;
  resource_id?: number;
  details?: string;
  ip_address?: string;
  created_at: string;
}

export interface AuditLogPage {
  total: number;
  logs: AuditLog[];
}

export interface AdminStats {
  users: number;
  admins: number;
  patients: number;
  appointments: number;
  today_appointments: number;
  treatments: number;
  sessions_completed: number;
  payments: number;
  documents: number;
  total_collected: number;
  collected_30d: number;
  appointment_status_counts: Record<string, number>;
  registrations_30d: Record<string, number>;
  revenue_30d: Record<string, number>;
  audit_events: number;
  pending_approvals: number;
}

export interface FinancialSummary {
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
}

// =====================================================
// API METHOD CALLS
// =====================================================

export const api = {
  // ---- AUTH ----
  register: async (email: string, password: string): Promise<AuthUser> => {
    const response = await apiClient.post('/auth/register', { email, password });
    return response.data;
  },

  login: async (email: string, password: string): Promise<AuthTokenResponse> => {
    const response = await apiClient.post('/auth/login', { email, password });
    return response.data;
  },

  getMe: async (): Promise<AuthUser> => {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },

  updateMe: async (payload: {
    role_label?: string;
    email?: string;
    current_password?: string;
  }): Promise<AuthUser> => {
    const response = await apiClient.put('/auth/me', payload);
    return response.data;
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await apiClient.post('/auth/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  createAdmin: async (
    email: string,
    password: string,
    setupSecret: string
  ): Promise<AuthUser> => {
    const response = await apiClient.post('/auth/create-admin', { email, password }, {
      headers: { 'X-Admin-Setup-Secret': setupSecret },
    });
    return response.data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },

  // ---- ADMIN ----
  getUsers: async (): Promise<AuthUser[]> => {
    const response = await apiClient.get('/admin/users');
    return response.data;
  },

  getPendingUsers: async (): Promise<AuthUser[]> => {
    const response = await apiClient.get('/admin/users/pending');
    return response.data;
  },

  approveUser: async (userId: number): Promise<AuthUser> => {
    const response = await apiClient.post(`/admin/users/${userId}/approve`);
    return response.data;
  },

  deleteUser: async (userId: number): Promise<void> => {
    await apiClient.delete(`/admin/users/${userId}`);
  },

  updateUserRole: async (userId: number, role: string): Promise<AuthUser> => {
    const response = await apiClient.put(`/admin/users/${userId}/role`, { role });
    return response.data;
  },

  resetUserPassword: async (userId: number, newPassword: string): Promise<AuthUser> => {
    const response = await apiClient.post(`/admin/users/${userId}/reset-password`, {
      new_password: newPassword,
    });
    return response.data;
  },

  updateUserSettings: async (
    userId: number,
    settings: { role_label?: string; permissions?: string[] | null }
  ): Promise<AuthUser> => {
    const response = await apiClient.put(`/admin/users/${userId}/settings`, settings);
    return response.data;
  },

  getAdminStats: async (): Promise<AdminStats> => {
    const response = await apiClient.get('/admin/stats');
    return response.data;
  },

  getAuditLogs: async (params?: {
    skip?: number;
    limit?: number;
    action?: string;
    user_id?: number;
    search?: string;
  }): Promise<AuditLogPage> => {
    const query = new URLSearchParams();
    if (params?.skip) query.append('skip', String(params.skip));
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.action) query.append('action', params.action);
    if (params?.user_id) query.append('user_id', String(params.user_id));
    if (params?.search) query.append('search', params.search);
    const response = await apiClient.get(`/admin/logs?${query.toString()}`);
    return response.data;
  },

  // ---- PATIENTS (paginated) ----
  getPatients: async (
    skip: number = 0,
    limit: number = 20,
    search?: string,
    sortBy?: string,
    gender?: string,
    ageGroup?: string
  ): Promise<Patient[]> => {
    const params = new URLSearchParams();
    params.append('skip', String(skip));
    params.append('limit', String(limit));
    if (search) params.append('search', search);
    if (sortBy) params.append('sort_by', sortBy);
    if (gender) params.append('gender', gender);
    if (ageGroup) params.append('age_group', ageGroup);
    const response = await apiClient.get(`/patients/?${params.toString()}`);
    return response.data;
  },

  getPatientsCount: async (search?: string, gender?: string, ageGroup?: string): Promise<number> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (gender) params.append('gender', gender);
    if (ageGroup) params.append('age_group', ageGroup);
    const response = await apiClient.get(`/patients/count?${params.toString()}`);
    return response.data.total;
  },

  createPatient: async (data: PatientCreate): Promise<Patient> => {
    const response = await apiClient.post('/patients/', data);
    return response.data;
  },

  getPatientById: async (id: number): Promise<Patient> => {
    const response = await apiClient.get(`/patients/${id}`);
    return response.data;
  },

  updatePatient: async (id: number, data: PatientCreate): Promise<Patient> => {
    const response = await apiClient.put(`/patients/${id}`, data);
    return response.data;
  },

  deletePatient: async (id: number): Promise<void> => {
    await apiClient.delete(`/patients/${id}`);
  },

  // ---- APPOINTMENTS ----
  getAllAppointments: async (): Promise<Appointment[]> => {
    const response = await apiClient.get('/appointments/');
    return response.data;
  },

  getTodayAppointments: async (): Promise<Appointment[]> => {
    const response = await apiClient.get('/appointments/today');
    return response.data;
  },

  getAppointmentsForRange: async (start: Date, end: Date): Promise<Appointment[]> => {
    // Backend stores naive local datetimes -- sending UTC ISO (toISOString)
    // shifts the range by the tz offset and drops the last hour of the day.
    const params = new URLSearchParams({
      start: toLocalNaiveISO(start),
      end: toLocalNaiveISO(end),
    });
    const response = await apiClient.get(`/appointments/range?${params.toString()}`);
    return response.data;
  },

  getPatientAppointments: async (patientId: number): Promise<Appointment[]> => {
    const response = await apiClient.get(`/patients/${patientId}/appointments`);
    return response.data;
  },

  createAppointment: async (appointment: AppointmentCreate): Promise<Appointment> => {
    const response = await apiClient.post('/appointments/', appointment);
    return response.data;
  },

  updateAppointment: async (
    id: number,
    appointment: AppointmentCreate
  ): Promise<Appointment> => {
    const response = await apiClient.put(`/appointments/${id}`, appointment);
    return response.data;
  },

  deleteAppointment: async (id: number): Promise<void> => {
    await apiClient.delete(`/appointments/${id}`);
  },

  // ---- TREATMENTS ----
  getPatientTreatments: async (patientId: number): Promise<Treatment[]> => {
    const response = await apiClient.get(`/patients/${patientId}/treatments`);
    return response.data;
  },

  createTreatment: async (treatment: TreatmentCreate): Promise<Treatment> => {
    const response = await apiClient.post('/treatments/', treatment);
    return response.data;
  },

  updateTreatment: async (
    id: number,
    treatment: TreatmentCreate
  ): Promise<Treatment> => {
    const response = await apiClient.put(`/treatments/${id}`, treatment);
    return response.data;
  },

  deleteTreatment: async (id: number): Promise<void> => {
    await apiClient.delete(`/treatments/${id}`);
  },

  deleteTreatmentSession: async (id: number): Promise<void> => {
    await apiClient.delete(`/treatment-sessions/${id}`);
  },

  // ---- PAYMENTS ----
  getPayments: async (): Promise<Payment[]> => {
    const response = await apiClient.get('/payments/');
    return response.data;
  },

  getPatientPayments: async (patientId: number): Promise<Payment[]> => {
    const response = await apiClient.get(`/patients/${patientId}/payments`);
    return response.data;
  },

  createPayment: async (data: PaymentCreate): Promise<Payment> => {
    const response = await apiClient.post('/payments/', data);
    return response.data;
  },

  deletePayment: async (id: number): Promise<void> => {
    await apiClient.delete(`/payments/${id}`);
  },

  updatePayment: async (id: number, data: PaymentUpdate): Promise<Payment> => {
    const response = await apiClient.put(`/payments/${id}`, data);
    return response.data;
  },

  // ---- TREATMENT SESSIONS ----
  createTreatmentSession: async (
    data: TreatmentSessionCreate
  ): Promise<TreatmentSession> => {
    const response = await apiClient.post("/treatment-sessions/", data);
    return response.data;
  },

  updateTreatmentSession: async (
    sessionId: number,
    data: TreatmentSessionUpdate
  ): Promise<TreatmentSession> => {
    const response = await apiClient.put(`/treatment-sessions/${sessionId}`, data);
    return response.data;
  },

  getTreatmentSessions: async (
    treatmentId: number
  ): Promise<TreatmentSession[]> => {
    const response = await apiClient.get(`/treatments/${treatmentId}/sessions`);
    return response.data;
  },

  scheduleTreatmentSession: async (
    treatmentId: number,
    data: AppointmentCreate
  ): Promise<Appointment> => {
    const response = await apiClient.post(
      `/treatments/${treatmentId}/schedule`,
      data
    );
    return response.data;
  },

  // ---- TOOTH RECORDS ----
  createToothRecord: async (
    data: ToothRecordCreate
  ): Promise<ToothRecord> => {
    const response = await apiClient.post("/teeth/", data);
    return response.data;
  },

  updateToothRecord: async (
    toothRecordId: number,
    data: ToothRecordCreate
  ): Promise<ToothRecord> => {
    const response = await apiClient.put(`/teeth/${toothRecordId}`, data);
    return response.data;
  },

  getPatientTeeth: async (
    patientId: number
  ): Promise<ToothRecord[]> => {
    const response = await apiClient.get(`/patients/${patientId}/teeth`);
    return response.data;
  },

  deleteToothRecord: async (
    toothRecordId: number
  ): Promise<void> => {
    await apiClient.delete(`/teeth/${toothRecordId}`);
  },

  // ---- DOCUMENTS ----
  getPatientDocuments: async (
    patientId: number
  ): Promise<PatientDocument[]> => {
    const response = await apiClient.get(`/patients/${patientId}/documents`);
    return response.data;
  },

  uploadDocument: async (
    patientId: number,
    file: File,
    description?: string
  ): Promise<PatientDocument> => {
    const form = new FormData();
    form.append('file', file);
    if (description) form.append('description', description);
    const response = await apiClient.post(`/patients/${patientId}/documents/upload`, form);
    return response.data;
  },

  deleteDocument: async (documentId: number): Promise<void> => {
    await apiClient.delete(`/documents/${documentId}`);
  },

  // ---- TIMELINE ----
  createTimelineEvent: async (
    data: PatientTimelineCreate
  ): Promise<PatientTimeline> => {
    const response = await apiClient.post("/timeline/", data);
    return response.data;
  },

  getPatientTimeline: async (
    patientId: number
  ): Promise<PatientTimeline[]> => {
    const response = await apiClient.get(`/patients/${patientId}/timeline`);
    return response.data;
  },

  // ---- FINANCIAL SUMMARY ----
  getFinancialSummary: async (): Promise<FinancialSummary> => {
    const response = await apiClient.get('/financials/summary');
    return response.data;
  },

  // ---- UTILITIES ----
  getNextAvailableSlot: async (
    date: string,
    durationMinutes: number = 30,
    startHour: number = 7,
    endHour: number = 20
  ): Promise<string> => {
    const all = await api.getAllAppointments();
    const dayAppointments = all
      .filter(a => a.status !== 'Canceled' && a.appointment_datetime.startsWith(date))
      .sort((a, b) => new Date(a.appointment_datetime).getTime() - new Date(b.appointment_datetime).getTime());

    const startOfDay = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`);
    const endOfDay = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00`);
    let candidate = new Date(startOfDay);

    for (const apt of dayAppointments) {
      const aptStart = new Date(apt.appointment_datetime);
      const aptEnd = new Date(aptStart.getTime() + apt.duration_minutes * 60000);

      const candidateEnd = new Date(candidate.getTime() + durationMinutes * 60000);
      if (candidateEnd <= aptStart) {
        return toLocalNaiveISO(candidate);
      }
      candidate = new Date(aptEnd);
    }

    const candidateEnd = new Date(candidate.getTime() + durationMinutes * 60000);
    if (candidateEnd <= endOfDay) {
      return toLocalNaiveISO(candidate);
    }

    // No slot fits today -- signal "unavailable" instead of returning the
    // current moment (which the UI would happily book as a bogus/past time).
    return '';
  },
};