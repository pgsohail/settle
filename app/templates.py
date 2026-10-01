"""The chase sequence: what the persona says at each stage, per channel and tone."""
from datetime import date, timedelta

from .latepay import calculate, fmt_gbp

# (stage, minimum days overdue, label)
STAGES = [
    (1, 3, "Friendly nudge"),
    (2, 10, "Follow-up"),
    (3, 17, "Pay by Friday"),
    (4, 24, "Statutory claim"),
    (5, 35, "Final notice"),
]
MIN_GAP_DAYS = 6
FINAL_STAGE = 5


def stage_for(days_overdue, min_days=3):
    """The highest stage an invoice this late has earned."""
    earned = 0
    for stage, days, _ in STAGES:
        threshold = max(days, min_days) if stage == 1 else days
        if days_overdue >= threshold:
            earned = stage
    return earned


def stage_label(stage):
    for s, _, label in STAGES:
        if s == stage:
            return label
    return "Not started"


def next_friday(today: date) -> date:
    ahead = (4 - today.weekday()) % 7
    if ahead < 2:  # Too close; give them the following Friday.
        ahead += 7
    return today + timedelta(days=ahead)


def _first_name(contact_name, company):
    if contact_name:
        return contact_name.split()[0]
    return f"the team at {company}"


def _fmt_day(d: date):
    return d.strftime("%A %-d %B")


