"""
seed_db.py -- generate realistic fake clinic data for testing.

Usage:
    python seed_db.py                # default: 500 patients
    python seed_db.py 2000           # custom patient count
    python seed_db.py 2000 --seed 7  # different random seed
    python seed_db.py --keep-users   # keep existing user accounts

Seeds demo user accounts (unless --keep-users):

    admin@clinic.com     / 9tqrgf5MXABIp3DauGcU+1Tn   (Administrator)
    doctor1@demo.com     / doctor123                  (Dentist)
    hygienist1@demo.com  / hygienist123               (Hygienist)
    secretary1@demo.com  / secretary123               (Receptionist)

This is an internal staff tool -- no patient demo account is seeded.

Everything is generated through the SQLAlchemy models, so the output always
matches the app's current schema (multi-tooth treatments, per-session costs,
title-case status enums, Universal tooth numbering 1-32, ...).
"""

import argparse
import datetime
import os
import random
import time

from faker import Faker

from database import SessionLocal, Base, engine
import models
import auth

# ============================================================================
# CONFIGURATION & CONSTANTS
# ============================================================================
DEFAULT_NUM_PATIENTS = 500
DEFAULT_SEED = 42

MAX_TREATMENTS_PER_PATIENT = 3
MAX_SESSIONS_PER_TREATMENT = 8
MAX_PAYMENTS_PER_TREATMENT = 5

YEARS_BACK = 5
MONTHS_FORWARD = 8

START_DATE = datetime.date.today() - datetime.timedelta(days=YEARS_BACK * 365)
END_DATE = datetime.date.today() + datetime.timedelta(days=MONTHS_FORWARD * 30)

# Age distribution buckets (matches the odontogram age groups)
AGE_GROUPS = ["18-25", "26-29", "30-50", "51-59", "60+"]
AGE_WEIGHTS = [0.20, 0.10, 0.40, 0.10, 0.20]

# Condition pool per age group -- uses the exact ToothCondition enum values
CONDITION_PROBS = {
    "18-25": (["Healthy", "Filling", "Caries", "Other"], [0.70, 0.20, 0.05, 0.05]),
    "26-29": (["Healthy", "Filling", "Caries", "Other"], [0.50, 0.30, 0.10, 0.10]),
    "30-50": (["Healthy", "Filling", "Crown", "Root Canal", "Implant"], [0.30, 0.25, 0.20, 0.15, 0.10]),
    "51-59": (["Healthy", "Filling", "Crown", "Root Canal", "Implant"], [0.20, 0.25, 0.25, 0.15, 0.15]),
    "60+":   (["Healthy", "Crown", "Implant", "Missing", "Root Canal"], [0.10, 0.30, 0.25, 0.20, 0.15]),
}

TREATMENT_TYPES = [
    "Cleaning", "Composite Filling", "Extraction", "Root Canal",
    "Crown", "Implant", "Whitening", "Orthodontics", "Bridge",
]
TREATMENT_WEIGHTS = [0.25, 0.20, 0.15, 0.12, 0.10, 0.08, 0.05, 0.03, 0.02]

TREATMENT_COSTS = {
    "Cleaning": (800, 1500), "Composite Filling": (1500, 3000), "Extraction": (2000, 4000),
    "Root Canal": (7000, 12000), "Crown": (9000, 15000), "Implant": (20000, 45000),
    "Whitening": (3000, 6000), "Orthodontics": (30000, 60000), "Bridge": (20000, 45000),
}

# Title-case values are what the app's SQLAlchemy enums actually accept
APPOINTMENT_STATES = ["Completed", "Scheduled", "In Treatment", "Canceled", "No-Show"]
APPOINTMENT_WEIGHTS = [0.60, 0.20, 0.10, 0.07, 0.03]

PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Insurance"]
PAYMENT_WEIGHTS = [0.50, 0.30, 0.10, 0.10]

