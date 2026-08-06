from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Tuple

import models
import schemas


# =====================================================
# PATIENTS this is the first time  
# =====================================================

# Age groups used by the Patients list filters. When one is active the
# filtering must happen server-side, otherwise pagination totals and the
# current page disagree ("3 of 120").
AGE_GROUPS = {
    "0-12": (0, 12),
    "13-18": (13, 18),
    "19-40": (19, 40),
    "40+": (40, None),
}


def _patient_age_years():
    # SQLite: julianday() works on ISO date strings. NULL/empty DOB -> NULL
    # -> excluded from every age group.
    return (func.julianday(func.date("now")) - func.julianday(models.Patient.date_of_birth)) / 365.25


def _apply_patient_filters(query, search=None, gender=None, age_group=None):
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (models.Patient.first_name.ilike(search_term)) |
            (models.Patient.last_name.ilike(search_term)) |
            (models.Patient.phone_number.ilike(search_term)) |
            (models.Patient.email.ilike(search_term))
        )
    if gender and gender != "All":
        query = query.filter(models.Patient.gender == gender)
    if age_group and age_group != "All":
        lo, hi = AGE_GROUPS[age_group]
        if hi is not None:
            query = query.filter(_patient_age_years().between(lo, hi))
        else:
            query = query.filter(_patient_age_years() >= lo)
    return query

def create_patient(
    db: Session,
    patient: schemas.PatientCreate
):
    db_patient = models.Patient(
        **patient.model_dump()
    )

    db.add(db_patient)
    db.commit()
    db.refresh(db_patient)

    return db_patient


def get_patients(
    db: Session,
    skip: int = 0,
    limit: int = 20,
    search: Optional[str] = None,
    sort_by: Optional[str] = None,
    gender: Optional[str] = None,
    age_group: Optional[str] = None
):
    query = _apply_patient_filters(db.query(models.Patient), search, gender, age_group)
    if sort_by == "created_desc":
        query = query.order_by(models.Patient.created_at.desc())
    else:
        query = query.order_by(models.Patient.first_name.asc(), models.Patient.last_name.asc())
    return query.offset(skip).limit(limit).all()


def count_patients(db: Session, search: Optional[str] = None, gender: Optional[str] = None, age_group: Optional[str] = None) -> int:
    query = _apply_patient_filters(db.query(models.Patient), search, gender, age_group)
    return query.count()


def get_patient(
    db: Session,
    patient_id: int
):
    return (
        db.query(models.Patient)
        .filter(models.Patient.id == patient_id)
        .first()
    )


def update_patient(db: Session, patient_id: int, patient_data: schemas.PatientCreate):
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()

    if not patient:
        return None

    update_data = patient_data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(patient, key, value)

    db.commit()
    db.refresh(patient)

    return patient


def delete_patient(db: Session, patient_id: int):
    patient = (
        db.query(models.Patient)
        .filter(models.Patient.id == patient_id)
        .first()
    )

    if not patient:
        return False

    db.delete(patient)
    db.commit()

    return True


# =====================================================
# APPOINTMENTS
# =====================================================

# Statuses that no longer occupy the calendar slot -- a canceled or
# no-show appointment shouldn't block that time from being rebooked.
NON_BLOCKING_STATUSES = (
    models.AppointmentStatus.CANCELED,
    models.AppointmentStatus.NOSHOW,
)


def _check_slot_available(db: Session, appointment, exclude_id=None):
    appointment_end = (
        appointment.appointment_datetime
        + timedelta(minutes=appointment.duration_minutes)
    )

    query = db.query(models.Appointment).filter(
        models.Appointment.status.notin_(NON_BLOCKING_STATUSES)
    )
    if exclude_id is not None:
        query = query.filter(models.Appointment.id != exclude_id)

    for apt in query.all():
        existing_end = (
            apt.appointment_datetime
            + timedelta(minutes=apt.duration_minutes)
        )

        if (
            appointment.appointment_datetime < existing_end
            and appointment_end > apt.appointment_datetime
        ):
            raise Exception("Time slot unavailable")


def create_appointment(
    db: Session,
    appointment: schemas.AppointmentCreate
):
    _check_slot_available(db, appointment)

    data = appointment.model_dump()

    # If this appointment is scheduling a specific treatment session, the
    # session is the source of truth -- derive treatment_id/session_number
    # from it rather than trusting whatever the client sent, so they can
    # never drift apart.
    session = None
    if data.get("session_id"):
        session = (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.id == data["session_id"])
            .first()
        )
        if not session:
            raise Exception("Linked session not found")

        # A session can only be tied to ONE active appointment -- otherwise
        # canceling one booking frees the session while the other still
        # points at it.
        already_booked = (
            db.query(models.Appointment)
            .filter(
                models.Appointment.session_id == data["session_id"],
                models.Appointment.status.in_(
                    (
                        models.AppointmentStatus.SCHEDULED,
                        models.AppointmentStatus.IN_TREATMENT,
                    )
                ),
            )
            .first()
        )
        if already_booked:
            raise Exception("Session already scheduled")

        data["treatment_id"] = session.treatment_id
        data["session_number"] = session.session_number

    db_appointment = models.Appointment(**data)

    db.add(db_appointment)
    db.flush()  # give it an id so the re-check can exclude itself

    # Re-verify the slot after the row exists: SQLite serializes writers, so
    # a concurrent booking that committed in between the first check and
    # this flush is now visible -- catch it instead of allowing an overlap.
    try:
        _check_slot_available(db, appointment, exclude_id=db_appointment.id)
    except Exception:
        db.rollback()
        raise

    if session:
        if appointment.status == models.AppointmentStatus.COMPLETED:
            session.status = models.SessionStatus.COMPLETED
            session.visit_date = appointment.appointment_datetime
            session.duration_minutes = appointment.duration_minutes
            db.add(session)

            treatment = (
                db.query(models.Treatment)
                .filter(models.Treatment.id == session.treatment_id)
                .first()
            )
            _recalculate_treatment_progress(db, treatment)
        elif appointment.status in (
            models.AppointmentStatus.SCHEDULED,
            models.AppointmentStatus.IN_TREATMENT,
        ):
            session.status = models.SessionStatus.SCHEDULED
            session.visit_date = appointment.appointment_datetime
            session.duration_minutes = appointment.duration_minutes
            db.add(session)

    db.commit()
    db.refresh(db_appointment)

    return db_appointment


