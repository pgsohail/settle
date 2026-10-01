"""Accounting integrations. Each provider returns invoices in one normalised shape:

{
  "ext_id", "number", "reference", "issue_date", "due_date",   # ISO dates
  "total", "amount_due",                                         # pence
  "status": "open" | "paid" | "void", "pay_url",
  "customer": {"ext_id", "name", "contact_name", "email", "phone"},
}
"""
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request


class IntegrationError(Exception):
    pass


def http_json(url, *, method="GET", headers=None, data=None, form=None):
    body = None
    headers = dict(headers or {})
    headers.setdefault("Accept", "application/json")
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise IntegrationError(f"{e.code} from {urllib.parse.urlparse(url).netloc}: {e.read()[:300]!r}") from e
    except urllib.error.URLError as e:
        raise IntegrationError(str(e)) from e


def basic_auth(client_id, client_secret):
    return "Basic " + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()


def with_expiry(tokens):
    tokens = dict(tokens)
    tokens["expires_at"] = time.time() + int(tokens.get("expires_in", 1800)) - 60
    return tokens


def expired(tokens):
    return time.time() >= float(tokens.get("expires_at", 0))


def pence(value):
    return int(round(float(value or 0) * 100))
