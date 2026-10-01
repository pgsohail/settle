"""Password hashing and cookie sessions (stdlib only)."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from . import db

ITERATIONS = 310_000
SESSION_DAYS = 30


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS).hex()
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest}"


def verify_password(password, stored):
    try:
        _, iterations, salt, digest = stored.split("$")
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations)).hex()
    return hmac.compare_digest(candidate, digest)


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    db.insert("sessions", token=token, user_id=user_id, expires_at=expires.isoformat())
    return token


def user_for_token(token):
    if not token:
        return None
    row = db.q1("SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", token)
    if not row or datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
        return None
    return row


def destroy_session(token):
    db.run("DELETE FROM sessions WHERE token = ?", token)
