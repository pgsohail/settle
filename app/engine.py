"""The credit controller: syncs the ledger, decides who to chase, sends, and handles replies."""
import json
import logging
import secrets
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from . import agent, channels, config, db
from .integrations import IntegrationError, demo, quickbooks, xero
from .latepay import calculate, fmt_gbp
from .templates import FINAL_STAGE, MIN_GAP_DAYS, STAGES, render, stage_for, stage_label

log = logging.getLogger("settle.engine")
TZ = ZoneInfo(config.TIMEZONE)

OPEN_STATES = ("queued", "chasing", "promised", "disputed", "paused")


def local_now():
    return datetime.now(TZ)


def today():
    return local_now().date()


# --- messages -------------------------------------------------------------------

def record(org_id, invoice_id, customer_id, direction, channel, body, *, subject=None, status="sent", meta=None):
    return db.insert(
        "messages", org_id=org_id, invoice_id=invoice_id, customer_id=customer_id, direction=direction,
        channel=channel, subject=subject, body=body, status=status, meta=json.dumps(meta or {}),
        created_at=db.now_iso(),
    )


def note(org_id, invoice, body, **meta):
    record(org_id, invoice["id"], invoice["customer_id"], "system", "system", body, meta=meta)


# --- sync -----------------------------------------------------------------------

def _provider_fetch(org):
    known = db.q("SELECT ext_id, pay_url FROM invoices WHERE org_id = ? AND status = 'open'", org["id"])
    known_ids = [k["ext_id"] for k in known]
    known_urls = {k["ext_id"]: k["pay_url"] for k in known if k["pay_url"]}
    provider = org["provider"]
    if provider == "demo":
        return demo.fetch_invoices(today()) if not known_ids else []
    module = {"xero": xero, "quickbooks": quickbooks}[provider]
    tokens = json.loads(org["provider_tokens"] or "{}")
    tokens, changed = module.refresh(tokens)
    if changed:
        db.update("orgs", org["id"], provider_tokens=json.dumps(tokens))
    return module.fetch_invoices(tokens, org["provider_tenant"], known_ids, known_urls)


def sync(org):
    """Pull invoices from the accounting system. Returns the number of invoices touched."""
    rows = _provider_fetch(org)
    for row in rows:
        c = row["customer"]
        cust = db.q1("SELECT * FROM customers WHERE org_id = ? AND ext_id = ?", org["id"], c["ext_id"])
        if cust:
            db.update("customers", cust["id"], name=c["name"], contact_name=c["contact_name"] or cust["contact_name"],
                      email=c["email"] or cust["email"], phone=c["phone"] or cust["phone"])
            customer_id = cust["id"]
        else:
            customer_id = db.insert("customers", org_id=org["id"], ext_id=c["ext_id"], name=c["name"],
                                    contact_name=c["contact_name"], email=c["email"], phone=c["phone"])

        inv = db.q1("SELECT * FROM invoices WHERE org_id = ? AND ext_id = ?", org["id"], row["ext_id"])
        if inv is None:
            if row["status"] != "open":
                continue
            token = secrets.token_urlsafe(12)
            pay_url = row["pay_url"] or f"{config.BASE_URL}/pay/{token}"
            db.insert("invoices", org_id=org["id"], customer_id=customer_id, ext_id=row["ext_id"],
                      number=row["number"], reference=row["reference"], issue_date=row["issue_date"],
                      due_date=row["due_date"], total=row["total"], amount_due=row["amount_due"],
                      pay_url=pay_url, pay_token=token, status="open", state="queued")
            continue

        if inv["status"] != "open":
            continue
        if row["status"] == "open":
            db.update("invoices", inv["id"], amount_due=row["amount_due"], due_date=row["due_date"],
                      reference=row["reference"], pay_url=row["pay_url"] or inv["pay_url"])
        else:
            if row["status"] == "paid":
                mark_paid(org, inv, source=org["provider"])
            else:
                db.update("invoices", inv["id"], status="void", state="void")
                note(org["id"], inv, f"{inv['number']} was voided in {org['provider'].title()}. Chasing stopped.")

    db.update("orgs", org["id"], last_synced_at=db.now_iso())
    return len(rows)


def mark_paid(org, inv, source="manual"):
    chased = inv["stage"] > 0 and inv["state"] != "queued"
    amount = inv["amount_due"]
    db.update("invoices", inv["id"], status="paid", state="collected" if chased else "paid",
              paid_at=db.now_iso(), amount_due=0, needs_attention=0,
              collected_amount=amount if chased else 0)
    if chased:
        note(org["id"], inv, f"Paid — {fmt_gbp(amount)} collected by {db.org_settings(org)['persona_name']}. Chasing stopped.",
             kind="collected", amount=amount)
    else:
        note(org["id"], inv, f"Marked as paid ({source}).", kind="paid")


# --- chasing --------------------------------------------------------------------

def _within_hours(settings, now):
    return now.weekday() < 5 and settings["hours"]["start"] <= now.hour < settings["hours"]["end"]


