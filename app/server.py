"""HTTP server: JSON API, OAuth callbacks, WhatsApp webhook and the static web app."""
import hashlib
import hmac
import json
import logging
import mimetypes
import re
import secrets
import threading
import time
import urllib.parse
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import auth, channels, config, db, engine
from .integrations import IntegrationError, quickbooks, xero
from .latepay import calculate
from .templates import STAGES, render

log = logging.getLogger("settle")
WEB = config.ROOT / "web"
COOKIE = "settle_session"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

ROUTES = []


def route(method, pattern, *, auth_required=True):
    def deco(fn):
        ROUTES.append((method, re.compile(f"^{pattern}$"), fn, auth_required))
        return fn
    return deco


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def need(cond, message, status=400):
    if not cond:
        raise ApiError(status, message)


# --- helpers ----------------------------------------------------------------------

def org_for(user):
    return db.q1("SELECT * FROM orgs WHERE owner_id = ?", user["id"])


def load_invoice(org, invoice_id):
    inv = db.q1("SELECT * FROM invoices WHERE id = ? AND org_id = ?", int(invoice_id), org["id"])
    need(inv, "Invoice not found", 404)
    return inv


def org_view(org):
    return {
        "id": org["id"], "name": org["name"], "provider": org["provider"], "live": bool(org["live"]),
        "last_synced_at": org["last_synced_at"], "settings": db.org_settings(org),
    }


def integrations_status():
    return {
        "xero": config.xero_enabled(), "quickbooks": config.qbo_enabled(),
        "whatsapp": config.whatsapp_enabled(), "email": config.email_enabled(),
        "agent": bool(config.ANTHROPIC_API_KEY),
    }


# --- auth ---------------------------------------------------------------------------

@route("POST", "/api/signup", auth_required=False)
def signup(req, body):
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    company = (body.get("company") or "").strip()
    password = body.get("password") or ""
    need(name, "Tell us your name")
    need(EMAIL_RE.match(email), "That email doesn't look right")
    need(company, "What's your business called?")
    need(len(password) >= 8, "Use at least 8 characters for your password")
    need(not db.q1("SELECT id FROM users WHERE email = ?", email), "There's already an account with that email — log in instead", 409)
    user_id = db.insert("users", email=email, name=name, pw_hash=auth.hash_password(password), created_at=db.now_iso())
    settings = dict(db.DEFAULT_SETTINGS, reply_to=email)
    db.insert("orgs", owner_id=user_id, name=company, settings=json.dumps(settings), created_at=db.now_iso())
    req.set_session(auth.create_session(user_id))
    return {"ok": True}


@route("POST", "/api/login", auth_required=False)
def login(req, body):
    email = (body.get("email") or "").strip().lower()
    user = db.q1("SELECT * FROM users WHERE email = ?", email)
    if not user or not auth.verify_password(body.get("password") or "", user["pw_hash"]):
        time.sleep(0.4)
        raise ApiError(401, "Email or password is incorrect")
    req.set_session(auth.create_session(user["id"]))
    return {"ok": True}


@route("POST", "/api/logout", auth_required=False)
def logout(req, body):
    if req.session_token:
        auth.destroy_session(req.session_token)
    req.set_session("", clear=True)
    return {"ok": True}


@route("GET", "/api/me")
def me(req, body):
    org = org_for(req.user)
    return {
        "user": {"name": req.user["name"], "email": req.user["email"]},
        "org": org_view(org),
        "integrations": integrations_status(),
    }


# --- connecting books ---------------------------------------------------------------

@route("POST", "/api/connect/demo")
def connect_demo(req, body):
    org = org_for(req.user)
    db.run("DELETE FROM messages WHERE org_id = ?", org["id"])
    db.run("DELETE FROM invoices WHERE org_id = ?", org["id"])
    db.run("DELETE FROM customers WHERE org_id = ?", org["id"])
    db.update("orgs", org["id"], provider="demo", provider_tenant=None, provider_tokens=None, live=0)
    engine.sync(db.q1("SELECT * FROM orgs WHERE id = ?", org["id"]))
    return {"ok": True}


