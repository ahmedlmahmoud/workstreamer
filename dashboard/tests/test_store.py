"""M1 pulse store — fail closed, atomic, one writer."""
from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

_DASH = Path(__file__).resolve().parents[1]
if str(_DASH) not in sys.path:
    sys.path.insert(0, str(_DASH))

from workstreamer_lib import store as pulse_store  # noqa: E402
from workstreamer_lib.schema import (  # noqa: E402
    SCHEMA_VERSION,
    empty_pulse,
    normalize,
    validate,
)


class TestEmptyAndValidate(unittest.TestCase):
    def test_empty_pulse_is_valid(self):
        p = empty_pulse("workstreamer")
        ok, err = validate(p)
        self.assertTrue(ok, err)
        self.assertEqual(p["version"], SCHEMA_VERSION)
        self.assertEqual(p["mode"], "steer")
        self.assertEqual(p["missions"], [])

    def test_blocked_without_blocker_fails(self):
        p = empty_pulse("s")
        p["missions"] = [
            {
                "id": "m-a",
                "title": "Do thing",
                "status": "blocked",
                "order": 0,
                "blocker_id": None,
            }
        ]
        ok, err = validate(p)
        self.assertFalse(ok)
        self.assertIn("blocker", err.lower())

    def test_blocked_with_missing_blocker_id_fails(self):
        p = empty_pulse("s")
        p["missions"] = [
            {
                "id": "m-a",
                "title": "Do thing",
                "status": "blocked",
                "order": 0,
                "blocker_id": "b-nope",
            }
        ]
        ok, err = validate(p)
        self.assertFalse(ok)

    def test_unknown_version_fails(self):
        p = empty_pulse("s")
        p["version"] = 99
        ok, err = validate(p)
        self.assertFalse(ok)

    def test_extra_keys_preserved(self):
        p = empty_pulse("s")
        p["future_field"] = {"ok": True}
        n = normalize(p, stream="s")
        self.assertEqual(n["future_field"], {"ok": True})


class TestStoreApply(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.stream = "demo"
        d = self.root / self.stream / "scope"
        d.mkdir(parents=True)
        self.prev = pulse_store.WORKSTREAMS_ROOT
        pulse_store.WORKSTREAMS_ROOT = self.root

    def tearDown(self):
        pulse_store.WORKSTREAMS_ROOT = self.prev
        self.tmp.cleanup()

    def _path(self):
        return self.root / self.stream / "scope" / "pulse.json"

    def test_missing_file_reads_as_empty_valid(self):
        loaded = pulse_store.load(self.stream)
        self.assertTrue(loaded["ok"])
        self.assertEqual(loaded["source"], "empty")
        self.assertFalse(self._path().exists())

    def test_first_upsert_creates_file(self):
        r = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {"title": "Ship schema", "status": "todo"},
            },
        )
        self.assertTrue(r["ok"], r)
        self.assertTrue(self._path().exists())
        data = json.loads(self._path().read_text())
        self.assertEqual(len(data["missions"]), 1)
        self.assertEqual(data["missions"][0]["title"], "Ship schema")
        self.assertEqual(data["revision"], 1)
        self.assertTrue(data["updated_at"].endswith("Z"))

    def test_invalid_json_fails_closed_and_does_not_wipe(self):
        p = self._path()
        p.write_text("{not json", encoding="utf-8")
        raw = p.read_bytes()
        loaded = pulse_store.load(self.stream)
        self.assertFalse(loaded["ok"])
        self.assertEqual(loaded["source"], "invalid")
        r = pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"title": "x"}},
        )
        self.assertFalse(r["ok"])
        self.assertEqual(p.read_bytes(), raw)

    def test_conflict_on_stale_revision(self):
        pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"id": "m-a", "title": "A"}},
        )
        r = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "id": "m-a",
                "record": {"status": "doing"},
                "base_revision": 0,
            },
        )
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "conflict")
        data = json.loads(self._path().read_text())
        self.assertEqual(data["missions"][0]["status"], "todo")

    def test_delete_blocker_with_dependent_is_409(self):
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
            {"op": "delete", "collection": "blockers", "id": "b-x"},
        )
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "conflict")
        self.assertIn("m-a", r.get("dependents") or [])

    def test_reorder_writes_order_field(self):
        pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"id": "m-a", "title": "A"}},
        )
        pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"id": "m-b", "title": "B"}},
        )
        r = pulse_store.apply(
            self.stream,
            {"op": "reorder", "collection": "missions", "ids": ["m-b", "m-a"]},
        )
        self.assertTrue(r["ok"], r)
        data = json.loads(self._path().read_text())
        by_id = {m["id"]: m["order"] for m in data["missions"]}
        self.assertLess(by_id["m-b"], by_id["m-a"])

    def test_adopt_writes_valid_empty(self):
        r = pulse_store.adopt_empty(self.stream)
        self.assertTrue(r["ok"])
        ok, err = validate(json.loads(self._path().read_text()))
        self.assertTrue(ok, err)

    def test_stream_field_forced_to_folder(self):
        pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "record": {"title": "x", "stream": "other"},
            },
        )
        data = json.loads(self._path().read_text())
        self.assertEqual(data["stream"], self.stream)

    def test_lww_without_base_revision_still_bumps(self):
        a = pulse_store.apply(
            self.stream,
            {"op": "upsert", "collection": "missions", "record": {"id": "m-a", "title": "A"}},
        )
        b = pulse_store.apply(
            self.stream,
            {
                "op": "upsert",
                "collection": "missions",
                "id": "m-a",
                "record": {"title": "A2"},
            },
        )
        self.assertTrue(b["ok"])
        self.assertGreater(b["pulse"]["revision"], a["pulse"]["revision"])

    def test_concurrent_writes_do_not_corrupt(self):
        pulse_store.adopt_empty(self.stream)
        errors = []

        def worker(i):
            try:
                pulse_store.apply(
                    self.stream,
                    {
                        "op": "upsert",
                        "collection": "missions",
                        "record": {"id": f"m-{i}", "title": f"T{i}"},
                    },
                )
            except Exception as e:  # noqa: BLE001
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertFalse(errors)
        data = json.loads(self._path().read_text())
        validate_ok, err = validate(data)
        self.assertTrue(validate_ok, err)
        self.assertGreaterEqual(len(data["missions"]), 1)
        json.loads(self._path().read_text())


class TestDogfoodFile(unittest.TestCase):
    def test_workstreamer_pulse_json_validates(self):
        path = Path("/home/ubuntu/dabbo-state/workstreams/workstreamer/scope/pulse.json")
        if not path.exists():
            self.skipTest("dogfood file missing")
        raw = json.loads(path.read_text())
        n = normalize(raw, stream="workstreamer")
        ok, err = validate(n)
        self.assertTrue(ok, err)


if __name__ == "__main__":
    unittest.main()
