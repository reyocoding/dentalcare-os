from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    DateTime,
    ForeignKey,
    Enum,
    Text,
    Boolean,
    JSON
)

from sqlalchemy.orm import relationship

from datetime import datetime, timezone
import enum

from database import Base
from encryption import EncryptedText


class UserRole(str, enum.Enum):
    """Application roles for RBAC.

    "user" is a legacy value kept for databases created before role
    expansion; it is treated as staff for data access."""

    USER = "user"
    ADMIN = "admin"
    DENTIST = "dentist"
    HYGIENIST = "hygienist"
    RECEPTIONIST = "receptionist"


class RefreshToken(Base):
    """Server-side refresh token store (SHA-256 hashes only, never the raw
    token). Supports rotation: each refresh revokes the presented token and
    issues a fresh one."""

    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash = Column(String(64), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, index=True, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.now(timezone.utc), nullable=False)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    email = Column(
        String,
        unique=True,
        index=True,
        nullable=False
    )

    password_hash = Column(
        String,
        nullable=False
    )

    role = Column(
        String,
        default=UserRole.USER.value,
        nullable=False
    )

    # Human-friendly job title shown in the UI, e.g. "Doctor 01",
    # "Secretary 1", "Doctor 02" -- set by an admin.
    role_label = Column(
        String,
        nullable=True
    )

    # List of page keys this user may access ("dashboard", "patients",
    # "calendar", "financials", "settings", ...). NULL means full access.
    permissions = Column(
        JSON,
        nullable=True
    )

    is_active = Column(
        Boolean,
        default=True,
        nullable=False
    )

    # Self-registered accounts start unapproved (False) and cannot sign in
    # until an admin approves them. Accounts created by an admin/staff
    # (seeded or /auth/create-admin) default to True.
    is_approved = Column(
        Boolean,
        default=True,
        nullable=False
    )

    # Set by the admin who approved this account.
    approved_at = Column(
        DateTime,
        nullable=True
    )
    approved_by_user_id = Column(
        Integer,
        nullable=True
    )

    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)

    # Denormalized user info (email survives user deletion).
    user_id = Column(Integer, nullable=True)
    user_email = Column(String, nullable=True)

    action = Column(String, nullable=False)
    resource = Column(String, nullable=True)
    resource_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    ip_address = Column(String, nullable=True)

    # Tamper-evidence: each entry stores the HMAC of its own contents plus
    # the previous entry's hash, so any modification is detectable.
    prev_hash = Column(String(64), nullable=True)
    entry_hash = Column(String(64), nullable=True)

    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )


class AppointmentStatus(str, enum.Enum):
    SCHEDULED = "Scheduled"
    IN_TREATMENT = "In Treatment"
    COMPLETED = "Completed"
    CANCELED = "Canceled"
    NOSHOW = "No-Show"


class TreatmentStatus(str, enum.Enum):
    PLANNED = "Planned"
    ONGOING = "Ongoing"
    COMPLETED = "Completed"
    CANCELED = "Canceled"


class ToothCondition(str, enum.Enum):
    HEALTHY = "Healthy"
    CARIES = "Caries"
    ROOT_CANAL = "Root Canal"
    CROWN = "Crown"
    MISSING = "Missing"
    EXTRACTED = "Extracted"
    IMPLANT = "Implant"
    FILLING = "Filling"
    OTHER = "Other"


# NEW: a session's own lifecycle, independent of any appointment matching.
# Unscheduled -> Scheduled (an Appointment with session_id points at it) ->
# Completed (the appointment happened) or back to Unscheduled if canceled.
class SessionStatus(str, enum.Enum):
    UNSCHEDULED = "Unscheduled"
    SCHEDULED = "Scheduled"
    COMPLETED = "Completed"
    CANCELED = "Canceled"

