import os
import re
import secrets
from pathlib import Path
from uuid import uuid4
from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File, Form, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, Response
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone, timedelta

import models
import schemas
import crud
import auth
import encryption

from database import engine, get_db, SessionLocal


# =====================================================
# DATABASE
# =====================================================

models.Base.metadata.create_all(bind=engine)


# =====================================================
# LIGHTWEIGHT SCHEMA MIGRATIONS
# create_all() never alters existing tables, so freshly added columns
# would be missing from databases created by older builds. ALTER TABLE
# for the columns that don't exist yet.
# =====================================================

def _ensure_columns(table: str, additions: dict):
    from sqlalchemy import inspect, text
    existing = {c["name"] for c in inspect(engine).get_columns(table)}
    with engine.begin() as conn:
        for name, ddl in additions.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


_ensure_columns("users", {
    "role_label": "VARCHAR",
    "permissions": "TEXT",
    "is_approved": "BOOLEAN",
    "approved_at": "DATETIME",
    "approved_by_user_id": "INTEGER",
})
_ensure_columns("audit_logs", {
    "prev_hash": "VARCHAR",
    "entry_hash": "VARCHAR",
})
_ensure_columns("patients", {
    "linked_user_id": "INTEGER",
})
_ensure_columns("treatments", {
    "tooth_numbers": "TEXT",
})

# Pre-existing accounts (created before the approval feature) were implicitly
# trusted, so backfill them as approved rather than locking everyone out.
# NULL only: genuinely pending registrations store 0 and must survive restarts.
# CAST(1 AS BOOLEAN): SQLite stores booleans as integers, Postgres demands
# a real boolean -- this literal works on both.
from sqlalchemy import text
with engine.begin() as conn:
    conn.execute(
        text(
            "UPDATE users SET is_approved = CAST(1 AS BOOLEAN) "
            "WHERE is_approved IS NULL"
        )
    )


# =====================================================
# UPLOAD CONFIG
# =====================================================

UPLOAD_DIR = Path("uploads/documents")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# -----------------------------------------------------
# UPLOAD SAFETY
# -----------------------------------------------------

# Extension -> canonical media type. The client's Content-Type header is
# NEVER trusted: the stored file_type is derived from the extension, so an
# uploaded HTML/SVG can't be previewed as a script-bearing document.
ALLOWED_UPLOAD_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
}

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))

# Extensions that are never acceptable in ANY dot-segment of the filename
# (defense in depth against double-extension tricks like "img.php.png").
DANGEROUS_EXTENSIONS = {
    "php", "php3", "php4", "php5", "php7", "phtml", "pht", "phar",
    "asp", "aspx", "ashx", "jsp", "jspx", "cgi", "pl", "py", "rb",
    "sh", "bash", "bat", "cmd", "com", "exe", "msi", "dll", "so",
    "js", "mjs", "html", "htm", "shtml", "xhtml", "svg", "xml",
    "swf", "jar", "wsf", "hta", "vbs", "ps1", "scr", "reg",
}


# =====================================================
# APP
# =====================================================

app = FastAPI(
    title="DentalCare OS API"
)


# =====================================================
# CORS -- explicit allow-list only. Wildcards are incompatible with
# credentialed (cookie) requests and defeat CSRF protections.
# =====================================================

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Host-header validation (opt-in): set TRUSTED_HOSTS to a comma-separated
# list of hostnames/domains in production to stop Host-header injection /
# cache poisoning. Empty (default) = any host, for LAN/desktop deployments.
TRUSTED_HOSTS = [
    h.strip()
    for h in os.getenv("TRUSTED_HOSTS", "").split(",")
    if h.strip()
]
if TRUSTED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=TRUSTED_HOSTS)


# =====================================================
# SECURITY HEADERS
# =====================================================

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    # HSTS: browsers ignore it on plain HTTP, so it is safe in dev and
    # mandatory in production (all subdomains, 2 years).
    response.headers["Strict-Transport-Security"] = (
        "max-age=63072000; includeSubDomains"
    )
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    )
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=(), payment=()"
    )
    return response


# =====================================================
# RATE LIMITING (login brute-force protection)
# =====================================================

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter


@app.exception_handler(429)
async def rate_limit_handler(request: Request, exc):
    if isinstance(exc, RateLimitExceeded):
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please try again later."},
        )
    # Non-slowapi 429s (e.g. the per-account lockout) keep their message.
    return JSONResponse(
        status_code=429,
        content={"detail": getattr(exc, "detail", "Too many requests.")},
    )