def _oauth_start(req, provider, module, enabled):
    need(enabled, f"{provider.title()} isn't configured on this server yet. Try the sample data for now.", 409)
    org = org_for(req.user)
    state = secrets.token_urlsafe(24)
    db.update("orgs", org["id"], oauth_state=f"{provider}:{state}")
    return {"url": module.authorize_url(state)}


@route("POST", "/api/connect/xero")
def connect_xero(req, body):
    return _oauth_start(req, "xero", xero, config.xero_enabled())


@route("POST", "/api/connect/quickbooks")
def connect_quickbooks(req, body):
    return _oauth_start(req, "quickbooks", quickbooks, config.qbo_enabled())


def _oauth_finish(req, provider, exchange):
    params = req.query
    org = org_for(req.user)
    expected = org["oauth_state"] or ""
    if params.get("error") or expected != f"{provider}:{params.get('state', '')}":
        return req.redirect("/app/connect?error=" + urllib.parse.quote(params.get("error", "state_mismatch")))
    try:
        tokens, tenant, name = exchange(params)
    except IntegrationError as e:
        log.warning("OAuth exchange failed: %s", e)
        return req.redirect("/app/connect?error=exchange_failed")
    if org["provider"] != provider or org["provider_tenant"] != tenant:
        db.run("DELETE FROM messages WHERE org_id = ?", org["id"])
        db.run("DELETE FROM invoices WHERE org_id = ?", org["id"])
        db.run("DELETE FROM customers WHERE org_id = ?", org["id"])
    db.update("orgs", org["id"], provider=provider, provider_tenant=tenant, provider_tokens=json.dumps(tokens),
              oauth_state=None, live=0, name=org["name"] or name)
    return req.redirect("/app/connect?connected=" + provider)


@route("GET", r"/api/connect/xero/callback")
def xero_callback(req, body):
    return _oauth_finish(req, "xero", lambda p: xero.exchange_code(p.get("code", "")))


@route("GET", r"/api/connect/quickbooks/callback")
def qbo_callback(req, body):
    return _oauth_finish(req, "quickbooks", lambda p: quickbooks.exchange_code(p.get("code", ""), p.get("realmId", "")))


@route("POST", "/api/sync")
def sync_now(req, body):
    org = org_for(req.user)
    need(org["provider"], "Connect your accounting software first")
    try:
        count = engine.sync(org)
    except IntegrationError as e:
        raise ApiError(502, f"Couldn't reach {org['provider'].title()}: {e}") from e
    return {"ok": True, "count": count}


# --- overview ------------------------------------------------------------------------

