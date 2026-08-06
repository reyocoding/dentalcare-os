"""Auth flows: password hashing, token lifecycle, cookie rotation,
rate limiting."""

import models
import crud
import auth
from tests.conftest import _make_user, login_as


def test_password_hash_is_argon2id(db):
    h = auth.hash_password("hunter2-hunter2")
    assert h.startswith("$argon2id$")
    assert auth.verify_password("hunter2-hunter2", h)
    assert not auth.verify_password("wrong", h)
    assert not auth.needs_rehash(h)


def test_legacy_bcrypt_hash_still_verifies(db):
    legacy = auth._pwd_context.hash("oldpass1", scheme="bcrypt")
    assert auth.verify_password("oldpass1", legacy)
    assert auth.needs_rehash(legacy)


def test_login_sets_httponly_cookie(client, db):
    _make_user("cookie@test.local", "password123", models.UserRole.ADMIN.value)
    r = client.post(
        "/auth/login",
        json={"email": "cookie@test.local", "password": "password123"},
    )
    assert r.status_code == 200
    set_cookie = r.headers["set-cookie"].lower()
    assert "refresh_token=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    # conftest sets COOKIE_SECURE=0 for plain-HTTP test clients; production
    # defaults to Secure. Assert the flag is *not* silently enabled/disabled
    # wrongly -- here it must be absent because we disabled it.
    assert "secure" not in set_cookie
    assert r.json()["access_token"]


def test_login_bad_password_rejected(client, db):
    _make_user("bad@test.local", "password123", models.UserRole.ADMIN.value)
    r = client.post(
        "/auth/login",
        json={"email": "bad@test.local", "password": "nope-nope"},
    )
    assert r.status_code == 401
    assert "set-cookie" not in r.headers


def test_refresh_token_rotation(client, db):
    _make_user("rot@test.local", "password123", models.UserRole.ADMIN.value)
    login = client.post(
        "/auth/login",
        json={"email": "rot@test.local", "password": "password123"},
    )
    cookie1 = login.headers["set-cookie"].split(";")[0]

    # First refresh: new access token + rotated cookie
    r1 = client.post("/auth/refresh", headers={"Cookie": cookie1})
    assert r1.status_code == 200
    cookie2 = r1.headers["set-cookie"].split(";")[0]
    assert cookie2 != cookie1

    # Replay of the already-rotated cookie must fail (theft protection)
    r2 = client.post("/auth/refresh", headers={"Cookie": cookie1})
    assert r2.status_code == 401

    # The rotated cookie still works
    r3 = client.post("/auth/refresh", headers={"Cookie": cookie2})
    assert r3.status_code == 200


def test_logout_revokes_refresh_cookie(client, db):
    _make_user("out@test.local", "password123", models.UserRole.ADMIN.value)
    login = client.post(
        "/auth/login",
        json={"email": "out@test.local", "password": "password123"},
    )
    cookie = login.headers["set-cookie"].split(";")[0]
    headers = {
        "Authorization": f"Bearer {login.json()['access_token']}",
        "Cookie": cookie,
    }

    assert client.post("/auth/logout", headers=headers).status_code == 204
    # Cookie revoked server-side -> refresh rejected
    r = client.post("/auth/refresh", headers={"Cookie": cookie})
    assert r.status_code == 401


def test_refresh_without_cookie_rejected(client):
    assert client.post("/auth/refresh").status_code == 401


def test_access_token_requires_typ_access(client, db):
    """A token whose typ is not 'access' must never authenticate."""
    import datetime
    import jwt as pyjwt

    _make_user("typ@test.local", "password123", models.UserRole.ADMIN.value)
    now = datetime.datetime.now(datetime.timezone.utc)
    forged = pyjwt.encode(
        {
            "sub": "1",
            "role": "admin",
            "typ": "refresh",  # wrong type -- must be rejected
            "iat": now,
            "exp": now + datetime.timedelta(minutes=15),
        },
        "test-secret-not-for-production-0123456789",
        algorithm="HS256",
    )
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


