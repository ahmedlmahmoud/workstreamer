"""M4 widget catalog — auto-hide empty extras."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_DASH = Path(__file__).resolve().parents[1]
if str(_DASH) not in sys.path:
    sys.path.insert(0, str(_DASH))

from workstreamer_lib.schema import empty_pulse  # noqa: E402
from workstreamer_lib.widgets import widget_tabs  # noqa: E402


class TestWidgetCatalog(unittest.TestCase):
    def test_faceless_shaped_has_no_ship_or_health(self):
        p = empty_pulse("faceless")
        tabs = widget_tabs(p, has_repo=False, has_checker=False, milestones=[])
        self.assertEqual(tabs[:3], ["missions", "blockers", "resources"])
        self.assertNotIn("ship", tabs)
        self.assertNotIn("health", tabs)
        self.assertNotIn("pipeline", tabs)
        self.assertNotIn("milestones", tabs)
        self.assertIn("notes", tabs)
        self.assertIn("timeline", tabs)

    def test_sanziq_shaped_shows_earned_extras(self):
        p = empty_pulse("sanziq")
        p["pipeline"] = ["design", "ship"]
        p["resources"] = [
            {"id": "r-u", "kind": "url", "title": "fe", "url": "https://fe.sq.dabbo.net", "status": "up"},
            {"id": "r-p", "kind": "pr", "title": "PR", "url": "https://github.com/a/b/pull/1", "status": "open"},
        ]
        p["blockers"] = [
            {"id": "b-w", "title": "Wait", "kind": "waiting-on", "status": "open", "waiting_on": "party"},
        ]
        p["locks"] = [{"id": "k-1", "title": "No shape"}]
        tabs = widget_tabs(
            p,
            has_repo=True,
            has_checker=True,
            milestones=[{"id": "M1"}],
        )
        for extra in ("health", "ship", "pipeline", "milestones", "waiting-on", "checks", "locks"):
            self.assertIn(extra, tabs, extra)

    def test_pipeline_comes_from_pulse_not_hardcoded(self):
        p = empty_pulse("x")
        p["pipeline"] = ["bid", "interview"]
        tabs = widget_tabs(p, has_repo=False, has_checker=False, milestones=[])
        self.assertIn("pipeline", tabs)

    def test_no_client_word_in_tab_ids(self):
        p = empty_pulse("x")
        p["blockers"] = [{"id": "b", "title": "x", "kind": "waiting-on", "status": "open"}]
        tabs = widget_tabs(p, has_repo=False, has_checker=False, milestones=[])
        self.assertIn("waiting-on", tabs)
        self.assertNotIn("client", tabs)


if __name__ == "__main__":
    unittest.main()