# =====================================================
# AUDIT TRAIL
# =====================================================

def _client_ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None

# Read (GET) access logging is opt-in: enable with AUDIT_LOG_READS=1.
# Mutations (POST/PUT/DELETE) are always logged.
AUDIT_LOG_READS = os.getenv("AUDIT_LOG_READS", "0") == "1"

# Paths that are never audit-logged by the middleware (auth/admin handlers
# log explicitly; framework routes are noise).
_AUDIT_SKIP_PREFIXES = ("/auth/", "/admin/", "/docs", "/redoc", "/openapi.json")


@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    """Automatically records every successful mutation (POST/PUT/DELETE)
    against the data API -- who did it, what, and from where. Auth and
    admin endpoints are excluded here because their handlers log
    explicitly (they carry richer context like emails/roles). With
    AUDIT_LOG_READS=1, successful reads are logged too (PHI access logs)."""
    response = await call_next(request)

    try:
        path = request.url.path
        if path.startswith(_AUDIT_SKIP_PREFIXES):
            return response

        method = request.method
        is_mutation = method in ("POST", "PUT", "DELETE")
        # Document downloads are PHI reads -- they belong in the access log.
        log_read = AUDIT_LOG_READS and method == "GET"
        if not (is_mutation or log_read):
            return response
        if not (200 <= response.status_code < 300):
            return response

        # Resolve the acting user from the bearer token.
        user = None
        token = request.headers.get("authorization")
        if token and token.lower().startswith("bearer "):
            try:
                payload = auth.decode_token(token[7:])
                user_id = int(payload.get("sub"))
                db = SessionLocal()
                try:
                    user = db.query(models.User).filter(models.User.id == user_id).first()
                finally:
                    db.close()
            except Exception:
                user = None

        segments = path.strip("/").split("/")
        resource = segments[0] if segments else None
        match = re.search(r"/(\d+)", path)
        resource_id = int(match.group(1)) if match else None

        db = SessionLocal()
        try:
            crud.log_action(
                db,
                user,
                action=request.method.lower(),
                resource=resource,
                resource_id=resource_id,
                details=f"{request.method} {path}",
                ip_address=_client_ip(request),
            )
        finally:
                db.close()
    except Exception:
        # Audit logging must never break an otherwise-successful request.
        pass

    return response


# =====================================================
# ACCOUNT LOCKOUT (in-memory, per-email)
# Complements the per-IP rate limits: a distributed brute force that
# spreads across IPs still hits the per-account lockout. Single-process
# only -- fine for the desktop/server deployment this app targets.
# =====================================================

_LOCKOUT_MAX_FAILURES = int(os.getenv("LOCKOUT_MAX_FAILURES", "5"))
_LOCKOUT_WINDOW_MIN = int(os.getenv("LOCKOUT_WINDOW_MIN", "15"))
_LOCKOUT_DURATION_MIN = int(os.getenv("LOCKOUT_DURATION_MIN", "15"))

_failed_logins: dict[str, list[datetime]] = {}


def _record_failed_login(email: str) -> None:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=_LOCKOUT_WINDOW_MIN)
    stamps = _failed_logins.setdefault(email, [])
    stamps.append(now)
    _failed_logins[email] = [s for s in stamps if s > cutoff]


def _check_locked(email: str) -> bool:
    """True when the account has had too many recent failures. Also
    enforces the lockout duration after the failure window passes."""
    now = datetime.now(timezone.utc)
    stamps = [s for s in _failed_logins.get(email, []) if s > now - timedelta(minutes=_LOCKOUT_WINDOW_MIN)]
    if len(stamps) >= _LOCKOUT_MAX_FAILURES:
        oldest = min(stamps)
        if now - oldest <= timedelta(minutes=_LOCKOUT_DURATION_MIN):
            return True
        # Lockout expired -- reset the counter.
        del _failed_logins[email]
    return False


def _clear_failed_logins(email: str) -> None:
    _failed_logins.pop(email, None)


# =====================================================
# AUTH (public endpoints)
# =====================================================

