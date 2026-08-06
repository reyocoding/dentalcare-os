# DentalCare OS — Setup & Usage Guide

> Overview & screenshots: [`README.md`](README.md) · Security: [`sec.md`](sec.md)

How to run the app today (development) and what to do when you deploy it
(production). Covers the new **admin approval flow**: people who sign up on
their own can no longer log in until an administrator approves their account.

---

## 1. What changed — the approval flow

| Step | Who | What happens |
|------|-----|--------------|
| 1 | Visitor | Fills the **Register** form → account is created with `is_approved = false` |
| 2 | Visitor | Sees a "Account created — pending admin approval" screen. **No auto-login.** |
| 3 | Visitor | Tries to log in → the app shows "Your account is awaiting admin approval" (HTTP 403) |
| 4 | Admin | Opens **Admin Panel → Users**: pending accounts show a yellow **"Pending approval"** badge and an **Approve** button (also a "Pending Approvals" counter on the Overview tab) |
| 5 | Admin | Clicks **Approve** → account is unlocked, timestamp + approver recorded, event written to the tamper-proof audit log (`register_approved`) |
| 6 | Visitor | Can now log in normally |

Rules enforced by the API:

- `POST /auth/register` always creates a **pending** patient account.
- `POST /auth/login` returns **403 "Account pending admin approval"** for
  unapproved accounts (wrong password still returns the generic 401, so
  account status is never leakable).
- `GET /admin/users/pending` and `POST /admin/users/{id}/approve` are
  **admin-only** (403 for other roles).
- Accounts created by an admin (seeding, `/auth/create-admin`) are approved
  by default. Existing accounts were backfilled as approved on startup —
  nobody gets locked out.
- Approvals are recorded in the audit log with `prev_hash`/`entry_hash`
  chaining (verify via `GET /admin/logs/verify` as admin).

---

## 2. Development (do this now)

### 2.1 Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run the API (auto-reload, SQLite db auto-created + auto-migrated on boot)
uvicorn main:app --reload
```

- API: http://127.0.0.1:8000 — interactive docs: http://127.0.0.1:8000/docs
- The database `backend/dental.db` is created and columns migrated
  automatically on first boot (no manual step).
- Encryption key: `backend/.encryption_key` is generated automatically
  (gitignored). You can also set `ENCRYPTION_KEY` explicitly.

### 2.2 First admin account

```bash
export ADMIN_SETUP_SECRET="pick-a-secret"   # only needed once
# in a second terminal, after uvicorn is running:
curl -X POST http://127.0.0.1:8000/auth/create-admin \
  -H "Content-Type: application/json" \
  -H "X-Admin-Setup-Secret: $ADMIN_SETUP_SECRET" \
  -d '{"email":"admin@clinic.com","password":"a-strong-password"}'
```

Then unset/restart without `ADMIN_SETUP_SECRET` to disable the endpoint.

### 2.3 Demo data (optional)

```bash
cd backend
DEMO_MODE=1 ./venv/bin/python seed_db.py      # fake patients + demo users
```

Demo accounts (only available when `DEMO_MODE=1`):

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@clinic.com` | `9tqrgf5MXABIp3DauGcU+1Tn` |
| Doctor | `doctor1@demo.com` | `doctor123` |
| Secretary | `secretary1@demo.com` | `secretary123` |

### 2.4 Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

### 2.5 Try the approval flow end-to-end

1. Open http://localhost:5173/register and create an account.
2. Confirm you see the "pending approval" screen and are **not** logged in.
3. Try logging in with those credentials → friendly "awaiting approval" message.
4. Sign in as `admin@clinic.com` → **Admin Panel → Users** → find the pending
   account → click **Approve**.
5. Log in with the registered account → works.

### 2.6 Tests & checks

```bash
cd backend
./venv/bin/python -m pytest tests/ -q        # 57 tests: auth, RBAC, encryption, file security, hardening, approval flow

cd frontend
./node_modules/.bin/tsc -b                    # typecheck
npx vite build                                # production build (injects the CSP header meta)
```

---

## 3. Production (do this next)

Deploy checklist, in order:

### 3.1 Secrets & runtime config