def get_appointments(
    db: Session
):
    return db.query(models.Appointment).all()


def get_patient_appointments(
    db: Session,
    patient_id: int
):
    return (
        db.query(models.Appointment)
        .filter(models.Appointment.patient_id == patient_id)
        .all()
    )


def get_today_appointments(db: Session):
    """Return appointments for today (UTC)."""
    today = datetime.now(timezone.utc).date()
    start = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
    end = datetime.combine(today, datetime.max.time(), tzinfo=timezone.utc)
    return (
        db.query(models.Appointment)
        .filter(models.Appointment.appointment_datetime.between(start, end))
        .all()
    )


def get_appointments_range(db: Session, start: datetime, end: datetime):
    """Return appointments within a date range."""
    return (
        db.query(models.Appointment)
        .filter(models.Appointment.appointment_datetime.between(start, end))
        .all()
    )


def _recalculate_treatment_progress(db: Session, treatment: models.Treatment):
    if not treatment:
        return

    # Flush first: the caller may have just flipped a session's status in
    # memory, and Query.count() does NOT autoflush pending changes, so the
    # completed count would be computed against stale data.
    db.flush()

    completed_sessions = db.query(models.TreatmentSession).filter(
        models.TreatmentSession.treatment_id == treatment.id,
        models.TreatmentSession.status == models.SessionStatus.COMPLETED
    ).count()

    treatment.sessions_completed = completed_sessions

    if treatment.sessions_completed >= treatment.total_sessions_required:
        treatment.status = models.TreatmentStatus.COMPLETED
    elif completed_sessions > 0:
        # Started work but not finished -- including downgrades from
        # COMPLETED when a session gets un-completed (e.g. a payment is
        # deleted or an appointment is canceled after being marked done).
        if treatment.status != models.TreatmentStatus.ONGOING:
            treatment.status = models.TreatmentStatus.ONGOING
    elif treatment.status == models.TreatmentStatus.COMPLETED:
        # Everything got undone -- nothing completed at all anymore.
        treatment.status = models.TreatmentStatus.ONGOING

    db.add(treatment)


def update_appointment(
    db: Session,
    appointment_id: int,
    appointment: schemas.AppointmentCreate
):
    db_appointment = (
        db.query(models.Appointment)
        .filter(models.Appointment.id == appointment_id)
        .first()
    )

    if not db_appointment:
        return None

    # Only re-check the slot if the time/duration actually changed --
    # avoids false conflicts against itself and lets status-only edits
    # (e.g. marking Completed) through without a redundant scan. A
    # reactivation from a non-blocking status (Canceled/No-Show) also
    # re-checks, because the slot may have been rebooked meanwhile.
    old_status = db_appointment.status
    reactivating = (
        old_status in NON_BLOCKING_STATUSES
        and appointment.status not in NON_BLOCKING_STATUSES
    )
    time_changed = (
        appointment.appointment_datetime != db_appointment.appointment_datetime
        or appointment.duration_minutes != db_appointment.duration_minutes
    )
    if time_changed or reactivating:
        _check_slot_available(db, appointment, exclude_id=appointment_id)

    linked_session = None
    if db_appointment.session_id:
        linked_session = (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.id == db_appointment.session_id)
            .first()
        )

    new_status = appointment.status

    # ---- Sync the linked session to the appointment's new status ----
    # This REPLACES the old logic that used to fabricate a brand new
    # TreatmentSession (or overwrite an unrelated one found by matching
    # treatment_id + session_number). Now there is exactly one session
    # tied to this appointment, and we just update it in place.
    if linked_session:
        if new_status == models.AppointmentStatus.COMPLETED:
            linked_session.status = models.SessionStatus.COMPLETED
            linked_session.visit_date = appointment.appointment_datetime
            linked_session.duration_minutes = appointment.duration_minutes
            # Only overwrite the label/notes if the appointment carried new
            # ones -- otherwise keep whatever was already recorded on the
            # session (e.g. via the "mark complete" form).
            if appointment.reason:
                linked_session.procedure_done = appointment.reason
            if appointment.notes:
                linked_session.notes = appointment.notes
            db.add(linked_session)

            treatment = (
                db.query(models.Treatment)
                .filter(models.Treatment.id == linked_session.treatment_id)
                .first()
            )
            _recalculate_treatment_progress(db, treatment)

            patient = db.query(models.Patient).filter(
                models.Patient.id == db_appointment.patient_id
            ).first()
            if patient and treatment:
                db.add(models.PatientTimeline(
                    patient_id=patient.id,
                    event_type="Visit Completed",
                    description=(
                        f"Completed {treatment.procedure or 'treatment'} "
                        f"– Session {linked_session.session_number}"
                    )
                ))

        elif new_status in (
            models.AppointmentStatus.CANCELED,
            models.AppointmentStatus.NOSHOW,
        ):
            # The visit didn't happen -- free the session back up so it's
            # obviously waiting to be rescheduled, instead of looking
            # "done" or silently vanishing.
            linked_session.status = models.SessionStatus.UNSCHEDULED
            linked_session.visit_date = None
            db.add(linked_session)

            treatment = (
                db.query(models.Treatment)
                .filter(models.Treatment.id == linked_session.treatment_id)
                .first()
            )
            _recalculate_treatment_progress(db, treatment)

        elif linked_session.status != models.SessionStatus.COMPLETED:
            # Scheduled / In Treatment (plain booking, reschedule, or
            # reactivation after a cancel) -- the visit is on the calendar,
            # keep the session in step with the current time/duration.
            linked_session.status = models.SessionStatus.SCHEDULED
            linked_session.visit_date = appointment.appointment_datetime
            linked_session.duration_minutes = appointment.duration_minutes
            db.add(linked_session)

    # ---- Update the appointment itself ----
    update_data = appointment.model_dump(exclude_unset=True)
    # treatment_id/session_number stay derived from session_id and shouldn't
    # be blindly overwritten by a client edit that didn't touch the link.
    update_data.pop("treatment_id", None)
    update_data.pop("session_number", None)
    update_data.pop("session_id", None)
    for key, value in update_data.items():
        setattr(db_appointment, key, value)

    db.commit()
    db.refresh(db_appointment)
    return db_appointment


