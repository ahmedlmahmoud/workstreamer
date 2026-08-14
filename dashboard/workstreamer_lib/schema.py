"""Pulse v2 schema — versioned, fail-closed, extra keys preserved."""
from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

SCHEMA_VERSION = 1
DEFAULT_MODE = "steer"
DEFAULT_TZ = "Africa/Cairo"

MODES = frozenset({"quiet", "steer", "hunt"})
MISSION_STATUSES = frozenset({"todo", "doing", "blocked", "later", "done", "cancelled"})
BLOCKER_KINDS = frozenset({"waiting-on", "stuck-on"})
BLOCKER_STATUSES = frozenset({"open", "resolved"})
RESOURCE_KINDS = frozenset({"repo", "url", "file", "pr"})
RESOURCE_STATUSES = frozenset({"unknown", "up", "down", "open", "merged", "closed"})
COLLECTIONS = frozenset({"missions", "blockers", "resources", "locks"})
EVENT_KINDS = frozenset(
    {
        "mission.added",
        "mission.flipped",
        "mission.reordered",
        "blocker.added",
        "blocker.resolved",
        "resource.upserted",
        "note.added",
        "today.accepted",
        "meta.changed",
        "session.timed",
        "resource.rechecked",
    }
)

ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_HINT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T")

CAPS = {
    "missions": 200,
    "blockers": 100,
    "resources": 100,
    "locks": 50,
    "notes": 100,
    "timeline": 200,
}

_KNOWN_TOP = {
    "version",
    "stream",
    "updated_at",
    "revision",
    "mode",
    "timezone",
    "pipeline",
    "today",
    "missions",
    "blockers",
    "resources",
    "locks",
    "notes",
    "timeline",
    "urls",  # legacy dogfood; ignored as a record
}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def empty_pulse(stream: str) -> dict[str, Any]:
    return {
        "version": SCHEMA_VERSION,
        "stream": stream,
        "updated_at": now_iso(),
        "revision": 0,
        "mode": DEFAULT_MODE,
        "timezone": DEFAULT_TZ,
        "pipeline": [],
        "today": {"date": None, "pinned_mission_ids": [], "accepted": False},
        "missions": [],
        "blockers": [],
        "resources": [],
        "locks": [],
        "notes": [],
        "timeline": [],
    }


def _as_str(v: Any, default: str = "") -> str:
    if v is None:
        return default
    return str(v).strip()


def _clip(s: str, n: int) -> str:
    s = s.strip()
    return s if len(s) <= n else s[:n]


def _iso_or_none(v: Any) -> str | None:
    if v is None or v == "":
        return None
    s = str(v).strip()
    if DATE_RE.fullmatch(s):
        return s
    if ISO_HINT_RE.match(s):
        if s.endswith("Z") or "+" in s[10:] or s.endswith("z"):
            return s if s.endswith("Z") else s
        return s + ("Z" if "T" in s and not s.endswith("Z") else "")
    return None


def _date_or_none(v: Any) -> str | None:
    if v is None or v == "":
        return None
    s = str(v).strip()[:10]
    return s if DATE_RE.fullmatch(s) else None


def _norm_id(raw: Any) -> str:
    s = _as_str(raw).lower()
    s = re.sub(r"[^a-z0-9-]+", "-", s).strip("-")
    if not s:
        return ""
    if s[0].isdigit():
        s = "x-" + s
    return s[:63]


def _list_of_str(v: Any, *, max_n: int, max_len: int) -> list[str]:
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for item in v[:max_n]:
        t = _clip(_as_str(item), max_len)
        if t:
            out.append(t)
    return out


def _norm_mission(raw: dict[str, Any], i: int) -> dict[str, Any]:
    mid = _norm_id(raw.get("id")) or f"m-{i+1}"
    if "status" not in raw or raw.get("status") in (None, ""):
        status = "todo"
    else:
        status = _as_str(raw.get("status"))
    bid = _norm_id(raw.get("blocker_id")) or None
    if status != "blocked":
        # keep id if present but not required
        pass
    order = raw.get("order")
    try:
        order_n = float(order)
    except (TypeError, ValueError):
        order_n = float(i)
    out = {
        "id": mid,
        "title": _clip(_as_str(raw.get("title"), "Untitled"), 200) or "Untitled",
        "status": status,
        "order": order_n,
        "due": _date_or_none(raw.get("due")),
        "blocker_id": bid,
        "goals": _list_of_str(raw.get("goals"), max_n=12, max_len=200),
        "related": [_norm_id(x) for x in (raw.get("related") or []) if _norm_id(x)],
        "note": _clip(_as_str(raw.get("note")), 2000) or None,
        "created_at": _iso_or_none(raw.get("created_at")),
        "updated_at": _iso_or_none(raw.get("updated_at")),
    }
    for k, v in raw.items():
        if k not in out:
            out[k] = v
    return out


