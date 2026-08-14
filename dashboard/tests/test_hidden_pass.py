"""M3 hidden pass — quiet / steer / hunt, fail-closed, no half-write."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

_DASH = Path(__file__).resolve().parents[1]
if str(_DASH) not in sys.path:
    sys.path.insert(0, str(_DASH))

from workstreamer_lib import store as pulse_store  # noqa: E402
from workstreamer_lib.hidden_pass import run_pass  # noqa: E402


class _TmpStream(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.stream = "demo"
        (self.root / self.stream / "scope").mkdir(parents=True)
        self.prev = pulse_store.WORKSTREAMS_ROOT
        pulse_store.WORKSTREAMS_ROOT = self.root
        pulse_store.adopt_empty(self.stream)

    def tearDown(self):
        pulse_store.WORKSTREAMS_ROOT = self.prev
        self.tmp.cleanup()

    def _path(self):
        return self.root / self.stream / "scope" / "pulse.json"

    def _raw(self):
        return self._path().read_bytes()

    def _data(self):
        return json.loads(self._path().read_text())

    def _session(self, **kw):
        base = {
            "session_id": "s-1",
            "duration_s": 420,
            "cwd": str(self.root / self.stream),
            "profile": "operations",
            "completed": True,
        }
        base.update(kw)
        return base


class TestAlwaysTimeAndRecheck(_TmpStream):
    def test_always_writes_session_time_event(self):
        r = run_pass(self.stream, session=self._session())
        self.assertTrue(r["ok"], r)
        kinds = [e["kind"] for e in self._data()["timeline"]]
        self.assertIn("session.timed", kinds)

    def test_rechecks_url_and_pr_resources(self):
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "resources",
                "record": {
                    "id": "r-pr",
                    "kind": "pr",
                    "title": "PR 1",
                    "url": "https://github.com/a/b/pull/1",
                    "status": "open",
                },
            },
        )
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "resources",
                "record": {
                    "id": "r-url",
                    "kind": "url",
                    "title": "Dash",
                    "url": "https://her.c.dabbo.net",
                    "status": "unknown",
                },
            },
        )

        def checker(res):
            if res["kind"] == "pr":
                return "merged"
            return "up"

        r = run_pass(self.stream, session=self._session(), check_resource=checker)
        self.assertTrue(r["ok"], r)
        by = {x["id"]: x for x in self._data()["resources"]}
        self.assertEqual(by["r-pr"]["status"], "merged")
        self.assertEqual(by["r-url"]["status"], "up")


class TestModes(_TmpStream):
    def test_quiet_does_not_invent_missions(self):
        pulse_store.apply(self.stream, {"op": "patch_meta", "meta": {"mode": "quiet"}})
        before = [m["id"] for m in self._data()["missions"]]
        r = run_pass(
            self.stream,
            session=self._session(),
            transcript="We should add a mission: rewrite the billing engine tomorrow",
        )
        self.assertTrue(r["ok"], r)
        after = [m["id"] for m in self._data()["missions"]]
        self.assertEqual(after, before)

    def test_quiet_does_not_reorder(self):
        pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"id": "m-a", "title": "A", "order": 0}},
        )
        pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"id": "m-b", "title": "B", "order": 1}},
        )
        pulse_store.apply(self.stream, {"op": "patch_meta", "meta": {"mode": "quiet"}})
        orders = {m["id"]: m["order"] for m in self._data()["missions"]}
        run_pass(self.stream, session=self._session(), transcript="please put B first")
        after = {m["id"]: m["order"] for m in self._data()["missions"]}
        self.assertEqual(after["m-a"], orders["m-a"])
        self.assertEqual(after["m-b"], orders["m-b"])

    def test_steer_closes_obvious_mission(self):
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {"id": "m-a", "title": "Ship schema", "status": "doing"},
            },
        )
        pulse_store.apply(self.stream, {"op": "patch_meta", "meta": {"mode": "steer"}})
        r = run_pass(
            self.stream,
            session=self._session(mission_id="m-a", completed=True),
            transcript="shipped the schema. done.",
        )
        self.assertTrue(r["ok"], r)
        by = {m["id"]: m for m in self._data()["missions"]}
        self.assertEqual(by["m-a"]["status"], "done")

    def test_hunt_invents_from_todo_lines(self):
        pulse_store.apply(self.stream, {"op": "patch_meta", "meta": {"mode": "hunt"}})
        r = run_pass(
            self.stream,
            session=self._session(),
            transcript="TODO: write SOUL stanza\nTODO: adopt pulse on faceless",
        )
        self.assertTrue(r["ok"], r)
        titles = [m["title"] for m in self._data()["missions"]]
        self.assertTrue(any("SOUL" in t for t in titles), titles)
        self.assertTrue(r.get("invented"), r)

    def test_never_marks_blocked_without_blocker(self):
        pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"id": "m-a", "title": "A", "status": "todo"}},
        )
        r = run_pass(
            self.stream,
            session=self._session(mission_id="m-a"),
            transcript="this is blocked, we are stuck",
        )
        self.assertTrue(r["ok"], r)
        by = {m["id"]: m for m in self._data()["missions"]}
        self.assertNotEqual(by["m-a"]["status"], "blocked")


class TestFailClosed(_TmpStream):
    def test_invalid_file_unchanged(self):
        p = self._path()
        p.write_text("{not json", encoding="utf-8")
        raw = p.read_bytes()
        r = run_pass(self.stream, session=self._session())
        self.assertFalse(r["ok"])
        self.assertEqual(p.read_bytes(), raw)

    def test_exception_during_recheck_does_not_half_write(self):
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "resources",
                "record": {
                    "id": "r-url",
                    "kind": "url",
                    "title": "X",
                    "url": "https://x.example",
                    "status": "unknown",
                },
            },
        )
        rev = self._data()["revision"]
        raw = self._raw()

        def boom(_res):
            raise RuntimeError("network down")

        r = run_pass(self.stream, session=self._session(), check_resource=boom)
        self.assertFalse(r["ok"])
        self.assertEqual(self._path().read_bytes(), raw)
        self.assertEqual(self._data()["revision"], rev)


class TestHookRegistration(unittest.TestCase):
    def test_plugin_registers_session_hooks(self):
        plugin = Path(__file__).resolve().parents[2]
        init = (plugin / "__init__.py").read_text()
        self.assertIn("on_session_end", init)
        self.assertIn("on_session_finalize", init)


if __name__ == "__main__":
    unittest.main()
