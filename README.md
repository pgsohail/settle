# Settle

**Get paid without the awkward chase.**

Settle is a credit controller for UK small businesses. It connects to Xero or QuickBooks,
finds every overdue invoice, and has a named persona — "Sarah from Accounts" — chase them
politely on WhatsApp and email. When it's justified it quotes the Late Payment of Commercial
Debts (Interest) Act 1998, which entitles UK businesses to statutory interest (8% over the
Bank of England base rate) plus £40–£100 fixed compensation per late invoice.

> **Where this is up to:** a working product you can demo end to end today with sample data.
> It is **not yet live with real customers** — that needs the API keys and approvals listed under
> [What's left](#whats-left).

---

## Try it in 2 minutes

You only need Python 3.9+ (already on every Mac). There's nothing to install.

```bash
git clone https://github.com/pgsohail/settle.git
cd settle
python3 server.py
```

Open **http://localhost:8000**, then:

1. **Start free** → create an account (it's stored locally in `settle.db`).
2. **Try it with sample data** → you'll see "You're owed £44,190" from a realistic UK ledger.
3. **Meet your credit controller** → pick a name, tone and channels; the phone shows each message live.
4. **Start chasing** → 11 chases go out (simulated in sample mode).
5. Open any invoice and use **Reply as customer** — try *"Sorry! Will pay on Friday"* or
   *"The invoice is wrong"* — and watch Sarah log the promise or hand the dispute to you.
6. Open the payment link in a message to see the hosted pay page; paying moves the money into
   "Collected" on the Overview chart.

Run the tests:

```bash
python3 -m unittest discover tests
```

---

## What's done ✅

**Product & UX**
- Marketing site in the style of Goldsand (via Mobbin): serif type, gold coin, forest-green
  comparison bars, giant wordmark footer, live Late Payment Act calculator.
- Motion inspired by Adaline (via Mobbin): money amounts roll into place digit by digit,
  labels decode from scrambled symbols, an ASCII field shimmers behind the hero coin, and the
  stats section's dotted rules draw in on scroll. All of it is switched off for people who
  prefer reduced motion.
- Sign up / log in (salted PBKDF2 passwords, HttpOnly session cookies).
- Onboarding: connect books → "here's what you're owed" reveal → persona setup with live
  WhatsApp preview → review the first batch → go live.
- Minimal app with four pages:
  - **Overview** — one big "You're owed" number, a plain-English sentence, and three simple
    bar charts: *Where your money is* (late / promised / collected), *How late it is*, and
    *Collected each week* (this week in green). Plus "Needs you" and "Latest".
  - **Invoices** — simple list with plain-language status ("Sarah is chasing", "Promised Fri 3 Oct",
    "Needs you"), filters, search (`/`), keyboard navigation (`j`/`k`/`Enter`/`Esc`).
  - **Invoice panel** — a one-sentence summary of what's happening, a 5-step chase progress bar,
    a preview of the next message, Late Payment Act claim, the full WhatsApp/email thread, and a
    composer. Actions: chase now, pause/resume, mark paid.
  - **Activity** — every message, reply and payment, grouped by day, in plain sentences.
  - **Settings** — persona, tone, channels, Late Payment Act on/off, autopilot replies,
    start-after days, business hours; auto-saves.
- Hosted pay page (sample mode).
- Light and dark mode, mobile layout, reduced-motion support.

**Engine**
- **Late Payment Act maths** (`app/latepay.py`): reference-date base rate, simple daily interest,
  £40/£70/£100 compensation bands, all in pence. Covered by tests.
- **5-stage chase sequence** (`app/templates.py`): friendly nudge (3+ days) → follow-up (10+) →
  "pay by Friday" with a statutory warning (17+) → statutory claim with a waiver if paid by Friday
  (24+) → final notice and hand-off to the owner (35+). Gentle / balanced / firm tones.
- **Safety rules** (`app/engine.py`): first contact never opens with a legal claim; at least
  6 days between chases; weekdays and business hours only (UK time); promises pause chasing;
  disputes stop chasing and alert the owner.
- **Reply agent** (`app/agent.py`): understands promises (with dates like "Friday" or "15th Oct"),
  "already paid", disputes, requests for more time and questions. Uses Claude when
  `ANTHROPIC_API_KEY` is set; otherwise built-in rules.
- **Integrations written** (need keys to switch on): Xero OAuth + invoices + contacts + online
  invoice links; QuickBooks OAuth + invoices + customers + invoice links; WhatsApp Cloud API
  (templates and in-session replies) with a signed inbound webhook; SMTP email.
- 19 unit tests covering the maths, the chase rules, reply handling and the full demo flow.

---

## What's left

**To go live with real customers (setup, not code)**
- [ ] Create a **Xero app** and/or **Intuit (QuickBooks) app**; add keys to `.env`
      (redirect URLs are in the table below). Xero needs app certification before other
      businesses can connect.
- [ ] Set up **WhatsApp Business** on Meta: verify the business, register a number, and get the
      `invoice_reminder` template approved (can take a few days).
- [ ] Choose an **email provider** (Postmark, SES, Resend) and verify the sending domain.
- [ ] **Deploy** (Render / Railway / Fly.io) with a persistent disk; set `BASE_URL` to the https URL.
- [ ] **Confirm the Bank of England base rate** for the current reference period
      (`app/config.py`) — the 30 June 2026 value is an estimate to verify.
- [ ] Get the customer-facing wording checked by a solicitor (statutory claim and final notice).

**To build next (code)**
- [ ] **Billing** — Stripe subscriptions for the £199 + 2% and £449 plans, plus the
      "pay nothing if we don't collect in 30 days" guarantee logic.
- [ ] **Inbound email replies** — currently email replies go to the owner's inbox; route them into
      the thread (e.g. Postmark inbound webhook) so Sarah can read them too.
- [ ] **Owner alerts** — WhatsApp/email the owner when something needs them.
- [ ] **Per-customer controls** in the UI — the API supports pausing a customer; add a toggle.
- [ ] **Teams** — more than one user per business; multiple personas/brands for the Unlimited plan.
- [ ] Rate-limit login, add password reset and email verification.
- [ ] Move from SQLite to Postgres when there are many customers.
- [ ] Error monitoring and an audit log export.

---

## Configuration

Copy `.env.example` to `.env`. Anything not configured is simulated, so you can switch things on
one at a time.

| What | Env vars | Notes |
|---|---|---|
| Public URL | `BASE_URL` | e.g. `https://app.yourdomain.co.uk` (turns on secure cookies) |
| Xero | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | Redirect URI: `BASE_URL/api/connect/xero/callback` |
| QuickBooks | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` | Redirect URI: `BASE_URL/api/connect/quickbooks/callback` |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Webhook: `BASE_URL/webhooks/whatsapp` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_DOMAIN` | Any SMTP provider |
| Reply agent | `ANTHROPIC_API_KEY` | Optional; needs `pip install anthropic` |
| Base rate | `BOE_REFERENCE_RATES` | e.g. `{"2026-06-30": 3.75}` to override |

**WhatsApp template:** businesses can only start a WhatsApp conversation with a pre-approved
template. Create one named `invoice_reminder` (category *Utility*, language `en_GB`) with two body
variables: `{{1}}` = contact's first name, `{{2}}` = the message.

## Deploy

```bash
docker build -t settle .
docker run -p 8000:8000 --env-file .env -v settle-data:/data settle
```

## Project layout

```
server.py              entry point (python3 server.py)
app/
  server.py            HTTP API, OAuth callbacks, WhatsApp webhook, static files
  engine.py            sync → decide who to chase → send → handle replies
  templates.py         the 5-stage message sequence
  latepay.py           Late Payment Act interest + compensation
  agent.py             reads customer replies (Claude or rules)
  channels.py          WhatsApp Cloud API + SMTP
  auth.py, db.py       accounts, sessions, SQLite
  integrations/        Xero, QuickBooks, sample ledger
web/                   no-build front end (index.html, app.js, app.css, pay.html)
tests/                 unit tests
```

Not legal advice. Statutory interest applies to business-to-business debts without a substantial
contractual late-payment remedy.