def test_register_creates_receptionist_role(client, db):
    r = client.post(
        "/auth/register",
        json={"email": "reg@test.local", "password": "password123"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == models.UserRole.RECEPTIONIST.value
    # Self-registered accounts must await admin approval and cannot sign in.
    assert data["is_approved"] is False
    assert client.post(
        "/auth/login",
        json={"email": "reg@test.local", "password": "password123"},
    ).status_code == 403


def test_email_change_requires_current_password(client, db):
    """Changing the login email must require the account password -- a
    stolen session alone cannot take the account over."""
    uid = _make_user("email@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "email@test.local", "password123")

    # No password -> 400
    r = client.put("/auth/me", headers=h, json={"email": "new1@test.local"})
    assert r.status_code == 400

    # Wrong password -> 400
    r = client.put(
        "/auth/me",
        headers=h,
        json={"email": "new2@test.local", "current_password": "nope-nope"},
    )
    assert r.status_code == 400

    # Correct password -> email changes
    r = client.put(
        "/auth/me",
        headers=h,
        json={"email": "new3@test.local", "current_password": "password123"},
    )
    assert r.status_code == 200
    assert r.json()["email"] == "new3@test.local"

    # Old email no longer logs in; new one does.
    assert client.post(
        "/auth/login",
        json={"email": "email@test.local", "password": "password123"},
    ).status_code == 401
    assert client.post(
        "/auth/login",
        json={"email": "new3@test.local", "password": "password123"},
    ).status_code == 200

    # Role label-only edits keep working without the password.
    r = client.put(
        "/auth/me",
        headers=h,
        json={"role_label": "Doctor 9"},
    )
    assert r.status_code == 200


def test_register_duplicate_email_conflict(client, db):
    client.post(
        "/auth/register",
        json={"email": "dup@test.local", "password": "password123"},
    )
    r = client.post(
        "/auth/register",
        json={"email": "dup@test.local", "password": "password123"},
    )
    assert r.status_code == 409


def test_register_race_conflict_returns_409(client, db, monkeypatch):
    """Two concurrent registrations of the same fresh email: the second
    request passes the existence check, then loses the UNIQUE constraint.
    It must surface as a 409 (email taken), never a 500 that hides the
    fact the account already exists."""
    client.post(
        "/auth/register",
        json={"email": "race@test.local", "password": "password123"},
    )

    def _no_existing(db, email):
        return None

    monkeypatch.setattr(crud, "get_user_by_email", _no_existing)
    r = client.post(
        "/auth/register",
        json={"email": "race@test.local", "password": "password123"},
    )
    assert r.status_code == 409
    assert r.json()["detail"] == "Email already registered"


def test_admin_reset_password_flow(client, db):
    _make_user("resetflow-admin@test.local", "password123", models.UserRole.ADMIN.value)
    _make_user("victim@test.local", "oldpass123", models.UserRole.DENTIST.value)
    admin = login_as(client, "resetflow-admin@test.local", "password123")
    assert client.post(
        "/auth/login",
        json={"email": "victim@test.local", "password": "oldpass123"},
    ).status_code == 200

    uid = crud.get_user_by_email(db, "victim@test.local").id
    r = client.post(
        f"/admin/users/{uid}/reset-password",
        headers=admin,
        json={"new_password": "freshpass456"},
    )
    assert r.status_code == 200

    # Old password stops working, the new one signs in.
    assert client.post(
        "/auth/login",
        json={"email": "victim@test.local", "password": "oldpass123"},
    ).status_code == 401
    assert client.post(
        "/auth/login",
        json={"email": "victim@test.local", "password": "freshpass456"},
    ).status_code == 200

    # The reset is written to the tamper-proof audit log.
    logs = crud.get_audit_logs(db, action="password_reset")
    assert any("victim@test.local" in log.details for log in logs)


def test_admin_reset_password_admin_only(client, db):
    _make_user("r2@test.local", "oldpass123", models.UserRole.DENTIST.value)
    _make_user("resetstaff-dentist@test.local", "password123", models.UserRole.DENTIST.value)
    uid = crud.get_user_by_email(db, "r2@test.local").id
    staff = login_as(client, "resetstaff-dentist@test.local", "password123")
    r = client.post(
        f"/admin/users/{uid}/reset-password",
        headers=staff,
        json={"new_password": "freshpass123"},
    )
    assert r.status_code == 403


def test_admin_reset_password_guards(client, db):
    _make_user("resetguards-admin@test.local", "password123", models.UserRole.ADMIN.value)
    admin = login_as(client, "resetguards-admin@test.local", "password123")
    me_id = crud.get_user_by_email(db, "resetguards-admin@test.local").id

    # Resetting your own account is not allowed (use the profile page).
    r = client.post(
        f"/admin/users/{me_id}/reset-password",
        headers=admin,
        json={"new_password": "something123"},
    )
    assert r.status_code == 400

    # Short passwords are rejected.
    victim = _make_user("v3@test.local", "oldpass123", models.UserRole.DENTIST.value)
    r = client.post(
        f"/admin/users/{victim}/reset-password",
        headers=admin,
        json={"new_password": "short"},
    )
    assert r.status_code == 422

    # Unknown user -> 404.
    r = client.post(
        "/admin/users/999999/reset-password",
        headers=admin,
        json={"new_password": "freshpass123"},
    )
    assert r.status_code == 404


def test_login_rate_limited(client, db):
    main = __import__("main")
    _make_user("rate@test.local", "password123", models.UserRole.ADMIN.value)

    main.limiter.enabled = True
    try:
        codes = []
        for _ in range(12):
            r = client.post(
                "/auth/login",
                json={"email": "rate@test.local", "password": "password123"},
            )
            codes.append(r.status_code)
        assert 429 in codes, f"expected a 429 among {codes}"
    finally:
        main.limiter.enabled = False


def test_refresh_rate_limited(client, db):
    """Token-refresh is also an auth endpoint -- it must be rate limited
    so a stolen cookie can't be brute-forced through rotation."""
    main = __import__("main")
    _make_user("rrate@test.local", "password123", models.UserRole.ADMIN.value)
    login = client.post(
        "/auth/login",
        json={"email": "rrate@test.local", "password": "password123"},
    )
    cookie = login.headers["set-cookie"].split(";")[0]

    main.limiter.enabled = True
    try:
        codes = []
        for _ in range(66):
            r = client.post("/auth/refresh", headers={"Cookie": cookie})
            codes.append(r.status_code)
        assert 429 in codes, f"expected a 429 among {codes}"
    finally:
        main.limiter.enabled = False
