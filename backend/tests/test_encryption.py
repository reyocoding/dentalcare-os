"""Encryption at rest: PHI columns must be ciphertext in the DB while the
API transparently serves plaintext."""

import sqlite3

import models
import crud
import auth
from tests.conftest import _make_user, login_as
from database import SessionLocal


def _raw_db_connection():
    # The test DB file lives at the path the engine was built with.
    import os
    from sqlalchemy.engine import make_url
    from database import engine
    url = make_url(engine.url)
    assert url.database, "test DB must be a file-backed sqlite"
    conn = sqlite3.connect(url.database)
    conn.row_factory = sqlite3.Row
    return conn


def test_phi_columns_encrypted_at_rest(client):
    _make_user("doc@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "doc@test.local", "password123")

    p = client.post(
        "/patients/",
        headers=h,
        json={
            "first_name": "Sensitive",
            "last_name": "Patient",
            "phone_number": "5551234567",
            "email": "s@t.com",
            "medical_history": "diabetes type 2 with hypertension",
            "allergies": "penicillin",
            "current_medications": "metformin 500mg",
            "address": "42 Clinic Road",
            "notes": "anxious patient, prefers morning slots",
        },
    ).json()
    pid = p["id"]

    conn = _raw_db_connection()
    row = conn.execute(
        "SELECT medical_history, allergies, current_medications, address, notes"
        " FROM patients WHERE id=?",
        (pid,),
    ).fetchone()
    conn.close()

    for col in ("medical_history", "allergies", "current_medications", "address", "notes"):
        raw = row[col]
        assert raw and raw.startswith("gAAAA"), f"{col} not encrypted: {raw!r}"
        assert "diabetes" not in raw and "penicillin" not in raw


def test_searchable_fields_stay_plaintext(client):
    """Fields used for ilike search/sort must remain plaintext so search
    still works server-side."""
    _make_user("doc2@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "doc2@test.local", "password123")
    client.post(
        "/patients/",
        headers=h,
        json={"first_name": "Plainname", "last_name": "Plainlast", "phone_number": "5559998888"},
    )
    conn = _raw_db_connection()
    row = conn.execute(
        "SELECT first_name, last_name, phone_number FROM patients WHERE first_name='Plainname'"
    ).fetchone()
    conn.close()
    assert row["first_name"] == "Plainname"
    assert row["last_name"] == "Plainlast"
    assert row["phone_number"] == "5559998888"


def test_api_returns_decrypted_phi(client):
    _make_user("doc3@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "doc3@test.local", "password123")
    p = client.post(
        "/patients/",
        headers=h,
        json={"first_name": "Readback", "last_name": "Patient", "medical_history": "asthma"},
    ).json()
    got = client.get(f"/patients/{p['id']}", headers=h).json()
    assert got["medical_history"] == "asthma"


def test_legacy_plaintext_rows_still_readable(client):
    """Rows written before encryption existed must not break reads."""
    _make_user("doc4@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "doc4@test.local", "password123")
    p = client.post(
        "/patients/",
        headers=h,
        json={"first_name": "Legacy", "last_name": "Row", "medical_history": "x"},
    ).json()
    conn = _raw_db_connection()
    conn.execute(
        "UPDATE patients SET medical_history='plaintext-from-old-build' WHERE id=?",
        (p["id"],),
    )
    conn.commit()
    conn.close()

    got = client.get(f"/patients/{p['id']}", headers=h).json()
    assert got["medical_history"] == "plaintext-from-old-build"


def test_updates_reencrypt(client):
    """Updating a legacy/plaintext row must re-encrypt it on write."""
    _make_user("doc5@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "doc5@test.local", "password123")
    p = client.post(
        "/patients/",
        headers=h,
        json={"first_name": "Rewrit", "last_name": "Me", "medical_history": "x"},
    ).json()
    conn = _raw_db_connection()
    conn.execute(
        "UPDATE patients SET medical_history='plaintext-again' WHERE id=?",
        (p["id"],),
    )
    conn.commit()
    conn.close()

    client.put(
        f"/patients/{p['id']}",
        headers=h,
        json={"first_name": "Rewrit", "last_name": "Me", "medical_history": "now encrypted"},
    )

    conn = _raw_db_connection()
    raw = conn.execute(
        "SELECT medical_history FROM patients WHERE id=?", (p["id"],)
    ).fetchone()[0]
    conn.close()
    assert raw.startswith("gAAAA")