def render(stage, invoice, customer, settings, today: date, business_name, statutory_ok=True):
    """Return {"whatsapp": str, "email_subject": str, "email": str, "claim": dict|None}."""
    persona = settings["persona_name"]
    role = settings["persona_role"]
    tone = settings["tone"]
    name = _first_name(customer.get("contact_name"), customer["name"])
    amount = fmt_gbp(invoice["amount_due"])
    number = invoice["number"]
    ref = f" (PO {invoice['reference']})" if invoice.get("reference") else ""
    due = date.fromisoformat(invoice["due_date"])
    due_s = due.strftime("%-d %B")
    friday = _fmt_day(next_friday(today))
    link = invoice.get("pay_url") or ""
    link_line = f"\n\nYou can pay securely here: {link}" if link else ""
    sign = f"{persona}\n{role}, {business_name}"

    claim = calculate(invoice["amount_due"], due, today)
    use_statutory = settings["statutory"] and statutory_ok
    interest = fmt_gbp(claim.interest_pence)
    comp = fmt_gbp(claim.compensation_pence)
    new_total = fmt_gbp(invoice["amount_due"] + claim.total_claim_pence)

    hello = {"gentle": "Hi", "balanced": "Hi", "firm": "Hello"}[tone]

    if stage == 1:
        wa = {
            "gentle": f"{hello} {name}, it's {persona} from {business_name} 👋 Just a quick nudge that invoice {number}{ref} for {amount} was due on {due_s}. It's probably slipped through — would you mind taking a look when you get a sec?",
            "balanced": f"{hello} {name}, it's {persona} from {business_name}. Invoice {number}{ref} for {amount} was due on {due_s} and is still showing as unpaid. Could you let me know when it's scheduled?",
            "firm": f"{hello} {name}, {persona} from {business_name} here. Invoice {number}{ref} for {amount} was due on {due_s} and remains unpaid. Please arrange payment or let me know the payment date.",
        }[tone]
        subject = f"Invoice {number} — {amount} now due"
        body = (
            f"{hello} {name},\n\nI hope you're well. A quick reminder that invoice {number}{ref} for {amount} "
            f"fell due on {due_s} and is still showing as outstanding on our side.\n\n"
            f"If it's already on its way, thank you — please ignore this. Otherwise, could you let me know when "
            f"it's scheduled?{link_line}"
        )
    elif stage == 2:
        wa = f"{hello} {name}, {persona} again from {business_name}. Following up on invoice {number} for {amount} (due {due_s}). Is there anything holding it up on your side? If you can give me a payment date I'll make a note of it."
        subject = f"Following up: invoice {number} ({amount})"
        body = (
            f"{hello} {name},\n\nFollowing up on invoice {number}{ref} for {amount}, which was due on {due_s}.\n\n"
            f"If there's a query or something missing (a PO number, a different contact in accounts), just reply and "
            f"I'll sort it straight away. Otherwise, could you confirm a payment date?{link_line}"
        )
    elif stage == 3:
        law = (
            f" If it's still open after that, we'll need to apply statutory interest and compensation under the "
            f"Late Payment of Commercial Debts (Interest) Act 1998 — currently {interest} plus a {comp} fixed fee."
            if use_statutory else ""
        )
        wa = f"{hello} {name}, invoice {number} for {amount} is now {claim.days_late} days overdue. Could you get it paid by {friday}?{law}"
        subject = f"Invoice {number} — please settle by {friday}"
        body = (
            f"{hello} {name},\n\nInvoice {number}{ref} for {amount} is now {claim.days_late} days overdue. "
            f"Could you please arrange payment by {friday}?"
            + (
                f"\n\nI'd like to avoid it, but if the invoice remains unpaid after {friday} we'll apply the "
                f"statutory interest ({claim.annual_rate:.2f}% a year, {interest} to date) and fixed compensation "
                f"({comp}) that UK businesses are entitled to under the Late Payment of Commercial Debts "
                f"(Interest) Act 1998." if use_statutory else ""
            )
            + link_line
        )
    elif stage == 4:
        if use_statutory:
            wa = (
                f"{hello} {name}, as invoice {number} is still unpaid we've now added statutory interest ({interest}) and "
                f"compensation ({comp}) under the Late Payment Act 1998, bringing the total to {new_total}. "
                f"If the original {amount} is paid by {friday}, we're happy to waive the additions."
            )
            subject = f"Invoice {number} — statutory interest and compensation added"
            body = (
                f"{hello} {name},\n\nInvoice {number}{ref} for {amount} is now {claim.days_late} days overdue.\n\n"
                f"Under the Late Payment of Commercial Debts (Interest) Act 1998 we are entitled to claim:\n"
                f"  • Statutory interest at {claim.annual_rate:.2f}% a year: {interest} to date "
                f"(accruing at {fmt_gbp(round(claim.daily_interest_pence))} a day)\n"
                f"  • Fixed-sum compensation: {comp}\n\n"
                f"The balance now due is {new_total}. As a goodwill gesture, if the original {amount} is received "
                f"by {friday} we will waive the interest and compensation.{link_line}"
            )
        else:
            wa = f"{hello} {name}, invoice {number} for {amount} is now {claim.days_late} days overdue and we haven't been able to confirm a payment date. Please arrange payment by {friday}."
            subject = f"Invoice {number} — {claim.days_late} days overdue"
            body = f"{hello} {name},\n\nInvoice {number}{ref} for {amount} is now {claim.days_late} days overdue. Please arrange payment by {friday}.{link_line}"
    else:
        wa = (
            f"{hello} {name}, this is a final reminder for invoice {number} ({amount}, {claim.days_late} days overdue). "
            f"If we don't hear back by {friday}, the account owner at {business_name} will be in touch directly about next steps."
        )
        subject = f"Final reminder: invoice {number}"
        body = (
            f"{hello} {name},\n\nThis is a final reminder that invoice {number}{ref} for {amount} is "
            f"{claim.days_late} days overdue. If we haven't received payment or heard from you by {friday}, "
            f"the owner of {business_name} will contact you directly about next steps.{link_line}"
        )

    if link and stage != 1:
        wa += f"\n\nPay here: {link}"
    elif link:
        wa += f"\n\n{link}"

    return {
        "whatsapp": wa,
        "email_subject": subject,
        "email": f"{body}\n\nThanks,\n{sign}",
        "claim": claim.as_dict() if (stage >= 3 and use_statutory) else None,
    }