@route("GET", "/api/overview")
def overview(req, body):
    org = org_for(req.user)
    settings = db.org_settings(org)
    on = engine.today()
    rows = db.q("SELECT i.*, c.paused AS customer_paused FROM invoices i JOIN customers c ON c.id = i.customer_id "
                "WHERE i.org_id = ?", org["id"])
    open_rows = [r for r in rows if r["status"] == "open"]
    overdue = [r for r in open_rows if date.fromisoformat(r["due_date"]) < on]

    buckets = {"current": 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0}
    for r in open_rows:
        days = (on - date.fromisoformat(r["due_date"])).days
        key = ("current" if days <= 0 else "1_30" if days <= 30 else "31_60" if days <= 60
               else "61_90" if days <= 90 else "90_plus")
        buckets[key] += r["amount_due"]

    month_start = on.replace(day=1).isoformat()
    collected = [r for r in rows if r["state"] == "collected"]
    statutory = sum(calculate(r["amount_due"], date.fromisoformat(r["due_date"]), on).total_claim_pence for r in overdue)
    ready = [r for r in overdue if r["state"] == "queued" and not r["customer_paused"]
             and (on - date.fromisoformat(r["due_date"])).days >= settings["min_days_overdue"]]

    activity = db.q("""SELECT m.*, i.number, c.name AS customer_name FROM messages m
                       LEFT JOIN invoices i ON i.id = m.invoice_id LEFT JOIN customers c ON c.id = m.customer_id
                       WHERE m.org_id = ? ORDER BY m.id DESC LIMIT 12""", org["id"])
    sent = db.q1("SELECT COUNT(*) AS n FROM messages WHERE org_id = ? AND direction = 'out'", org["id"])["n"]

    # Money collected by Settle in each of the last 8 weeks (weeks start Monday, UK time).
    this_monday = on - timedelta(days=on.weekday())
    weeks = [{"start": (this_monday - timedelta(weeks=8 - 1 - i)).isoformat(), "amount": 0} for i in range(8)]
    for r in collected:
        if not r["paid_at"]:
            continue
        paid = datetime.fromisoformat(r["paid_at"]).astimezone(engine.TZ).date()
        idx = 7 - (this_monday - (paid - timedelta(days=paid.weekday()))).days // 7
        if 0 <= idx < 8:
            weeks[idx]["amount"] += r["collected_amount"]

    return {
        "org": org_view(org),
        "open_total": sum(r["amount_due"] for r in open_rows),
        "overdue_total": sum(r["amount_due"] for r in overdue),
        "overdue_count": len(overdue),
        "customers_overdue": len({r["customer_id"] for r in overdue}),
        "promised_total": sum(r["amount_due"] for r in open_rows if r["state"] == "promised"),
        "promised_count": sum(1 for r in open_rows if r["state"] == "promised"),
        "attention_count": sum(1 for r in open_rows if r["needs_attention"]),
        "collected_month": sum(r["collected_amount"] for r in collected if (r["paid_at"] or "") >= month_start),
        "collected_total": sum(r["collected_amount"] for r in collected),
        "collected_count": len(collected),
        "statutory_available": statutory,
        "ready_count": len(ready),
        "ready_total": sum(r["amount_due"] for r in ready),
        "oldest_days": max(((on - date.fromisoformat(r["due_date"])).days for r in overdue), default=0),
        "buckets": buckets,
        "messages_sent": sent,
        "weekly_collected": weeks,
        "activity": [{**engine.message_view(a), "number": a["number"], "customer_name": a["customer_name"],
                      "invoice_id": a["invoice_id"]} for a in activity],
    }


# --- invoices ------------------------------------------------------------------------

FILTERS = {
    "all": "i.status = 'open'",
    "overdue": "i.status = 'open' AND i.due_date < :today",
    "attention": "i.status = 'open' AND i.needs_attention = 1",
    "chasing": "i.status = 'open' AND i.state = 'chasing'",
    "promised": "i.status = 'open' AND i.state = 'promised'",
    "disputed": "i.status = 'open' AND i.state IN ('disputed', 'paused')",
    "queued": "i.status = 'open' AND i.state = 'queued'",
    "upcoming": "i.status = 'open' AND i.due_date >= :today",
    "paid": "i.status = 'paid'",
}


@route("GET", "/api/invoices")
def invoices(req, body):
    org = org_for(req.user)
    settings = db.org_settings(org)
    on = engine.today()
    f = req.query.get("filter", "overdue")
    need(f in FILTERS, "Unknown filter")
    sql = FILTERS[f].replace(":today", "?")
    args = [org["id"]] + ([on.isoformat()] if "?" in sql else [])
    rows = db.q(f"""SELECT i.* FROM invoices i WHERE i.org_id = ? AND {sql}
                    ORDER BY i.needs_attention DESC, i.due_date ASC""", *args)
    customers = {c["id"]: c for c in db.q("SELECT * FROM customers WHERE org_id = ?", org["id"])}
    last = {m["invoice_id"]: m for m in db.q(
        """SELECT m.* FROM messages m JOIN (SELECT invoice_id, MAX(id) AS id FROM messages
           WHERE org_id = ? GROUP BY invoice_id) x ON x.id = m.id""", org["id"])}
    counts = {}
    for key, cond in FILTERS.items():
        s = cond.replace(":today", "?")
        a = [org["id"]] + ([on.isoformat()] if "?" in s else [])
        counts[key] = db.q1(f"SELECT COUNT(*) AS n FROM invoices i WHERE i.org_id = ? AND {s}", *a)["n"]
    out = []
    for r in rows:
        v = engine.invoice_view(r, customers[r["customer_id"]], settings, on)
        m = last.get(r["id"])
        v["last_message"] = engine.message_view(m) if m else None
        out.append(v)
    return {"invoices": out, "counts": counts}


