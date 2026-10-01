import json
import os
import tempfile
import unittest
from datetime import date, timedelta

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["ENGINE_INTERVAL"] = "0"

from app import agent, db, engine, latepay, templates  # noqa: E402


class LatePaymentTests(unittest.TestCase):
    def test_reference_dates(self):
        self.assertEqual(latepay.reference_date(date(2026, 3, 1)), date(2025, 12, 31))
        self.assertEqual(latepay.reference_date(date(2026, 6, 30)), date(2025, 12, 31))
        self.assertEqual(latepay.reference_date(date(2026, 7, 1)), date(2026, 6, 30))
        self.assertEqual(latepay.reference_date(date(2025, 12, 31)), date(2025, 6, 30))

    def test_compensation_bands(self):
        self.assertEqual(latepay.compensation_pence(99_999), 4_000)
        self.assertEqual(latepay.compensation_pence(100_000), 7_000)
        self.assertEqual(latepay.compensation_pence(999_999), 7_000)
        self.assertEqual(latepay.compensation_pence(1_000_000), 10_000)

    def test_interest_is_simple_daily(self):
        # £10,000 due 1 Aug 2025 (reference 30 Jun 2025: 4.25%) -> 12.25% a year, 30 days late.
        claim = latepay.calculate(1_000_000, date(2025, 8, 1), date(2025, 8, 31))
        self.assertEqual(claim.annual_rate, 12.25)
        self.assertEqual(claim.days_late, 30)
        self.assertEqual(claim.interest_pence, round(1_000_000 * 0.1225 / 365 * 30))  # £100.68
        self.assertEqual(claim.compensation_pence, 10_000)

    def test_not_late_means_no_claim(self):
        claim = latepay.calculate(50_000, date(2025, 8, 1), date(2025, 7, 20))
        self.assertEqual((claim.days_late, claim.interest_pence, claim.compensation_pence), (0, 0, 0))

    def test_format(self):
        self.assertEqual(latepay.fmt_gbp(123456), "£1,234.56")
        self.assertEqual(latepay.fmt_gbp(123456, cents=False), "£1,235")


class TemplateTests(unittest.TestCase):
    def test_stage_thresholds(self):
        self.assertEqual(templates.stage_for(2), 0)
        self.assertEqual(templates.stage_for(3), 1)
        self.assertEqual(templates.stage_for(12), 2)
        self.assertEqual(templates.stage_for(90), 5)
        self.assertEqual(templates.stage_for(4, min_days=7), 0)

    def test_next_friday_is_never_tomorrow(self):
        thursday = date(2026, 10, 1)
        self.assertEqual(templates.next_friday(thursday), date(2026, 10, 9))
        self.assertEqual(templates.next_friday(date(2026, 9, 29)), date(2026, 10, 2))

    def test_statutory_mentioned_only_when_enabled(self):
        inv = {"number": "INV-1", "reference": "PO-9", "amount_due": 250_000, "due_date": "2026-08-01",
               "issue_date": "2026-07-01", "pay_url": "https://pay.example/x"}
        cust = {"name": "Acme Ltd", "contact_name": "Jo Bloggs"}
        s = dict(db.DEFAULT_SETTINGS)
        msg = templates.render(4, inv, cust, s, date(2026, 9, 1), "Brightside Ltd")
        self.assertIn("Late Payment Act", msg["whatsapp"])
        self.assertIn("£70.00", msg["whatsapp"])
        self.assertIn("PO-9", msg["email"])
        self.assertIsNotNone(msg["claim"])
        s["statutory"] = False
        msg = templates.render(4, inv, cust, s, date(2026, 9, 1), "Brightside Ltd")
        self.assertNotIn("Late Payment", msg["whatsapp"] + msg["email"])
        self.assertIsNone(msg["claim"])


class RulesAgentTests(unittest.TestCase):
    inv = {"number": "INV-7", "amount_due": 10_000, "due_date": "2026-09-01", "issue_date": "2026-08-01",
           "pay_url": "", "reference": ""}
    cust = {"name": "Acme", "contact_name": "Jo Bloggs"}
    today = date(2026, 9, 29)  # a Tuesday

    def ask(self, text):
        return agent.interpret(text, self.inv, self.cust, dict(db.DEFAULT_SETTINGS), "Biz", today=self.today)

    def test_promise(self):
        r = self.ask("Sorry! Will pay it on Friday")
        self.assertEqual(r["intent"], "promise_to_pay")
        self.assertEqual(r["promised_date"], "2026-10-02")
        self.assertFalse(r["needs_owner"])

    def test_promise_with_date(self):
        r = self.ask("We'll settle it by the 15th October")
        self.assertEqual(r["promised_date"], "2026-10-15")

    def test_amount_is_not_a_date(self):
        r = self.ask("Can we pay £2,400 now and the rest later?")
        self.assertNotEqual(r["intent"], "promise_to_pay")

    def test_dispute_goes_to_owner(self):
        r = self.ask("The invoice is wrong, we never received the second batch")
        self.assertEqual(r["intent"], "dispute")
        self.assertTrue(r["needs_owner"])
        self.assertEqual(r["reply"], "")

    def test_paid(self):
        self.assertEqual(self.ask("We paid this yesterday")["intent"], "paid_already")


