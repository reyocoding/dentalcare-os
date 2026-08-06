"""Pytest fixtures: isolated temp DB + deterministic encryption key.

Everything here runs BEFORE `main` is imported so that the app's
module-level `create_all`/`_ensure_columns` initialize the temp database
instead of the dev `dental.db`.
"""

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="dentaltest_")

os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["ENCRYPTION_KEY"] = os.getenv(
    "ENCRYPTION_KEY",
    "TkZDaWRhbWljVGVzdEtleTEyMzQ1Njc4OTBfI2okKiU=",
)
os.environ["COOKIE_SECURE"] = "0"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-0123456789"

import pytest
from fastapi.testclient import TestClient

import main
import models
import crud
import auth
from database import SessionLocal

# Rate limiting is disabled by default so the test suite's many logins
# don't trip it; the dedicated rate-limit test re-enables it.
main.limiter.enabled = False


@pytest.fixture(scope="session")
def client():
    with TestClient(main.app) as c:
        yield c


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_user(email: str, password: str, role: str) -> int:
    db = SessionLocal()
    try:
        user = crud.create_user(
            db,
            email=email,
            password_hash=auth.hash_password(password),
            role=role,
        )
        return user.id
    finally:
        db.close()


def login_as(client, email: str, password: str, cookie: bool = False):
    r = client.post(
        "/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    if cookie:
        cookie_header = r.headers.get("set-cookie")
        assert cookie_header, "login must set a refresh cookie"
        headers["Cookie"] = cookie_header.split(";")[0]
    return headers


@pytest.fixture()
def admin_headers(client):
    _make_user("admin@test.local", "password123", models.UserRole.ADMIN.value)
    return login_as(client, "admin@test.local", "password123")


@pytest.fixture()
def dentist_headers(client):
    _make_user("dentist@test.local", "password123", models.UserRole.DENTIST.value)
    return login_as(client, "dentist@test.local", "password123")