@route("GET", r"/api/invoices/(\d+)")
def invoice_detail(req, body, invoice_id):
    org = org_for(req.user)
    settings = db.org_settings(org)
    inv = load_invoice(org, invoice_id)
    customer = db.q1("SELECT * FROM customers WHERE id = ?", inv["customer_id"])
    on = engine.today()
    view = engine.invoice_view(inv, customer, settings, on)
    msgs = db.q("SELECT * FROM messages WHERE invoice_id = ? ORDER BY id", inv["id"])
    view["messages"] = [engine.message_view(m) for m in msgs]
    nxt = view["next"]
    if nxt and nxt.get("stage"):
        view["preview"] = render(nxt["stage"], inv, customer, settings, on, org["name"])
    return view


@route("POST", r"/api/invoices/(\d+)/(pause|resume|mark-paid|chase-now|resolve)")
def invoice_action(req, body, invoice_id, action):
    org = org_for(req.user)
    inv = load_invoice(org, invoice_id)
    need(inv["status"] == "open", "This invoice is already closed")
    if action == "pause":
        db.update("invoices", inv["id"], state="paused")
        engine.note(org["id"], inv, "Chasing paused by you.")
    elif action == "resume":
        db.update("invoices", inv["id"], state="chasing" if inv["stage"] else "queued", needs_attention=0)
        engine.note(org["id"], inv, "Chasing resumed.")
    elif action == "resolve":
        db.update("invoices", inv["id"], needs_attention=0)
    elif action == "mark-paid":
        engine.mark_paid(org, inv)
    elif action == "chase-now":
        settings = db.org_settings(org)
        days = (engine.today() - date.fromisoformat(inv["due_date"])).days
        need(days > 0, "This invoice isn't overdue yet")
        need(inv["state"] not in ("disputed",), "Resolve the dispute before chasing again")
        stage = engine.next_stage(inv, days, settings) or min(inv["stage"] + 1, 5)
        need(inv["stage"] < 5, "The final notice has already gone — this one's with you now")
        engine.chase(org, inv, stage, settings=settings)
    return invoice_detail(req, body, invoice_id)


@route("POST", r"/api/invoices/(\d+)/reply")
def invoice_reply(req, body, invoice_id):
    org = org_for(req.user)
    inv = load_invoice(org, invoice_id)
    text = (body.get("text") or "").strip()
    need(text, "Write a message first")
    engine.owner_reply(org, inv, text)
    return invoice_detail(req, body, invoice_id)


@route("POST", r"/api/invoices/(\d+)/simulate")
def invoice_simulate(req, body, invoice_id):
    """Demo only: pretend the customer replied on WhatsApp."""
    org = org_for(req.user)
    need(org["provider"] == "demo", "Customer replies arrive by WhatsApp on live accounts", 403)
    inv = load_invoice(org, invoice_id)
    text = (body.get("text") or "").strip()
    need(text, "Type what the customer says")
    engine.handle_reply(org, inv, text)
    return invoice_detail(req, body, invoice_id)


@route("POST", r"/api/customers/(\d+)/(pause|resume)")
def customer_action(req, body, customer_id, action):
    org = org_for(req.user)
    cust = db.q1("SELECT * FROM customers WHERE id = ? AND org_id = ?", int(customer_id), org["id"])
    need(cust, "Customer not found", 404)
    db.update("customers", cust["id"], paused=1 if action == "pause" else 0)
    return {"ok": True}