def _norm_blocker(raw: dict[str, Any], i: int) -> dict[str, Any]:
    if "kind" not in raw or raw.get("kind") in (None, ""):
        kind = "stuck-on"
    else:
        kind = _as_str(raw.get("kind"))
    if "status" not in raw or raw.get("status") in (None, ""):
        status = "open"
    else:
        status = _as_str(raw.get("status"))
    out = {
        "id": _norm_id(raw.get("id")) or f"b-{i+1}",
        "title": _clip(_as_str(raw.get("title"), "Untitled"), 200) or "Untitled",
        "kind": kind,
        "waiting_on": _clip(_as_str(raw.get("waiting_on")), 120) or None,
        "status": status,
        "note": _clip(_as_str(raw.get("note")), 2000) or None,
        "resolved_at": _iso_or_none(raw.get("resolved_at")),
    }
    for k, v in raw.items():
        if k not in out:
            out[k] = v
    return out


def _norm_resource(raw: dict[str, Any], i: int) -> dict[str, Any]:
    if "kind" not in raw or raw.get("kind") in (None, ""):
        kind = "url"
    else:
        kind = _as_str(raw.get("kind"))
    if "status" not in raw or raw.get("status") in (None, ""):
        status = "unknown"
    else:
        status = _as_str(raw.get("status"))
    out = {
        "id": _norm_id(raw.get("id")) or f"r-{i+1}",
        "kind": kind,
        "title": _clip(_as_str(raw.get("title"), "Untitled"), 200) or "Untitled",
        "url": _clip(_as_str(raw.get("url")), 2000),
        "status": status,
        "checked_at": _iso_or_none(raw.get("checked_at")),
    }
    for k, v in raw.items():
        if k not in out:
            out[k] = v
    return out


def _norm_lock(raw: dict[str, Any], i: int) -> dict[str, Any]:
    out = {
        "id": _norm_id(raw.get("id")) or f"k-{i+1}",
        "title": _clip(_as_str(raw.get("title"), "Untitled"), 200) or "Untitled",
        "decided": _date_or_none(raw.get("decided")),
        "note": _clip(_as_str(raw.get("note")), 2000) or None,
    }
    for k, v in raw.items():
        if k not in out:
            out[k] = v
    return out


def _norm_note(raw: dict[str, Any], i: int) -> dict[str, Any]:
    out = {
        "id": _norm_id(raw.get("id")) or f"n-{i+1}",
        "at": _iso_or_none(raw.get("at")) or now_iso(),
        "text": _clip(_as_str(raw.get("text")), 2000),
    }
    for k, v in raw.items():
        if k not in out:
            out[k] = v
    return out


def _norm_event(raw: dict[str, Any], i: int) -> dict[str, Any]:
    kind = _as_str(raw.get("kind"), "meta.changed")
    if kind not in EVENT_KINDS:
        kind = "meta.changed"
    out = {
        "id": _norm_id(raw.get("id")) or f"e-{i+1}",
        "at": _iso_or_none(raw.get("at")) or now_iso(),
        "kind": kind,
        "ref": _norm_id(raw.get("ref")) or None,
        "detail": _clip(_as_str(raw.get("detail")), 400) or None,
    }
    for k, v in raw.items():
        if k not in out:
            out[k] = v
    return out


