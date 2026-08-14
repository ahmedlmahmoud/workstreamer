"""Atomic pulse.json reader/writer. One writer for chip, page, slash."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import secrets
from copy import deepcopy
from pathlib import Path
from typing import Any

from .constants import WORKSTREAMS_ROOT
from .schema import (
    CAPS,
    COLLECTIONS,
    MISSION_STATUSES,
    empty_pulse,
    now_iso,
    normalize,
    validate,
    view,
)

PREFIX = {
    "missions": "m",
    "blockers": "b",
    "resources": "r",
    "locks": "k",
    "notes": "n",
    "timeline": "e",
}


def _stream_dir(stream: str) -> Path:
    name = (stream or "").strip().strip("/")
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise ValueError(f"bad stream name: {stream!r}")
    return WORKSTREAMS_ROOT / name


def pulse_path(stream: str) -> Path:
    return _stream_dir(stream) / "scope" / "pulse.json"


def _lock_path(stream: str) -> Path:
    return _stream_dir(stream) / "scope" / ".pulse.lock"


def _new_id(collection: str, title: str, existing: set[str]) -> str:
    prefix = PREFIX.get(collection, "x")
    base = hashlib.sha1(f"{title}|{secrets.token_hex(4)}".encode()).hexdigest()[:8]
    cand = f"{prefix}-{base}"
    n = 0
    while cand in existing:
        n += 1
        cand = f"{prefix}-{base}{n:x}"
    return cand


def _read_raw(path: Path) -> tuple[str, dict[str, Any] | None, str]:
    """Return (source, data_or_none, error). source in empty|pulse.json|invalid|io."""
    if not path.exists():
        return "empty", None, ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        return "io", None, str(e)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return "invalid", None, f"invalid json: {e}"
    if not isinstance(data, dict):
        return "invalid", None, "pulse root is not an object"
    return "pulse.json", data, ""


def load(stream: str) -> dict[str, Any]:
    """Read lists. Missing → empty valid (no file create). Invalid → fail closed."""
    path = pulse_path(stream)
    source, data, err = _read_raw(path)
    if source == "empty":
        pulse = empty_pulse(stream)
        return {
            "ok": True,
            "source": source,
            "error": "",
            "pulse": pulse,
            "view": view(pulse),
            "path": str(path),
        }
    if data is None:
        return {
            "ok": False,
            "source": source,
            "error": err or "unreadable pulse.json",
            "pulse": None,
            "view": None,
            "path": str(path),
        }
    pulse = normalize(data, stream=stream)
    ok, verr = validate(pulse)
    if not ok:
        return {
            "ok": False,
            "source": "invalid",
            "error": verr,
            "pulse": None,
            "view": None,
            "path": str(path),
        }
    return {
        "ok": True,
        "source": "pulse.json",
        "error": "",
        "pulse": pulse,
        "view": view(pulse),
        "path": str(path),
    }


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name("pulse.json.tmp")
    bak = path.with_name("pulse.json.bak")
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    if path.exists():
        try:
            os.replace(path, bak)
        except OSError:
            pass
    os.replace(tmp, path)


def _append_event(pulse: dict[str, Any], kind: str, ref: str | None, detail: str | None) -> None:
    ev = {
        "id": _new_id("timeline", f"{kind}-{now_iso()}", {e.get("id") for e in pulse.get("timeline") or []}),
        "at": now_iso(),
        "kind": kind,
        "ref": ref,
        "detail": detail,
    }
    tl = list(pulse.get("timeline") or [])
    tl.append(ev)
    pulse["timeline"] = tl[-200:]


def _collection(pulse: dict[str, Any], name: str) -> list[dict[str, Any]]:
    items = pulse.get(name)
    if not isinstance(items, list):
        pulse[name] = []
        return pulse[name]
    return items


def apply(stream: str, op: dict[str, Any]) -> dict[str, Any]:
    """Apply one op under flock. Never overwrite an invalid file."""
    if not isinstance(op, dict):
        return {"ok": False, "error": "bad_request", "message": "op must be an object"}

    path = pulse_path(stream)
    lock_p = _lock_path(stream)
    lock_p.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_p, "a+", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
        try:
            return _apply_locked(stream, path, op)
        finally:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)


def _apply_locked(stream: str, path: Path, op: dict[str, Any]) -> dict[str, Any]:
    source, data, err = _read_raw(path)
    if source in {"invalid", "io"}:
        return {
            "ok": False,
            "error": "invalid",
            "message": err or "pulse.json is unreadable — refuse to overwrite",
            "source": source,
        }

    if source == "empty":
        pulse = empty_pulse(stream)
    else:
        pulse = normalize(data or {}, stream=stream)
        ok, verr = validate(pulse)
        if not ok:
            return {
                "ok": False,
                "error": "invalid",
                "message": verr,
                "source": "invalid",
            }

    if "base_revision" in op and op["base_revision"] is not None:
        try:
            base = int(op["base_revision"])
        except (TypeError, ValueError):
            return {"ok": False, "error": "bad_request", "message": "base_revision must be int"}
        if base != int(pulse.get("revision") or 0):
            return {
                "ok": False,
                "error": "conflict",
                "message": f"revision {pulse.get('revision')} != base {base}",
                "pulse": pulse,
                "view": view(pulse),
            }

    kind = (op.get("op") or "").strip()
    try:
        if kind == "upsert":
            _op_upsert(pulse, op)
        elif kind == "delete":
            _op_delete(pulse, op)
        elif kind == "reorder":
            _op_reorder(pulse, op)
        elif kind == "patch_meta":
            _op_meta(pulse, op)
        elif kind == "add_note":
            _op_note(pulse, op)
        elif kind == "adopt":
            raise _OpError("bad_request", "use adopt_empty, not apply(adopt)")
        else:
            return {"ok": False, "error": "bad_request", "message": f"unknown op: {kind}"}
    except _OpError as e:
        body = {"ok": False, "error": e.code, "message": e.message}
        if e.dependents:
            body["dependents"] = e.dependents
        return body

    pulse["stream"] = stream
    pulse["updated_at"] = now_iso()
    pulse["revision"] = int(pulse.get("revision") or 0) + 1
    pulse = normalize(pulse, stream=stream)
    ok, verr = validate(pulse)
    if not ok:
        return {"ok": False, "error": "invalid", "message": f"write rejected: {verr}"}

    _atomic_write(path, pulse)
    return {
        "ok": True,
        "error": "",
        "pulse": pulse,
        "view": view(pulse),
        "path": str(path),
        "revision": pulse["revision"],
    }


class _OpError(Exception):
    def __init__(self, code: str, message: str, dependents: list[str] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.dependents = dependents or []


def _op_upsert(pulse: dict[str, Any], op: dict[str, Any]) -> None:
    col = op.get("collection")
    if col not in COLLECTIONS:
        raise _OpError("bad_request", f"bad collection: {col}")
    rec = op.get("record")
    if not isinstance(rec, dict):
        raise _OpError("bad_request", "record must be an object")
    items = _collection(pulse, col)
    rid = (op.get("id") or rec.get("id") or "").strip()
    existing_ids = {x.get("id") for x in items if x.get("id")}
    idx = next((i for i, x in enumerate(items) if x.get("id") == rid), None) if rid else None
    if idx is None:
        if len(items) >= CAPS.get(col, 10_000):
            raise _OpError("bad_request", f"{col} at cap {CAPS[col]}")
        if not rid:
            rid = _new_id(col, rec.get("title") or rec.get("text") or col, existing_ids)
        merged = deepcopy(rec)
        merged["id"] = rid
        if col == "missions":
            orders = [float(x.get("order") or 0) for x in items]
            merged.setdefault("order", (min(orders) - 1) if orders else 0)
            merged.setdefault("status", "todo")
            merged.setdefault("created_at", now_iso())
        if col == "blockers":
            merged.setdefault("kind", "stuck-on")
            merged.setdefault("status", "open")
        if col == "resources":
            merged.setdefault("kind", "url")
            merged.setdefault("status", "unknown")
        merged["updated_at"] = now_iso()
        items.append(merged)
        ev = {
            "missions": "mission.added",
            "blockers": "blocker.added",
            "resources": "resource.upserted",
        }.get(col, "meta.changed")
        _append_event(pulse, ev, rid, rec.get("title") or rid)
        return

    prev = items[idx]
    merged = deepcopy(prev)
    for k, v in rec.items():
        if k == "id":
            continue
        merged[k] = v
    merged["id"] = prev["id"]
    merged["updated_at"] = now_iso()
    if col == "missions" and rec.get("status") and rec["status"] != prev.get("status"):
        if rec["status"] not in MISSION_STATUSES:
            raise _OpError("bad_request", f"bad status: {rec['status']}")
        _append_event(pulse, "mission.flipped", prev["id"], f"{prev.get('status')}→{rec['status']}")
    elif col == "blockers" and rec.get("status") == "resolved" and prev.get("status") != "resolved":
        merged["resolved_at"] = now_iso()
        _append_event(pulse, "blocker.resolved", prev["id"], prev.get("title"))
    elif col == "resources":
        _append_event(pulse, "resource.upserted", prev["id"], rec.get("title") or prev.get("title"))
    items[idx] = merged


def _op_delete(pulse: dict[str, Any], op: dict[str, Any]) -> None:
    col = op.get("collection")
    if col not in COLLECTIONS:
        raise _OpError("bad_request", f"bad collection: {col}")
    rid = (op.get("id") or "").strip()
    if not rid:
        raise _OpError("bad_request", "id required")
    if col == "blockers":
        deps = [
            m["id"]
            for m in pulse.get("missions") or []
            if m.get("blocker_id") == rid and m.get("status") == "blocked"
        ]
        if deps:
            raise _OpError("conflict", "blocker still referenced", dependents=deps)
    items = _collection(pulse, col)
    nxt = [x for x in items if x.get("id") != rid]
    if len(nxt) == len(items):
        raise _OpError("bad_request", f"{rid} not found")
    pulse[col] = nxt


def _op_reorder(pulse: dict[str, Any], op: dict[str, Any]) -> None:
    col = op.get("collection")
    if col not in {"missions", "blockers", "resources"}:
        raise _OpError("bad_request", f"cannot reorder {col}")
    ids = op.get("ids")
    if not isinstance(ids, list) or not ids:
        raise _OpError("bad_request", "ids must be a non-empty array")
    items = _collection(pulse, col)
    by_id = {x.get("id"): x for x in items}
    seen: set[str] = set()
    ordered: list[dict[str, Any]] = []
    for i, rid in enumerate(ids):
        rid = str(rid)
        if rid in seen or rid not in by_id:
            continue
        seen.add(rid)
        row = deepcopy(by_id[rid])
        row["order"] = i
        ordered.append(row)
    for row in items:
        if row.get("id") not in seen:
            row = deepcopy(row)
            row["order"] = len(ordered)
            ordered.append(row)
    pulse[col] = ordered
    _append_event(pulse, "mission.reordered" if col == "missions" else "meta.changed", None, ",".join(map(str, ids[:12])))


def _op_meta(pulse: dict[str, Any], op: dict[str, Any]) -> None:
    meta = op.get("meta")
    if not isinstance(meta, dict):
        raise _OpError("bad_request", "meta must be an object")
    if "mode" in meta:
        pulse["mode"] = meta["mode"]
    if "timezone" in meta:
        pulse["timezone"] = meta["timezone"]
    if "pipeline" in meta:
        pulse["pipeline"] = meta["pipeline"]
    if "today" in meta and isinstance(meta["today"], dict):
        today = pulse.get("today") if isinstance(pulse.get("today"), dict) else {}
        today.update(meta["today"])
        pulse["today"] = today
        if meta["today"].get("accepted"):
            _append_event(pulse, "today.accepted", None, today.get("date"))
            return
    _append_event(pulse, "meta.changed", None, ",".join(meta.keys()))


def _op_note(pulse: dict[str, Any], op: dict[str, Any]) -> None:
    text = (op.get("text") or "").strip()
    if not text:
        raise _OpError("bad_request", "text required")
    notes = _collection(pulse, "notes")
    if len(notes) >= CAPS["notes"]:
        raise _OpError("bad_request", f"notes at cap {CAPS['notes']}")
    nid = _new_id("notes", text, {n.get("id") for n in notes})
    notes.append({"id": nid, "at": now_iso(), "text": text[:2000]})
    _append_event(pulse, "note.added", nid, text[:80])


def adopt_empty(stream: str) -> dict[str, Any]:
    """Write empty valid pulse.json if missing. Never overwrite. Same flock as apply."""
    path = pulse_path(stream)
    lock_p = _lock_path(stream)
    lock_p.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_p, "a+", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
        try:
            if path.exists():
                loaded = load(stream)
                if loaded["ok"]:
                    return {"ok": True, "created": False, **loaded}
                return {
                    "ok": False,
                    "created": False,
                    "error": "invalid",
                    "message": "pulse.json exists but is invalid — not overwritten",
                }
            pulse = empty_pulse(stream)
            _atomic_write(path, pulse)
            return {
                "ok": True,
                "created": True,
                "pulse": pulse,
                "view": view(pulse),
                "path": str(path),
            }
        finally:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)


def lists_payload(stream: str) -> dict[str, Any]:
    loaded = load(stream)
    return {
        "ok": loaded["ok"],
        "source": loaded["source"],
        "error": loaded.get("error") or "",
        "pulse": loaded.get("pulse"),
        "view": loaded.get("view"),
        "revision": (loaded.get("pulse") or {}).get("revision") if loaded.get("ok") else None,
        "updated_at": (loaded.get("pulse") or {}).get("updated_at") if loaded.get("ok") else None,
    }


def commit(stream: str, pulse: dict[str, Any], *, base_revision: Any = None) -> dict[str, Any]:
    """Atomic replace of a fully-built pulse. Used by hidden pass (one write or none)."""
    path = pulse_path(stream)
    lock_p = _lock_path(stream)
    lock_p.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_p, "a+", encoding="utf-8") as lock_fh:
        fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
        try:
            source, data, err = _read_raw(path)
            if source in {"invalid", "io"}:
                return {
                    "ok": False,
                    "error": "invalid",
                    "message": err or "pulse.json is unreadable — refuse to overwrite",
                    "source": source,
                }
            current = empty_pulse(stream) if source == "empty" else normalize(data or {}, stream=stream)
            if source != "empty":
                ok, verr = validate(current)
                if not ok:
                    return {"ok": False, "error": "invalid", "message": verr, "source": "invalid"}
            if base_revision is not None:
                try:
                    base = int(base_revision)
                except (TypeError, ValueError):
                    return {"ok": False, "error": "bad_request", "message": "base_revision must be int"}
                if base != int(current.get("revision") or 0):
                    return {
                        "ok": False,
                        "error": "conflict",
                        "message": f"revision {current.get('revision')} != base {base}",
                        "pulse": current,
                        "view": view(current),
                    }
            pulse = normalize(pulse, stream=stream)
            pulse["stream"] = stream
            pulse["updated_at"] = now_iso()
            pulse["revision"] = int(current.get("revision") or 0) + 1
            ok, verr = validate(pulse)
            if not ok:
                return {"ok": False, "error": "invalid", "message": f"write rejected: {verr}"}
            _atomic_write(path, pulse)
            return {
                "ok": True,
                "error": "",
                "pulse": pulse,
                "view": view(pulse),
                "path": str(path),
                "revision": pulse["revision"],
            }
        finally:
            fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)

