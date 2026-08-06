import re
from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional, List
from datetime import datetime

from models import (
    UserRole,
    AppointmentStatus,
    TreatmentStatus,
    ToothCondition,
    SessionStatus
)

# ==========================================================
# AUTH / USERS
# ==========================================================

class UserCreate(BaseModel):
    email: str
    password: str

    @field_validator('email')
    @classmethod
    def normalize_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError('invalid email format')
        return v

    @field_validator('password')
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('password must be at least 8 characters')
        return v


class UserLogin(BaseModel):
    email: str
    password: str

    @field_validator('email')
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    role_label: Optional[str] = None
    permissions: Optional[List[str]] = None
    is_active: bool
    is_approved: bool = True
    approved_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )


class UserSettingsUpdate(BaseModel):
    """Admin-edited access settings for a user: job title label plus the
    list of pages they may open (None = full access)."""
    role_label: Optional[str] = None
    permissions: Optional[List[str]] = None


class UserSelfUpdate(BaseModel):
    """Fields a user may edit about themselves from the profile page."""
    role_label: Optional[str] = None
    email: Optional[str] = None
    # Required when `email` is being changed -- proves possession of the
    # account password (a session token alone is not enough).
    current_password: Optional[str] = None


class ChangePassword(BaseModel):
    current_password: str
    new_password: str

    @field_validator('new_password')
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('password must be at least 8 characters')
        return v


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class CreateAdminRequest(BaseModel):
    email: str
    password: str

    @field_validator('email')
    @classmethod
    def normalize_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError('invalid email format')
        return v

    @field_validator('password')
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('password must be at least 8 characters')
        return v


class RoleUpdate(BaseModel):
    role: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed = {r.value for r in UserRole}
        if v not in allowed:
            raise ValueError(f'role must be one of: {", ".join(sorted(allowed))}')
        return v


class AdminResetPassword(BaseModel):
    """New password an admin sets on someone else's account."""
    new_password: str

    @field_validator('new_password')
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('password must be at least 8 characters')
        return v


class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    action: str
    resource: Optional[str] = None
    resource_id: Optional[int] = None
    details: Optional[str] = None
    ip_address: Optional[str] = None
    prev_hash: Optional[str] = None
    entry_hash: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )


class AuditLogPage(BaseModel):
    total: int
    logs: List[AuditLogOut]


class AdminStats(BaseModel):
    users: int
    admins: int
    patients: int
    appointments: int
    today_appointments: int
    treatments: int
    sessions_completed: int
    payments: int
    documents: int
    total_collected: float
    collected_30d: float
    appointment_status_counts: dict
    registrations_30d: dict
    revenue_30d: dict
    audit_events: int
    pending_approvals: int


# ==========================================================
# PATIENT
# ==========================================================

_PHONE_RE = re.compile(r'^[+]?[\d\s\-().]{6,20}$')
_EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')

class PatientBase(BaseModel):
    # Identity
    first_name: str
    last_name: str
    gender: Optional[str] = None

    # Contact
    phone_number: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None

    # Personal
    date_of_birth: Optional[str] = None
    occupation: Optional[str] = None

    # Emergency
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None

    # Medical
    allergies: Optional[str] = None
    current_medications: Optional[str] = None
    medical_history: Optional[str] = None
    notes: Optional[str] = None

    # Misc
    profile_photo: Optional[str] = None

    # Optional patient-portal link: when set to a patient-role user's id,
    # that account may READ this record (and nothing else).
    linked_user_id: Optional[int] = None

    @field_validator('first_name', 'last_name')
    @classmethod
    def check_name_not_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError('must not be blank')
        if len(stripped) < 2:
            raise ValueError('must be at least 2 characters')
        return stripped

    @field_validator('phone_number', 'emergency_contact_phone')
    @classmethod
    def check_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return v
        if not _PHONE_RE.match(v.strip()):
            raise ValueError('invalid phone number format')
        return v.strip()

    @field_validator('email')
    @classmethod
    def check_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return v
        if not _EMAIL_RE.match(v.strip()):
            raise ValueError('invalid email format')
        return v.strip()


class PatientCreate(PatientBase):
    pass


class Patient(PatientBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )


# ==========================================================
# APPOINTMENTS
# ==========================================================

class AppointmentBase(BaseModel):
    patient_id: int

    appointment_datetime: datetime

    # Convenience/denormalized -- always derived server-side from session_id
    # when a session is linked. Safe to omit from the client.
    treatment_id: Optional[int] = None

    # NEW: the real link to a specific TreatmentSession slot. This is what
    # a session actually IS a booking for.
    session_id: Optional[int] = None

    session_number: Optional[int] = None

    duration_minutes: int = 30

    reason: Optional[str] = None

    notes: Optional[str] = None

    recurrence: Optional[str] = None

    priority: str = "Normal"

    status: AppointmentStatus = (
        AppointmentStatus.SCHEDULED
    )


class AppointmentCreate(AppointmentBase):
    pass


class Appointment(AppointmentBase):
    id: int

    model_config = ConfigDict(
        from_attributes=True
    )


