"""M1 production contract — fail-closed meaning, caps, rec order, API defaults.

These tests exist because the first writer looked green while still lying:
unknown enums became todo, over-cap upserts dropped the row and bumped
revision, pins outranked overdue, GET defaulted to sanziq.
"""
from __future__ import annotations

import inspect
import json
import sys
import tempfile
import unittest
from pathlib import Path

_DASH = Path(__file__).resolve().parents[1]
_PLUGIN = _DASH.parent
if str(_DASH) not in sys.path:
    sys.path.insert(0, str(_DASH))
if str(_PLUGIN) not in sys.path:
    sys.path.insert(0, str(_PLUGIN))

from workstreamer_lib.schema import (  # noqa: E402
    empty_pulse,
    normalize,
    recommend_today,
    validate,
)
from workstreamer_lib import store as pulse_store  # noqa: E402
import plugin_api  # noqa: E402


class TestUnknownEnumKeepsMeaning(unittest.TestCase):
    def test_unknown_mission_status_is_not_coerced_to_todo(self):
        p = empty_pulse("s")
        p["missions"] = [
            {
                "id": "m-a",
                "title": "Ship",
                "status": "shipped",
                "order": 0,
                "blocker_id": None,
            }
        ]
        n = normalize(p, stream="s")
        self.assertEqual(n["missions"][0]["status"], "shipped")
        ok, err = validate(n)
        self.assertFalse(ok)
        self.assertIn("status", err.lower())

    def test_unknown_blocker_kind_is_not_coerced(self):
        p = empty_pulse("s")
        p["blockers"] = [
            {"id": "b-a", "title": "Wait", "kind": "client", "status": "open"}
        ]
        n = normalize(p, stream="s")
        self.assertEqual(n["blockers"][0]["kind"], "client")
        ok, err = validate(n)
        self.assertFalse(ok)
        self.assertIn("kind", err.lower())

    def test_unknown_resource_kind_is_not_coerced(self):
        p = empty_pulse("s")
        p["resources"] = [
            {
                "id": "r-a",
                "kind": "money",
                "title": "Invoice",
                "url": "https://x.example",
                "status": "unknown",
            }
        ]
        n = normalize(p, stream="s")
        self.assertEqual(n["resources"][0]["kind"], "money")
        ok, _ = validate(n)
        self.assertFalse(ok)

    def test_unknown_mode_is_not_coerced_to_steer(self):
        p = empty_pulse("s")
        p["mode"] = "yolo"
        n = normalize(p, stream="s")
        self.assertEqual(n["mode"], "yolo")
        ok, err = validate(n)
        self.assertFalse(ok)
        self.assertIn("mode", err.lower())

    def test_absent_status_still_defaults_to_todo(self):
        p = empty_pulse("s")
        p["missions"] = [{"id": "m-a", "title": "Ship", "order": 0}]
        n = normalize(p, stream="s")
        self.assertEqual(n["missions"][0]["status"], "todo")
        ok, err = validate(n)
        self.assertTrue(ok, err)


class TestRecommendTodayOrder(unittest.TestCase):
    def test_overdue_outranks_pins(self):
        p = empty_pulse("s")
        p["today"] = {
            "date": "2026-08-13",
            "pinned_mission_ids": ["m-pin"],
            "accepted": False,
        }
        p["missions"] = [
            {
                "id": "m-pin",
                "title": "Pinned",
                "status": "todo",
                "order": 0,
                "due": None,
                "blocker_id": None,
                "goals": [],
                "related": [],
                "note": None,
            },
            {
                "id": "m-due",
                "title": "Overdue",
                "status": "todo",
                "order": 9,
                "due": "2020-01-01",
                "blocker_id": None,
                "goals": [],
                "related": [],
                "note": None,
            },
            {
                "id": "m-later",
                "title": "Later pile",
                "status": "todo",
                "order": 1,
                "due": None,
                "blocker_id": None,
                "goals": [],
                "related": [],
                "note": None,
            },
        ]
        rec = recommend_today(p, today="2026-08-13")
        self.assertEqual(rec[0]["id"], "m-due")
        self.assertEqual(rec[1]["id"], "m-pin")
        self.assertEqual(rec[2]["id"], "m-later")


