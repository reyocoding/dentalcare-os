# DentalCare OS — Security Assessment Report

**Project:** Dental ERP (FastAPI + SQLAlchemy backend, React/TypeScript frontend)
**Scope:** Authentication & session management, authorization (RBAC + object-level), PHI data protection, API/network hardening, frontend security, injection & upload defenses.
**Date:** 2026-08-04 (updated after remediation round 2; redeployment notes 2026-08-06)
**Status:** Baseline review + two remediation passes completed. **57 automated security tests passing.**

> Project overview & screenshots: [`README.md`](README.md) · Setup: [`SETUP_GUIDE.md`](SETUP_GUIDE.md)

---

## 1. Executive Summary

DentalCare OS processes Sensitive Personal Data (PHI: names, medical histories, allergies, medications, clinical notes, financial records, uploaded X-rays/referrals). The application now implements defense-in-depth across all ten OWASP Top 10 (2021) categories:

| Control area | Status |
|---|---|
| Authentication (JWT OAuth2 + rotating refresh cookies, argon2id) | Implemented |
| Authorization (RBAC roles, admin-only endpoints, page permissions) | Implemented |
| Object-level access (patient reads only own linked record) | Implemented |
| Data encryption at rest (Fernet/AES-128-GCM on PHI columns **and uploaded files**) | Implemented |
| Tamper-evident audit logging (HMAC hash chain, opt-in PHI read logs) | Implemented |
| Rate limiting + per-account lockout | Implemented |
| CORS allow-list, strict CSP (build-time), HSTS, security headers | Implemented |
| Frontend: in-memory tokens, HttpOnly cookies, route guards, 30-min inactivity logout | Implemented |
| Upload security (allow-list, size cap, canonical types, double-extension defense) | Implemented |
| Session-hijack defense (email change requires password) | Implemented |
| Production fail-fast (refuses to boot with default secrets) | Implemented |

**Remaining gaps are operational, not code-level** (Section 5): AV scanning of uploads, MFA for admins, dependency audits in CI, code signing of desktop bundles.

---

## 2. Security Controls — Implemented

### 2.1 Authentication & Session Management (`backend/auth.py`, `backend/main.py`)

- **JWT access tokens (OAuth2 Password flow)** — 15-minute lifespan (`JWT_EXPIRE_MINUTES`, default 15), `typ: "access"` claim enforced; tokens with `typ: "refresh"` are rejected (`test_access_token_requires_typ_access`).
- **Refresh tokens** — 256-bit random (`secrets.token_urlsafe(48)`), stored **hashed (SHA-256)** in the DB, **rotated on every use** (presented token revoked, replay → 401), delivered only inside an **HttpOnly + Secure + SameSite=Lax** cookie. `SameSite=Lax` blocks cross-site cookie sending (CSRF) while keeping same-site refresh working.
- **Password hashing** — Passlib `CryptContext` with **argon2id** (bcrypt legacy hashes transparently upgraded on login via `needs_rehash`). Verified by `test_password_hash_is_argon2id`.
- **Brute-force defense (two layers)** —
  - slowapi rate limits: `/auth/login` 10/min, `/auth/register` 10/min, `/auth/refresh` 60/min, `/auth/change-password` 10/min, `/auth/create-admin` 5/min (per IP).
  - **Per-account lockout** (in-memory): ≥5 failed logins for one email within 15 min locks that account for 15 min (429), even with the correct password; success resets the counter. Defeats distributed brute force that spreads across IPs. (`test_account_lockout_after_failures`)
- **Generic login errors** — identical 401 for unknown email vs wrong password; failed attempts (incl. lockouts) are audited.
- **Admin bootstrap** — `/auth/create-admin` gated by `ADMIN_SETUP_SECRET` (constant-time `secrets.compare_digest`), endpoint disabled when unset.
- **Production fail-fast** — with `ENV=production`, the app refuses to start unless `JWT_SECRET`, `ENCRYPTION_KEY`, and `ADMIN_SETUP_SECRET` are all explicitly set to strong values (no default-secret fallback can reach production).

