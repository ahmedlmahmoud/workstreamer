"""M1 snapshot + slash + STATUS-LIVE preamble guard."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

_PLUGIN = Path(__file__).resolve().parents[2]
_DASH = _PLUGIN / "dashboard"
if str(_DASH) not in sys.path:
    sys.path.insert(0, str(_DASH))
if str(_PLUGIN) not in sys.path:
    sys.path.insert(0, str(_PLUGIN))

from workstreamer_lib import store as pulse_store  # noqa: E402
from workstreamer_lib.pulse import parse_status_live  # noqa: E402
from workstreamer_lib.schema import recommend_today, validate  # noqa: E402
from workstreamer_lib.snapshot import stream_snapshot  # noqa: E402
import slash  # noqa: E402


class TestPreambleNotPrs(unittest.TestCase):
    def test_status_live_preamble_is_not_prs(self):
        text = Path(
            "/home/ubuntu/dabbo-state/workstreams/workstreamer/scope/STATUS-LIVE.md"
        ).read_text()
        parsed = parse_status_live(text)
        joined = " ".join(parsed.get("prs") or [])
        self.assertNotIn("Last updated", joined)
        self.assertNotIn("DO NOT TRUST", joined)
        self.assertFalse(any("Last updated" in p for p in parsed.get("prs") or []))


class TestLiveSnapshotLists(unittest.TestCase):
    def test_workstreamer_snapshot_lists_from_pulse_json(self):
        d = Path("/home/ubuntu/dabbo-state/workstreams/workstreamer")
        snap = stream_snapshot(d, run_check_flag=False, include_pulse=True)
        self.assertIn("lists", snap)
        self.assertTrue(snap["lists"]["ok"], snap["lists"])
        missions = snap["lists"]["pulse"]["missions"]
        ids = {m["id"] for m in missions}
        self.assertIn("m1-schema", ids)
        # lists, not STATUS bullets, drive focus when pulse.json exists
        self.assertTrue(snap["lists"]["view"]["next_mission"])
        self.assertNotEqual(snap["focus_label"], "")


class TestRecommendToday(unittest.TestCase):
    def test_overdue_bends_before_top(self):
        from workstreamer_lib.schema import empty_pulse

        p = empty_pulse("s")
        p["missions"] = [
            {"id": "m-top", "title": "Top", "status": "todo", "order": 0, "due": None, "blocker_id": None, "goals": [], "related": [], "note": None},
            {"id": "m-due", "title": "Overdue", "status": "todo", "order": 1, "due": "2020-01-01", "blocker_id": None, "goals": [], "related": [], "note": None},
        ]
        rec = recommend_today(p, today="2026-08-13")
        self.assertEqual(rec[0]["id"], "m-due")


class TestSlashWriter(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.stream = "demo"
        d = self.root / self.stream
        (d / "scope").mkdir(parents=True)
        (d / "AGENTS.md").write_text("# demo\n")
        self.prev_store = pulse_store.WORKSTREAMS_ROOT
        self.prev_slash = slash.WORKSTREAMS_ROOT
        pulse_store.WORKSTREAMS_ROOT = self.root
        slash.WORKSTREAMS_ROOT = self.root

    def tearDown(self):
        pulse_store.WORKSTREAMS_ROOT = self.prev_store
        slash.WORKSTREAMS_ROOT = self.prev_slash
        self.tmp.cleanup()

    def test_add_and_flip_use_same_writer(self):
        out = slash.dispatch_ws(f"add {self.stream} Ship the schema")
        self.assertIn("added", out)
        path = self.root / self.stream / "scope" / "pulse.json"
        data = json.loads(path.read_text())
        self.assertEqual(data["missions"][0]["title"], "Ship the schema")
        mid = data["missions"][0]["id"]
        out2 = slash.dispatch_ws(f"flip {self.stream} {mid} doing")
        self.assertIn("flipped", out2)
        data2 = json.loads(path.read_text())
        self.assertEqual(data2["missions"][0]["status"], "doing")
        self.assertGreater(data2["revision"], data["revision"])

    def test_pulse_prints_lists_before_story(self):
        pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"title": "A"}},
        )
        (self.root / self.stream / "scope" / "STATUS-LIVE.md").write_text("# Story\n")
        out = slash.dispatch_ws(f"pulse {self.stream}")
        self.assertIn("lists", out)
        self.assertIn("STATUS-LIVE", out)


class TestAdoptEmpty(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.prev = pulse_store.WORKSTREAMS_ROOT
        pulse_store.WORKSTREAMS_ROOT = self.root

    def tearDown(self):
        pulse_store.WORKSTREAMS_ROOT = self.prev
        self.tmp.cleanup()

    def test_adopt_on_fresh_stream(self):
        d = self.root / "fresh"
        (d / "scope").mkdir(parents=True)
        r = pulse_store.adopt_empty("fresh")
        self.assertTrue(r["ok"])
        ok, err = validate(json.loads((d / "scope" / "pulse.json").read_text()))
        self.assertTrue(ok, err)


if __name__ == "__main__":
    unittest.main()