@app.post("/auth/register", response_model=schemas.UserOut)
@limiter.limit("10/minute")
def register(
    request: Request,
    payload: schemas.UserCreate,
    db: Session = Depends(get_db)
):
    """Create a self-registered staff account (role=receptionist). Public
    endpoint, rate-limited against account-creation spam. The account is
    created UNAPPROVED and cannot sign in until an admin approves it."""
    existing = crud.get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    try:
        user = crud.create_user(
            db,
            email=payload.email,
            password_hash=auth.hash_password(payload.password),
            role=models.UserRole.RECEPTIONIST.value,
            is_approved=False,
        )
    except IntegrityError:
        # Race: a concurrent request (double-click, parallel tab) slipped
        # past the existence check above and one of them lost the UNIQUE
        # constraint. The account exists -- report it as taken instead of
        # a confusing 500 that hides the successful registration.
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered")
    crud.log_action(
        db, user,
        action="register", resource="auth",
        details=f"New user registered (pending approval): {user.email}",
        ip_address=_client_ip(request),
    )
    return user


@app.post("/auth/login", response_model=schemas.Token)
@limiter.limit("10/minute")
def login(
    request: Request,
    payload: schemas.UserLogin,
    response: Response,
    db: Session = Depends(get_db)
):
    """Return a short-lived JWT access token (client memory) and set a
    long-lived rotating refresh token in an HttpOnly, SameSite cookie.
    Uses the same generic error for a missing user and a wrong password
    so we never leak whether an email exists."""
    user = crud.get_user_by_email(db, payload.email)

    if _check_locked(payload.email):
        crud.log_action(
            db, None,
            action="login_blocked", resource="auth",
            details=f"Login blocked for {payload.email}: account temporarily locked",
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Account temporarily locked.",
        )

    if user is None or not auth.verify_password(payload.password, user.password_hash):
        _record_failed_login(payload.email)
        crud.log_action(
            db, None,
            action="login_failed", resource="auth",
            details=f"Failed login attempt for {payload.email}",
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    if not user.is_active:
        crud.log_action(
            db, user,
            action="login_failed", resource="auth",
            details=f"Login blocked for inactive account {user.email}",
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    if not user.is_approved:
        crud.log_action(
            db, user,
            action="login_blocked", resource="auth",
            details=f"Login blocked for unapproved account {user.email} (pending admin approval)",
            ip_address=_client_ip(request),
        )
        raise HTTPException(
            status_code=403,
            detail="Account pending admin approval",
        )

    _clear_failed_logins(payload.email)

    # Transparently upgrade legacy bcrypt hashes to argon2id on login.
    if auth.needs_rehash(user.password_hash):
        crud.set_user_password(db, user.id, auth.hash_password(payload.password))

    # Refresh token: HttpOnly cookie, not readable by JS (XSS-proof),
    # SameSite=Lax blocks cross-site sends, Secure on HTTPS.
    raw_refresh = auth.issue_refresh_token(user.id, db, request)
    response.set_cookie(
        key=auth.REFRESH_COOKIE_NAME,
        value=raw_refresh,
        max_age=auth.REFRESH_EXPIRE_DAYS * 24 * 3600,
        httponly=True,
        secure=auth.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )

    crud.log_action(
        db, user,
        action="login", resource="auth",
        details=f"{user.email} signed in",
        ip_address=_client_ip(request),
    )

    return schemas.Token(
        access_token=auth.create_access_token(user.id, user.role),
        user=schemas.UserOut.model_validate(user),
    )


@app.post("/auth/refresh", response_model=schemas.Token)
@limiter.limit("60/minute")
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Exchange the HttpOnly refresh cookie for a fresh access token. The
    presented refresh token is revoked and replaced (rotation), so a stolen
    cookie stops working after a single use."""
    raw = request.cookies.get(auth.REFRESH_COOKIE_NAME)
    if not raw:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
        )

    new_raw, user = auth.rotate_refresh_token(raw, db, request)
    if user is None or not user.is_active or not user.is_approved:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

    response.set_cookie(
        key=auth.REFRESH_COOKIE_NAME,
        value=new_raw,
        max_age=auth.REFRESH_EXPIRE_DAYS * 24 * 3600,
        httponly=True,
        secure=auth.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )

    return schemas.Token(
        access_token=auth.create_access_token(user.id, user.role),
        user=schemas.UserOut.model_validate(user),
    )


@app.post("/auth/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke the refresh token stored in the cookie (the access JWT is
    stateless and simply dropped client-side) and clear the cookie."""
    raw = request.cookies.get(auth.REFRESH_COOKIE_NAME)
    if raw:
        auth.revoke_refresh_token(raw, db)
    response.delete_cookie(auth.REFRESH_COOKIE_NAME, path="/")

    crud.log_action(
        db, current_user,
        action="logout", resource="auth",
        details=f"{current_user.email} signed out",
        ip_address=_client_ip(request),
    )


@app.post("/auth/change-password", status_code=204)
@limiter.limit("10/minute")
def change_password(
    payload: schemas.ChangePassword,
    request: Request,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Change the authenticated user's own password. Requires the current
    password -- a hijacked session token alone is not enough."""
    if not auth.verify_password(payload.current_password, current_user.password_hash):
        crud.log_action(
            db, current_user,
            action="password_change_failed", resource="auth",
            details=f"Wrong current password for {current_user.email}",
            ip_address=_client_ip(request),
        )
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    crud.set_user_password(
        db,
        current_user.id,
        auth.hash_password(payload.new_password),
    )
    crud.log_action(
        db, current_user,
        action="password_changed", resource="auth",
        details=f"{current_user.email} changed their password",
        ip_address=_client_ip(request),
    )


@app.get("/auth/me", response_model=schemas.UserOut)
def me(
    current_user: models.User = Depends(auth.get_current_user)
):
    """Return the currently authenticated user."""
    return current_user


@app.put("/auth/me", response_model=schemas.UserOut)
def update_me(
    payload: schemas.UserSelfUpdate,
    request: Request,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Let a user edit their own profile (display label / email).

    Changing the email -- the account's login identifier -- requires the
    current password, so a hijacked session alone cannot take the account
    over by pointing the email at the attacker."""
    if payload.email is not None and payload.email != current_user.email:
        if not payload.current_password or not auth.verify_password(
            payload.current_password, current_user.password_hash
        ):
            crud.log_action(
                db, current_user,
                action="email_change_rejected", resource="profile",
                resource_id=current_user.id,
                details=f"Email change for {current_user.email} rejected: missing/wrong password",
                ip_address=_client_ip(request),
            )
            raise HTTPException(
                status_code=400,
                detail="Current password is required to change email",
            )
    try:
        updated = crud.update_self_profile(
            db,
            current_user,
            role_label=payload.role_label,
            email=payload.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    crud.log_action(
        db, current_user,
        action="update", resource="profile", resource_id=current_user.id,
        details=(
            f"{updated.email} updated own profile: "
            f"label={updated.role_label!r}"
        ),
        ip_address=_client_ip(request),
    )
    return updated


@app.post("/auth/create-admin", response_model=schemas.UserOut)
@limiter.limit("5/minute")
def create_admin(
    payload: schemas.CreateAdminRequest,
    request: Request,
    x_admin_setup_secret: str = Header("", alias="X-Admin-Setup-Secret"),
    db: Session = Depends(get_db)
):
    """Bootstrap the first admin. Protected by the ADMIN_SETUP_SECRET
    environment variable -- run once, then set the flag off."""
    if not auth.ADMIN_SETUP_SECRET:
        raise HTTPException(
            status_code=404,
            detail="Admin bootstrap disabled (set ADMIN_SETUP_SECRET)",
        )

    if not secrets.compare_digest(x_admin_setup_secret, auth.ADMIN_SETUP_SECRET):
        raise HTTPException(
            status_code=403,
            detail="Invalid admin setup secret",
        )

    existing = crud.get_user_by_email(db, payload.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = crud.create_user(
        db,
        email=payload.email,
        password_hash=auth.hash_password(payload.password),
        role=models.UserRole.ADMIN.value,
    )
    crud.log_action(
        db, user,
        action="admin_created", resource="auth",
        details=f"Admin account created: {user.email}",
        ip_address=_client_ip(request),
    )
    return user


# =====================================================
# ADMIN (admin-only endpoints)
# =====================================================

@app.get("/admin/users", response_model=List[schemas.UserOut])
def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    _admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    return crud.get_users(db, skip=skip, limit=limit)


@app.get("/admin/users/pending", response_model=List[schemas.UserOut])
def list_pending_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    _admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Self-registered accounts waiting for admin approval."""
    return crud.get_pending_users(db, skip=skip, limit=limit)


@app.post("/admin/users/{user_id}/approve", response_model=schemas.UserOut)
def approve_user(
    user_id: int,
    request: Request,
    current_user: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Approve a pending self-registered account so it can sign in."""
    target = crud.get_user_by_id(db, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    if target.is_approved:
        raise HTTPException(status_code=400, detail="User is already approved")

    approved = crud.set_user_approved(db, user_id, current_user.id)

    crud.log_action(
        db, current_user,
        action="register_approved", resource="users", resource_id=user_id,
        details=f"{current_user.email} approved registration of {target.email}",
        ip_address=_client_ip(request),
    )
    return approved


@app.delete("/admin/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    request: Request,
    current_user: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    user = crud.get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot delete your own account")

    admin_count = crud.count_admins(db)
    if user.role == models.UserRole.ADMIN.value and admin_count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")

    crud.log_action(
        db, current_user,
        action="user_deleted", resource="users", resource_id=user.id,
        details=f"{current_user.email} deleted user {user.email} ({user.role})",
        ip_address=_client_ip(request),
    )
    crud.delete_user(db, user)


@app.put("/admin/users/{user_id}/role", response_model=schemas.UserOut)
def change_user_role(
    user_id: int,
    payload: schemas.RoleUpdate,
    request: Request,
    current_user: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    target = crud.get_user_by_id(db, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot change your own role")

    if (
        target.role == models.UserRole.ADMIN.value
        and payload.role != models.UserRole.ADMIN.value
        and crud.count_admins(db) <= 1
    ):
        raise HTTPException(status_code=400, detail="Cannot demote the last admin")

    updated = crud.set_user_role(db, user_id, payload.role)

    crud.log_action(
        db, current_user,
        action="role_changed", resource="users", resource_id=user_id,
        details=f"{current_user.email} changed {target.email} role: {target.role} -> {payload.role}",
        ip_address=_client_ip(request),
    )
    return updated


@app.put("/admin/users/{user_id}/settings", response_model=schemas.UserOut)
def update_user_settings(
    user_id: int,
    payload: schemas.UserSettingsUpdate,
    request: Request,
    current_user: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Set a user's job title label and page-level permissions."""
    target = crud.get_user_by_id(db, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    updated = crud.set_user_settings(
        db,
        user_id,
        role_label=payload.role_label,
        permissions=payload.permissions,
    )

    crud.log_action(
        db, current_user,
        action="access_changed", resource="users", resource_id=user_id,
        details=(
            f"{current_user.email} updated access for {target.email}: "
            f"label={updated.role_label!r} pages={updated.permissions or 'all'}"
        ),
        ip_address=_client_ip(request),
    )
    return updated


@app.post("/admin/users/{user_id}/reset-password", response_model=schemas.UserOut)
def reset_user_password(
    user_id: int,
    payload: schemas.AdminResetPassword,
    request: Request,
    current_user: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Admin force-resets another account's password (no current password
    needed). Audited so the reset is visible in the tamper-proof log."""
    target = crud.get_user_by_id(db, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    # An admin resetting their own password must go through the normal
    # change-password flow.
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Use your profile to change your own password")

    updated = crud.set_user_password(
        db,
        user_id,
        auth.hash_password(payload.new_password),
    )

    # Kill every active session of the account: the reset may be a response
    # to a compromise, so old refresh cookies must stop working.
    db.query(models.RefreshToken).filter(
        models.RefreshToken.user_id == user_id,
        models.RefreshToken.revoked.is_(False),
    ).update({"revoked": True})
    db.commit()

    crud.log_action(
        db, current_user,
        action="password_reset", resource="users", resource_id=user_id,
        details=f"{current_user.email} reset password for {target.email}",
        ip_address=_client_ip(request),
    )
    return updated


@app.get("/admin/stats", response_model=schemas.AdminStats)
def admin_stats(
    _admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    return crud.get_admin_stats(db)


@app.get("/admin/logs", response_model=schemas.AuditLogPage)
def admin_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    search: Optional[str] = None,
    _admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    logs = crud.get_audit_logs(
        db,
        skip=skip,
        limit=limit,
        action=action,
        user_id=user_id,
        search=search,
    )
    return schemas.AuditLogPage(
        total=crud.count_audit_logs(db),
        logs=logs,
    )


@app.get("/admin/logs/verify")
def verify_admin_logs(
    _admin: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db)
):
    """Replay the HMAC hash chain: detects any tampered or re-ordered
    audit entry. Legacy pre-chain entries are reported as skipped."""
    return crud.verify_audit_chain(db)


# =====================================================
# PATIENTS
# =====================================================

@app.post(
    "/patients/",
    response_model=schemas.Patient
)
def create_patient(
    patient: schemas.PatientCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    # Linking a patient record to a user account grants that account
    # read access -- only admins may create the link.
    if (
        patient.linked_user_id is not None
        and current_user.role != models.UserRole.ADMIN.value
    ):
        raise HTTPException(
            status_code=403,
            detail="Only admins can link a patient record to a user account",
        )
    return crud.create_patient(
        db,
        patient
    )


@app.get(
    "/patients/",
    response_model=List[schemas.Patient]
)
def get_patients(
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=10000),
    search: Optional[str] = None,
    sort_by: Optional[str] = None,
    gender: Optional[str] = None,
    age_group: Optional[str] = None,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.get_patients(
        db,
        skip=skip,
        limit=limit,
        search=search,
        sort_by=sort_by,
        gender=gender,
        age_group=age_group
    )


@app.get("/patients/count")
def count_patients(
    search: Optional[str] = None,
    gender: Optional[str] = None,
    age_group: Optional[str] = None,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return {"total": crud.count_patients(db, search=search, gender=gender, age_group=age_group)}


@app.get(
    "/patients/{patient_id}",
    response_model=schemas.Patient
)
def get_patient(
    patient_id: int,
    current_user: models.User = Depends(auth.require_patient_scope),
    db: Session = Depends(get_db)
):

    patient = crud.get_patient(
        db,
        patient_id
    )

    if not patient:
        raise HTTPException(
            404,
            "Patient not found"
        )

    return patient


@app.put("/patients/{patient_id}", response_model=schemas.Patient)
def update_patient_endpoint(
    patient_id: int,
    patient: schemas.PatientCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    # Only admins may create/change a patient->account access link.
    if (
        patient.linked_user_id is not None
        and current_user.role != models.UserRole.ADMIN.value
    ):
        raise HTTPException(
            status_code=403,
            detail="Only admins can link a patient record to a user account",
        )
    updated = crud.update_patient(db, patient_id, patient)

    if updated is None:
        raise HTTPException(status_code=404, detail="Patient not found")

    return updated


@app.delete("/patients/{patient_id}")
def delete_patient_endpoint(
    patient_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    success = crud.delete_patient(db, patient_id)

    if not success:
        raise HTTPException(status_code=404, detail="Patient not found")

    return {
        "message": "Patient deleted successfully"
    }


# =====================================================
# APPOINTMENTS
# =====================================================

@app.post(
    "/appointments/",
    response_model=schemas.Appointment
)
def create_appointment(
    appointment: schemas.AppointmentCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):

    try:
        return crud.create_appointment(
            db,
            appointment
        )

    except Exception as e:
        raise HTTPException(
            400,
            str(e)
        )


@app.get(
    "/appointments/",
    response_model=List[schemas.Appointment]
)
def get_appointments(
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.get_appointments(db)


@app.get("/appointments/today", response_model=List[schemas.Appointment])
def get_today_appointments(
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.get_today_appointments(db)


@app.get("/appointments/range", response_model=List[schemas.Appointment])
def get_appointments_range(
    start: datetime = Query(...),
    end: datetime = Query(...),
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.get_appointments_range(db, start, end)


@app.get(
    "/patients/{patient_id}/appointments",
    response_model=List[schemas.Appointment]
)
def get_patient_appointments(
    patient_id: int,
    current_user: models.User = Depends(auth.require_patient_scope),
    db: Session = Depends(get_db)
):
    return crud.get_patient_appointments(
        db,
        patient_id
    )


@app.put(
    "/appointments/{appointment_id}",
    response_model=schemas.Appointment
)
def update_appointment(
    appointment_id: int,
    appointment: schemas.AppointmentCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):

    try:
        updated = crud.update_appointment(
            db,
            appointment_id,
            appointment
        )
    except Exception as e:
        raise HTTPException(
            400,
            str(e)
        )

    if not updated:
        raise HTTPException(
            404,
            "Appointment not found"
        )

    return updated


@app.delete(
    "/appointments/{appointment_id}"
)
def delete_appointment(
    appointment_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):

    deleted = crud.delete_appointment(
        db,
        appointment_id
    )

    if not deleted:
        raise HTTPException(
            404,
            "Appointment not found"
        )

    return {
        "message": "deleted"
    }


# =====================================================
# TREATMENTS
# =====================================================

@app.post(
    "/treatments/",
    response_model=schemas.Treatment
)
def create_treatment(
    treatment: schemas.TreatmentCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.create_treatment(
        db,
        treatment
    )


@app.get(
    "/patients/{patient_id}/treatments",
    response_model=List[schemas.Treatment]
)
def get_patient_treatments(
    patient_id: int,
    current_user: models.User = Depends(auth.require_patient_scope),
    db: Session = Depends(get_db)
):
    return crud.get_patient_treatments(
        db,
        patient_id
    )


@app.put(
    "/treatments/{treatment_id}",
    response_model=schemas.Treatment
)
def update_treatment(
    treatment_id: int,
    treatment: schemas.TreatmentCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    updated = crud.update_treatment(
        db,
        treatment_id,
        treatment
    )

    if not updated:
        raise HTTPException(
            404,
            "Treatment not found"
        )

    return updated


@app.delete(
    "/treatments/{treatment_id}"
)
def delete_treatment(
    treatment_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):

    deleted = crud.delete_treatment(
        db,
        treatment_id
    )

    if not deleted:
        raise HTTPException(
            404,
            "Treatment not found"
        )

    return {
        "message": "deleted"
    }


@app.post(
    "/treatments/{treatment_id}/schedule"
)
def schedule_session(
    treatment_id: int,
    session: schemas.AppointmentCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    try:
        return crud.schedule_treatment_session(
            db,
            treatment_id,
            session.appointment_datetime,
            session.reason,
            session.notes
        )
    except Exception as e:
        raise HTTPException(400, str(e))


# =====================================================
# TREATMENT SESSIONS
# =====================================================

@app.post(
    "/treatment-sessions/",
    response_model=schemas.TreatmentSession
)
def create_treatment_session(
    session: schemas.TreatmentSessionCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    try:
        return crud.create_treatment_session(
            db,
            session
        )
    except Exception as e:
        raise HTTPException(400, str(e))


@app.put(
    "/treatment-sessions/{session_id}",
    response_model=schemas.TreatmentSession
)
def update_treatment_session(
    session_id: int,
    session: schemas.TreatmentSessionUpdate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    updated = crud.update_treatment_session(
        db,
        session_id,
        session
    )

    if not updated:
        raise HTTPException(
            404,
            "Treatment session not found"
        )

    return updated


@app.get(
    "/treatments/{treatment_id}/sessions",
    response_model=List[schemas.TreatmentSession]
)
def get_treatment_sessions(
    treatment_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.get_treatment_sessions(
        db,
        treatment_id
    )


@app.delete(
    "/treatment-sessions/{session_id}"
)
def delete_treatment_session(
    session_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):

    deleted = crud.delete_treatment_session(
        db,
        session_id
    )

    if not deleted:
        raise HTTPException(
            404,
            "Treatment session not found"
        )

    return {
        "message": "deleted"
    }


# =====================================================
# TOOTH RECORDS
# =====================================================

@app.post(
    "/teeth/",
    response_model=schemas.ToothRecord
)
def create_tooth_record(
    tooth: schemas.ToothRecordCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.create_tooth_record(
        db,
        tooth
    )


@app.get(
    "/patients/{patient_id}/teeth",
    response_model=List[schemas.ToothRecord]
)
def get_patient_teeth(
    patient_id: int,
    current_user: models.User = Depends(auth.require_patient_scope),
    db: Session = Depends(get_db)
):
    return crud.get_patient_teeth(
        db,
        patient_id
    )


@app.put(
    "/teeth/{tooth_id}",
    response_model=schemas.ToothRecord
)
def update_tooth_record(
    tooth_id: int,
    tooth: schemas.ToothRecordCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):

    updated = crud.update_tooth_record(
        db,
        tooth_id,
        tooth
    )

    if not updated:
        raise HTTPException(
            404,
            "Tooth record not found"
        )

    return updated


# =====================================================
# PAYMENTS
# =====================================================

@app.post(
    "/payments/",
    response_model=schemas.Payment
)
def create_payment(
    payment: schemas.PaymentCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.create_payment(
        db,
        payment
    )


@app.get(
    "/payments/",
    response_model=List[schemas.Payment]
)
def get_payments(
    skip: int = 0,
    limit: int = 10000,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.get_payments(
        db,
        skip,
        limit
    )


@app.get(
    "/patients/{patient_id}/payments",
    response_model=List[schemas.Payment]
)
def get_patient_payments(
    patient_id: int,
    current_user: models.User = Depends(auth.require_patient_scope),
    db: Session = Depends(get_db)
):
    return crud.get_patient_payments(
        db,
        patient_id
    )


@app.delete(
    "/payments/{payment_id}"
)
def delete_payment(
    payment_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):

    deleted = crud.delete_payment(
        db,
        payment_id
    )

    if not deleted:
        raise HTTPException(
            404,
            "Payment not found"
        )

    return {
        "message": "deleted"
    }


@app.put("/payments/{payment_id}", response_model=schemas.Payment)
def update_payment(
    payment_id: int,
    payment: schemas.PaymentUpdate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    updated = crud.update_payment(db, payment_id, payment)
    if not updated:
        raise HTTPException(404, "Payment not found")
    return updated


# =====================================================
# FINANCIAL SUMMARY
# =====================================================

@app.get("/financials/summary")
def get_financial_summary(
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    return crud.get_financial_summary(db)


# =====================================================
# DOCUMENTS
# =====================================================

@app.post(
    "/patients/{patient_id}/documents/upload",
    response_model=schemas.PatientDocument
)
def upload_document(
    patient_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    # Verify the patient exists BEFORE writing anything to disk -- an
    # unknown id would otherwise leave an orphaned file and blow up the
    # DB insert with a raw IntegrityError 500.
    patient = crud.get_patient(db, patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    patient_dir = UPLOAD_DIR / str(patient_id)
    patient_dir.mkdir(parents=True, exist_ok=True)

    # Extension allow-list + size cap before anything touches the disk.
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed (allowed: {', '.join(sorted(ALLOWED_UPLOAD_TYPES))})",
        )

    # Double-extension defense: "img.php.png" passes the allow-list check
    # on its last segment, but the php segment is a red flag -- reject any
    # filename whose non-first dot-segments contain a dangerous extension.
    base_name = Path(filename).name[:120]
    dot_segments = [s.lower() for s in base_name.split(".")]
    if any(seg in DANGEROUS_EXTENSIONS for seg in dot_segments[1:]):
        raise HTTPException(
            status_code=400,
            detail="File name contains a disallowed extension",
        )

    contents = b""
    while True:
        chunk = file.file.read(1024 * 1024)
        if not chunk:
            break
        contents += chunk
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit",
            )

    # Random prefix: kills same-name overwrite races and makes stored
    # names unguessable.
    stored_name = f"{uuid4().hex}_{base_name}" if base_name else f"{uuid4().hex}"
    file_path = patient_dir / stored_name

    # PHI at rest: only ciphertext ever reaches the disk.
    with open(file_path, "wb") as f:
        f.write(encryption.encrypt_bytes(contents))

    doc = crud.create_document(db, schemas.PatientDocumentCreate(
        patient_id=patient_id,
        file_name=stored_name,
        file_type=ALLOWED_UPLOAD_TYPES[ext],
        file_path=str(file_path),
        description=description,
    ))
    return doc


@app.get(
    "/patients/{patient_id}/documents",
    response_model=List[schemas.PatientDocument]
)
def get_patient_documents(
    patient_id: int,
    current_user: models.User = Depends(auth.require_patient_scope),
    db: Session = Depends(get_db)
):
    return crud.get_patient_documents(
        db,
        patient_id
    )


@app.get("/documents/{document_id}/download")
def download_document(
    document_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    doc = crud.get_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = Path(doc.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    try:
        raw = path.read_bytes()
    except OSError:
        raise HTTPException(status_code=404, detail="File not found on disk")
    # Decrypt at read time; legacy plaintext files fall through untouched.
    plain = encryption.decrypt_bytes(raw)
    return Response(
        content=plain,
        media_type=doc.file_type,
        headers={
            "Content-Disposition": f'attachment; filename="{doc.file_name}"',
        },
    )


@app.delete("/documents/{document_id}", status_code=204)
def delete_document(
    document_id: int,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    doc = crud.get_document_by_id(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = Path(doc.file_path)
    if path.exists():
        path.unlink()
    crud.delete_document(db, document_id)


# =====================================================
# TIMELINE
# =====================================================

@app.post(
    "/timeline/",
    response_model=schemas.PatientTimeline
)
def create_timeline_event(
    event: schemas.PatientTimelineCreate,
    current_user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db)
):
    return crud.create_timeline_event(
        db,
        event
    )


@app.get(
    "/patients/{patient_id}/timeline",
    response_model=List[schemas.PatientTimeline]
)
def get_patient_timeline(
    patient_id: int,
    current_user: models.User = Depends(auth.require_patient_scope),
    db: Session = Depends(get_db)
):
    return crud.get_patient_timeline(
        db,
        patient_id
    )
    
    
if __name__ == "__main__":
    import uvicorn
    # Note: reload MUST be False when bundling with PyInstaller
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)