class TestStoreProduction(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.stream = "demo"
        (self.root / self.stream / "scope").mkdir(parents=True)
        self.prev = pulse_store.WORKSTREAMS_ROOT
        pulse_store.WORKSTREAMS_ROOT = self.root

    def tearDown(self):
        pulse_store.WORKSTREAMS_ROOT = self.prev
        self.tmp.cleanup()

    def _path(self):
        return self.root / self.stream / "scope" / "pulse.json"

    def test_unknown_status_upsert_refuses_and_does_not_write(self):
        pulse_store.adopt_empty(self.stream)
        raw = self._path().read_bytes()
        rev = json.loads(raw)["revision"]
        r = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {"id": "m-a", "title": "X", "status": "shipped"},
            },
        )
        self.assertFalse(r["ok"])
        self.assertEqual(self._path().read_bytes(), raw)
        self.assertEqual(json.loads(self._path().read_text())["revision"], rev)

    def test_flip_blocked_without_blocker_refuses(self):
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {"id": "m-a", "title": "A", "status": "todo"},
            },
        )
        raw = self._path().read_bytes()
        r = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "id": "m-a",
                "record": {"status": "blocked"},
            },
        )
        self.assertFalse(r["ok"])
        self.assertEqual(self._path().read_bytes(), raw)

    def test_over_cap_upsert_is_400_and_does_not_bump(self):
        pulse_store.adopt_empty(self.stream)
        data = json.loads(self._path().read_text())
        data["missions"] = [
            {
                "id": f"m-{i:03d}x",
                "title": f"M{i}",
                "status": "todo",
                "order": i,
                "blocker_id": None,
            }
            for i in range(200)
        ]
        self._path().write_text(json.dumps(data) + "\n")
        before = json.loads(self._path().read_text())
        r = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {"id": "m-overflow", "title": "Too many"},
            },
        )
        self.assertFalse(r["ok"], r)
        after = json.loads(self._path().read_text())
        self.assertEqual(after["revision"], before["revision"])
        self.assertEqual(len(after["missions"]), 200)
        self.assertFalse(any(m["id"] == "m-overflow" for m in after["missions"]))

    def test_adopt_does_not_overwrite_invalid(self):
        p = self._path()
        p.write_text("{not json", encoding="utf-8")
        raw = p.read_bytes()
        r = pulse_store.adopt_empty(self.stream)
        self.assertFalse(r["ok"])
        self.assertEqual(p.read_bytes(), raw)

    def test_empty_bytes_file_is_invalid_not_empty_source(self):
        self._path().write_bytes(b"")
        loaded = pulse_store.load(self.stream)
        self.assertFalse(loaded["ok"])
        self.assertEqual(loaded["source"], "invalid")

    def test_array_root_is_invalid(self):
        self._path().write_text("[]\n", encoding="utf-8")
        loaded = pulse_store.load(self.stream)
        self.assertFalse(loaded["ok"])
        self.assertEqual(loaded["source"], "invalid")

    def test_path_traversal_stream_rejected(self):
        with self.assertRaises(ValueError):
            pulse_store.apply("../etc", {"op": "add_note", "text": "no"})

    def test_unicode_title_roundtrip(self):
        r = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {"id": "m-ar", "title": "اكتب النبض — café"},
            },
        )
        self.assertTrue(r["ok"], r)
        data = json.loads(self._path().read_text(encoding="utf-8"))
        self.assertEqual(data["missions"][0]["title"], "اكتب النبض — café")

    def test_extra_top_key_survives_write(self):
        pulse_store.adopt_empty(self.stream)
        data = json.loads(self._path().read_text())
        data["future_field"] = {"keep": True, "n": 1}
        self._path().write_text(json.dumps(data, indent=2) + "\n")
        r = pulse_store.apply(
            self.stream,
            {"op": "add_note", "text": "hello"},
        )
        self.assertTrue(r["ok"], r)
        after = json.loads(self._path().read_text())
        self.assertEqual(after["future_field"], {"keep": True, "n": 1})

    def test_apply_adopt_is_not_a_silent_write(self):
        pulse_store.adopt_empty(self.stream)
        raw = self._path().read_bytes()
        rev = json.loads(raw)["revision"]
        r = pulse_store.apply(self.stream, {"op": "adopt"})
        self.assertFalse(r["ok"])
        self.assertEqual(self._path().read_bytes(), raw)
        self.assertEqual(json.loads(self._path().read_text())["revision"], rev)

    def test_commit_refuses_garbage(self):
        self._path().write_text("{nope", encoding="utf-8")
        raw = self._path().read_bytes()
        r = pulse_store.commit(self.stream, empty_pulse(self.stream))
        self.assertFalse(r["ok"])
        self.assertEqual(self._path().read_bytes(), raw)

    def test_resolve_blocker_does_not_auto_flip_mission(self):
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "blockers",
                "record": {"id": "b-x", "title": "Wait", "kind": "stuck-on"},
            },
        )
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {
                    "id": "m-a",
                    "title": "Blocked work",
                    "status": "blocked",
                    "blocker_id": "b-x",
                },
            },
        )
        r = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "blockers",
                "id": "b-x",
                "record": {"status": "resolved"},
            },
        )
        self.assertTrue(r["ok"], r)
        data = json.loads(self._path().read_text())
        mission = next(m for m in data["missions"] if m["id"] == "m-a")
        self.assertEqual(mission["status"], "blocked")
        self.assertEqual(mission["blocker_id"], "b-x")


class TestApiRequiresStream(unittest.TestCase):
    def _assert_stream_required(self, fn):
        params = inspect.signature(fn).parameters
        self.assertIn("stream", params)
        default = params["stream"].default
        self.assertNotEqual(default, "sanziq")
        if isinstance(default, str):
            self.fail(f"{fn.__name__} has concrete stream default {default!r}")

    def test_stream_get_has_no_sanziq_default(self):
        self._assert_stream_required(plugin_api.stream_detail)

    def test_pulse_get_has_no_sanziq_default(self):
        self._assert_stream_required(plugin_api.pulse_workstream)

    def test_check_get_has_no_sanziq_default(self):
        self._assert_stream_required(plugin_api.check_workstream)


class TestSchemaFileExists(unittest.TestCase):
    def test_machine_schema_present(self):
        path = _DASH / "workstreamer_lib" / "pulse.schema.json"
        self.assertTrue(path.exists(), path)
        data = json.loads(path.read_text())
        self.assertIn("properties", data)
        self.assertIn("missions", data["properties"])
        self.assertEqual(data["properties"]["version"].get("const"), 1)


if __name__ == "__main__":
    unittest.main()
