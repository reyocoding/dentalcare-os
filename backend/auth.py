import hashlib
import os
import secrets
import datetime

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

import models
from database import get_db

# =====================================================
# CONFIG (env vars, with safe local-dev defaults)
# =====================================================

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me-in-production-000")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# Access tokens are deliberately short-lived; long sessions are kept alive
# with refresh tokens (rotated on every use, stored hashed in the DB).
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "15"))

REFRESH_COOKIE_NAME = os.getenv("REFRESH_COOKIE_NAME", "refresh_token")
REFRESH_EXPIRE_DAYS = int(os.getenv("REFRESH_EXPIRE_DAYS", "14"))

# "1" (default) sends Secure cookies; set "0" for plain-HTTP local dev.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "1") == "1"

# Secret required to bootstrap the first admin. If empty, the
# POST /auth/create-admin endpoint is disabled entirely.
ADMIN_SETUP_SECRET = os.getenv("ADMIN_SETUP_SECRET", "")

# =====================================================
# PRODUCTION GUARDRAILS -- fail fast, never run with defaults
# =====================================================

if os.getenv("ENV", "development") == "production":
    _jwt = os.getenv("JWT_SECRET", "")
    if not _jwt or _jwt.startswith("dev-secret"):
        raise RuntimeError(
            "Refusing to start in production: JWT_SECRET must be a strong random value"
        )
    if not os.getenv("ENCRYPTION_KEY"):
        raise RuntimeError(
            "Refusing to start in production: ENCRYPTION_KEY must be set "
            "(never rely on the on-disk key file in production)"
        )
    if not os.getenv("ADMIN_SETUP_SECRET"):
        raise RuntimeError(
            "Refusing to start in production: ADMIN_SETUP_SECRET must be set"
        )

bearer_scheme = HTTPBearer(auto_error=False)


# =====================================================
# PASSWORD HASHING (argon2id preferred, bcrypt legacy)
# =====================================================

_pwd_context = CryptContext(
    schemes=["argon2", "bcrypt"],
    deprecated=["auto"],
)

def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd_context.verify(plain, hashed)
    except (ValueError, TypeError):
        return False


def needs_rehash(hashed: str) -> bool:
    """True when the stored hash predates argon2 (legacy bcrypt) and should
    be transparently upgraded on next successful login."""
    try:
        return _pwd_context.needs_update(hashed)
    except (ValueError, TypeError):
        return False


# =====================================================
# JWT ACCESS TOKENS
# =====================================================

def create_access_token(user_id: int, role: str) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "typ": "access",
        "iat": now,
        "exp": now + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


# =====================================================
# REFRESH TOKENS (rotating, hashed at rest, HttpOnly cookie)
# =====================================================

def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_refresh_token(
    user_id: int,
    db: Session,
    request: Request | None = None,
) -> str:
    """Creates a refresh token, stores only its SHA-256 hash, and returns
    the raw token (given to the client inside an HttpOnly cookie)."""
    raw = secrets.token_urlsafe(48)
    token = models.RefreshToken(
        user_id=user_id,
        token_hash=_hash_token(raw),
        expires_at=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(days=REFRESH_EXPIRE_DAYS),
        ip_address=request.client.host if request is not None else None,
        user_agent=request.headers.get("user-agent") if request is not None else None,
    )
    db.add(token)
    db.commit()
    return raw


def validate_refresh_token(raw: str, db: Session) -> models.RefreshToken:
    """Finds a live (unexpired, unrevoked) refresh token by its hash, or
    raises 401 without revealing which condition failed."""
    stored = (
        db.query(models.RefreshToken)
        .filter(models.RefreshToken.token_hash == _hash_token(raw))
        .first()
    )
    if stored is None or stored.revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )
    if stored.expires_at.replace(tzinfo=datetime.timezone.utc) < datetime.datetime.now(
        datetime.timezone.utc
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
        )
    return stored


def revoke_refresh_token(raw: str, db: Session) -> None:
    stored = (
        db.query(models.RefreshToken)
        .filter(models.RefreshToken.token_hash == _hash_token(raw))
        .first()
    )
    if stored is not None:
        stored.revoked = True
        db.commit()


def rotate_refresh_token(
    raw: str,
    db: Session,
    request: Request | None = None,
) -> tuple[str, models.RefreshToken]:
    """Replaces a valid refresh token with a fresh one (rotation). The old
    token is revoked so a stolen token cannot be replayed after first use."""
    stored = validate_refresh_token(raw, db)
    stored.revoked = True

    new_raw = issue_refresh_token(stored.user_id, db, request)
    user = db.query(models.User).filter(models.User.id == stored.user_id).first()
    return new_raw, user


# =====================================================
# DEPENDENCIES
# =====================================================

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """Validates the Bearer JWT and attaches the current user to the request.

    Raises 401 for missing, malformed, or expired tokens -- never reveals
    why the token was rejected."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        payload = decode_token(credentials.credentials)
        if payload.get("typ") != "access":
            raise jwt.InvalidTokenError()
        user_id = int(payload.get("sub"))
    except (jwt.PyJWTError, TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user = db.query(models.User).filter(models.User.id == user_id).first()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    return user


def require_role(*allowed_roles: str):
    """RBAC dependency factory.

    Usage:
        @router.get("/x", dependencies=[Depends(require_role("admin"))])
        @router.get("/y", dependencies=[Depends(require_role("admin", "dentist"))])

    Raises 403 when the caller's role is not allowed.
    """

    def checker(current_user: models.User = Depends(get_current_user)) -> models.User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient privileges",
            )
        return current_user

    return checker


def require_admin(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """Admin-only gate. Raises 403 when the caller is not an admin."""
    if current_user.role != models.UserRole.ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


# Roles allowed to touch clinical/financial data. "user" is the legacy
# pre-RBAC staff role; it keeps full access for backward compatibility.
STAFF_ROLES = (
    models.UserRole.ADMIN.value,
    models.UserRole.DENTIST.value,
    models.UserRole.HYGIENIST.value,
    models.UserRole.RECEPTIONIST.value,
    models.UserRole.USER.value,
)


def require_staff(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """Gates every clinical/financial data endpoint to clinic staff.
    Patient-role accounts get 403 -- they may not read the clinic's data."""
    if current_user.role not in STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient privileges",
        )
    return current_user


def require_patient_scope(
    patient_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.User:
    """Object-level access control for patient records.

    Staff roles pass through (they see any patient). The legacy patient
    role no longer exists, so every non-staff account is rejected.
    """
    if current_user.role in STAFF_ROLES:
        return current_user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Insufficient privileges",
    )