### 2.2 Authorization (RBAC + Object-Level) (`backend/auth.py`, `backend/main.py`)

- Roles: `admin`, `dentist`, `hygienist`, `receptionist`, legacy `user`. (The former `patient` role was removed — self-registration now creates a receptionist account awaiting approval.)
- Dependency chain: `get_current_user` (401) → `require_staff` (403 for any non-staff role) → `require_admin` (403 for non-admin).
- **_Patient↔account linking is admin-only_** — any staff attempt to set `linked_user_id` on create/update → 403 (`test_only_admin_can_link_patient_account`).
- Admin-only: user list/delete, role changes, page-permission assignment, stats, audit-log viewer + chain verification.
- Per-page permissions (admin-assigned `permissions` list) enforced both in the API and the React router (`ProtectedLayout` + `canView`).
- Role assignment accepts all valid roles (`test_admin_can_assign_any_valid_role`).
- Ownership fields are server-side only: `update_tooth_record` no longer mass-assigns `patient_id` (`test_tooth_record_ownership_cannot_be_moved`); `update_treatment`/`update_appointment` already did the same.

### 2.3 Data Protection & PHI (`backend/encryption.py`, `backend/models.py`)

- **Field-level encryption at rest** — SQLAlchemy `TypeDecorator` `EncryptedText` (AES-128-GCM via Fernet) on PHI columns: patient address, occupation, emergency contacts, allergies, medications, medical history, notes; appointment reason/notes; treatment plan/medication/notes; session notes; tooth notes; payment description; document description; timeline events.
- **File-level encryption at rest** — uploaded documents (X-rays, referrals, records) are **encrypted before hitting the disk** (`encrypt_bytes`) and decrypted only at download time (`decrypt_bytes`). Raw bytes on disk are ciphertext (verified: `test_uploaded_files_encrypted_on_disk`); legacy plaintext files still read (verified: `test_legacy_plaintext_file_still_downloads`).
- **Searchable fields stay plaintext by design** (first/last name, phone, email) — verified by `test_searchable_fields_stay_plaintext`.
- Legacy plaintext rows read transparently and are re-encrypted on next write.
- Key management: `ENCRYPTION_KEY` env (preferred) or auto-generated `.encryption_key` file (chmod 600, gitignored). **Never committed.** Production refuses the on-disk fallback.

### 2.4 Audit Logging — Tamper-Evident (`backend/main.py` middleware, `backend/crud.py`)

- Every **mutation** (POST/PUT/DELETE, 2xx) on the data API is logged with `user_id` (resolved from token), `user_email`, `action`, `resource`, `resource_id`, `details`, `ip_address`, `timestamp`.
- **PHI read access logging** — opt-in via `AUDIT_LOG_READS=1` (document downloads included); verified by `test_opt_in_read_auditing`.
- **HMAC hash chain (non-repudiation)** — each entry stores `prev_hash` + `entry_hash` = HMAC-SHA256 (key `AUDIT_HMAC_KEY`, defaults to `JWT_SECRET`) over the entry's contents plus the previous hash. Any edit, deletion, or reordering is detectable. Admin endpoint `GET /admin/logs/verify` replays and reports the chain (`test_audit_entries_are_hash_chained`, `test_tampered_audit_entry_detected`).
- Auth events logged explicitly with richer context: register, login, login_failed, login_blocked, logout, password_changed, password_change_failed, email_change_rejected, role_changed, user_deleted, admin_created.
- Admin-viewable via `/admin/logs`.

### 2.5 API & Network Security (`backend/main.py`)