def next_stage(inv, days_overdue, settings):
    target = stage_for(days_overdue, settings["min_days_overdue"])
    if target <= inv["stage"]:
        return 0
    if inv["stage"] == 0:
        # A first contact never opens with a legal claim, however late the invoice is.
        return min(target, 3)
    return inv["stage"] + 1


def due_for_chase(inv, customer, settings, on: date):
    """Return the stage to send now, or 0."""
    if inv["status"] != "open" or customer["paused"]:
        return 0
    if inv["state"] in ("paused", "disputed"):
        return 0
    if inv["state"] == "promised" and inv["promised_date"] and date.fromisoformat(inv["promised_date"]) >= on:
        return 0
    if inv["amount_due"] < settings["min_amount"]:
        return 0
    days = (on - date.fromisoformat(inv["due_date"])).days
    if days <= 0 or inv["stage"] >= FINAL_STAGE:
        return 0
    if inv["last_chased_at"]:
        last = datetime.fromisoformat(inv["last_chased_at"]).astimezone(TZ).date()
        if (on - last).days < MIN_GAP_DAYS:
            return 0
    return next_stage(inv, days, settings)


def chase(org, inv, stage, *, settings=None, on=None):
    settings = settings or db.org_settings(org)
    on = on or today()
    customer = db.q1("SELECT * FROM customers WHERE id = ?", inv["customer_id"])
    simulate = org["provider"] == "demo"
    msg = render(stage, inv, customer, settings, on, org["name"])
    sent_any = False

    if inv["state"] == "promised":
        note(org["id"], inv, f"Promised date ({inv['promised_date']}) passed without payment. Resuming the chase.")

    if settings["channels"]["whatsapp"] and customer["phone"]:
        first = customer["contact_name"].split()[0] if customer["contact_name"] else "there"
        result = channels.send_whatsapp(customer["phone"], msg["whatsapp"], template_params=[first, msg["whatsapp"]],
                                        simulate=simulate)
        record(org["id"], inv["id"], customer["id"], "out", "whatsapp", msg["whatsapp"], status=result.status,
               meta={**result.meta, "stage": stage, "claim": msg["claim"]})
        sent_any |= result.status in ("sent", "simulated")
    if settings["channels"]["email"] and customer["email"]:
        result = channels.send_email(customer["email"], msg["email_subject"], msg["email"],
                                     from_name=f"{settings['persona_name']} at {org['name']}",
                                     reply_to=settings["reply_to"] or None, simulate=simulate)
        record(org["id"], inv["id"], customer["id"], "out", "email", msg["email"], subject=msg["email_subject"],
               status=result.status, meta={**result.meta, "stage": stage, "claim": msg["claim"]})
        sent_any |= result.status in ("sent", "simulated")

    if not sent_any:
        db.update("invoices", inv["id"], needs_attention=1)
        note(org["id"], inv, f"Couldn't reach {customer['name']} — add a mobile number or email to chase {inv['number']}.",
             kind="unreachable")
        return False

    changes = {"stage": stage, "last_chased_at": db.now_iso(), "state": "chasing"}
    if msg["claim"] and stage >= 4:
        changes["statutory_claimed"] = msg["claim"]["total_claim"]
    db.update("invoices", inv["id"], **changes)
    if stage >= FINAL_STAGE:
        db.update("invoices", inv["id"], needs_attention=1)
        note(org["id"], inv, f"Final notice sent. {inv['number']} is yours to take from here — call {customer['contact_name'] or customer['name']}.",
             kind="escalated")
    return True


def run_org(org, *, force_hours=False, on=None):
    """One pass of the engine for an org. Returns how many chases went out."""
    if not org["live"]:
        return 0
    settings = db.org_settings(org)
    now = local_now()
    if not force_hours and not _within_hours(settings, now):
        return 0
    on = on or now.date()
    sent = 0
    rows = db.q("""SELECT i.*, c.paused AS customer_paused FROM invoices i JOIN customers c ON c.id = i.customer_id
                   WHERE i.org_id = ? AND i.status = 'open' ORDER BY i.due_date""", org["id"])
    for inv in rows:
        customer = {"paused": inv["customer_paused"]}
        stage = due_for_chase(inv, customer, settings, on)
        if stage and chase(org, inv, stage, settings=settings, on=on):
            sent += 1
    return sent


def run_all():
    for org in db.q("SELECT * FROM orgs WHERE provider IS NOT NULL"):
        try:
            stale = not org["last_synced_at"] or (
                datetime.now(TZ) - datetime.fromisoformat(org["last_synced_at"])).total_seconds() > 3600
            if stale and org["provider"] != "demo":
                sync(org)
                org = db.q1("SELECT * FROM orgs WHERE id = ?", org["id"])
            run_org(org)
        except IntegrationError:
            log.exception("Sync failed for org %s", org["id"])
        except Exception:  # noqa: BLE001 — one org must never stop the others
            log.exception("Engine failed for org %s", org["id"])


# --- replies --------------------------------------------------------------------