def delete_appointment(
    db: Session,
    appointment_id: int
):
    appointment = (
        db.query(models.Appointment)
        .filter(models.Appointment.id == appointment_id)
        .first()
    )

    if not appointment:
        return False

    # Deleting the booking shouldn't erase the session slot -- just
    # free it back up so it can be rescheduled.
    if appointment.session_id:
        session = (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.id == appointment.session_id)
            .first()
        )
        if session and session.status != models.SessionStatus.COMPLETED:
            session.status = models.SessionStatus.UNSCHEDULED
            session.visit_date = None
            db.add(session)

    db.delete(appointment)
    db.commit()

    return True


# =====================================================
# TREATMENTS
# =====================================================

def create_treatment(
    db: Session,
    treatment: schemas.TreatmentCreate
):
    data = treatment.model_dump()
    # session_costs is not a stored column -- it only feeds the spawned
    # placeholder sessions below.
    session_costs = data.pop("session_costs", None) or []
    data["tooth_number"] = data.get("tooth_number") or (
        data["tooth_numbers"][0] if data.get("tooth_numbers") else None
    )

    db_treatment = models.Treatment(
        **data
    )

    db.add(db_treatment)
    db.flush()  # get db_treatment.id

    # Spawn one placeholder session per required session -- these are the
    # "slots" that get scheduled (and later completed) one at a time.
    required = treatment.total_sessions_required or 1
    for i in range(1, required + 1):
        db.add(models.TreatmentSession(
            treatment_id=db_treatment.id,
            session_number=i,
            label=f"Session {i}",
            status=models.SessionStatus.UNSCHEDULED,
            cost=session_costs[i - 1] if i <= len(session_costs) else 0,
        ))

    db.commit()
    db.refresh(db_treatment)

    return db_treatment


def get_patient_treatments(
    db: Session,
    patient_id: int
):
    return (
        db.query(models.Treatment)
        .filter(models.Treatment.patient_id == patient_id)
        .all()
    )


def update_treatment(
    db: Session,
    treatment_id: int,
    treatment: schemas.TreatmentCreate
):
    db_treatment = (
        db.query(models.Treatment)
        .filter(models.Treatment.id == treatment_id)
        .first()
    )

    if not db_treatment:
        return None

    # Ownership never changes through an edit.
    update_data = treatment.model_dump(exclude_unset=True)
    update_data.pop("patient_id", None)

    # Multi-tooth: keep tooth_number in sync with the first listed tooth so
    # anything that still reads the single column keeps working.
    if "tooth_numbers" in update_data:
        teeth = update_data["tooth_numbers"] or []
        update_data["tooth_number"] = teeth[0] if teeth else None

    # session_costs is not a stored column -- apply it to the placeholder
    # session slots (existing + the ones topped up below).
    session_costs = update_data.pop("session_costs", None) or []

    for key, value in update_data.items():
        setattr(db_treatment, key, value)

    # Keep placeholder session slots in sync with total_sessions_required:
    # if the plan grew, top up the missing numbered slots.
    required = db_treatment.total_sessions_required or 1
    existing = (
        db.query(models.TreatmentSession)
        .filter(models.TreatmentSession.treatment_id == db_treatment.id)
        .all()
    )
    existing_numbers = {s.session_number for s in existing}
    for n in range(1, required + 1):
        if n not in existing_numbers:
            db.add(models.TreatmentSession(
                treatment_id=db_treatment.id,
                session_number=n,
                label=f"Session {n}",
                status=models.SessionStatus.UNSCHEDULED,
                cost=session_costs[n - 1] if n <= len(session_costs) else 0,
            ))

    # Push updated per-session costs onto existing slots too (the client
    # sends the full breakdown when the cost plan changes).
    if session_costs:
        for sess in existing:
            if sess.session_number <= len(session_costs):
                sess.cost = session_costs[sess.session_number - 1]
                db.add(sess)

    _recalculate_treatment_progress(db, db_treatment)

    db.commit()
    db.refresh(db_treatment)

    return db_treatment


def delete_treatment(
    db: Session,
    treatment_id: int
):
    treatment = (
        db.query(models.Treatment)
        .filter(models.Treatment.id == treatment_id)
        .first()
    )

    if not treatment:
        return False

    # Any appointments that reference this treatment (directly, or via one
    # of its sessions) shouldn't be deleted -- the visit still happened /
    # is still booked -- just unlinked.
    linked_appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.treatment_id == treatment_id)
        .all()
    )
    for apt in linked_appointments:
        apt.treatment_id = None
        apt.session_id = None
        apt.session_number = None

    # sessions + payments cascade automatically (cascade="all, delete-orphan")
    db.delete(treatment)
    db.commit()

    return True


# =====================================================
# TREATMENT SESSIONS
# =====================================================