@route("PUT", r"/api/customers/(\d+)")
def customer_update(req, body, customer_id):
    org = org_for(req.user)
    cust = db.q1("SELECT * FROM customers WHERE id = ? AND org_id = ?", int(customer_id), org["id"])
    need(cust, "Customer not found", 404)
    phone = (body.get("phone") or "").strip()
    email = (body.get("email") or "").strip()
    need(not phone or channels.normalise_uk_phone(phone), "That mobile number doesn't look right")
    need(not email or EMAIL_RE.match(email), "That email doesn't look right")
    db.update("customers", cust["id"], phone=phone, email=email,
              contact_name=(body.get("contact_name") or cust["contact_name"] or "").strip())
    db.run("UPDATE invoices SET needs_attention = 0 WHERE customer_id = ? AND status = 'open' AND stage < 5", cust["id"])
    return {"ok": True}


# --- going live & settings -----------------------------------------------------------

@route("POST", "/api/golive")
def go_live(req, body):
    org = org_for(req.user)
    need(org["provider"], "Connect your accounting software first")
    excluded = [int(i) for i in body.get("exclude", [])]
    for inv_id in excluded:
        db.run("UPDATE invoices SET state = 'paused' WHERE id = ? AND org_id = ?", inv_id, org["id"])
    db.update("orgs", org["id"], live=1)
    org = db.q1("SELECT * FROM orgs WHERE id = ?", org["id"])
    settings = db.org_settings(org)
    in_hours = engine._within_hours(settings, engine.local_now())
    sent = engine.run_org(org, force_hours=org["provider"] == "demo")
    return {"ok": True, "sent": sent, "in_hours": in_hours or org["provider"] == "demo",
            "hours": settings["hours"]}


@route("POST", "/api/pause-all")
def pause_all(req, body):
    org = org_for(req.user)
    db.update("orgs", org["id"], live=0 if body.get("paused", True) else 1)
    return {"ok": True, "live": not body.get("paused", True)}


@route("GET", "/api/settings")
def get_settings(req, body):
    org = org_for(req.user)
    return {"org": org_view(org), "integrations": integrations_status(),
            "stages": [{"stage": s, "days": d, "label": l} for s, d, l in STAGES]}


@route("PUT", "/api/settings")
def put_settings(req, body):
    org = org_for(req.user)
    current = db.org_settings(org)
    incoming = body.get("settings", {})
    allowed = set(db.DEFAULT_SETTINGS)
    for key, value in incoming.items():
        if key in allowed:
            current[key] = value
    need(current["tone"] in ("gentle", "balanced", "firm"), "Unknown tone")
    need(str(current["persona_name"]).strip(), "Give your credit controller a name")
    current["persona_name"] = str(current["persona_name"]).strip()[:40]
    current["persona_role"] = str(current["persona_role"]).strip()[:40] or "Accounts"
    current["min_days_overdue"] = max(1, min(30, int(current["min_days_overdue"])))
    h = current["hours"]
    h["start"], h["end"] = int(h["start"]), int(h["end"])
    need(0 <= h["start"] < h["end"] <= 24, "Business hours don't look right")
    db.save_org_settings(org["id"], current)
    if body.get("name"):
        db.update("orgs", org["id"], name=str(body["name"]).strip()[:80])
    return get_settings(req, body)


@route("POST", "/api/preview")
def preview(req, body):
    org = org_for(req.user)
    settings = {**db.org_settings(org), **{k: v for k, v in body.get("settings", {}).items() if k in db.DEFAULT_SETTINGS}}
    on = engine.today()
    inv = db.q1("SELECT * FROM invoices WHERE org_id = ? AND status = 'open' AND due_date < ? ORDER BY amount_due DESC LIMIT 1",
                org["id"], on.isoformat())
    if inv:
        customer = db.q1("SELECT * FROM customers WHERE id = ?", inv["customer_id"])
    else:
        inv = {"number": "INV-1001", "reference": "", "amount_due": 245000, "due_date": on.isoformat(),
               "issue_date": on.isoformat(), "pay_url": f"{config.BASE_URL}/pay/example"}
        customer = {"name": "Acme Ltd", "contact_name": "Alex Morgan"}
    stage = int(body.get("stage", 1))
    need(1 <= stage <= 5, "Unknown stage")
    msg = render(stage, inv, customer, settings, on, org["name"])
    return {"stage": stage, "customer": customer["name"], **msg}