def normalize(raw: dict[str, Any], *, stream: str) -> dict[str, Any]:
    """Coerce a dict toward schema. Does not raise. Does not drop unknown top keys."""
    src = raw if isinstance(raw, dict) else {}
    out = empty_pulse(stream)
    extra = {k: deepcopy(v) for k, v in src.items() if k not in _KNOWN_TOP}

    try:
        ver = int(src.get("version", SCHEMA_VERSION))
    except (TypeError, ValueError):
        ver = SCHEMA_VERSION
    out["version"] = ver
    out["stream"] = stream
    out["updated_at"] = _iso_or_none(src.get("updated_at")) or now_iso()
    try:
        out["revision"] = max(0, int(src.get("revision") or 0))
    except (TypeError, ValueError):
        out["revision"] = 0
    if "mode" not in src or src.get("mode") in (None, ""):
        out["mode"] = DEFAULT_MODE
    else:
        out["mode"] = _as_str(src.get("mode"))
    tz = _as_str(src.get("timezone"), DEFAULT_TZ)
    out["timezone"] = tz or DEFAULT_TZ
    pipe = src.get("pipeline") or []
    if isinstance(pipe, list):
        out["pipeline"] = [_clip(_as_str(x), 40) for x in pipe[:24] if _as_str(x)]
    today = src.get("today") if isinstance(src.get("today"), dict) else {}
    pins = today.get("pinned_mission_ids") or []
    out["today"] = {
        "date": _date_or_none(today.get("date")),
        "pinned_mission_ids": [_norm_id(x) for x in pins if _norm_id(x)][:8],
        "accepted": bool(today.get("accepted")),
    }

    def _arr(key: str, fn, cap: int) -> list[dict[str, Any]]:
        items = src.get(key) or []
        if not isinstance(items, list):
            return []
        return [fn(x, i) for i, x in enumerate(items[:cap]) if isinstance(x, dict)]

    out["missions"] = _arr("missions", _norm_mission, CAPS["missions"])
    out["blockers"] = _arr("blockers", _norm_blocker, CAPS["blockers"])
    out["resources"] = _arr("resources", _norm_resource, CAPS["resources"])
    out["locks"] = _arr("locks", _norm_lock, CAPS["locks"])
    out["notes"] = _arr("notes", _norm_note, CAPS["notes"])
    out["timeline"] = _arr("timeline", _norm_event, CAPS["timeline"])

    # drop unknown related resource ids (don't fail)
    res_ids = {r["id"] for r in out["resources"]}
    for m in out["missions"]:
        m["related"] = [x for x in m.get("related") or [] if x in res_ids]

    out.update(extra)
    return out


def validate(pulse: dict[str, Any]) -> tuple[bool, str]:
    if not isinstance(pulse, dict):
        return False, "pulse is not an object"
    if pulse.get("version") != SCHEMA_VERSION:
        return False, f"unsupported version: {pulse.get('version')}"
    stream = _as_str(pulse.get("stream"))
    if not stream:
        return False, "stream is required"
    if pulse.get("mode") not in MODES:
        return False, f"bad mode: {pulse.get('mode')}"
    try:
        rev = int(pulse.get("revision", 0))
        if rev < 0:
            return False, "revision must be >= 0"
    except (TypeError, ValueError):
        return False, "revision must be an int"
    if not _iso_or_none(pulse.get("updated_at")):
        return False, "updated_at must be ISO-8601"

    for key in ("missions", "blockers", "resources", "locks", "notes", "timeline"):
        if not isinstance(pulse.get(key), list):
            return False, f"{key} must be an array"
        if len(pulse[key]) > CAPS[key]:
            return False, f"{key} exceeds cap {CAPS[key]}"

    seen: dict[str, str] = {}

    def _uniq(kind: str, rid: str) -> str | None:
        if not ID_RE.fullmatch(rid):
            return f"bad {kind} id: {rid!r}"
        if rid in seen:
            return f"duplicate id {rid} ({seen[rid]} and {kind})"
        seen[rid] = kind
        return None

    blocker_ids = set()
    for i, b in enumerate(pulse["blockers"]):
        if not isinstance(b, dict):
            return False, f"blockers[{i}] not an object"
        err = _uniq("blocker", _as_str(b.get("id")))
        if err:
            return False, err
        if not _as_str(b.get("title")):
            return False, f"blockers[{i}] missing title"
        if b.get("kind") not in BLOCKER_KINDS:
            return False, f"blockers[{i}] bad kind"
        if b.get("status") not in BLOCKER_STATUSES:
            return False, f"blockers[{i}] bad status"
        blocker_ids.add(b["id"])

    res_ids = set()
    for i, r in enumerate(pulse["resources"]):
        if not isinstance(r, dict):
            return False, f"resources[{i}] not an object"
        err = _uniq("resource", _as_str(r.get("id")))
        if err:
            return False, err
        if r.get("kind") not in RESOURCE_KINDS:
            return False, f"resources[{i}] bad kind"
        if r.get("kind") in {"repo", "url", "pr"} and not _as_str(r.get("url")):
            return False, f"resources[{i}] {r.get('kind')} needs url"
        if r.get("status") not in RESOURCE_STATUSES:
            return False, f"resources[{i}] bad status"
        res_ids.add(r["id"])

    for i, m in enumerate(pulse["missions"]):
        if not isinstance(m, dict):
            return False, f"missions[{i}] not an object"
        err = _uniq("mission", _as_str(m.get("id")))
        if err:
            return False, err
        if not _as_str(m.get("title")):
            return False, f"missions[{i}] missing title"
        if m.get("status") not in MISSION_STATUSES:
            return False, f"missions[{i}] bad status"
        if m.get("status") == "blocked":
            bid = _as_str(m.get("blocker_id"))
            if not bid:
                return False, f"missions[{i}] blocked requires blocker_id"
            if bid not in blocker_ids:
                return False, f"missions[{i}] blocker_id {bid} does not exist"

    for i, lock in enumerate(pulse["locks"]):
        if not isinstance(lock, dict):
            return False, f"locks[{i}] not an object"
        err = _uniq("lock", _as_str(lock.get("id")))
        if err:
            return False, err
        if not _as_str(lock.get("title")):
            return False, f"locks[{i}] missing title"

    for i, note in enumerate(pulse["notes"]):
        if not isinstance(note, dict):
            return False, f"notes[{i}] not an object"
        nid = _as_str(note.get("id"))
        if nid:
            err = _uniq("note", nid)
            if err:
                return False, err
        if not _as_str(note.get("text")):
            return False, f"notes[{i}] missing text"

    today = pulse.get("today")
    if not isinstance(today, dict):
        return False, "today must be an object"
    if today.get("date") not in (None, "") and not DATE_RE.fullmatch(str(today.get("date"))):
        return False, "today.date must be YYYY-MM-DD or null"

    return True, ""