| Env var | Must set | Why |
|---------|----------|-----|
| `ENV=production` | ✅ | Enables the fail-fast guard: the app refuses to start if the secrets below are missing or weak |
| `JWT_SECRET` | ✅ | Long random string — signs access/refresh tokens |
| `ENCRYPTION_KEY` | ✅ | Fernet key for PHI fields and uploaded files (generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) |
| `ADMIN_SETUP_SECRET` | ⚠️ | Only while bootstrapping the first admin, then remove |
| `COOKIE_SECURE=1` | ✅ | Refresh cookie sent over HTTPS only |
| `TRUSTED_HOSTS` | ✅ | Comma-separated hostnames (`api.clinic.com`) — blocks Host-header attacks |
| `CORS_ORIGINS` | ✅ | Comma-separated frontend origins (`https://app.clinic.com`) |
| `AUDIT_HMAC_KEY` | ✅ | Separate key for the audit hash chain (falls back to `JWT_SECRET` otherwise) |
| `AUDIT_LOG_READS=1` | optional | Also audit read-only access to patient data |

### 3.2 Deployment steps

1. **Build the frontend** without demo mode: `npm run build` → serve the
   `dist/` folder from your web server / CDN. The build already embeds a
   strict Content-Security-Policy.
2. **Run the API behind HTTPS** (Caddy or nginx reverse proxy with TLS;
   HSTS is already sent by the API). Set `TRUSTED_HOSTS` and `CORS_ORIGINS`
   to your real domains.
3. **Bootstrap the first admin** with `ADMIN_SETUP_SECRET`, then restart
   without it.
4. **Verify** `GET /admin/logs/verify` returns no chain breaks, and
   `GET /admin/logs` shows real events (logins, approvals, deletions).
5. **Back up** `dental.db` **and** `backend/.encryption_key` together —
   without the key the encrypted fields/files are unrecoverable. Keep
   backups encrypted.
6. **Postpone manual user creation**: from now on every self-registration
   sits in Admin Panel → Users until an admin approves it. Check the
   "Pending Approvals" counter on the Admin Overview regularly.

### 3.4 Deploying the frontend on Netlify

The repo ships a `netlify.toml` (frontend build + SPA fallback + security
headers). Connecting the repo to Netlify is enough to serve the UI.

**Same-site cookie requirement (read this first).** Sessions are kept alive
by an HttpOnly `SameSite=Lax` refresh cookie. Browsers do **not** send Lax
cookies on cross-site XHR, so if the API is on a different domain the silent
refresh breaks and users are logged out after ~15 minutes. Solution: proxy
`/api` through Netlify so the browser only ever calls your Netlify domain:

1. Host the FastAPI backend somewhere HTTPS-enabled (Render, Railway, Fly.io,
   VPS) — e.g. `https://api.clinic.example.com`. Run it with
   `ENV=production` and all the secrets from §3.1 (`JWT_SECRET`,
   `ENCRYPTION_KEY`, `ADMIN_SETUP_SECRET`), plus `CORS_ORIGINS`
   = `https://<your-app>.netlify.app` and `TRUSTED_HOSTS` = `api.clinic.example.com`.
2. In Netlify → Site settings → Environment variables, set `VITE_API_URL=/api`.
3. Uncomment the `/api/*` proxy block in `netlify.toml` and set
   `to = "https://api.clinic.example.com/:splat"`.
4. Deploy (Netlify runs `npm ci && npm run build` automatically).
5. Verify: sign in → hard-reload the page → you should stay signed in
   (refresh-cookie path working). Check the browser console for CSP errors
   (the build-time CSP allows `'self'` and your `VITE_API_URL`).

Alternative (no proxy): set `VITE_API_URL` to the absolute backend URL. It
works but requires cross-site cookies (`SameSite=None; Secure`) on the
backend, which is a CSRF trade-off — the proxy is the recommended setup.

### 3.3 Recommended follow-ups (details in `sec.md`)

- MFA (TOTP) for admin accounts
- ClamAV scanning of uploaded files
- Password policy ≥ 12 chars or SSO
- CI: `pip-audit` + `npm audit` on every build
- Regular test of the backup-restore procedure
