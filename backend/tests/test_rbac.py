"""RBAC: anonymous 401s, patient-role 403s, staff access, admin-only
endpoints, security headers."""

import models
import crud
from database import SessionLocal
from tests.conftest import _make_user, login_as


def test_anonymous_rejected_everywhere(client):
    for path in (
        "/patients/?limit=2",
        "/appointments/",
        "/appointments/today",
        "/financials/summary",
        "/admin/users",
        "/admin/stats",
    ):
        assert client.get(path).status_code == 401, path


def test_anonymous_mutations_rejected(client):
    assert client.post("/patients/", json={}).status_code == 401
    assert client.delete("/admin/users/1").status_code == 401


def test_non_staff_role_blocked_from_clinic_data(client):
    # Roles outside STAFF_ROLES (e.g. a leftover/invalid assignment) must
    # never reach clinical/financial data.
    _make_user("outsider@test.local", "password123", "guest")
    h = login_as(client, "outsider@test.local", "password123")
    for path in (
        "/patients/?limit=2",
        "/appointments/",
        "/financials/summary",
        "/admin/users",
    ):
        assert client.get(path, headers=h).status_code == 403, path


def test_staff_roles_access_clinic_data(client):
    for role in (
        models.UserRole.DENTIST.value,
        models.UserRole.HYGIENIST.value,
        models.UserRole.RECEPTIONIST.value,
    ):
        email = f"{role}@test.local"
        _make_user(email, "password123", role)
        h = login_as(client, email, "password123")
        assert client.get("/patients/?limit=2", headers=h).status_code == 200, role
        assert client.get("/appointments/", headers=h).status_code == 200, role
        assert client.get("/financials/summary", headers=h).status_code == 200, role
        # ...but never the admin panel
        assert client.get("/admin/users", headers=h).status_code == 403, role


def test_admin_has_full_access(client):
    _make_user("boss@test.local", "password123", models.UserRole.ADMIN.value)
    h = login_as(client, "boss@test.local", "password123")
    assert client.get("/patients/?limit=2", headers=h).status_code == 200
    assert client.get("/admin/users", headers=h).status_code == 200
    assert client.get("/admin/stats", headers=h).status_code == 200


def test_non_admin_cannot_change_roles(client):
    _make_user("worker@test.local", "password123", models.UserRole.RECEPTIONIST.value)
    h = login_as(client, "worker@test.local", "password123")
    r = client.put("/admin/users/1/role", json={"role": "admin"}, headers=h)
    assert r.status_code == 403


def test_admin_can_assign_any_valid_role(client):
    """The admin panel offers all staff roles -- the API must accept them
    (previously only user/admin were allowed, breaking the UI with 422)."""
    _make_user("boss2@test.local", "password123", models.UserRole.ADMIN.value)
    h = login_as(client, "boss2@test.local", "password123")
    _make_user("promote@test.local", "password123", "guest")

    target_id = crud.get_user_by_email(SessionLocal(), "promote@test.local").id
    for role in ("dentist", "hygienist", "receptionist"):
        r = client.put(
            f"/admin/users/{target_id}/role",
            json={"role": role},
            headers=h,
        )
        assert r.status_code == 200, (role, r.text)

    # Unknown roles are still rejected.
    r = client.put(f"/admin/users/{target_id}/role", json={"role": "superuser"}, headers=h)
    assert r.status_code == 422


def test_register_endpoint_public(client):
    assert client.get("/auth/me").status_code == 401


def test_security_headers_present(client):
    r = client.get("/auth/me")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert r.headers["permissions-policy"]
    assert r.headers["strict-transport-security"].startswith(
        "max-age=63072000"
    )


def test_cors_wildcard_forbidden(client):
    """CORS must not echo a wildcard origin back."""
    r = client.get(
        "/auth/me",
        headers={"Origin": "https://evil.example.com"},
    )
    assert "access-control-allow-origin" not in r.headers


def test_guest_cannot_read_patient_records(client):
    """Non-staff accounts have no object-level read access at all (the
    legacy patient portal is gone; every role is now staff)."""
    _make_user("scoped@test.local", "password123", models.UserRole.ADMIN.value)
    staff = login_as(client, "scoped@test.local", "password123")
    _make_user("outsider2@test.local", "password123", "guest")

    own = client.post(
        "/patients/",
        headers=staff,
        json={"first_name": "Alice", "last_name": "Own"},
    ).json()

    h = login_as(client, "outsider2@test.local", "password123")
    assert client.get(f"/patients/{own['id']}", headers=h).status_code == 403
    assert client.get(f"/patients/{own['id']}/appointments", headers=h).status_code == 403
    assert client.get("/patients/?limit=2", headers=h).status_code == 403
    assert client.get("/appointments/today", headers=h).status_code == 403
    assert client.delete(f"/patients/{own['id']}", headers=h).status_code == 403

    # Staff access is unaffected.
    assert client.get(f"/patients/{own['id']}", headers=staff).status_code == 200