def view(pulse: dict[str, Any]) -> dict[str, Any]:
    """Derived glance fields for chip/page — never stored."""
    missions = sorted(
        pulse.get("missions") or [],
        key=lambda m: (float(m.get("order") or 0), m.get("id") or ""),
    )
    open_m = [m for m in missions if m.get("status") not in {"done", "cancelled"}]
    next_m = open_m[0] if open_m else None
    blockers = [b for b in (pulse.get("blockers") or []) if b.get("status") != "resolved"]
    waiting = [b for b in blockers if b.get("kind") == "waiting-on"]
    stuck = [b for b in blockers if b.get("kind") == "stuck-on"]
    resources = pulse.get("resources") or []
    urls = [r for r in resources if r.get("kind") == "url"]
    down = [r for r in urls if r.get("status") == "down"]
    prs = [r for r in resources if r.get("kind") == "pr" and r.get("status") in {"open", "unknown"}]
    return {
        "next_mission": next_m,
        "open_mission_count": len(open_m),
        "doing": [m for m in missions if m.get("status") == "doing"],
        "blocker_count": len(blockers),
        "waiting_on_count": len(waiting),
        "stuck_on_count": len(stuck),
        "waiting_on": waiting,
        "stuck_on": stuck,
        "down_url_count": len(down),
        "pr_count": len(prs),
        "url_resources": urls,
        "pr_resources": prs,
        "mode": pulse.get("mode") or DEFAULT_MODE,
        "revision": pulse.get("revision") or 0,
        "updated_at": pulse.get("updated_at"),
    }


def recommend_today(pulse: dict[str, Any], *, today: str | None = None, limit: int = 3) -> list[dict[str, Any]]:
    """Morning rec: overdue first, then last night's pins, then pile order."""
    date = today or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    missions = [
        m
        for m in (pulse.get("missions") or [])
        if isinstance(m, dict) and m.get("status") not in {"done", "cancelled"}
    ]
    today_obj = pulse.get("today") if isinstance(pulse.get("today"), dict) else {}
    pin_ids = list((today_obj or {}).get("pinned_mission_ids") or [])
    by_id = {m.get("id"): m for m in missions}

    def _due_rank(m: dict[str, Any]) -> tuple[int, float, str]:
        due = m.get("due")
        overdue = 0 if (due and str(due) <= date) else 1
        order = float(m.get("order") or 0)
        return (overdue, order, str(m.get("id") or ""))

    ranked = sorted(missions, key=_due_rank)
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    # 1. overdue first (due <= today), pile order among themselves
    for m in ranked:
        due = m.get("due")
        if due and str(due) <= date:
            mid = m.get("id")
            if mid and mid not in seen:
                seen.add(str(mid))
                out.append(m)
            if len(out) >= limit:
                return out[:limit]
    # 2. last night's pins still open
    for pid in pin_ids:
        m = by_id.get(pid)
        if m and pid not in seen:
            seen.add(str(pid))
            out.append(m)
        if len(out) >= limit:
            return out[:limit]
    # 3. rest of the pile
    for m in ranked:
        mid = m.get("id")
        if mid and mid not in seen:
            seen.add(str(mid))
            out.append(m)
        if len(out) >= limit:
            break
    return out[:limit]