def invoice_for_reply(org_id, customer_id):
    return db.q1("""SELECT * FROM invoices WHERE org_id = ? AND customer_id = ? AND status = 'open'
                    ORDER BY (last_chased_at IS NULL), last_chased_at DESC, due_date LIMIT 1""", org_id, customer_id)


def handle_reply(org, inv, text, channel="whatsapp", *, simulate=None):
    settings = db.org_settings(org)
    customer = db.q1("SELECT * FROM customers WHERE id = ?", inv["customer_id"])
    simulate = org["provider"] == "demo" if simulate is None else simulate
    history = db.q("SELECT direction, body FROM messages WHERE invoice_id = ? AND direction != 'system' ORDER BY id",
                   inv["id"])
    record(org["id"], inv["id"], customer["id"], "in", channel, text, status="received")

    result = agent.interpret(text, inv, customer, settings, org["name"], today=today(), history=history)
    intent = result["intent"]
    changes = {"needs_attention": 1 if result["needs_owner"] else 0}
    if intent == "promise_to_pay" and result["promised_date"]:
        changes.update(state="promised", promised_date=result["promised_date"])
    elif intent == "paid_already":
        # Give the payment a few days to land in the books before chasing again.
        changes.update(state="promised", promised_date=(today() + timedelta(days=3)).isoformat())
    elif intent == "dispute":
        changes.update(state="disputed")
    db.update("invoices", inv["id"], **changes)

    note(org["id"], inv, result["summary"], kind="agent", intent=intent, needs_owner=result["needs_owner"],
         source=result["source"])

    if result["reply"] and settings["autopilot"] and not result["needs_owner"]:
        send = channels.send_whatsapp(customer["phone"], result["reply"], within_session=True, simulate=simulate)
        record(org["id"], inv["id"], customer["id"], "out", "whatsapp", result["reply"], status=send.status,
               meta={**send.meta, "agent": True, "intent": intent})
    elif result["reply"]:
        note(org["id"], inv, "Suggested reply (not sent — autopilot is off):\n" + result["reply"], kind="draft")
    return result


def owner_reply(org, inv, text):
    customer = db.q1("SELECT * FROM customers WHERE id = ?", inv["customer_id"])
    send = channels.send_whatsapp(customer["phone"], text, within_session=True, simulate=org["provider"] == "demo")
    record(org["id"], inv["id"], customer["id"], "out", "whatsapp", text, status=send.status,
           meta={**send.meta, "owner": True})
    db.update("invoices", inv["id"], needs_attention=0)
    return send


# --- views ----------------------------------------------------------------------

def next_step(inv, settings, on):
    if inv["status"] != "open":
        return None
    if inv["state"] in ("paused", "disputed"):
        return {"label": "Waiting on you", "date": None}
    if inv["state"] == "promised" and inv["promised_date"]:
        d = date.fromisoformat(inv["promised_date"]) + timedelta(days=1)
        return {"label": "Check-in if unpaid", "date": d.isoformat()}
    if inv["stage"] >= FINAL_STAGE:
        return {"label": "Handed to you", "date": None}
    due = date.fromisoformat(inv["due_date"])
    days = (on - due).days
    stage = next_stage(inv, max(days, 0), settings) or inv["stage"] + 1
    threshold = next(d for s, d, _ in STAGES if s == stage)
    if stage == 1:
        threshold = max(threshold, settings["min_days_overdue"])
    when = max(due + timedelta(days=threshold), on)
    if inv["last_chased_at"]:
        last = datetime.fromisoformat(inv["last_chased_at"]).astimezone(TZ).date()
        when = max(when, last + timedelta(days=MIN_GAP_DAYS))
    return {"label": stage_label(stage), "date": when.isoformat(), "stage": stage}


def invoice_view(inv, customer, settings, on):
    due = date.fromisoformat(inv["due_date"])
    claim = calculate(inv["amount_due"], due, on) if inv["status"] == "open" else None
    return {
        "id": inv["id"],
        "number": inv["number"],
        "reference": inv["reference"],
        "issue_date": inv["issue_date"],
        "due_date": inv["due_date"],
        "total": inv["total"],
        "amount_due": inv["amount_due"],
        "status": inv["status"],
        "state": inv["state"],
        "stage": inv["stage"],
        "stage_label": stage_label(inv["stage"]),
        "days_overdue": (on - due).days,
        "promised_date": inv["promised_date"],
        "paid_at": inv["paid_at"],
        "collected_amount": inv["collected_amount"],
        "needs_attention": bool(inv["needs_attention"]),
        "pay_url": inv["pay_url"],
        "last_chased_at": inv["last_chased_at"],
        "claim": claim.as_dict() if claim else None,
        "next": next_step(inv, settings, on),
        "customer": {
            "id": customer["id"], "name": customer["name"], "contact_name": customer["contact_name"],
            "email": customer["email"], "phone": customer["phone"], "paused": bool(customer["paused"]),
        },
    }


def message_view(m):
    return {
        "id": m["id"], "direction": m["direction"], "channel": m["channel"], "subject": m["subject"],
        "body": m["body"], "status": m["status"], "meta": json.loads(m["meta"] or "{}"), "created_at": m["created_at"],
    }
