# Settle

**Get paid without the awkward chase.** Settle connects to Xero or QuickBooks and becomes
"Sarah from Accounts" — a calm, polite credit controller who chases every overdue invoice on
WhatsApp and email, and quotes the UK Late Payment of Commercial Debts (Interest) Act 1998 when it matters.

## Run it locally (2 minutes)

Needs only Python 3.9+. No packages to install.

```bash
python3 server.py
```

Open http://localhost:8000 → **Start free** → create an account → **Try it with sample data**.
You'll see the full flow: what you're owed → set up your persona → go live → open any invoice
and use **Reply as customer** to watch Sarah handle the reply. Messages are simulated in sample mode.

Run the tests:

```bash
python3 -m unittest discover tests
```

## Going live

Copy `.env.example` to `.env` and fill in what you need. Every integration is optional — anything
not configured is simulated, so you can turn things on one at a time.

| What | Env vars | Where to get it |
|---|---|---|
| Public URL | `BASE_URL` | Your deployed URL, e.g. `https://app.settle.co` (enables secure cookies) |
| Xero | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | developer.xero.com → New app → redirect URI `BASE_URL/api/connect/xero/callback` |
| QuickBooks | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` | developer.intuit.com → redirect URI `BASE_URL/api/connect/quickbooks/callback` |
| WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Meta WhatsApp Cloud API. Webhook URL: `BASE_URL/webhooks/whatsapp` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_DOMAIN` | Any SMTP provider (Postmark, SES, Resend…) |
| Reply agent | `ANTHROPIC_API_KEY` (optional `AGENT_MODEL`) | console.anthropic.com. Without it, built-in rules handle replies. Needs `pip install anthropic`. |

### WhatsApp template (required)

WhatsApp only lets businesses start a conversation with a **pre-approved template**. Create one in
Meta Business Manager named `invoice_reminder` (or set `WHATSAPP_TEMPLATE`), category *Utility*,
language `en_GB`, with two body variables — `{{1}}` the contact's first name and `{{2}}` the message.
Replies inside the 24-hour customer-service window are sent as free text automatically.

### Bank of England base rate

Statutory interest = 8% + the base rate on the reference date (30 June / 31 December). The table is in
`app/config.py`. **Check the latest rate** at bankofengland.co.uk and override with
`BOE_REFERENCE_RATES='{"2026-06-30": 3.75}'` if it differs.

## Deploy

Any host that runs a Docker container or Python works (Render, Railway, Fly.io). Mount a persistent
disk and set `DATABASE_PATH` to a file on it.

```bash
docker build -t settle .
docker run -p 8000:8000 --env-file .env -v settle-data:/data settle
```

## How it works

```
app/
  server.py        HTTP API, OAuth callbacks, WhatsApp webhook, static web app
  engine.py        sync → decide who to chase → send → handle replies
  templates.py     the 5-stage chase sequence (nudge → follow-up → "by Friday" → statutory claim → final)
  latepay.py       Late Payment Act interest + compensation (pence, simple daily interest)
  agent.py         reads customer replies (Claude, or rules) — promises, "already paid", disputes
  channels.py      WhatsApp Cloud API + SMTP
  integrations/    Xero, QuickBooks, sample ledger
web/               no-build vanilla JS front end (landing, onboarding, dashboard, pay page)
```

Chasing rules: first contact never opens with a legal claim; at least 6 days between chases;
only Monday–Friday inside business hours; promises pause chasing until the date passes;
disputes stop chasing and go to the owner; the final notice hands the invoice back to the owner.

Not legal advice. Statutory interest applies to business-to-business debts without a substantial
contractual late-payment remedy.
