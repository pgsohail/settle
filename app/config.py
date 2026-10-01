"""Runtime configuration, read from environment variables (and an optional .env file)."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def env(name, default=""):
    return os.environ.get(name, default)


PORT = int(env("PORT", "8000"))
BASE_URL = env("BASE_URL", f"http://localhost:{PORT}").rstrip("/")
DATABASE_PATH = env("DATABASE_PATH", str(ROOT / "settle.db"))
SECURE_COOKIES = BASE_URL.startswith("https://")
TIMEZONE = env("TIMEZONE", "Europe/London")

# Scheduler: how often the chasing engine wakes up (seconds). 0 disables it.
ENGINE_INTERVAL = int(env("ENGINE_INTERVAL", "900"))

# Accounting integrations
XERO_CLIENT_ID = env("XERO_CLIENT_ID")
XERO_CLIENT_SECRET = env("XERO_CLIENT_SECRET")
XERO_SCOPES = env(
    "XERO_SCOPES",
    "openid profile email offline_access accounting.transactions accounting.contacts",
)
QBO_CLIENT_ID = env("QBO_CLIENT_ID")
QBO_CLIENT_SECRET = env("QBO_CLIENT_SECRET")
QBO_ENVIRONMENT = env("QBO_ENVIRONMENT", "sandbox")  # sandbox | production

# Channels
WHATSAPP_TOKEN = env("WHATSAPP_TOKEN")
WHATSAPP_PHONE_NUMBER_ID = env("WHATSAPP_PHONE_NUMBER_ID")
WHATSAPP_VERIFY_TOKEN = env("WHATSAPP_VERIFY_TOKEN", "settle-verify")
WHATSAPP_APP_SECRET = env("WHATSAPP_APP_SECRET")  # verifies webhook signatures
WHATSAPP_TEMPLATE = env("WHATSAPP_TEMPLATE", "invoice_reminder")
WHATSAPP_TEMPLATE_LANG = env("WHATSAPP_TEMPLATE_LANG", "en_GB")
WHATSAPP_API_VERSION = env("WHATSAPP_API_VERSION", "v21.0")

SMTP_HOST = env("SMTP_HOST")
SMTP_PORT = int(env("SMTP_PORT", "587"))
SMTP_USER = env("SMTP_USER")
SMTP_PASSWORD = env("SMTP_PASSWORD")
SMTP_FROM_DOMAIN = env("SMTP_FROM_DOMAIN", "mail.settle.local")

# Reply agent
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
AGENT_MODEL = env("AGENT_MODEL", "claude-opus-5")

# Bank of England base rate on each statutory reference date (30 June / 31 December).
# The rate in force on the reference date applies to debts falling due in the
# following six months. VERIFY the latest value at
# https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate
# and override with BOE_REFERENCE_RATES='{"2026-06-30": 3.75}' if it has changed.
BOE_REFERENCE_RATES = {
    "2023-06-30": 5.00,
    "2023-12-31": 5.25,
    "2024-06-30": 5.25,
    "2024-12-31": 4.75,
    "2025-06-30": 4.25,
    "2025-12-31": 3.75,
    "2026-06-30": 3.75,
}
BOE_REFERENCE_RATES.update(json.loads(env("BOE_REFERENCE_RATES", "{}") or "{}"))


def xero_enabled():
    return bool(XERO_CLIENT_ID and XERO_CLIENT_SECRET)


def qbo_enabled():
    return bool(QBO_CLIENT_ID and QBO_CLIENT_SECRET)


def whatsapp_enabled():
    return bool(WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID)


def email_enabled():
    return bool(SMTP_HOST)