def schedule_treatment_session(
    db: Session,
    treatment_id: int,
    visit_date,
    procedure,
    notes
):
    """Legacy convenience helper (kept for the /treatments/{id}/schedule
    route) -- schedules the next unscheduled session for this treatment."""
    treatment = (
        db.query(models.Treatment)
        .filter(models.Treatment.id == treatment_id)
        .first()
    )

    if not treatment:
        raise Exception("Treatment not found")

    # Same overlap rule as every other booking path -- this legacy route
    # must not be able to double-book a slot.
    _check_slot_available(
        db,
        schemas.AppointmentCreate(
            patient_id=treatment.patient_id,
            appointment_datetime=visit_date,
            duration_minutes=30,
        ),
    )

    next_session = (
        db.query(models.TreatmentSession)
        .filter(
            models.TreatmentSession.treatment_id == treatment_id,
            models.TreatmentSession.status == models.SessionStatus.UNSCHEDULED
        )
        .order_by(models.TreatmentSession.session_number)
        .first()
    )

    if not next_session:
        raise Exception("No unscheduled sessions left for this treatment")

    appointment = models.Appointment(
        patient_id=treatment.patient_id,
        treatment_id=treatment.id,
        session_id=next_session.id,
        session_number=next_session.session_number,
        appointment_datetime=visit_date,
        reason=procedure,
        notes=notes,
        duration_minutes=next_session.duration_minutes or 30,
        status=models.AppointmentStatus.SCHEDULED
    )

    db.add(appointment)

    next_session.status = models.SessionStatus.SCHEDULED
    next_session.visit_date = visit_date
    db.add(next_session)

    db.commit()
    db.refresh(appointment)

    return appointment


def create_treatment_session(
    db: Session,
    session: schemas.TreatmentSessionCreate
):
    """Adds an EXTRA session slot to a treatment (e.g. it turned out to
    need more visits than planned). Always creates an Unscheduled
    placeholder -- it does NOT touch appointments. Scheduling/completing
    happens later through the appointment flow, same as any other
    session."""
    treatment = (
        db.query(models.Treatment)
        .filter(models.Treatment.id == session.treatment_id)
        .first()
    )
    if not treatment:
        raise Exception("Treatment not found")

    next_number = session.session_number
    if not next_number:
        highest = (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.treatment_id == treatment.id)
            .order_by(models.TreatmentSession.session_number.desc())
            .first()
        )
        next_number = (highest.session_number + 1) if highest else 1

    duplicate = (
        db.query(models.TreatmentSession)
        .filter(
            models.TreatmentSession.treatment_id == treatment.id,
            models.TreatmentSession.session_number == next_number,
        )
        .first()
    )
    if duplicate:
        raise Exception(
            f"Session {next_number} already exists for this treatment"
        )

    db_session = models.TreatmentSession(
        treatment_id=treatment.id,
        session_number=next_number,
        label=session.label or f"Session {next_number}",
        status=models.SessionStatus.UNSCHEDULED,
        cost=session.cost or 0,
        duration_minutes=session.duration_minutes or 30,
        notes=session.notes,
    )
    db.add(db_session)

    if next_number > treatment.total_sessions_required:
        treatment.total_sessions_required = next_number
        db.add(treatment)

    db.commit()
    db.refresh(db_session)
    return db_session


def update_treatment_session(
    db: Session,
    session_id: int,
    update: schemas.TreatmentSessionUpdate
):
    """General-purpose edit: relabel an unscheduled slot, or record what
    actually happened and mark it Completed directly (walk-ins with no
    calendar entry)."""
    db_session = (
        db.query(models.TreatmentSession)
        .filter(models.TreatmentSession.id == session_id)
        .first()
    )
    if not db_session:
        return None

    update_data = update.model_dump(exclude_unset=True)
    was_completed = db_session.status == models.SessionStatus.COMPLETED
    for key, value in update_data.items():
        setattr(db_session, key, value)

    db.add(db_session)

    treatment = (
        db.query(models.Treatment)
        .filter(models.Treatment.id == db_session.treatment_id)
        .first()
    )
    _recalculate_treatment_progress(db, treatment)

    # Marking a session Completed directly (walk-in) should close out any
    # appointment tied to it, the same way payment completion does --
    # otherwise the calendar keeps showing an open booking for a visit
    # that already happened.
    if (
        not was_completed
        and db_session.status == models.SessionStatus.COMPLETED
    ):
        linked_appointments = (
            db.query(models.Appointment)
            .filter(models.Appointment.session_id == db_session.id)
            .all()
        )
        for apt in linked_appointments:
            if apt.status != models.AppointmentStatus.COMPLETED:
                apt.status = models.AppointmentStatus.COMPLETED
                db.add(apt)

    db.commit()
    db.refresh(db_session)
    return db_session


def get_treatment_sessions(
    db: Session,
    treatment_id: int
):
    return (
        db.query(models.TreatmentSession)
        .filter(models.TreatmentSession.treatment_id == treatment_id)
        .order_by(models.TreatmentSession.session_number)
        .all()
    )


def delete_treatment_session(
    db: Session,
    session_id: int
):
    session = (
        db.query(models.TreatmentSession)
        .filter(models.TreatmentSession.id == session_id)
        .first()
    )

    if not session:
        return False

    # Don't leave appointments pointing at a session that no longer exists.
    linked_appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.session_id == session_id)
        .all()
    )
    for apt in linked_appointments:
        apt.session_id = None

    treatment = session.treatment
    db.delete(session)
    db.flush()
    _recalculate_treatment_progress(db, treatment)

    db.commit()

    return True


# =====================================================
# TOOTH RECORDS
# =====================================================

