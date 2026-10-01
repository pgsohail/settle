"""Outbound channels: WhatsApp (Meta Cloud API) and email (SMTP).

When a channel isn't configured, or the org is in demo mode, messages are
recorded as `simulated` so the whole product can be demoed end to end.
"""
import json
import re
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from . import config


class SendResult:
    def __init__(self, status, meta=None):
        self.status = status  # sent | simulated | failed
        self.meta = meta or {}


def normalise_uk_phone(phone):
    """07700 900123 / +44 7700 900123 / 447700900123 -> 447700900123 (E.164 without '+')."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = "44" + digits[1:]
    return digits if len(digits) >= 10 else ""


def _post_json(url, payload, headers):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read() or b"{}")


def send_whatsapp(to_phone, body, *, template_params=None, within_session=False, simulate=False):
    """Send a WhatsApp message.

    Outside a 24-hour customer-service window WhatsApp only allows pre-approved
    templates, so business-initiated chases go out as the configured template with
    `template_params` (see README). Replies inside the window are free text.
    """
    to = normalise_uk_phone(to_phone)
    if not to:
        return SendResult("failed", {"error": "No valid mobile number"})
    if simulate or not config.whatsapp_enabled():
        return SendResult("simulated", {"to": to})

    url = (
        f"https://graph.facebook.com/{config.WHATSAPP_API_VERSION}/"
        f"{config.WHATSAPP_PHONE_NUMBER_ID}/messages"
    )
    if within_session or not template_params:
        payload = {"messaging_product": "whatsapp", "to": to, "type": "text",
                   "text": {"body": body, "preview_url": True}}
    else:
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": config.WHATSAPP_TEMPLATE,
                "language": {"code": config.WHATSAPP_TEMPLATE_LANG},
                "components": [{
                    "type": "body",
                    "parameters": [{"type": "text", "text": str(p)} for p in template_params],
                }],
            },
        }
    try:
        data = _post_json(url, payload, {"Authorization": f"Bearer {config.WHATSAPP_TOKEN}"})
        wamid = (data.get("messages") or [{}])[0].get("id")
        return SendResult("sent", {"to": to, "wamid": wamid})
    except urllib.error.HTTPError as e:
        return SendResult("failed", {"to": to, "error": e.read().decode(errors="replace")[:500]})
    except (urllib.error.URLError, TimeoutError) as e:
        return SendResult("failed", {"to": to, "error": str(e)})


def send_email(to_addr, subject, body, *, from_name, reply_to=None, simulate=False):
    if not to_addr:
        return SendResult("failed", {"error": "No email address"})
    if simulate or not config.email_enabled():
        return SendResult("simulated", {"to": to_addr})

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, f"accounts@{config.SMTP_FROM_DOMAIN}"))
    msg["To"] = to_addr
    msg["Message-ID"] = make_msgid(domain=config.SMTP_FROM_DOMAIN)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as smtp:
            smtp.starttls()
            if config.SMTP_USER:
                smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
            smtp.send_message(msg)
        return SendResult("sent", {"to": to_addr, "message_id": msg["Message-ID"]})
    except (smtplib.SMTPException, OSError) as e:
        return SendResult("failed", {"to": to_addr, "error": str(e)})
