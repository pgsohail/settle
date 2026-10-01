"""A realistic sample ledger so owners can see Settle working before connecting their books.

Phone numbers use Ofcom's reserved drama range (07700 900xxx) and emails use example.co.uk.
"""
from datetime import date, timedelta

CUSTOMERS = [
    ("Harbour & Finch Architects", "Olivia Harbour", "07700 900101"),
    ("Northgate Property Services", "James Whitfield", "07700 900102"),
    ("Brightwell Dental Group", "Priya Shah", "07700 900103"),
    ("Kestrel Logistics Ltd", "Tom Reilly", "07700 900104"),
    ("Oakmere Estates", "Hannah Blake", "07700 900105"),
    ("Thistle & Rye Restaurants", "Callum Fraser", "07700 900106"),
    ("Mersey Fit-Out Co", "Daniel Okafor", "07700 900107"),
    ("Lumen Creative Studio", "Sophie Turner", "07700 900108"),
    ("Pennine Care Homes", "Rachel Moss", "07700 900109"),
    ("Albion Recruitment Partners", "Marcus Hale", "07700 900110"),
]

# (customer index, invoice number, PO, days overdue, amount in £)
INVOICES = [
    (0, "INV-1042", "PO-8812", 62, 8_450.00),
    (1, "INV-1047", "NPS-2291", 41, 3_960.00),
    (2, "INV-1051", "", 34, 2_175.50),
    (3, "INV-1055", "KL-40417", 27, 6_240.00),
    (4, "INV-1058", "", 19, 1_480.00),
    (5, "INV-1060", "TR-118", 12, 920.00),
    (6, "INV-1061", "MF-7730", 90, 11_300.00),
    (7, "INV-1063", "", 5, 1_750.00),
    (8, "INV-1064", "PCH-5521", 23, 2_640.00),
    (9, "INV-1066", "", 15, 4_150.00),
    (0, "INV-1069", "PO-8904", 8, 1_125.00),
    (3, "INV-1070", "KL-40502", -6, 3_400.00),
    (1, "INV-1072", "NPS-2340", -12, 2_280.00),
    (5, "INV-1073", "", -20, 640.00),
]


def _slug(name):
    return "".join(ch for ch in name.lower() if ch.isalnum())[:18]


def fetch_invoices(today=None):
    today = today or date.today()
    out = []
    for idx, number, po, days_overdue, amount in INVOICES:
        company, person, phone = CUSTOMERS[idx]
        due = today - timedelta(days=days_overdue)
        issue = due - timedelta(days=30)
        amt = int(round(amount * 100))
        out.append({
            "ext_id": f"demo-{number}",
            "number": number,
            "reference": po,
            "issue_date": issue.isoformat(),
            "due_date": due.isoformat(),
            "total": amt,
            "amount_due": amt,
            "status": "open",
            "pay_url": "",  # filled in with Settle's own demo pay page
            "customer": {
                "ext_id": f"demo-c{idx}",
                "name": company,
                "contact_name": person,
                "email": f"accounts@{_slug(company)}.example.co.uk",
                "phone": phone,
            },
        })
    return out