class EngineTests(unittest.TestCase):
    def setUp(self):
        db.init()
        for t in ("messages", "invoices", "customers", "orgs", "sessions", "users"):
            db.run(f"DELETE FROM {t}")
        uid = db.insert("users", email="o@x.co", name="Owner", pw_hash="x", created_at=db.now_iso())
        self.org_id = db.insert("orgs", owner_id=uid, name="Brightside Ltd", provider="demo",
                                settings=json.dumps(db.DEFAULT_SETTINGS), created_at=db.now_iso())
        engine.sync(self.org())

    def org(self):
        return db.q1("SELECT * FROM orgs WHERE id = ?", self.org_id)

    def test_sync_imports_demo_ledger(self):
        rows = db.q("SELECT * FROM invoices WHERE org_id = ?", self.org_id)
        self.assertEqual(len(rows), 14)
        self.assertTrue(all(r["pay_url"].endswith(r["pay_token"]) for r in rows))

    def test_nothing_sent_until_live(self):
        self.assertEqual(engine.run_org(self.org(), force_hours=True), 0)

    def test_first_contact_never_opens_with_a_claim(self):
        db.update("orgs", self.org_id, live=1)
        sent = engine.run_org(self.org(), force_hours=True)
        self.assertEqual(sent, 11)  # overdue by >= 3 days
        stages = {r["number"]: r["stage"] for r in db.q("SELECT number, stage FROM invoices")}
        self.assertEqual(stages["INV-1061"], 3)   # 90 days late -> "pay by Friday" warning, not a claim
        self.assertEqual(stages["INV-1063"], 1)   # 5 days late -> friendly nudge
        self.assertEqual(stages["INV-1070"], 0)   # not due yet
        # Second pass the same day sends nothing (minimum gap between chases).
        self.assertEqual(engine.run_org(self.org(), force_hours=True), 0)

    def test_gap_then_escalation(self):
        db.update("orgs", self.org_id, live=1)
        engine.run_org(self.org(), force_hours=True)
        later = engine.today() + timedelta(days=7)
        engine.run_org(self.org(), force_hours=True, on=later)
        inv = db.q1("SELECT * FROM invoices WHERE number = 'INV-1061'")
        self.assertEqual(inv["stage"], 4)
        self.assertGreater(inv["statutory_claimed"], 0)

    def test_reply_promise_pauses_then_payment_collects(self):
        db.update("orgs", self.org_id, live=1)
        engine.run_org(self.org(), force_hours=True)
        inv = db.q1("SELECT * FROM invoices WHERE number = 'INV-1042'")
        engine.handle_reply(self.org(), inv, "Apologies, we'll pay it tomorrow")
        inv = db.q1("SELECT * FROM invoices WHERE id = ?", inv["id"])
        self.assertEqual(inv["state"], "promised")
        self.assertEqual(engine.due_for_chase(inv, {"paused": 0}, db.org_settings(self.org()),
                                              engine.today() + timedelta(days=1)), 0)
        auto = db.q("SELECT * FROM messages WHERE invoice_id = ? AND direction = 'out' AND meta LIKE '%agent%'", inv["id"])
        self.assertEqual(len(auto), 1)
        engine.mark_paid(self.org(), inv)
        inv = db.q1("SELECT * FROM invoices WHERE id = ?", inv["id"])
        self.assertEqual((inv["state"], inv["collected_amount"]), ("collected", 845_000))

    def test_dispute_stops_chasing(self):
        db.update("orgs", self.org_id, live=1)
        engine.run_org(self.org(), force_hours=True)
        inv = db.q1("SELECT * FROM invoices WHERE number = 'INV-1047'")
        engine.handle_reply(self.org(), inv, "This is incorrect, we have a complaint about the work")
        inv = db.q1("SELECT * FROM invoices WHERE id = ?", inv["id"])
        self.assertEqual(inv["state"], "disputed")
        self.assertTrue(inv["needs_attention"])
        self.assertEqual(engine.due_for_chase(inv, {"paused": 0}, db.org_settings(self.org()),
                                              engine.today() + timedelta(days=30)), 0)


if __name__ == "__main__":
    unittest.main()