# ==========================================================
# TREATMENTS
# ==========================================================

class TreatmentBase(BaseModel):
    patient_id: int

    tooth_number: Optional[int] = None

    # NEW: multi-tooth support -- all teeth this treatment covers.
    tooth_numbers: Optional[List[int]] = None

    # NEW: per-session costs, parallel to session numbers 1..N. Spawned
    # placeholder sessions pick up their cost from here.
    session_costs: Optional[List[float]] = None

    diagnosis: Optional[str] = None

    procedure: Optional[str] = None

    treatment_plan: Optional[str] = None

    prescribed_medication: Optional[str] = None

    treatment_notes: Optional[str] = None

    total_sessions_required: int = 1

    sessions_completed: int = 0

    total_cost: float = 0

    start_date: Optional[datetime] = None

    completed_date: Optional[datetime] = None

    status: TreatmentStatus = (
        TreatmentStatus.PLANNED
    )


class TreatmentCreate(TreatmentBase):
    pass


class Treatment(TreatmentBase):
    id: int

    model_config = ConfigDict(
        from_attributes=True
    )


# ==========================================================
# TREATMENT SESSIONS
# ==========================================================

class TreatmentSessionBase(BaseModel):
    treatment_id: int

    session_number: int

    label: Optional[str] = None

    status: SessionStatus = SessionStatus.UNSCHEDULED

    # No longer required -- a freshly created placeholder session has no
    # date until it's scheduled via an Appointment.
    visit_date: Optional[datetime] = None

    procedure_done: Optional[str] = None

    notes: Optional[str] = None

    next_visit: Optional[datetime] = None

    cost: float = 0

    duration_minutes: int = 30


class TreatmentSessionCreate(
    TreatmentSessionBase
):
    # Only treatment_id is really required to add an extra ad-hoc session;
    # everything else has sane defaults.
    session_number: Optional[int] = None


class TreatmentSessionUpdate(BaseModel):
    """Partial update -- used both for editing a not-yet-scheduled session's
    label, and for recording what actually happened when marking one
    Completed directly (walk-ins with no calendar entry)."""
    label: Optional[str] = None
    status: Optional[SessionStatus] = None
    visit_date: Optional[datetime] = None
    procedure_done: Optional[str] = None
    notes: Optional[str] = None
    next_visit: Optional[datetime] = None
    cost: Optional[float] = None
    duration_minutes: Optional[int] = None


class TreatmentSession(
    TreatmentSessionBase
):
    id: int

    model_config = ConfigDict(
        from_attributes=True
    )


# ==========================================================
# TOOTH RECORDS
# ==========================================================

class ToothRecordBase(BaseModel):
    patient_id: int

    tooth_number: int

    condition: ToothCondition = (
        ToothCondition.HEALTHY
    )

    notes: Optional[str] = None

    treatment_status: Optional[str] = None


class ToothRecordCreate(
    ToothRecordBase
):
    pass


class ToothRecord(
    ToothRecordBase
):
    id: int

    last_updated: datetime

    model_config = ConfigDict(
        from_attributes=True
    )


# ==========================================================
# PAYMENTS
# ==========================================================

class PaymentBase(BaseModel):
    patient_id: int

    treatment_id: Optional[int] = None

    session_id: Optional[int] = None

    invoice_number: Optional[str] = None

    amount: float

    discount: float = 0

    payment_date: Optional[datetime] = None

    method: str = "Cash"

    insurance_provider: Optional[str] = None

    description: Optional[str] = None

    receipt_path: Optional[str] = None

    status: str = "Completed"


class PaymentCreate(PaymentBase):
    pass


class PaymentUpdate(BaseModel):
    """Partial update: any subset of fields, e.g. settling a pending
    payment (status only) without resending the amount."""
    patient_id: Optional[int] = None
    treatment_id: Optional[int] = None
    session_id: Optional[int] = None
    invoice_number: Optional[str] = None
    amount: Optional[float] = None
    discount: Optional[float] = None
    payment_date: Optional[datetime] = None
    method: Optional[str] = None
    insurance_provider: Optional[str] = None
    description: Optional[str] = None
    receipt_path: Optional[str] = None
    status: Optional[str] = None


class Payment(PaymentBase):
    id: int

    model_config = ConfigDict(
        from_attributes=True
    )


# ==========================================================
# DOCUMENTS
# ==========================================================

class PatientDocumentBase(BaseModel):
    patient_id: int

    file_name: str

    file_type: str

    file_path: str

    description: Optional[str] = None


class PatientDocumentCreate(
    PatientDocumentBase
):
    pass


class PatientDocument(
    PatientDocumentBase
):
    id: int

    uploaded_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )


# ==========================================================
# TIMELINE
# ==========================================================

class PatientTimelineBase(BaseModel):
    patient_id: int

    event_type: str

    description: str


class PatientTimelineCreate(
    PatientTimelineBase
):
    pass


class PatientTimeline(
    PatientTimelineBase
):
    id: int

    created_at: datetime

    model_config = ConfigDict(
        from_attributes=True
    )