##
class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, index=True)

    # identity
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    gender = Column(String, nullable=True)

    # contact -- phone/email stay plaintext (used for search/lookup);
    # address is free-text PHI and is encrypted at rest.
    phone_number = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(EncryptedText, nullable=True)

    # personal
    date_of_birth = Column(String, nullable=True)
    occupation = Column(EncryptedText, nullable=True)

    # emergency -- PHI: encrypted at rest
    emergency_contact_name = Column(EncryptedText, nullable=True)
    emergency_contact_phone = Column(EncryptedText, nullable=True)

    # medical -- PHI: encrypted at rest
    allergies = Column(EncryptedText, nullable=True)
    current_medications = Column(EncryptedText, nullable=True)
    medical_history = Column(EncryptedText, nullable=True)
    notes = Column(EncryptedText, nullable=True)

    # metadata
    profile_photo = Column(String, nullable=True)

    # Optional link to a patient-role user account. When set, that account
    # may READ only this record (object-level access control); NULL keeps
    # the record staff-only.
    linked_user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    appointments = relationship(
        "Appointment",
        back_populates="patient",
        cascade="all, delete-orphan"
    )

    treatments = relationship(
        "Treatment",
        back_populates="patient",
        cascade="all, delete-orphan"
    )

    payments = relationship(
        "Payment",
        back_populates="patient",
        cascade="all, delete-orphan"
    )

    tooth_records = relationship(
        "ToothRecord",
        back_populates="patient",
        cascade="all, delete-orphan"
    )

    documents = relationship(
        "PatientDocument",
        back_populates="patient",
        cascade="all, delete-orphan"
    )

    timeline_events = relationship(
        "PatientTimeline",
        back_populates="patient",
        cascade="all, delete-orphan"
    )


class Appointment(Base):

    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, index=True)

    patient_id = Column(
        Integer,
        ForeignKey(
    "patients.id",
    ondelete="CASCADE"
),
        nullable=False
    )

    appointment_datetime = Column(
        DateTime,
        nullable=False
    )

    # Kept for convenient querying ("all appointments for this treatment")
    # but it is ALWAYS derived server-side from session_id when a session
    # is linked -- never trust a client-supplied treatment_id/session_number
    # to disagree with the session it's supposedly for.
    treatment_id = Column(
        Integer,
        ForeignKey("treatments.id"),
        nullable=True
    )

    # NEW: the real link. One appointment is scheduling exactly one
    # treatment session. No more matching-by-number.
    session_id = Column(
        Integer,
        ForeignKey("treatment_sessions.id"),
        nullable=True
    )

    # Denormalized copy of the session's number, kept only for display
    # convenience (e.g. calendar event titles) without an extra join.
    session_number = Column(
        Integer,
        nullable=True
    )

    duration_minutes = Column(
        Integer,
        default=30
    )

    reason = Column(
        EncryptedText,
        nullable=True
    )

    notes = Column(
        EncryptedText,
        nullable=True
    )

    recurrence = Column(
        String,
        nullable=True
    )

    priority = Column(
        String,
        default="Normal"
    )

    status = Column(
        Enum(AppointmentStatus),
        default=AppointmentStatus.SCHEDULED
    )

    patient = relationship(
        "Patient",
        back_populates="appointments"
    )

    treatment = relationship(
        "Treatment",
        backref="appointments"
    )

    session = relationship(
        "TreatmentSession",
        backref="appointments"
    )


class Treatment(Base):
    __tablename__ = "treatments"

    id = Column(Integer, primary_key=True)

    patient_id = Column(
        Integer,
        ForeignKey(
    "patients.id",
    ondelete="CASCADE"
)
    )

    tooth_number = Column(
        Integer,
        nullable=True
    )

    # NEW: multi-tooth support -- a treatment may cover several teeth at
    # once. tooth_number stays as the first (primary) tooth for backward
    # compatibility with existing UI/logic.
    tooth_numbers = Column(
        JSON,
        nullable=True
    )

    # diagnosis/procedure stay plaintext (shown in list views); the free
    # text around them is PHI and encrypted at rest.
    diagnosis = Column(
        Text,
        nullable=True
    )

    procedure = Column(
        Text,
        nullable=True
    )

    treatment_plan = Column(
        EncryptedText,
        nullable=True
    )

    prescribed_medication = Column(
        EncryptedText,
        nullable=True
    )

    treatment_notes = Column(
        EncryptedText,
        nullable=True
    )

    total_sessions_required = Column(
        Integer,
        default=1
    )

    sessions_completed = Column(
        Integer,
        default=0
    )

    total_cost = Column(
        Float,
        default=0
    )

    start_date = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    completed_date = Column(
        DateTime,
        nullable=True
    )

    status = Column(
        Enum(TreatmentStatus),
        default=TreatmentStatus.PLANNED
    )

    patient = relationship(
        "Patient",
        back_populates="treatments"
    )

    sessions = relationship(
        "TreatmentSession",
        back_populates="treatment",
        cascade="all, delete-orphan",
        order_by="TreatmentSession.session_number"
    )

    payments = relationship(
        "Payment",
        back_populates="treatment",
        cascade="all, delete-orphan"
    )