DOCUMENT_TYPES = ["Prescription", "XRay", "Insurance", "Consent Form", "Treatment Plan"]

DEMO_USERS = [
    {
        "email": "admin@clinic.com", "password": "9tqrgf5MXABIp3DauGcU+1Tn",
        "role": models.UserRole.ADMIN.value, "role_label": "Administrator",
        "permissions": None,
    },
    {
        "email": "doctor1@demo.com", "password": "doctor123",
        "role": models.UserRole.DENTIST.value, "role_label": "Dentist",
        "permissions": None,
    },
    {
        "email": "hygienist1@demo.com", "password": "hygienist123",
        "role": models.UserRole.HYGIENIST.value, "role_label": "Hygienist",
        "permissions": None,
    },
    {
        "email": "secretary1@demo.com", "password": "secretary123",
        "role": models.UserRole.RECEPTIONIST.value, "role_label": "Receptionist",
        "permissions": None,
    },
]


def parse_args():
    parser = argparse.ArgumentParser(description="Seed the clinic DB with fake data")
    parser.add_argument("count", nargs="?", type=int, default=DEFAULT_NUM_PATIENTS,
                        help=f"number of patients to generate (default {DEFAULT_NUM_PATIENTS})")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="random seed")
    parser.add_argument("--keep-users", action="store_true",
                        help="keep existing user accounts instead of seeding demo users")
    return parser.parse_args()


def get_age_group(age):
    if age <= 25: return "18-25"
    if age <= 29: return "26-29"
    if age <= 50: return "30-50"
    if age <= 59: return "51-59"
    return "60+"


def even_split(total, n):
    """Whole-number split of a cost across n sessions; the remainder goes to
    the first session(s), e.g. 100 / 3 -> [34, 33, 33]."""
    n = max(1, n)
    base, rem = divmod(int(round(total)), n)
    return [base + 1 if i < rem else base for i in range(n)]


def clear_tables(session):
    """Wipe clinic data (child tables first, honouring FK constraints).
    User accounts are preserved unless --keep-users is absent."""
    for table in ["patient_documents", "patient_timeline", "payments",
                  "appointments", "treatment_sessions", "tooth_records",
                  "treatments", "patients"]:
        session.execute(models.Base.metadata.tables[table].delete())
    session.commit()


def seed_users(session):
    # Demo accounts ship known passwords -- only ever create them when
    # explicitly requested (DEMO_MODE=1), never in production.
    if os.getenv("DEMO_MODE", "0") != "1":
        print("  [skip] demo user accounts (set DEMO_MODE=1 to seed them)")
        return
    print("[*] Seeding demo user accounts...")
    for demo in DEMO_USERS:
        session.add(models.User(
            email=demo["email"],
            password_hash=auth.hash_password(demo["password"]),
            role=demo["role"],
            role_label=demo["role_label"],
            permissions=demo["permissions"],
        ))
    session.commit()


def fake_phone(fake):
    """Phone number that passes the app's _PHONE_RE validator
    (^[+]?[\\d\\s\\-().]{6,20}$) -- faker's default formats often contain
    letters/extensions which make the patients list 500."""
    pattern = random.choice(
        ["+###-##-#######", "+###-####-####", "(###) ###-####", "###-###-####"]
    )
    return fake.numerify(pattern)


