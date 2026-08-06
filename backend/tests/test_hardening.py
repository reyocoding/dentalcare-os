"""Tamper-evident audit chain, per-account lockout, admin-only patient
linking, tooth ownership protection, opt-in read auditing."""

import models
import crud
from database import SessionLocal
from tests.conftest import _make_user, login_as


def test_audit_entries_are_hash_chained(client):
    _make_user("chain@test.local", "password123", models.UserRole.ADMIN.value)
    h = login_as(client, "chain@test.local", "password123")
    client.post(
        "/patients/",
        headers=h,
        json={"first_name": "Chain", "last_name": "Test"},
    )

    db = SessionLocal()
    try:
        rows = db.query(models.AuditLog).order_by(models.AuditLog.id.asc()).all()
        chained = [r for r in rows if r.entry_hash]
        assert chained, "expected at least one hash-chained entry"
        for i in range(1, len(chained)):
            assert chained[i].prev_hash == chained[i - 1].entry_hash
        assert crud.verify_audit_chain(db)["valid"] is True
    finally:
        db.close()


def test_tampered_audit_entry_detected(client):
    _make_user("tamper@test.local", "password123", models.UserRole.ADMIN.value)
    h = login_as(client, "tamper@test.local", "password123")
    client.post(
        "/patients/",
        headers=h,
        json={"first_name": "Tamper", "last_name": "Target"},
    )

    db = SessionLocal()
    try:
        target = (
            db.query(models.AuditLog)
            .filter(models.AuditLog.action == "post")
            .order_by(models.AuditLog.id.desc())
            .first()
        )
        assert target is not None
        target.details = "edited by an attacker"
        db.commit()
        assert crud.verify_audit_chain(db)["valid"] is False
    finally:
        db.close()


def test_account_lockout_after_failures(client):
    """5 failed logins lock the account for 15 minutes -- even a correct
    password is refused during the lockout."""
    _make_user("lock@test.local", "password123", models.UserRole.DENTIST.value)

    for _ in range(5):
        r = client.post(
            "/auth/login",
            json={"email": "lock@test.local", "password": "wrong-pass"},
        )
        assert r.status_code == 401

    # Correct password, but the account is locked.
    r = client.post(
        "/auth/login",
        json={"email": "lock@test.local", "password": "password123"},
    )
    assert r.status_code == 429
    assert "locked" in r.json()["detail"].lower()


def test_lockout_resets_on_success(client):
    """A successful login clears the failure counter."""
    _make_user("unlock@test.local", "password123", models.UserRole.DENTIST.value)

    for _ in range(3):
        client.post(
            "/auth/login",
            json={"email": "unlock@test.local", "password": "wrong-pass"},
        )
    r = client.post(
        "/auth/login",
        json={"email": "unlock@test.local", "password": "password123"},
    )
    assert r.status_code == 200


def test_only_admin_can_link_patient_account(client):
    _make_user("staff9@test.local", "password123", models.UserRole.DENTIST.value)
    staff = login_as(client, "staff9@test.local", "password123")
    _make_user("admin9@test.local", "password123", models.UserRole.ADMIN.value)
    admin = login_as(client, "admin9@test.local", "password123")
    uid = _make_user("linkee@test.local", "password123", models.UserRole.RECEPTIONIST.value)

    # Staff attempt to link -> 403.
    r = client.post(
        "/patients/",
        headers=staff,
        json={"first_name": "Link", "last_name": "Me", "linked_user_id": uid},
    )
    assert r.status_code == 403

    # Admin link succeeds.
    r = client.post(
        "/patients/",
        headers=admin,
        json={"first_name": "Link", "last_name": "Me", "linked_user_id": uid},
    )
    assert r.status_code == 200
    assert r.json()["linked_user_id"] == uid


def test_tooth_record_ownership_cannot_be_moved(client):
    _make_user("tooth@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "tooth@test.local", "password123")

    p1 = client.post(
        "/patients/", headers=h, json={"first_name": "One", "last_name": "Tooth"}
    ).json()
    p2 = client.post(
        "/patients/", headers=h, json={"first_name": "Two", "last_name": "Tooth"}
    ).json()
    tooth = client.post(
        "/teeth/",
        headers=h,
        json={"patient_id": p1["id"], "tooth_number": 14},
    ).json()

    moved = client.put(
        f"/teeth/{tooth['id']}",
        headers=h,
        json={"patient_id": p2["id"], "tooth_number": 14, "condition": "Caries"},
    ).json()
    # Ownership is server-side only -- the attempted move is ignored.
    assert moved["patient_id"] == p1["id"]
    assert moved["condition"] == "Caries"


def test_opt_in_read_auditing(client, monkeypatch):
    import main

    _make_user("reader@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "reader@test.local", "password123")
    client.post(
        "/patients/", headers=h, json={"first_name": "Read", "last_name": "Log"}
    )

    monkeypatch.setattr(main, "AUDIT_LOG_READS", True)
    client.get("/patients/?limit=2", headers=h)

    db = SessionLocal()
    try:
        read = (
            db.query(models.AuditLog)
            .filter(models.AuditLog.action == "get")
            .order_by(models.AuditLog.id.desc())
            .first()
        )
        assert read is not None
        assert read.resource == "patients"
    finally:
        db.close()
