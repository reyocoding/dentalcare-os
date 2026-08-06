"""Admin approval of self-registered accounts.

Flow: /auth/register creates a UNAPPROVED patient account; login is blocked
with 403 until an admin calls POST /admin/users/{id}/approve. All admin
endpoints are admin-only and every approval is recorded in the audit trail.
"""

import models
import crud
from tests.conftest import _make_user, login_as


def _register(client, email: str, password: str = "password123"):
    r = client.post("/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def test_pending_account_cannot_login(client, db):
    user = _register(client, "pending1@test.local")
    r = client.post(
        "/auth/login",
        json={"email": "pending1@test.local", "password": "password123"},
    )
    assert r.status_code == 403
    assert "approval" in r.json()["detail"].lower()
    # No session cookie must be issued for a blocked login.
    assert "set-cookie" not in r.headers
    assert not crud.get_user_by_email(db, "pending1@test.local").is_approved
    assert user["is_approved"] is False


def test_wrong_password_still_hides_account_state(client, db):
    """A pending account must look identical to a bad password (401), so
    the registration status of an email address is not leakable."""
    _register(client, "pending2@test.local")
    r = client.post(
        "/auth/login",
        json={"email": "pending2@test.local", "password": "wrong-pass"},
    )
    assert r.status_code == 401


def test_approve_then_login_succeeds(client, db):
    admin = _make_user("approver@test.local", "password123", models.UserRole.ADMIN.value)
    _register(client, "pending3@test.local")

    # Still blocked before approval.
    assert client.post(
        "/auth/login",
        json={"email": "pending3@test.local", "password": "password123"},
    ).status_code == 403

    headers = login_as(client, "approver@test.local", "password123")
    uid = crud.get_user_by_email(db, "pending3@test.local").id
    r = client.post(f"/admin/users/{uid}/approve", headers=headers)
    assert r.status_code == 200
    assert r.json()["is_approved"] is True
    assert r.json()["approved_at"] is not None

    # Approval is recorded on the user row...
    stored = crud.get_user_by_email(db, "pending3@test.local")
    assert stored.is_approved is True
    assert stored.approved_by_user_id == admin
    assert stored.approved_at is not None

    # ...and the account can finally sign in.
    r = client.post(
        "/auth/login",
        json={"email": "pending3@test.local", "password": "password123"},
    )
    assert r.status_code == 200


def test_pending_list_admin_only(client, db):
    _register(client, "pending4@test.local")
    staff = login_as(client, *_make_staff(client, "staff4@test.local"))
    r = client.get("/admin/users/pending", headers=staff)
    assert r.status_code == 403

    admin = _make_user("plist@test.local", "password123", models.UserRole.ADMIN.value)
    headers = login_as(client, "plist@test.local", "password123")
    r = client.get("/admin/users/pending", headers=headers)
    assert r.status_code == 200
    emails = [u["email"] for u in r.json()]
    assert "pending4@test.local" in emails
    # Staff accounts created by an admin are NOT pending.
    assert "plist@test.local" not in emails


def test_approve_requires_admin(client, db):
    _register(client, "pending5@test.local")
    staff = login_as(client, *_make_staff(client, "staff5@test.local"))
    uid = crud.get_user_by_email(db, "pending5@test.local").id
    r = client.post(f"/admin/users/{uid}/approve", headers=staff)
    assert r.status_code == 403
    assert not crud.get_user_by_email(db, "pending5@test.local").is_approved


def test_approve_unknown_user_404(client, db):
    admin = _make_user("ap404@test.local", "password123", models.UserRole.ADMIN.value)
    headers = login_as(client, "ap404@test.local", "password123")
    r = client.post("/admin/users/999999/approve", headers=headers)
    assert r.status_code == 404


def test_approve_twice_is_400(client, db):
    _register(client, "pending6@test.local")
    admin = _make_user("ap2x@test.local", "password123", models.UserRole.ADMIN.value)
    headers = login_as(client, "ap2x@test.local", "password123")
    uid = crud.get_user_by_email(db, "pending6@test.local").id
    assert client.post(f"/admin/users/{uid}/approve", headers=headers).status_code == 200
    r = client.post(f"/admin/users/{uid}/approve", headers=headers)
    assert r.status_code == 400


def test_approval_written_to_audit_log(client, db):
    _register(client, "pending7@test.local")
    admin = _make_user("apaudit@test.local", "password123", models.UserRole.ADMIN.value)
    headers = login_as(client, "apaudit@test.local", "password123")
    uid = crud.get_user_by_email(db, "pending7@test.local").id
    client.post(f"/admin/users/{uid}/approve", headers=headers)

    logs = crud.get_audit_logs(db, action="register_approved")
    assert any("pending7@test.local" in log.details for log in logs)
    assert all(log.entry_hash for log in logs)  # chained into the tamper-proof audit trail


def test_admin_stats_counts_pending(client, db):
    _register(client, "pending8@test.local")
    admin = _make_user("apstat@test.local", "password123", models.UserRole.ADMIN.value)
    headers = login_as(client, "apstat@test.local", "password123")
    r = client.get("/admin/stats", headers=headers)
    assert r.status_code == 200
    assert r.json()["pending_approvals"] >= 1


def _make_staff(client, email: str):
    _make_user(email, "password123", models.UserRole.DENTIST.value)
    return email, "password123"
