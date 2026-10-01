"""QuickBooks Online: OAuth 2.0 + Accounting API."""
import urllib.parse

from .. import config
from . import basic_auth, expired, http_json, pence, with_expiry

AUTH_URL = "https://appcenter.intuit.com/connect/oauth2"
TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
SCOPE = "com.intuit.quickbooks.accounting"
REDIRECT_PATH = "/api/connect/quickbooks/callback"
MINOR_VERSION = "75"


def api_base():
    if config.QBO_ENVIRONMENT == "production":
        return "https://quickbooks.api.intuit.com"
    return "https://sandbox-quickbooks.api.intuit.com"


def redirect_uri():
    return config.BASE_URL + REDIRECT_PATH


def authorize_url(state):
    return AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": config.QBO_CLIENT_ID,
        "response_type": "code",
        "scope": SCOPE,
        "redirect_uri": redirect_uri(),
        "state": state,
    })


def exchange_code(code, realm_id):
    tokens = http_json(TOKEN_URL, method="POST",
                       headers={"Authorization": basic_auth(config.QBO_CLIENT_ID, config.QBO_CLIENT_SECRET)},
                       form={"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri()})
    tokens = with_expiry(tokens)
    info = _get(f"companyinfo/{realm_id}", tokens, realm_id)
    name = info.get("CompanyInfo", {}).get("CompanyName")
    return tokens, realm_id, name


def refresh(tokens):
    if not expired(tokens):
        return tokens, False
    fresh = http_json(TOKEN_URL, method="POST",
                      headers={"Authorization": basic_auth(config.QBO_CLIENT_ID, config.QBO_CLIENT_SECRET)},
                      form={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]})
    return with_expiry(fresh), True


def _get(path, tokens, realm, params=None):
    params = {"minorversion": MINOR_VERSION, **(params or {})}
    url = f"{api_base()}/v3/company/{realm}/{path}?" + urllib.parse.urlencode(params)
    return http_json(url, headers={"Authorization": f"Bearer {tokens['access_token']}"})


def _query(sql, tokens, realm, extra=None):
    rows, start = [], 1
    while True:
        data = _get("query", tokens, realm, {"query": f"{sql} STARTPOSITION {start} MAXRESULTS 1000", **(extra or {})})
        entity = next(iter(data.get("QueryResponse", {}).values()), [])
        batch = entity if isinstance(entity, list) else []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def fetch_invoices(tokens, realm, known_open_ext_ids=(), known_pay_urls=None):
    raw = _query("SELECT * FROM Invoice WHERE Balance > '0'", tokens, realm, {"include": "invoiceLink"})
    seen = {i["Id"] for i in raw}
    missing = [i for i in known_open_ext_ids if i not in seen]
    for start in range(0, len(missing), 100):
        ids = ", ".join(f"'{i}'" for i in missing[start:start + 100])
        raw.extend(_query(f"SELECT * FROM Invoice WHERE Id IN ({ids})", tokens, realm))

    customer_ids = sorted({i["CustomerRef"]["value"] for i in raw})
    customers = {}
    for start in range(0, len(customer_ids), 100):
        ids = ", ".join(f"'{i}'" for i in customer_ids[start:start + 100])
        for c in _query(f"SELECT * FROM Customer WHERE Id IN ({ids})", tokens, realm):
            person = " ".join(filter(None, [c.get("GivenName"), c.get("FamilyName")]))
            customers[c["Id"]] = {
                "ext_id": c["Id"],
                "name": c.get("CompanyName") or c.get("DisplayName") or person,
                "contact_name": person,
                "email": (c.get("PrimaryEmailAddr") or {}).get("Address", ""),
                "phone": (c.get("Mobile") or c.get("PrimaryPhone") or {}).get("FreeFormNumber", ""),
            }

    out = []
    for i in raw:
        currency = (i.get("CurrencyRef") or {}).get("value", "GBP")
        if currency != "GBP":
            continue
        balance = pence(i.get("Balance"))
        cref = i["CustomerRef"]
        out.append({
            "ext_id": i["Id"],
            "number": i.get("DocNumber") or i["Id"],
            "reference": (i.get("CustomerMemo") or {}).get("value", "")[:40],
            "issue_date": i.get("TxnDate", ""),
            "due_date": i.get("DueDate") or i.get("TxnDate", ""),
            "total": pence(i.get("TotalAmt")),
            "amount_due": balance,
            "status": "open" if balance > 0 else "paid",
            "pay_url": i.get("InvoiceLink", ""),
            "customer": customers.get(cref["value"]) or {
                "ext_id": cref["value"], "name": cref.get("name", "Customer"),
                "contact_name": "", "email": "", "phone": "",
            },
        })
    return out