@route("GET", "/api/activity")
def activity(req, body):
    org = org_for(req.user)
    rows = db.q("""SELECT m.*, i.number, c.name AS customer_name FROM messages m
                   LEFT JOIN invoices i ON i.id = m.invoice_id LEFT JOIN customers c ON c.id = m.customer_id
                   WHERE m.org_id = ? ORDER BY m.id DESC LIMIT 200""", org["id"])
    return {"activity": [{**engine.message_view(a), "number": a["number"], "customer_name": a["customer_name"],
                          "invoice_id": a["invoice_id"]} for a in rows]}


@route("GET", "/api/public/claim", auth_required=False)
def public_claim(req, body):
    """Late Payment Act calculator for the marketing site."""
    try:
        amount = int(round(float(req.query.get("amount", "0")) * 100))
        days = int(req.query.get("days", "0"))
    except ValueError as e:
        raise ApiError(400, "Enter an amount and number of days") from e
    need(0 < amount <= 10_000_000_000 and 0 <= days <= 3650, "Enter an amount and number of days")
    on = engine.today()
    claim = calculate(amount, on - timedelta(days=days), on)
    return claim.as_dict()


# --- demo pay page ---------------------------------------------------------------------

@route("GET", r"/api/pay/([\w-]+)", auth_required=False)
def pay_info(req, body, token):
    inv = db.q1("SELECT * FROM invoices WHERE pay_token = ?", token)
    need(inv, "This payment link isn't valid", 404)
    org = db.q1("SELECT * FROM orgs WHERE id = ?", inv["org_id"])
    customer = db.q1("SELECT name FROM customers WHERE id = ?", inv["customer_id"])
    return {"business": org["name"], "customer": customer["name"], "number": inv["number"],
            "amount": inv["amount_due"] or inv["collected_amount"] or inv["total"], "due_date": inv["due_date"],
            "paid": inv["status"] == "paid", "demo": org["provider"] == "demo"}


@route("POST", r"/api/pay/([\w-]+)", auth_required=False)
def pay_now(req, body, token):
    inv = db.q1("SELECT * FROM invoices WHERE pay_token = ?", token)
    need(inv, "This payment link isn't valid", 404)
    org = db.q1("SELECT * FROM orgs WHERE id = ?", inv["org_id"])
    need(org["provider"] == "demo", "Payments for this invoice are taken by your accounting software", 403)
    if inv["status"] == "open":
        engine.mark_paid(org, inv, source="payment link")
    return pay_info(req, body, token)


# --- WhatsApp webhook ------------------------------------------------------------------

@route("GET", "/webhooks/whatsapp", auth_required=False)
def wa_verify(req, body):
    q = req.query
    if q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") == config.WHATSAPP_VERIFY_TOKEN:
        return req.send_text(q.get("hub.challenge", ""))
    raise ApiError(403, "Verification failed")


@route("POST", "/webhooks/whatsapp", auth_required=False)
def wa_inbound(req, body):
    if config.WHATSAPP_APP_SECRET:
        expected = "sha256=" + hmac.new(config.WHATSAPP_APP_SECRET.encode(), req.raw_body, hashlib.sha256).hexdigest()
        need(hmac.compare_digest(expected, req.headers.get("X-Hub-Signature-256", "")), "Bad signature", 403)
    for entry in body.get("entry", []):
        for change in entry.get("changes", []):
            for msg in change.get("value", {}).get("messages", []):
                if msg.get("type") != "text":
                    continue
                sender = channels.normalise_uk_phone(msg.get("from", ""))
                text = msg["text"]["body"]
                for cust in db.q("SELECT * FROM customers WHERE phone IS NOT NULL AND phone != ''"):
                    if channels.normalise_uk_phone(cust["phone"]) != sender:
                        continue
                    org = db.q1("SELECT * FROM orgs WHERE id = ? AND provider != 'demo'", cust["org_id"])
                    inv = org and engine.invoice_for_reply(org["id"], cust["id"])
                    if inv:
                        engine.handle_reply(org, inv, text, simulate=False)
    return {"ok": True}


