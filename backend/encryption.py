"""
Field-level encryption at rest for PHI columns.

Uses AES128-GCM (Fernet) from the `cryptography` package via a SQLAlchemy
TypeDecorator so application code keeps working with plain Python strings
while the DB only ever stores ciphertext.

Key management:
  * Prefer the ENCRYPTION_KEY env var (Fernet key, base64 urlsafe).
  * Otherwise, on first run, a fresh key is generated and persisted to
    `.encryption_key` in the backend directory (chmod 0600, gitignored).
  * Never commit keys to the repository.

Legacy rows written before encryption was enabled contain plaintext. Reads
fall back to returning the raw value so existing data keeps working; any
subsequent write encrypts it.
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet
from sqlalchemy import types
from sqlalchemy.engine import Dialect

# =====================================================
# KEY LOADING / BOOTSTRAP
# =====================================================

_fernet: Fernet | None = None


def _load_key() -> bytes:
    env_key = os.getenv("ENCRYPTION_KEY")
    if env_key:
        return env_key.encode("utf-8")

    key_file = Path(__file__).resolve().parent / ".encryption_key"
    if key_file.exists():
        raw = key_file.read_text(encoding="utf-8").strip()
        if raw:
            return raw.encode("utf-8")

    # First run: generate + persist a key so restarts stay decryptable.
    key = Fernet.generate_key()
    try:
        key_file.write_text(key.decode("utf-8"), encoding="utf-8")
        os.chmod(key_file, 0o600)
    except OSError:
        pass  # read-only FS -- key lives only for this process
    return key


def get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_key())
    return _fernet


# =====================================================
# FILE-LEVEL ENCRYPTION (uploaded PHI documents)
# =====================================================

def encrypt_bytes(data: bytes) -> bytes:
    """Encrypt a document's raw bytes for storage on disk."""
    return get_fernet().encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    """Decrypt a stored document. Files written before encryption existed
    (plaintext on disk) are returned as-is."""
    try:
        return get_fernet().decrypt(token)
    except Exception:
        return token


# =====================================================
# SQLALCHEMY TYPE
# =====================================================

class EncryptedText(types.TypeDecorator):
    """Transparently encrypts Text columns at rest.

    Encrypts on write; decrypts on read. Rows that were written before
    encryption existed (plaintext) are returned as-is.
    """

    impl = types.Text
    cache_ok = True

    def process_bind_param(self, value, dialect: Dialect):
        if value is None:
            return None
        return get_fernet().encrypt(str(value).encode("utf-8")).decode("utf-8")

    def process_result_value(self, value, dialect: Dialect):
        if value is None:
            return None
        try:
            return get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
        except Exception:
            # Legacy plaintext row (pre-encryption) -- return as-is.
            return value