- **CORS** — explicit allow-list (`CORS_ORIGINS`, default `http://localhost:5173,http://127.0.0.1:5173`), `allow_credentials=True` **without** wildcard origins; wildcard origin never echoed (tested).
- **Security headers** — CSP (`default-src 'self'`; **`script-src 'self'` — no `'unsafe-inline'`**; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (no camera/mic/geo/payment), **HSTS** (`max-age=63072000; includeSubDomains`).
- **Build-time SPA CSP** — a strict CSP meta tag is injected into `index.html` by a Vite plugin during `vite build` only (dev HMR needs inline scripts); verified present in the production bundle.
- **TrustedHostMiddleware** (opt-in via `TRUSTED_HOSTS` env) — Host-header/cache-poisoning defense; off by default for LAN/desktop deployments.
- **Input validation** — strict Pydantic models on every endpoint (email/phone/name/role/enum/range validation); all DB access is parameterized ORM — no user input reaches raw SQL (code-scan verified; the only `text()` calls use hardcoded identifiers).
- **Upload security** —
  - Extension allow-list: PDF, images (png/jpg/jpeg/gif/webp/bmp/tiff), office docs (doc/docx/xls/xlsx), txt.
  - **25 MB size cap** (streamed, enforced mid-read; over-limit → 413).
  - **Canonical media types** — `file_type` is derived server-side from the validated extension; the client's `Content-Type` header is never stored or served (blocks HTML/SVG polyglot XSS via preview).
  - **Double-extension defense** — any dot-segment other than the last containing a dangerous extension (`php`, `phar`, `html`, `svg`, `exe`, `js`, `sh`, …) → rejected. `img.php.png`, `evil.html.png`, `notes.exe.pdf` all → 400 (`test_double_extension_rejected`).
  - **Traversal-proof naming** — `Path().name` strips all directory components + random UUID prefix (no overwrite races, unguessable paths).
  - Files are served **exclusively** as `Content-Disposition: attachment`, decrypted in memory, never streamed back raw (`test_document_download_serves_attachment`).

### 2.6 Frontend Security (`frontend/src/`)

- **No JWTs in localStorage/sessionStorage** — token lives in module memory; session persistence only via the HttpOnly refresh cookie (silent `/auth/refresh` retry on 401, single-flight).
- **No `dangerouslySetInnerHTML`**, no `eval`/`innerHTML`/`document.write` anywhere (verified by scan). React escapes all user-generated content by default.
- **Route guarding** — `ProtectedLayout` (auth + page-permission gate) and `AdminRoute` wrap every protected view; unauthenticated → `/login`, unauthorized → `/forbidden`.
- **Inactivity auto-logout** — 30 minutes of idle (mousemove/keydown/touch/scroll) clears memory state and calls `/auth/logout` (revokes refresh cookie).
- **CSRF-resistant API client** — credentials only via SameSite cookie + Bearer header.
- Profile email change requires the current password (account-takeover defense).

### 2.7 Demo-Credential Hygiene

- Demo user accounts are created by `seed_db.py` **only when `DEMO_MODE=1`** (default off).
- The login page never shows demo credentials (the hint panel was removed).
- `demo_users.txt` removed from the repo.

---

## 3. Verification

`cd backend && ./venv/bin/python -m pytest tests/ -q` → **57 passed**:

| Test file | Covers |
|---|---|
| `test_auth.py` | argon2id, bcrypt upgrade, HttpOnly/SameSite cookie, refresh rotation & replay rejection, logout revocation, token `typ` enforcement, register role, rate limits (login + refresh), email-change-password |
| `test_rbac.py` | anonymous 401s incl. `/appointments/today`, non-staff 403s, staff 200s, admin-only, security headers + HSTS, CORS wildcard, role assignment |
| `test_encryption.py` | PHI ciphertext at rest (`gAAAA…`), plaintext search fields, API decryption, legacy-row reads, re-encryption on update |
| `test_file_security.py` | HTML/SVG upload rejected, traversal filenames stripped, canonical media types, unknown/double extensions rejected, attachment-only downloads, **files encrypted on disk**, legacy plaintext files |
| `test_hardening.py` | **audit hash chain + tamper detection, per-account lockout, admin-only patient linking, tooth ownership, opt-in read auditing** |

Frontend: `tsc -b` clean; `vite build` succeeds with the CSP meta tag in the bundle. (Repo-wide `eslint` has 74 pre-existing errors in unrelated components — unchanged by this work.)

---

## 4. Findings Fixed

### Round 1 (baseline gaps)

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | **High** | `GET /appointments/today` had **no authentication** | Added `require_staff` |
| F2 | **High** | **Stored file-upload attacks** (no validation, client `Content-Type` served verbatim, no size cap) | Allow-list + size cap + canonical types + attachment-only serving |
| F3 | **High** | **Email change without password** (session theft → permanent account takeover) | `/auth/me` requires `current_password` for email changes |
| F4 | **Medium** | RBAC role assignment 422'd for dentist/hygienist/receptionist | `RoleUpdate` accepts all valid roles |
| F5 | **Medium** | Weak filename sanitization, overwrite races | `Path().name` + UUID-prefixed names |
| F6 | **Medium** | No rate limits on refresh/change-password/create-admin | 60/10/5 per minute |
| F7 | **Medium** | No HSTS | Added |
| F8 | **Medium** | No Host-header validation | Opt-in `TRUSTED_HOSTS` |
| F9 | **Low** | Non-constant-time admin secret comparison | `secrets.compare_digest` |

### Round 2 (deep-dive findings, all fixed)

| # | Severity | Finding | Fix |
|---|---|---|---|
| F10 | **High** | **Uploaded PHI documents stored plaintext on disk** (encryption covered DB text only) | Fernet file-level encryption at rest + transparent decrypt on download; legacy files kept readable |
| F11 | **High** | **Weak default JWT secret fallback** — forget the env var in prod and tokens are forgeable | `ENV=production` ⇒ refuse to boot without `JWT_SECRET` / `ENCRYPTION_KEY` / `ADMIN_SETUP_SECRET` |
| F12 | **Medium** | **Audit log mutable, not non-repudiable; PHI reads not logged** | HMAC-SHA256 hash chain (`prev_hash`/`entry_hash`) + `/admin/logs/verify` tamper check + opt-in `AUDIT_LOG_READS=1` read auditing |
| F13 | **Medium** | **Demo credentials shipped** in repo + shown on login page | Gated behind `DEMO_MODE=1` / `VITE_DEMO_MODE=1`; `demo_users.txt` deleted |
| F14 | **Medium** | **CSP had `script-src 'unsafe-inline'`** | Backend CSP tightened; strict CSP meta injected at build time into the SPA |
| F15 | **Medium** | `linked_user_id` (read-access grant) settable by any staff | Admin-only (403 for staff) |
| F16 | **Medium** | No per-account lockout — distributed brute force could still hit one account | In-memory lockout: 5 failures/15 min ⇒ 15-min lock (429), reset on success |
| F17 | **Low** | `update_tooth_record` mass-assignment of `patient_id` | `exclude_unset` + ownership pop |
| F18 | **Low** | `requirements.txt` unpinned | Pinned to tested versions (F18) |

---

## 5. Remaining Recommendations (operational / out-of-repo)

| # | Priority | Item | Notes |
|---|---|---|---|
| R1 | High | **Virus scanning of uploads** | Real healthcare requirement — add ClamAV scan on upload before the file is marked available |
| R2 | High | **Backups** must be encrypted and tested; `uploads/` should sit on an encrypted volume even though files are now encrypted in-app | Defense in depth |
| R3 | Medium | **MFA (TOTP) for admin accounts** | High-value target; recommend before internet-facing deployments |
| R4 | Medium | **Dependency audit in CI** (`pip-audit`, `npm audit`) and a quarterly upgrade cadence | Versions are pinned but still need tracking |
| R5 | Medium | Export audit entries to an **append-only store** (syslog/paper trail/S3 object lock) — the hash chain detects tampering but an attacker with DB write access can still hide it | |
| R6 | Medium | **Password policy**: 12+ chars (NIST); consider passkeys/SSO for staff | 8-char minimum currently |
| R7 | Low | **Email verification** on self-registration (currently registrations are unverified, though accounts cannot sign in until approved) | Add when external staff self-registration is opened |
| R8 | Low | Code-sign PyInstaller bundles (`main.spec`); document the TLS-terminating reverse proxy in front of the app | |
| R9 | Low | Key **rotation procedure** for `ENCRYPTION_KEY` (dual-key re-encrypt job) | Currently single static key |

---

## 6. OWASP Top 10 (2021) Mapping

| Category | Posture | Notes |
|---|---|---|
| **A01 Broken Access Control** | ✅ Strong | RBAC deps everywhere; object-level `require_patient_scope`; admin-only linking + admin endpoints; page permissions; 403s leak nothing |
| **A02 Cryptographic Failures** | ✅ Strong | argon2id, Fernet field + file encryption, hashed refresh tokens, production fail-fast on weak secrets. Residual: R9 key rotation |
| **A03 Injection** | ✅ Strong | All SQL parameterized (verified — no user input reaches raw SQL); no eval/exec/shell (verified); upload allow-list + double-extension defense; React escapes HTML; strict CSP |
| **A04 Insecure Design** | ⚠️ | Residual: R3 MFA, R6 password policy, R7 email verification |
| **A05 Security Misconfiguration** | ✅ Strong | CORS allow-list, strict CSP (API + build-time SPA), HSTS, nosniff, frame-deny, referrer/permissions policy, TrustedHost (opt-in), no demo creds in prod |
| **A06 Vulnerable & Outdated Components** | ⚠️ | Pinned; residual: R4 CI audits + upgrade cadence |
| **A07 Identification & Auth Failures** | ✅ Strong | Short-lived JWTs, rotating hashed refresh tokens in HttpOnly/SameSite cookies, argon2id, rate limits + per-account lockout, generic login errors, password-gated email change, production fail-fast. Residual: R3 |
| **A08 Software & Data Integrity** | ✅ Strong | JWT signatures, refresh rotation/revocation, canonical upload types, tamper-evident audit chain. Residual: R8 signing |
| **A09 Security Logging & Monitoring** | ✅ Strong | Mutations always logged with user/IP; PHI reads opt-in; HMAC chain + verify endpoint. Residual: R5 append-only export |
| **A10 SSRF** | ✅ N/A | No outbound URL fetching anywhere (verified by scan) |

---

## 7. Deployment Checklist (before production)

1. Set strong `JWT_SECRET` (≥256-bit random), `ENCRYPTION_KEY` (Fernet), `ADMIN_SETUP_SECRET`, `TRUSTED_HOSTS`, `CORS_ORIGINS`; keep `COOKIE_SECURE=1` (default); set `ENV=production` (fail-fast guard active).
2. Do **not** run `seed_db.py` with `DEMO_MODE=1` against production.
3. Terminate TLS at a reverse proxy (Nginx/Caddy) — HSTS is already sent by the app; verify Secure cookies pass through.
4. **Netlify/static-host deployment (cross-site cookies):** the refresh cookie is `SameSite=Lax`, which browsers refuse to send on cross-site XHR. A split deployment (SPA on Netlify, API elsewhere) **silently breaks session renewal** unless the SPA calls the API through a **same-origin proxy** (`/api/*` → backend, see `netlify.toml`). Do not switch the cookie to `SameSite=None` just to avoid the proxy — that trades CSRF protection for convenience. Set `VITE_API_URL=/api` at build time; the build-time CSP `connect-src` then only needs `'self'`.
5. Run `pip install -r requirements.txt` (pinned); run `pip-audit` / `npm audit` in CI.
6. Add ClamAV scanning of uploads (R1) and admin MFA (R3) before internet-facing rollout.
7. Enable `AUDIT_LOG_READS=1` where PHI access logging is required by regulation; export logs to an append-only sink (R5).
8. Encrypt backups; test restore; keep `uploads/` on an encrypted volume (R2). The SQLite DB and `uploads/` are now gitignored — production data must never live in the repository.

---

## 8. How to Run the Tests

```bash
cd backend
./venv/bin/python -m pytest tests/ -q        # 57 passed
cd ../frontend
./node_modules/.bin/tsc -b                     # clean
npx vite build                                 # strict CSP meta injected
```