def generate_patient(fake, random):
    age_group = random.choices(AGE_GROUPS, weights=AGE_WEIGHTS)[0]
    if age_group == "18-25": age = random.randint(18, 25)
    elif age_group == "26-29": age = random.randint(26, 29)
    elif age_group == "30-50": age = random.randint(30, 50)
    elif age_group == "51-59": age = random.randint(51, 59)
    else: age = random.randint(60, 85)

    birth_year = datetime.date.today().year - age
    dob = f"{birth_year}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"

    arrival = START_DATE + datetime.timedelta(days=random.randint(0, (datetime.date.today() - START_DATE).days))

    return models.Patient(
        first_name=fake.first_name(),
        last_name=fake.last_name(),
        gender=random.choice(["Male", "Female"]),
        phone_number=fake_phone(fake),
        email=fake.email(),
        address=fake.address().replace("\n", ", "),
        date_of_birth=dob,
        occupation=fake.job(),
        emergency_contact_name=fake.name(),
        emergency_contact_phone=fake_phone(fake),
        allergies=random.choice([None, None, "Penicillin", "Latex", "Aspirin"]),
        current_medications=random.choice([None, None, "Metformin", "Warfarin", "Lisinopril"]),
        medical_history=random.choice([None, None, "Diabetes", "Hypertension", "Asthma"]),
        notes=random.choice([None, None, "Prefers morning appointments", None, "Anxious patient"]),
        created_at=datetime.datetime.combine(arrival, datetime.time(9, 0)),
    )


def generate_tooth_records(patient, age, random):
    records = []
    cond_pool, cond_weights = CONDITION_PROBS[get_age_group(age)]
    for tooth_num in random.sample(range(1, 33), random.randint(3, 10)):
        condition = random.choices(cond_pool, weights=cond_weights)[0]
        if condition != "Healthy":
            records.append(models.ToothRecord(
                patient=patient,
                tooth_number=tooth_num,
                condition=condition,
                notes="Identified during diagnostic check.",
                treatment_status="Tracked",
            ))
    return records