# --- plumbing ----------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "Settle/1.0"

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    # request context
    def _prepare(self):
        parsed = urllib.parse.urlparse(self.path)
        self.route_path = parsed.path
        self.query = dict(urllib.parse.parse_qsl(parsed.query))
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        self.session_token = cookie[COOKIE].value if COOKIE in cookie else None
        self.user = None
        self._cookie = None
        length = int(self.headers.get("Content-Length") or 0)
        self.raw_body = self.rfile.read(length) if length else b""

    def set_session(self, token, clear=False):
        attrs = ["Path=/", "HttpOnly", "SameSite=Lax"]
        if config.SECURE_COOKIES:
            attrs.append("Secure")
        attrs.append("Max-Age=0" if clear else f"Max-Age={auth.SESSION_DAYS * 86400}")
        self._cookie = f"{COOKIE}={token}; " + "; ".join(attrs)

    def _send(self, status, payload, content_type, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if self._cookie:
            self.send_header("Set-Cookie", self._cookie)
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def send_json(self, status, data):
        self._send(status, json.dumps(data).encode(), "application/json; charset=utf-8",
                   {"Cache-Control": "no-store"})

    def send_text(self, text):
        self._send(200, text.encode(), "text/plain; charset=utf-8")
        return _SENT

    def redirect(self, location):
        self._send(302, b"", "text/plain", {"Location": location})
        return _SENT

    def _static(self):
        path = self.route_path
        if path.startswith("/static/"):
            target = (WEB / path[len("/static/"):]).resolve()
            if WEB.resolve() not in target.parents or not target.is_file():
                return self._send(404, b"Not found", "text/plain")
            ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            return self._send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"})
        page = "pay.html" if path.startswith("/pay/") else "index.html"
        return self._send(200, (WEB / page).read_bytes(), "text/html; charset=utf-8", {"Cache-Control": "no-cache"})

    def _dispatch(self, method):
        self._prepare()
        path = self.route_path
        if method == "GET" and not (path.startswith("/api/") or path.startswith("/webhooks/")):
            return self._static()
        for m, pattern, fn, auth_required in ROUTES:
            match = pattern.match(path)
            if m != method or not match:
                continue
            try:
                if auth_required:
                    self.user = auth.user_for_token(self.session_token)
                    if not self.user:
                        if method == "GET" and "callback" in path:
                            return self.redirect("/login")
                        raise ApiError(401, "Please log in")
                body = {}
                if self.raw_body:
                    ctype = self.headers.get("Content-Type", "")
                    need("application/json" in ctype, "Expected JSON", 415)
                    body = json.loads(self.raw_body)
                result = fn(self, body, *match.groups())
                if result is not _SENT:
                    self.send_json(200, result)
            except ApiError as e:
                self.send_json(e.status, {"error": e.message})
            except json.JSONDecodeError:
                self.send_json(400, {"error": "Invalid JSON"})
            except Exception:  # noqa: BLE001
                log.exception("Unhandled error on %s %s", method, path)
                self.send_json(500, {"error": "Something went wrong on our side. Please try again."})
            return
        self.send_json(404, {"error": "Not found"})

    def do_GET(self):
        try:
            self._dispatch("GET")
        finally:
            db.reset_connection()

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        try:
            self._dispatch("POST")
        finally:
            db.reset_connection()

    def do_PUT(self):
        try:
            self._dispatch("PUT")
        finally:
            db.reset_connection()


_SENT = object()


def _scheduler():
    while True:
        time.sleep(config.ENGINE_INTERVAL)
        try:
            engine.run_all()
        except Exception:  # noqa: BLE001
            log.exception("Scheduler pass failed")
        finally:
            db.reset_connection()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    db.init()
    if config.ENGINE_INTERVAL > 0:
        threading.Thread(target=_scheduler, daemon=True, name="engine").start()
    server = ThreadingHTTPServer(("0.0.0.0", config.PORT), Handler)
    log.info("Settle running on %s (engine every %ss)", config.BASE_URL, config.ENGINE_INTERVAL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
