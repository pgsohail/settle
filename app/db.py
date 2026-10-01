"""SQLite storage. One connection per thread; rows come back as dicts."""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from . import config

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orgs (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    provider TEXT,                 -- xero | quickbooks | demo
    provider_tenant TEXT,
    provider_tokens TEXT,          -- json
    last_synced_at TEXT,
    live INTEGER NOT NULL DEFAULT 0,
    settings TEXT NOT NULL DEFAULT '{}',
    oauth_state TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    ext_id TEXT,
    name TEXT NOT NULL,
    contact_name TEXT,
    email TEXT,
    phone TEXT,
    paused INTEGER NOT NULL DEFAULT 0,
    UNIQUE (org_id, ext_id)
);
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    ext_id TEXT,
    number TEXT NOT NULL,
    reference TEXT,
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    total INTEGER NOT NULL,        -- pence
    amount_due INTEGER NOT NULL,   -- pence
    currency TEXT NOT NULL DEFAULT 'GBP',
    pay_url TEXT,
    status TEXT NOT NULL DEFAULT 'open',       -- open | paid | void
    state TEXT NOT NULL DEFAULT 'queued',      -- queued | chasing | promised | disputed | paused | collected | paid | void
    stage INTEGER NOT NULL DEFAULT 0,
    last_chased_at TEXT,
    promised_date TEXT,
    statutory_claimed INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    collected_amount INTEGER NOT NULL DEFAULT 0,
    needs_attention INTEGER NOT NULL DEFAULT 0,
    pay_token TEXT,
    UNIQUE (org_id, ext_id)
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    invoice_id INTEGER REFERENCES invoices(id),
    customer_id INTEGER REFERENCES customers(id),
    direction TEXT NOT NULL,       -- out | in | system
    channel TEXT NOT NULL,         -- whatsapp | email | system
    subject TEXT,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',  -- sent | simulated | failed | received
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices(org_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_invoice ON messages(invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
"""


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def conn():
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(config.DATABASE_PATH, timeout=30)
        c.row_factory = lambda cur, row: {d[0]: row[i] for i, d in enumerate(cur.description)}
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")
        _local.conn = c
    return c


def init():
    conn().executescript(SCHEMA)
    conn().commit()


def reset_connection():
    c = getattr(_local, "conn", None)
    if c is not None:
        c.close()
        _local.conn = None


def q(sql, *args):
    return conn().execute(sql, args).fetchall()


def q1(sql, *args):
    return conn().execute(sql, args).fetchone()


def run(sql, *args):
    cur = conn().execute(sql, args)
    conn().commit()
    return cur.lastrowid


def insert(table, **values):
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    return run(f"INSERT INTO {table} ({cols}) VALUES ({marks})", *values.values())


def update(table, row_id, **values):
    if not values:
        return
    sets = ", ".join(f"{k} = ?" for k in values)
    run(f"UPDATE {table} SET {sets} WHERE id = ?", *values.values(), row_id)


# --- org settings -----------------------------------------------------------

DEFAULT_SETTINGS = {
    "persona_name": "Sarah",
    "persona_role": "Accounts",
    "tone": "balanced",           # gentle | balanced | firm
    "channels": {"whatsapp": True, "email": True},
    "statutory": True,            # mention Late Payment Act interest + compensation
    "autopilot": True,            # let the agent answer simple replies on its own
    "min_days_overdue": 3,
    "min_amount": 0,              # pence
    "hours": {"start": 9, "end": 17},
    "owner_phone": "",
    "reply_to": "",
}


def org_settings(org):
    stored = json.loads(org.get("settings") or "{}")
    merged = {**DEFAULT_SETTINGS, **stored}
    merged["channels"] = {**DEFAULT_SETTINGS["channels"], **stored.get("channels", {})}
    merged["hours"] = {**DEFAULT_SETTINGS["hours"], **stored.get("hours", {})}
    return merged


def save_org_settings(org_id, settings):
    update("orgs", org_id, settings=json.dumps(settings))