def generate_treatment(patient, random, today):
    """Build one treatment with sessions, appointments, payments, documents."""
    t_type = random.choices(TREATMENT_TYPES, weights=TREATMENT_WEIGHTS)[0]
    total_cost = random.randint(*TREATMENT_COSTS[t_type])
    req_sessions = min(MAX_SESSIONS_PER_TREATMENT,
                       random.choices([1, 2, 3, 4, 5, 6, 8], weights=[0.35, 0.20, 0.15, 0.10, 0.08, 0.07, 0.05])[0])
    session_costs = even_split(total_cost, req_sessions)

    # Start a few weeks after the patient first came in
    start_date = patient.created_at + datetime.timedelta(days=random.randint(3, 60))

    teeth = [random.randint(1, 32)]
    if random.random() < 0.15:  # multi-tooth treatments (new feature)
        teeth.append(min(32, teeth[0] + random.choice([1, 2])))

    treatment = models.Treatment(
        patient=patient,
        tooth_number=teeth[0],
        tooth_numbers=teeth,
        diagnosis=f"{t_type} required for {random.choice(['decay', 'damage', 'restoration', 'aesthetics'])}.",
        procedure=t_type,
        treatment_plan=random.choice([
            "Complete in staged visits, review at each session.",
            "Restore function and aesthetics over the planned sessions.",
            "Monitor and complete across the scheduled appointments.",
        ]),
        prescribed_medication=random.choice([None, "Amoxicillin 500mg", "Ibuprofen 400mg", None]),
        treatment_notes=random.choice([None, "Patient informed of the plan and costs.", None, None]),
        total_sessions_required=req_sessions,
        sessions_completed=0,
        total_cost=total_cost,
        start_date=start_date,
        status="Ongoing",
    )
    patient.treatments.append(treatment)

    sessions = []
    for idx in range(req_sessions):
        session_num = idx + 1
        visit_date = start_date + datetime.timedelta(weeks=idx)
        is_future = visit_date > today

        if is_future:
            s_status = models.SessionStatus.SCHEDULED.value
            a_status = "Scheduled"
        else:
            a_status = random.choices(APPOINTMENT_STATES, weights=APPOINTMENT_WEIGHTS)[0]
            if a_status == "Completed":
                s_status = models.SessionStatus.COMPLETED.value
            elif a_status in ("Canceled", "No-Show"):
                s_status = models.SessionStatus.CANCELED.value
            else:
                s_status = models.SessionStatus.UNSCHEDULED.value

        session = models.TreatmentSession(
            treatment=treatment,
            session_number=session_num,
            label=f"{t_type} - Session {session_num}",
            status=s_status,
            visit_date=visit_date,
            procedure_done=(t_type if s_status == models.SessionStatus.COMPLETED.value else None),
            notes=random.choice([None, "No complications.", None]),
            cost=session_costs[idx],
            duration_minutes=30,
        )
        sessions.append(session)

        appointment = models.Appointment(
            patient=patient,
            treatment=treatment,
            session=session,
            session_number=session_num,
            appointment_datetime=visit_date,
            duration_minutes=30,
            reason=f"Appointment for {t_type}.",
            priority=random.choices(["Normal", "High", "Low"], weights=[0.8, 0.15, 0.05])[0],
            status=a_status,
        )
        session.appointments.append(appointment)

    completed_count = sum(1 for s in sessions if s.status == models.SessionStatus.COMPLETED.value)
    treatment.sessions_completed = completed_count
    if completed_count == req_sessions:
        treatment.status = models.TreatmentStatus.COMPLETED.value
        treatment.completed_date = sessions[-1].visit_date + datetime.timedelta(hours=1)

    # Payments: sometimes fully paid, sometimes partial, sometimes pending
    pay_state = random.choices(["Completed", "Partial", "Pending"], weights=[0.60, 0.25, 0.15])[0]
    if pay_state == "Completed":
        payouts = random.choices([1, 2, 3], weights=[0.6, 0.3, 0.1])[0]
        amounts = even_split(total_cost, payouts)
        for i in range(payouts):
            p_date = start_date + datetime.timedelta(days=i * 30)
            patient.payments.append(models.Payment(
                patient=patient,
                treatment=treatment,
                amount=amounts[i],
                discount=0,
                payment_date=p_date,
                method=random.choices(PAYMENT_METHODS, weights=PAYMENT_WEIGHTS)[0],
                status="Completed",
            ))
    elif pay_state == "Partial":
        splits = random.randint(2, 3)
        for i in range(splits):
            p_date = start_date + datetime.timedelta(days=i * 30)
            p_status = "Completed" if p_date <= today else "Pending"
            patient.payments.append(models.Payment(
                patient=patient,
                treatment=treatment,
                amount=total_cost // splits,
                discount=0,
                payment_date=p_date,
                method=random.choices(PAYMENT_METHODS, weights=PAYMENT_WEIGHTS)[0],
                status=p_status,
            ))
    else:
        patient.payments.append(models.Payment(
            patient=patient,
            treatment=treatment,
            amount=0,
            discount=0,
            payment_date=start_date,
            method="Cash",
            status="Pending",
        ))

    if random.random() < 0.4:
        doc_type = random.choice(DOCUMENT_TYPES)
        patient.documents.append(models.PatientDocument(
            patient=patient,
            file_name=f"{doc_type.lower().replace(' ', '_')}_record.pdf",
            file_type="pdf",
            file_path=f"/docs/{patient.id}/",
            description="System file.",
            uploaded_at=start_date,
        ))

    return treatment


def generate_timeline(patient, treatments, random):
    events = [models.PatientTimeline(
        patient=patient,
        event_type="Patient Registered",
        description="Successfully registered at the clinic.",
        created_at=patient.created_at,
    )]
    for treatment in treatments:
        events.append(models.PatientTimeline(
            patient=patient,
            event_type="Treatment Started",
            description=f"Treatment setup initialized: {treatment.procedure}.",
            created_at=treatment.start_date,
        ))
    return events


