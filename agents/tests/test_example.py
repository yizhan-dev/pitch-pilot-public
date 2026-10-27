import asyncio
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from example import FIXTURE, run  # noqa: E402


class WorkflowTest(unittest.TestCase):
    def test_editor_sends_overlong_passage_back_and_preserves_accepted_text(self):
        sheet = json.loads(FIXTURE.read_text())
        result = asyncio.run(run(sheet))
        self.assertEqual(result["mode"], "dry")
        self.assertEqual(result["duration_method"], "estimate")
        self.assertEqual(result["reason"], "approved")
        self.assertEqual(result["rounds"], 2)
        self.assertEqual(result["unresolved"], [])
        self.assertTrue(result["checks"][0]["opening"]["hard"])
        self.assertFalse(result["checks"][1]["opening"]["hard"])
        self.assertEqual(result["drafts"][0][1], result["drafts"][1][1])
        self.assertEqual([c["role"] for c in result["calls"]],
                         ["analyst", "commentator", "editor", "commentator", "editor"])

    def test_round_limit_reports_unresolved_output(self):
        result = asyncio.run(run(json.loads(FIXTURE.read_text()), rounds=1))
        self.assertTrue(result["unresolved"])
        self.assertIn("out of rounds", result["reason"])


if __name__ == "__main__":
    unittest.main()
