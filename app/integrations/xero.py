"""Xero: OAuth 2.0 (authorisation code) + Accounting API."""
import urllib.parse

from .. import config
from . import IntegrationError, basic_auth, expired, http_json, pence, with_expiry

AUTH_URL = "https://login.xero.com/identity/connect/authorize"
TOKEN_URL = "https://identity.xero.com/connect/token"
CONNECTIONS_URL = "https://api.xero.com/connections"
API = "https://api.xero.com/api.xro/2.0"

REDIRECT_PATH = "/api/connect/xero/callback"


def redirect_uri():
    return config.BASE_URL + REDIRECT_PATH


def authorize_url(state):
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "response_type": "code",
        "client_id": config.XERO_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "scope": config.XERO_SCOPES,
        "state": state,
    })


def exchange_code(code):
    tokens = http_json(TOKEN_URL, method="POST",
                       headers={"Authorization": basic_auth(config.XERO_CLIENT_ID, config.XERO_CLIENT_SECRET)},
                       form={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri()})
    tokens = with_expiry(tokens)
    connections = http_json(CONNECTIONS_URL, headers={"Authorization": f"Bearer {tokens['access_token']}"})
    orgs = [c for c in connections if c.get("tenantType") == "ORGANISATION"]
    if not orgs:
        raise IntegrationError("No Xero organisation was authorised")
    return tokens, orgs[0]["tenantId"], orgs[0].get("tenantName")


def refresh(tokens):
    if not expired(tokens):
        return tokens, False
    fresh = http_json(TOKEN_URL, method="POST",
                      headers={"Authorization": basic_auth(config.XERO_CLIENT_ID, config.XERO_CLIENT_SECRET)},
                      form={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]})
    return with_expiry(fresh), True


def _get(path, tokens, tenant, params=None):
    url = f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    return http_json(url, headers={"Authorization": f"Bearer {tokens['access_token']}", "Xero-tenant-id": tenant})


def _date(s):
    return (s or "")[:10]


def _contact_details(c):
    mobile = ""
    for p in c.get("Phones", []):
        number = "".join(filter(None, [p.get("PhoneCountryCode"), p.get("PhoneAreaCode"), p.get("PhoneNumber")]))
        if number and (p.get("PhoneType") == "MOBILE" or not mobile):
            mobile = number
    person = " ".join(filter(None, [c.get("FirstName"), c.get("LastName")]))
    return {
        "ext_id": c["ContactID"],
        "name": c.get("Name") or person or "Customer",
        "contact_name": person,
        "email": c.get("EmailAddress") or "",
        "phone": mobile,
    }


def _pay_url(invoice_id, tokens, tenant):
    try:
        data = _get(f"Invoices/{invoice_id}/OnlineInvoice", tokens, tenant)
        return (data.get("OnlineInvoices") or [{}])[0].get("OnlineInvoiceUrl", "")
    except IntegrationError:
        return ""


def fetch_invoices(tokens, tenant, known_open_ext_ids=(), known_pay_urls=None):
    """Open sales invoices, plus the current status of any we were already chasing."""
    known_pay_urls = known_pay_urls or {}
    raw = []
    page = 1
    while True:
        data = _get("Invoices", tokens, tenant, {
            "where": 'Type=="ACCREC" AND Status=="AUTHORISED"',
            "page": page,
            "pageSize": 500,
        })
        batch = data.get("Invoices", [])
        raw.extend(batch)
        if len(batch) < 500:
            break
        page += 1

    seen = {i["InvoiceID"] for i in raw}
    missing = [i for i in known_open_ext_ids if i not in seen]
    for start in range(0, len(missing), 50):
        data = _get("Invoices", tokens, tenant, {"IDs": ",".join(missing[start:start + 50])})
        raw.extend(data.get("Invoices", []))

    contact_ids = sorted({i["Contact"]["ContactID"] for i in raw})
    contacts = {}
    for start in range(0, len(contact_ids), 50):
        data = _get("Contacts", tokens, tenant, {"IDs": ",".join(contact_ids[start:start + 50])})
        for c in data.get("Contacts", []):
            contacts[c["ContactID"]] = _contact_details(c)

    out = []
    for i in raw:
        if i.get("CurrencyCode", "GBP") != "GBP":
            continue
        status = {"AUTHORISED": "open", "PAID": "paid"}.get(i.get("Status"), "void")
        if status == "open" and float(i.get("AmountDue", 0)) <= 0:
            status = "paid"
        pay_url = known_pay_urls.get(i["InvoiceID"])
        if status == "open" and not pay_url:
            pay_url = _pay_url(i["InvoiceID"], tokens, tenant)
        out.append({
            "ext_id": i["InvoiceID"],
            "number": i.get("InvoiceNumber") or i["InvoiceID"][:8],
            "reference": i.get("Reference") or "",
            "issue_date": _date(i.get("DateString")),
            "due_date": _date(i.get("DueDateString") or i.get("DateString")),
            "total": pence(i.get("Total")),
            "amount_due": pence(i.get("AmountDue")),
            "status": status,
            "pay_url": pay_url or "",
            "customer": contacts.get(i["Contact"]["ContactID"]) or {
                "ext_id": i["Contact"]["ContactID"], "name": i["Contact"].get("Name", "Customer"),
                "contact_name": "", "email": "", "phone": "",
            },
        })
    return out