def create_tooth_record(
    db: Session,
    tooth: schemas.ToothRecordCreate
):
    db_tooth = models.ToothRecord(
        **tooth.model_dump()
    )

    db.add(db_tooth)
    db.commit()
    db.refresh(db_tooth)

    return db_tooth


def get_patient_teeth(
    db: Session,
    patient_id: int
):
    return (
        db.query(models.ToothRecord)
        .filter(models.ToothRecord.patient_id == patient_id)
        .all()
    )


def update_tooth_record(
    db: Session,
    tooth_id: int,
    tooth: schemas.ToothRecordCreate
):
    db_tooth = (
        db.query(models.ToothRecord)
        .filter(models.ToothRecord.id == tooth_id)
        .first()
    )

    if not db_tooth:
        return None

    # Ownership never changes through an edit -- only explicitly-sent
    # fields are applied (no mass-assignment of patient_id).
    update_data = tooth.model_dump(exclude_unset=True)
    update_data.pop("patient_id", None)
    for key, value in update_data.items():
        setattr(db_tooth, key, value)

    db.commit()
    db.refresh(db_tooth)
    return db_tooth


# =====================================================
# PAYMENTS
# =====================================================

def create_payment(
    db: Session,
    payment: schemas.PaymentCreate
):
    db_payment = models.Payment(
        **payment.model_dump()
    )

    db.add(db_payment)
    db.flush()  # get db_payment.id

    # Recording a Completed payment for a session IS the completing step:
    # mark the session done right here so the clinic doesn't need a separate
    # "mark session complete" action afterwards.
    linked_session = None
    if payment.session_id:
        linked_session = (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.id == payment.session_id)
            .first()
        )

    if linked_session:
        if db_payment.treatment_id is None:
            db_payment.treatment_id = linked_session.treatment_id

        if payment.status == "Completed":
            linked_session.status = models.SessionStatus.COMPLETED
            if linked_session.visit_date is None and payment.payment_date:
                linked_session.visit_date = payment.payment_date
            if not linked_session.cost and payment.amount:
                linked_session.cost = payment.amount
            db.add(linked_session)

            treatment = (
                db.query(models.Treatment)
                .filter(models.Treatment.id == linked_session.treatment_id)
                .first()
            )
            _recalculate_treatment_progress(db, treatment)

            # The visit is done once it is paid for: close out any
            # appointment tied to this session as well.
            linked_appointments = db.query(models.Appointment).filter(
                models.Appointment.session_id == linked_session.id
            ).all()
            for apt in linked_appointments:
                if apt.status != models.AppointmentStatus.COMPLETED:
                    apt.status = models.AppointmentStatus.COMPLETED
                    db.add(apt)

    db.commit()
    db.refresh(db_payment)

    return db_payment


def get_patient_payments(
    db: Session,
    patient_id: int
):
    return (
        db.query(models.Payment)
        .filter(models.Payment.patient_id == patient_id)
        .all()
    )


def get_payments(
    db: Session,
    skip: int = 0,
    limit: int = 10000
):
    return (
        db.query(models.Payment)
        .order_by(models.Payment.payment_date.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def delete_payment(
    db: Session,
    payment_id: int
):
    payment = (
        db.query(models.Payment)
        .filter(models.Payment.id == payment_id)
        .first()
    )

    if not payment:
        return False

    # Deleting a payment may undo a session's completion: if the session
    # was only completed because of this payment, drop it back to
    # UNSCHEDULED so the visit isn't silently still marked done.
    if payment.session_id and payment.status == "Completed":
        linked_session = (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.id == payment.session_id)
            .first()
        )
        if linked_session and linked_session.status == models.SessionStatus.COMPLETED:
            still_paid = (
                db.query(models.Payment)
                .filter(
                    models.Payment.session_id == payment.session_id,
                    models.Payment.status == "Completed",
                    models.Payment.id != payment.id,
                )
                .first()
            )
            completed_appt = (
                db.query(models.Appointment)
                .filter(
                    models.Appointment.session_id == payment.session_id,
                    models.Appointment.status == models.AppointmentStatus.COMPLETED,
                )
                .first()
            )
            # Only undo the session if this payment was its sole source of
            # completion -- a completed visit may also be paid by another
            # payment or marked done via its appointment.
            if not still_paid and not completed_appt:
                linked_session.status = models.SessionStatus.UNSCHEDULED
                linked_session.visit_date = None
                db.add(linked_session)

                treatment = linked_session.treatment
                _recalculate_treatment_progress(db, treatment)

    db.delete(payment)
    db.commit()

    return True


def update_payment(
    db: Session,
    payment_id: int,
    payment_update: schemas.PaymentUpdate
):
    db_payment = db.query(models.Payment).filter(models.Payment.id == payment_id).first()
    if not db_payment:
        return None

    update_data = payment_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_payment, key, value)

    # Settling a pending payment is also "recording" it: complete the
    # linked session (and its appointment) the same way create_payment does.
    if db_payment.status == "Completed" and db_payment.session_id:
        linked_session = (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.id == db_payment.session_id)
            .first()
        )
        if linked_session and linked_session.status != models.SessionStatus.COMPLETED:
            linked_session.status = models.SessionStatus.COMPLETED
            if linked_session.visit_date is None and db_payment.payment_date:
                linked_session.visit_date = db_payment.payment_date
            if not linked_session.cost and db_payment.amount:
                linked_session.cost = db_payment.amount
            db.add(linked_session)

            treatment = (
                db.query(models.Treatment)
                .filter(models.Treatment.id == linked_session.treatment_id)
                .first()
            )
            _recalculate_treatment_progress(db, treatment)

            linked_appointments = db.query(models.Appointment).filter(
                models.Appointment.session_id == linked_session.id
            ).all()
            for apt in linked_appointments:
                if apt.status != models.AppointmentStatus.COMPLETED:
                    apt.status = models.AppointmentStatus.COMPLETED
                    db.add(apt)

    db.commit()
    db.refresh(db_payment)
    return db_payment