def main():
    args = parse_args()
    num_patients = args.count
    random.seed(args.seed)
    fake = Faker()
    Faker.seed(args.seed)

    print("=" * 80)
    print(f"  DENTAL CLINIC SEEDER - {num_patients} patients (seed {args.seed})")
    print("=" * 80)

    Base.metadata.create_all(engine)
    session = SessionLocal()
    # SQLite-only speed hint; Postgres has no synchronous pragma.
    if engine.dialect.name == "sqlite":
        session.execute(__import__("sqlalchemy").text("PRAGMA synchronous=OFF"))

    clear_tables(session)
    if not args.keep_users:
        session.query(models.User).delete()
        session.commit()
        seed_users(session)
    else:
        print("[*] Keeping existing user accounts.")

    today = datetime.datetime.now()
    start_time = time.time()

    print(f"[*] Generating {num_patients} patient profiles...")
    for i in range(num_patients):
        patient = generate_patient(fake, random)
        birth_year = int(patient.date_of_birth.split("-")[0])
        age = today.year - birth_year

        session.add(patient)
        session.flush()  # get patient.id

        for rec in generate_tooth_records(patient, age, random):
            session.add(rec)

        num_treatments = random.choices([0, 1, 2, 3], weights=[0.35, 0.35, 0.20, 0.10])[0]
        treatments = []
        for _ in range(num_treatments):
            treatment = generate_treatment(patient, random, today)
            treatments.append(treatment)
            session.add(treatment)

        for event in generate_timeline(patient, treatments, random):
            session.add(event)

        if i % 200 == 0:
            session.commit()
            print(f"   ...{i} patients done ({time.time() - start_time:.1f}s)")

    session.commit()
    elapsed = time.time() - start_time

    # ============================================================================
    # REPORT
    # ============================================================================
    def count(tbl):
        return session.query(tbl).count()

    print("\n" + "=" * 80)
    print(" " * 24 + "SEED COMPLETE - DATA DASHBOARD")
    print("=" * 80)

    print("\n------------------- DATABASE COUNTS -------------------")
    labels = [
        ("Users", models.User), ("Patients", models.Patient),
        ("Treatments", models.Treatment), ("Treatment Sessions", models.TreatmentSession),
        ("Appointments", models.Appointment), ("Payments", models.Payment),
        ("Tooth Records", models.ToothRecord), ("Documents", models.PatientDocument),
        ("Timeline Events", models.PatientTimeline),
    ]
    for name, tbl in labels:
        print(f" {name:<22}: {count(tbl):,}")

    print("\n------------------- FINANCIAL SUMMARY -------------------")
    total_billed = session.query(models.Payment).count()
    total_collected = session.query(models.Payment).filter(models.Payment.status == "Completed").count()
    print(f" Total Payments       : {total_billed:,}")
    print(f" Completed Payments   : {total_collected:,}")

    print("\n------------------- UPCOMING APPOINTMENTS -------------------")
    upcoming = (
        session.query(models.Appointment)
        .filter(models.Appointment.appointment_datetime > today)
        .order_by(models.Appointment.appointment_datetime)
        .limit(5)
        .all()
    )
    if upcoming:
        for a in upcoming:
            print(f" {a.appointment_datetime:%Y-%m-%d %H:%M}  |  {a.patient.first_name} {a.patient.last_name:<16} | {a.reason}")
    else:
        print(" No upcoming appointments.")

    print("\n------------------- TOP PROCEDURES -------------------")
    from sqlalchemy import func
    top = (
        session.query(models.Treatment.procedure, func.count(models.Treatment.id))
        .group_by(models.Treatment.procedure)
        .order_by(func.count(models.Treatment.id).desc())
        .limit(3)
        .all()
    )
    for idx, (proc, c) in enumerate(top, 1):
        print(f" {idx}. {proc:<20} ({c:,} performed)")

    if not args.keep_users:
        print("\n------------------- DEMO ACCOUNTS -------------------")
        for demo in DEMO_USERS:
            print(f" {demo['email']:<24} / {demo['password']:<12} ({demo['role_label']})")

    print("\n" + "=" * 80)
    print(f" Finished in {elapsed:.2f} seconds.")
    print("=" * 80)

    session.close()


if __name__ == "__main__":
    main()
