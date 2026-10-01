"""Late Payment of Commercial Debts (Interest) Act 1998 calculations.

Business-to-business debts that are paid late (and have no substantial contractual
late-payment remedy) carry:

* statutory interest at 8% above the Bank of England "reference rate", simple,
  accruing daily from the day after the due date. The reference rate is the base
  rate in force on 30 June (for debts falling due 1 July - 31 December) or on
  31 December (for debts falling due 1 January - 30 June), and stays fixed for
  the life of that debt; and
* fixed-sum compensation per invoice: £40 (under £1,000), £70 (£1,000 - £9,999.99)
  or £100 (£10,000 and over).

Amounts are handled in pence (int) to avoid float drift.
"""
from dataclasses import dataclass
from datetime import date

from . import config

STATUTORY_MARGIN = 8.0


def reference_date(due: date) -> date:
    """The reference date whose base rate governs a debt that fell due on `due`."""
    if due.month <= 6:
        return date(due.year - 1, 12, 31)
    return date(due.year, 6, 30)


def reference_rate(due: date) -> float:
    ref = reference_date(due).isoformat()
    rates = config.BOE_REFERENCE_RATES
    if ref in rates:
        return float(rates[ref])
    # Fall back to the most recent known rate on or before the reference date.
    known = sorted(k for k in rates if k <= ref)
    if known:
        return float(rates[known[-1]])
    return float(rates[min(rates)])


def compensation_pence(amount_pence: int) -> int:
    if amount_pence < 100_000:
        return 4_000
    if amount_pence < 1_000_000:
        return 7_000
    return 10_000


@dataclass
class Claim:
    principal_pence: int
    days_late: int
    annual_rate: float  # e.g. 11.75 (percent)
    interest_pence: int
    daily_interest_pence: float
    compensation_pence: int

    @property
    def total_claim_pence(self):
        return self.interest_pence + self.compensation_pence

    def as_dict(self):
        return {
            "principal": self.principal_pence,
            "days_late": self.days_late,
            "annual_rate": round(self.annual_rate, 2),
            "interest": self.interest_pence,
            "daily_interest": round(self.daily_interest_pence, 2),
            "compensation": self.compensation_pence,
            "total_claim": self.total_claim_pence,
        }


def calculate(amount_pence: int, due: date, on: date) -> Claim:
    days_late = max(0, (on - due).days)
    annual_rate = STATUTORY_MARGIN + reference_rate(due)
    daily = amount_pence * (annual_rate / 100) / 365
    interest = round(daily * days_late)
    compensation = compensation_pence(amount_pence) if days_late > 0 else 0
    return Claim(amount_pence, days_late, annual_rate, interest, daily, compensation)


def fmt_gbp(pence: int, cents=True) -> str:
    sign = "-" if pence < 0 else ""
    pence = abs(int(pence))
    if cents:
        return f"{sign}£{pence // 100:,}.{pence % 100:02d}"
    return f"{sign}£{round(pence / 100):,}"