# =====================================================
# FINANCIAL SUMMARY
# =====================================================

def get_financial_summary(db: Session):
    """
    Return aggregated financial stats:
    - total_collected   (completed payments, net of discount)
    - total_billed      (cost of delivered treatments -- Canceled excluded)
    - total_outstanding (billed minus collected)
    - total_pending     (payments still marked Pending)
    - collection_rate   (collected / billed)
    - discounts_given   (discounts applied to completed payments)
    - sessions_completed / avg_per_visit
    - aging             (outstanding aged by when each treatment was delivered)
    - patient_balances  (list of {patient_id, full_name, balance})
    """
    from sqlalchemy import func
    from datetime import datetime, timezone

    net_payment = (
        models.Payment.amount
        - func.coalesce(models.Payment.discount, 0)
    )

    # Total collected (completed payments) -- net of any discount.
    total_collected = (
        db.query(models.Payment)
        .filter(models.Payment.status == "Completed")
        .with_entities(func.sum(net_payment))
        .scalar() or 0.0
    )

    total_pending = (
        db.query(models.Payment)
        .filter(models.Payment.status == "Pending")
        .with_entities(func.sum(net_payment))
        .scalar() or 0.0
    )

    discounts_given = (
        db.query(models.Payment)
        .filter(models.Payment.status == "Completed")
        .with_entities(func.sum(func.coalesce(models.Payment.discount, 0)))
        .scalar() or 0.0
    )

    # Billed = the cost of treatments that actually happened (or are
    # happening) -- a canceled treatment was never delivered, so it has
    # nothing to collect against.
    delivered_treatments = db.query(models.Treatment).filter(
        models.Treatment.status != models.TreatmentStatus.CANCELED
    )
    total_billed = (
        delivered_treatments.with_entities(
            func.sum(models.Treatment.total_cost)
        ).scalar() or 0.0
    )

    sessions_completed = (
        db.query(models.TreatmentSession)
        .join(models.Treatment)
        .filter(
            models.TreatmentSession.status == models.SessionStatus.COMPLETED,
            models.Treatment.status != models.TreatmentStatus.CANCELED,
        )
        .count()
    )

    total_outstanding = max(total_billed - total_collected, 0.0)
    collection_rate = 0.0
    if total_billed > 0:
        collection_rate = (total_collected / total_billed) * 100
    avg_per_visit = 0.0
    if sessions_completed > 0:
        avg_per_visit = total_collected / sessions_completed

    # Aging of the true receivable: each delivered treatment's remaining
    # balance, aged from when it was delivered (completed_date when set,
    # otherwise start_date). Payments net of discount, per treatment.
    treatment_totals = (
        db.query(
            models.Treatment.id,
            models.Treatment.total_cost,
            func.coalesce(
                models.Treatment.completed_date,
                models.Treatment.start_date,
            ).label('billed_at'),
        )
        .filter(models.Treatment.status != models.TreatmentStatus.CANCELED)
        .subquery()
    )
    payment_totals = (
        db.query(
            models.Payment.treatment_id,
            func.sum(net_payment).label('paid'),
        )
        .filter(
            models.Payment.status == "Completed",
            models.Payment.treatment_id.isnot(None),
        )
        .group_by(models.Payment.treatment_id)
        .subquery()
    )
    aged_rows = (
        db.query(
            treatment_totals.c.total_cost,
            treatment_totals.c.billed_at,
            func.coalesce(payment_totals.c.paid, 0).label('paid'),
        )
        .outerjoin(payment_totals, payment_totals.c.treatment_id == treatment_totals.c.id)
        .all()
    )
    aging = {"0-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
    now = datetime.now(timezone.utc)
    for row in aged_rows:
        outstanding = max(row.total_cost - row.paid, 0.0)
        if outstanding <= 0 or row.billed_at is None:
            continue
        # SQLite returns naive datetimes -- make the comparison tz-safe.
        billed_at = row.billed_at
        if billed_at.tzinfo is None:
            billed_at = billed_at.replace(tzinfo=timezone.utc)
        days = max((now - billed_at).days, 0)
        if days <= 30:
            aging["0-30"] += outstanding
        elif days <= 60:
            aging["31-60"] += outstanding
        elif days <= 90:
            aging["61-90"] += outstanding
        else:
            aging["90+"] += outstanding

    # Patient balances – sum of treatment costs minus paid amounts.
    # Aggregate each side in its own subquery first -- a naive double
    # outer join against Treatment and Payment multiplies rows (cartesian),
    # inflating both sums.
    treatment_totals = (
        db.query(
            models.Treatment.patient_id,
            func.sum(models.Treatment.total_cost).label('total_cost')
        )
        .filter(models.Treatment.status != models.TreatmentStatus.CANCELED)
        .group_by(models.Treatment.patient_id)
        .subquery()
    )
    payment_totals = (
        db.query(
            models.Payment.patient_id,
            func.sum(net_payment).label('paid')
        )
        .filter(models.Payment.status == "Completed")
        .group_by(models.Payment.patient_id)
        .subquery()
    )

    patient_balances = (
        db.query(
            models.Patient.id,
            models.Patient.first_name,
            models.Patient.last_name,
            func.coalesce(treatment_totals.c.total_cost, 0).label('total_cost'),
            func.coalesce(payment_totals.c.paid, 0).label('paid')
        )
        .outerjoin(treatment_totals, treatment_totals.c.patient_id == models.Patient.id)
        .outerjoin(payment_totals, payment_totals.c.patient_id == models.Patient.id)
        .all()
    )

    balance_list = [
        {
            "patient_id": row.id,
            "first_name": row.first_name,
            "last_name": row.last_name,
            "balance": row.total_cost - row.paid
        }
        for row in patient_balances
        if row.total_cost - row.paid > 0
    ]

    return {
        "total_collected": total_collected,
        "total_pending": total_pending,
        "total_billed": total_billed,
        "total_outstanding": total_outstanding,
        "collection_rate": collection_rate,
        "discounts_given": discounts_given,
        "sessions_completed": sessions_completed,
        "avg_per_visit": avg_per_visit,
        "aging": aging,
        "patient_balances": balance_list
    }


# =====================================================
# DOCUMENTS
# =====================================================

def create_document(
    db: Session,
    document: schemas.PatientDocumentCreate
):
    db_doc = models.PatientDocument(
        **document.model_dump()
    )

    db.add(db_doc)
    db.commit()
    db.refresh(db_doc)

    return db_doc


def get_patient_documents(
    db: Session,
    patient_id: int
):
    return (
        db.query(models.PatientDocument)
        .filter(models.PatientDocument.patient_id == patient_id)
        .all()
    )


def get_document_by_id(
    db: Session,
    document_id: int
):
    return (
        db.query(models.PatientDocument)
        .filter(models.PatientDocument.id == document_id)
        .first()
    )


def delete_document(
    db: Session,
    document_id: int
):
    db.query(models.PatientDocument).filter(
        models.PatientDocument.id == document_id
    ).delete()
    db.commit()


# =====================================================
# TIMELINE
# =====================================================

def create_timeline_event(
    db: Session,
    event: schemas.PatientTimelineCreate
):
    db_event = models.PatientTimeline(
        **event.model_dump()
    )

    db.add(db_event)
    db.commit()
    db.refresh(db_event)

    return db_event


def get_patient_timeline(
    db: Session,
    patient_id: int
):
    return (
        db.query(models.PatientTimeline)
        .filter(models.PatientTimeline.patient_id == patient_id)
        .order_by(models.PatientTimeline.created_at.desc())
        .all()
    )

# =====================================================
# USERS / AUTH
# =====================================================

def get_user_by_email(db: Session, email: str):
    return (
        db.query(models.User)
        .filter(models.User.email == email.strip().lower())
        .first()
    )


def get_user_by_id(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()


def create_user(
    db: Session,
    email: str,
    password_hash: str,
    role: str = models.UserRole.USER.value,
    is_approved: bool = True,
):
    user = models.User(
        email=email.strip().lower(),
        password_hash=password_hash,
        role=role,
        is_active=True,
        is_approved=is_approved,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_users(
    db: Session,
    skip: int = 0,
    limit: int = 100,
):
    return (
        db.query(models.User)
        .order_by(models.User.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_pending_users(
    db: Session,
    skip: int = 0,
    limit: int = 100,
):
    """Accounts that registered themselves but have not been approved yet."""
    return (
        db.query(models.User)
        .filter(models.User.is_approved.is_(False))
        .order_by(models.User.created_at.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def count_pending_users(db: Session) -> int:
    return (
        db.query(models.User)
        .filter(models.User.is_approved.is_(False))
        .count()
    )


def set_user_approved(
    db: Session,
    user_id: int,
    approved_by_user_id: int,
):
    user = get_user_by_id(db, user_id)
    if user is None:
        return None
    user.is_approved = True
    user.approved_at = datetime.now(timezone.utc)
    user.approved_by_user_id = approved_by_user_id
    db.commit()
    db.refresh(user)
    return user


def count_admins(db: Session) -> int:
    return (
        db.query(models.User)
        .filter(models.User.role == models.UserRole.ADMIN.value)
        .count()
    )


def delete_user(db: Session, user: models.User):
    db.delete(user)
    db.commit()


# =====================================================
# AUDIT LOG
# =====================================================

import hashlib
import hmac
import os

# HMAC key for the audit chain. Separate from JWT so a leaked JWT secret
# can't be used to forge audit entries.
AUDIT_HMAC_KEY = os.getenv("AUDIT_HMAC_KEY", "").encode("utf-8") or os.getenv(
    "JWT_SECRET", "dev-audit-key-change-me"
).encode("utf-8")

# Timestamps must hash identically at write and verify time. SQLite stores
# naive datetimes, so serialize with an explicit tz-free format.
def _chain_ts(dt) -> str:
    if dt is None:
        return ""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _audit_hash(
    prev_hash, user_id, user_email, action, resource,
    resource_id, details, ip_address, created_at,
) -> str:
    canonical = "|".join(
        str(x) if x is not None else ""
        for x in (
            prev_hash or "", user_id, user_email, action, resource,
            resource_id, details, ip_address, _chain_ts(created_at),
        )
    )
    return hmac.new(AUDIT_HMAC_KEY, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def log_action(
    db: Session,
    user: Optional[models.User],
    action: str,
    resource: Optional[str] = None,
    resource_id: Optional[int] = None,
    details: Optional[str] = None,
    ip_address: Optional[str] = None,
):
    created_at = datetime.now(timezone.utc)
    last = (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.id.desc())
        .first()
    )
    prev_hash = last.entry_hash if last else None
    entry_hash = _audit_hash(
        prev_hash,
        user.id if user else None,
        user.email if user else None,
        action,
        resource,
        resource_id,
        details,
        ip_address,
        created_at,
    )
    entry = models.AuditLog(
        user_id=user.id if user else None,
        user_email=user.email if user else None,
        action=action,
        resource=resource,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
        prev_hash=prev_hash,
        entry_hash=entry_hash,
        created_at=created_at,
    )
    db.add(entry)
    db.commit()


def verify_audit_chain(db: Session) -> dict:
    """Replays the stored chain and reports whether it is intact.

    Legacy entries (written before chaining existed) are skipped; a gap
    after them is expected. Returns {valid, checked, skipped}."""
    rows = (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.id.asc())
        .all()
    )
    prev_hash = None
    checked = 0
    skipped = 0
    for row in rows:
        if row.entry_hash is None:
            # Pre-chaining entry -- the chain (re)starts after it.
            prev_hash = None
            skipped += 1
            continue
        expected = _audit_hash(
            prev_hash,
            row.user_id, row.user_email, row.action, row.resource,
            row.resource_id, row.details, row.ip_address, row.created_at,
        )
        if row.entry_hash != expected or row.prev_hash != prev_hash:
            return {"valid": False, "checked": checked, "skipped": skipped}
        prev_hash = row.entry_hash
        checked += 1
    return {"valid": True, "checked": checked, "skipped": skipped}


def get_audit_logs(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    search: Optional[str] = None,
):
    query = db.query(models.AuditLog)

    if action:
        query = query.filter(models.AuditLog.action == action)
    if user_id:
        query = query.filter(models.AuditLog.user_id == user_id)
    if search:
        term = f"%{search}%"
        query = query.filter(
            (models.AuditLog.user_email.ilike(term)) |
            (models.AuditLog.resource.ilike(term)) |
            (models.AuditLog.details.ilike(term))
        )

    return (
        query
        .order_by(models.AuditLog.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def count_audit_logs(db: Session) -> int:
    return db.query(models.AuditLog).count()


def set_user_role(
    db: Session,
    user_id: int,
    role: str,
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        return None
    user.role = role
    db.commit()
    db.refresh(user)
    return user


def set_user_password(
    db: Session,
    user_id: int,
    password_hash: str,
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        return None
    user.password_hash = password_hash
    db.commit()
    db.refresh(user)
    return user


def set_user_settings(
    db: Session,
    user_id: int,
    role_label: Optional[str] = None,
    permissions: Optional[List[str]] = None,
):
    """Update a user's access settings (job title label + allowed pages).
    Only the explicitly-provided fields are touched."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        return None

    if role_label is not None:
        user.role_label = role_label.strip() or None
    if permissions is not None:
        user.permissions = permissions

    db.commit()
    db.refresh(user)
    return user


def update_self_profile(
    db: Session,
    user: models.User,
    role_label: Optional[str] = None,
    email: Optional[str] = None,
):
    """Update the profile fields a user may change about themselves.

    Returns the updated user. Raises ValueError when the new email is
    already taken by another account."""
    if role_label is not None:
        user.role_label = role_label.strip() or None
    if email is not None:
        email = email.strip().lower()
        if not email:
            raise ValueError("Email cannot be empty")
        taken = (
            db.query(models.User)
            .filter(models.User.email == email, models.User.id != user.id)
            .first()
        )
        if taken is not None:
            raise ValueError("Email already in use")
        user.email = email

    db.commit()
    db.refresh(user)
    return user


def set_user_password(db: Session, user_id: int, password_hash: str):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        return None
    user.password_hash = password_hash
    db.commit()
    db.refresh(user)
    return user


# =====================================================
# ADMIN STATS
# =====================================================

def get_admin_stats(db: Session) -> dict:
    """Aggregates used by the admin overview: entity counts, revenue
    totals, user role split, recent registrations and revenue series."""
    from sqlalchemy import func

    def count(model):
        return db.query(model).count()

    def sum_collected(since: Optional[datetime] = None):
        query = db.query(models.Payment).filter(
            models.Payment.status == "Completed"
        )
        if since is not None:
            query = query.filter(models.Payment.payment_date >= since)
        return query.with_entities(
            func.sum(models.Payment.amount - func.coalesce(models.Payment.discount, 0))
        ).scalar() or 0.0

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    month_ago = now - timedelta(days=30)

    # User role split
    users = db.query(models.User).all()
    admins = sum(1 for u in users if u.role == models.UserRole.ADMIN.value)

    # Registrations per day for the last 30 days (UTC date grouping).
    day = func.date(models.User.created_at)
    registrations = dict(
        db.query(day, func.count(models.User.id))
        .filter(models.User.created_at >= month_ago)
        .group_by(day)
        .all()
    )

    # Revenue per day for the last 30 days (completed payments).
    pday = func.date(models.Payment.payment_date)
    revenue = dict(
        db.query(pday, func.sum(
            models.Payment.amount - func.coalesce(models.Payment.discount, 0)
        ))
        .filter(
            models.Payment.status == "Completed",
            models.Payment.payment_date >= month_ago,
        )
        .group_by(pday)
        .all()
    )

    # Appointments per status.
    statuses = dict(
        db.query(models.Appointment.status, func.count(models.Appointment.id))
        .group_by(models.Appointment.status)
        .all()
    )
    status_counts = {}
    for s in models.AppointmentStatus:
        status_counts[s.value] = int(statuses.get(s, 0))

    today_start = datetime.combine(
        now.date(), datetime.min.time()
    )
    today_appointments = (
        db.query(models.Appointment)
        .filter(models.Appointment.appointment_datetime >= today_start)
        .count()
    )

    return {
        "users": len(users),
        "admins": admins,
        "patients": count(models.Patient),
        "appointments": count(models.Appointment),
        "today_appointments": today_appointments,
        "treatments": count(models.Treatment),
        "sessions_completed": (
            db.query(models.TreatmentSession)
            .filter(models.TreatmentSession.status == models.SessionStatus.COMPLETED)
            .count()
        ),
        "payments": count(models.Payment),
        "documents": count(models.PatientDocument),
        "total_collected": sum_collected(),
        "collected_30d": sum_collected(month_ago),
        "appointment_status_counts": status_counts,
        "registrations_30d": dict(registrations),
        "revenue_30d": {str(k): float(v) for k, v in revenue.items()},
        "audit_events": count_audit_logs(db),
        "pending_approvals": count_pending_users(db),
    }