class TreatmentSession(Base):
    __tablename__ = "treatment_sessions"

    id = Column(
        Integer,
        primary_key=True
    )

    treatment_id = Column(
        Integer,
        ForeignKey("treatments.id")
    )

    session_number = Column(
        Integer
    )

    # NEW: a short label describing what this slot is for, settable before
    # it's even scheduled, e.g. "Root canal - 1st session".
    label = Column(
        String,
        nullable=True
    )

    # NEW: lifecycle state. Replaces the old "does an appointment exist
    # with this number" guesswork.
    status = Column(
        Enum(SessionStatus),
        default=SessionStatus.UNSCHEDULED
    )

    # No longer required at creation time -- a freshly created session from
    # a new Treatment has no date until it's scheduled.
    visit_date = Column(
        DateTime,
        nullable=True
    )

    procedure_done = Column(
        Text
    )

    notes = Column(
        EncryptedText
    )

    next_visit = Column(
        DateTime,
        nullable=True
    )

    cost = Column(
        Float,
        default=0
    )

    # NEW: was captured in the UI before but never actually saved anywhere.
    duration_minutes = Column(
        Integer,
        default=30
    )

    treatment = relationship(
        "Treatment",
        back_populates="sessions"
    )

    payments = relationship(
        "Payment",
        back_populates="session",
        cascade="all, delete-orphan"
    )

class ToothRecord(Base):
    __tablename__ = "tooth_records"

    id = Column(
        Integer,
        primary_key=True
    )

    patient_id = Column(
        Integer,
        ForeignKey(
    "patients.id",
    ondelete="CASCADE"
)
    )

    tooth_number = Column(
        Integer
    )

    condition = Column(
        Enum(ToothCondition),
        default=ToothCondition.HEALTHY
    )

    notes = Column(
        EncryptedText
    )

    treatment_status = Column(
        String
    )

    last_updated = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    patient = relationship(
        "Patient",
        back_populates="tooth_records"
    )


class Payment(Base):
    __tablename__ = "payments"

    id = Column(
        Integer,
        primary_key=True
    )

    patient_id = Column(
        Integer,
        ForeignKey(
    "patients.id",
    ondelete="CASCADE"
)
    )

    treatment_id = Column(
        Integer,
        ForeignKey("treatments.id"),
        nullable=True
    )

    session_id = Column(
        Integer,
        ForeignKey("treatment_sessions.id"),
        nullable=True
    )

    invoice_number = Column(
        String,
        nullable=True
    )

    amount = Column(
        Float,
        nullable=False
    )

    discount = Column(
        Float,
        default=0
    )

    payment_date = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    method = Column(
        String,
        default="Cash"
    )

    insurance_provider = Column(
        String,
        nullable=True
    )

    description = Column(
        EncryptedText,
        nullable=True
    )

    receipt_path = Column(
        String,
        nullable=True
    )

    status = Column(
        String,
        default="Completed"
    )

    patient = relationship(
        "Patient",
        back_populates="payments"
    )

    treatment = relationship(
        "Treatment",
        back_populates="payments"
    )

    session = relationship(
        "TreatmentSession",
        back_populates="payments"
    )


class PatientDocument(Base):
    __tablename__ = "patient_documents"

    id = Column(
        Integer,
        primary_key=True
    )

    patient_id = Column(
        Integer,
        ForeignKey(
    "patients.id",
    ondelete="CASCADE"
)
    )

    file_name = Column(
        String
    )

    file_type = Column(
        String
    )

    file_path = Column(
        String
    )

    description = Column(
        EncryptedText
    )

    uploaded_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    patient = relationship(
        "Patient",
        back_populates="documents"
    )

class PatientTimeline(Base):
    __tablename__ = "patient_timeline"

    id = Column(
        Integer,
        primary_key=True
    )

    patient_id = Column(
        Integer,
        ForeignKey(
    "patients.id",
    ondelete="CASCADE"
)
    )

    event_type = Column(
        String
    )

    description = Column(
        EncryptedText
    )

    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc)
    )

    patient = relationship(
        "Patient",
        back_populates="timeline_events"
    )