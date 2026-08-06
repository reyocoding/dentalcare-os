"""File-upload security: extension allow-list, canonical media types,
no HTML/SVG XSS vectors, size cap."""

import models
from tests.conftest import _make_user, login_as


def _upload(client, headers, patient_id, filename, content, content_type="application/octet-stream"):
    return client.post(
        f"/patients/{patient_id}/documents/upload",
        headers=headers,
        files={"file": (filename, content, content_type)},
    )


def _make_patient(client, headers):
    return client.post(
        "/patients/",
        headers=headers,
        json={"first_name": "Up", "last_name": "Load"},
    ).json()


def test_html_upload_rejected(client):
    """HTML/SVG files are an XSS vector when previewed -- must be rejected
    outright, regardless of the client-declared Content-Type."""
    _make_user("up@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    r = _upload(
        client, h, pid, "xss.html",
        b"<script>alert(document.cookie)</script>",
        content_type="text/html",
    )
    assert r.status_code == 400, r.text

    r = _upload(
        client, h, pid, "xss.svg",
        b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        content_type="image/svg+xml",
    )
    assert r.status_code == 400, r.text


def test_path_traversal_filename_stripped(client):
    """A filename carrying directory components must not escape the
    patient's folder, and the stored name is server-generated."""
    _make_user("up2@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up2@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    r = _upload(client, h, pid, "../../../etc/cron.d/x.pdf", b"%PDF-1.4 x", "application/pdf")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert "/" not in doc["file_name"] and "\\" not in doc["file_name"]
    assert ".." not in doc["file_name"]


def test_stored_file_type_is_canonical(client):
    """The client's Content-Type header must never reach the DB -- the
    stored type is derived from the validated extension."""
    _make_user("up3@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up3@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    r = _upload(
        client, h, pid, "scan.pdf",
        b"%PDF-1.4 fake", content_type="text/html",
    )
    assert r.status_code == 200, r.text
    assert r.json()["file_type"] == "application/pdf"


def test_unknown_extension_rejected(client):
    _make_user("up4@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up4@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    r = _upload(client, h, pid, "payload.exe", b"MZ...", "application/octet-stream")
    assert r.status_code == 400, r.text
    r = _upload(client, h, pid, "notes.php", b"<?php ?>", "application/octet-stream")
    assert r.status_code == 400, r.text


def test_document_download_serves_attachment(client):
    """Files are always served as downloads (Content-Disposition:
    attachment), never inline -- even allowed types can't run in the tab."""
    _make_user("up5@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up5@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    doc = _upload(client, h, pid, "scan.pdf", b"%PDF-1.4 x", "application/pdf").json()
    r = client.get(f"/documents/{doc['id']}/download", headers=h)
    assert r.status_code == 200
    assert "attachment" in r.headers.get("content-disposition", "").lower()


def test_double_extension_rejected(client):
    """img.php.png must be rejected: a dangerous extension anywhere in the
    filename is refused, not just the last segment."""
    _make_user("up6@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up6@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    for name in ("img.php.png", "evil.html.png", "x.jpg.js", "notes.exe.pdf", "a.php"):
        r = _upload(client, h, pid, name, b"payload", "application/octet-stream")
        assert r.status_code == 400, (name, r.text)

    # Benign multi-dot names still pass.
    r = _upload(client, h, pid, "scan.final.pdf", b"%PDF-1.4 x", "application/pdf")
    assert r.status_code == 200, r.text


def test_uploaded_files_encrypted_on_disk(client):
    """Only ciphertext reaches the disk; downloads decrypt transparently."""
    _make_user("up7@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up7@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    secret = b"%PDF-1.4 very sensitive x-ray data"
    doc = _upload(client, h, pid, "xray.pdf", secret, "application/pdf").json()

    # Raw bytes on disk are Fernet ciphertext -- the PHI never appears.
    raw = open(doc["file_path"], "rb").read()
    assert raw != secret
    assert raw.startswith(b"gAAAA")

    # The API still serves the original plaintext.
    r = client.get(f"/documents/{doc['id']}/download", headers=h)
    assert r.status_code == 200
    assert r.content == secret


def test_legacy_plaintext_file_still_downloads(client):
    """Files written before encryption existed must keep working."""
    import tempfile
    from pathlib import Path

    import crud
    import schemas
    from database import SessionLocal

    _make_user("up8@test.local", "password123", models.UserRole.DENTIST.value)
    h = login_as(client, "up8@test.local", "password123")
    pid = _make_patient(client, h)["id"]

    tmp = Path(tempfile.mkdtemp()) / "legacy.pdf"
    tmp.write_bytes(b"legacy-plaintext-doc")
    db = SessionLocal()
    try:
        doc = crud.create_document(db, schemas.PatientDocumentCreate(
            patient_id=pid,
            file_name="legacy.pdf",
            file_type="application/pdf",
            file_path=str(tmp),
        ))
        doc_id = doc.id
    finally:
        db.close()

    r = client.get(f"/documents/{doc_id}/download", headers=h)
    assert r.status_code == 200
    assert r.content == b"legacy-plaintext-doc"
