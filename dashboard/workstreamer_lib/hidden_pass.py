"""Hidden session-end pass. Silent. One write or none."""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Callable

from .schema import now_iso
from . import store as pulse_store

CheckFn = Callable[[dict[str, Any]], str | None]

_TODO_LINE = re.compile(r"^\s*(?:[-*]\s*)?(?:TODO|todo|Hunt)\s*[:\-]\s+(.+)$", re.M)
_DONE_HINT = re.compile(r"\b(done|shipped|merged|finished|landed)\b", re.I)


def _new_event(pulse: dict[str, Any], kind: str, ref: str | None, detail: str | None) -> None:
    existing = {e.get("id") for e in pulse.get("timeline") or []}
    ev_id = pulse_store._new_id("timeline", f"{kind}-{now_iso()}", {x for x in existing if x})
    ev = {"id": ev_id, "at": now_iso(), "kind": kind, "ref": ref, "detail": detail}
    tl = list(pulse.get("timeline") or [])
    tl.append(ev)
    pulse["timeline"] = tl[-200:]


def _extract_todos(transcript: str) -> list[str]:
    if not transcript:
        return []
    out: list[str] = []
    for m in _TODO_LINE.finditer(transcript):
        title = (m.group(1) or "").strip()
        if title:
            out.append(title[:200])
    return out[:8]


def run_pass(
    stream: str,
    *,
    session: dict[str, Any] | None = None,
    transcript: str = "",
    check_resource: CheckFn | None = None,
) -> dict[str, Any]:
    """Always: time + recheck. Mode: quiet/steer/hunt. Fail closed, no half-write."""
    session = session or {}
    loaded = pulse_store.load(stream)
    if not loaded["ok"] or not loaded.get("pulse"):
        return {
            "ok": False,
            "error": loaded.get("error") or "invalid",
            "message": loaded.get("error") or "pulse unreadable",
            "invented": [],
        }

    pulse = deepcopy(loaded["pulse"])
    mode = pulse.get("mode") or "steer"
    invented: list[str] = []

    try:
        # Recheck first so a raise cannot follow a write.
        if check_resource:
            for res in list(pulse.get("resources") or []):
                if res.get("kind") not in {"url", "pr", "repo"}:
                    continue
                status = check_resource(res)
                if status and status != res.get("status"):
                    res["status"] = status
                    res["checked_at"] = now_iso()
                    _new_event(pulse, "resource.rechecked", res.get("id"), f"{res.get('title')}→{status}")
        else:
            for res in list(pulse.get("resources") or []):
                if res.get("kind") in {"url", "pr", "repo"} and not res.get("checked_at"):
                    res["checked_at"] = now_iso()

        dur = session.get("duration_s")
        sid = session.get("session_id") or ""
        mid = session.get("mission_id")
        detail = f"{int(dur)}s" if isinstance(dur, (int, float)) else "session"
        if mid:
            detail = f"{detail} · {mid}"
        _new_event(pulse, "session.timed", mid or sid or None, detail)

        if mode in {"steer", "hunt"} and mid and session.get("completed"):
            if _DONE_HINT.search(transcript or "") or session.get("completed") is True:
                for m in pulse.get("missions") or []:
                    if m.get("id") == mid and m.get("status") not in {"done", "cancelled"}:
                        prev = m.get("status")
                        m["status"] = "done"
                        m["updated_at"] = now_iso()
                        _new_event(pulse, "mission.flipped", mid, f"{prev}→done")
                        break

        if mode == "hunt":
            existing_titles = {str(m.get("title") or "").lower() for m in pulse.get("missions") or []}
            for title in _extract_todos(transcript):
                if title.lower() in existing_titles:
                    continue
                existing_ids = {m.get("id") for m in pulse.get("missions") or [] if m.get("id")}
                nid = pulse_store._new_id("missions", title, {x for x in existing_ids if x})
                orders = [float(m.get("order") or 0) for m in pulse.get("missions") or []]
                rec = {
                    "id": nid,
                    "title": title,
                    "status": "todo",
                    "order": (min(orders) - 1) if orders else 0,
                    "due": None,
                    "blocker_id": None,
                    "goals": [],
                    "related": [],
                    "note": "hunt",
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                }
                pulse.setdefault("missions", []).append(rec)
                invented.append(nid)
                existing_titles.add(title.lower())
                _new_event(pulse, "mission.added", nid, title)

    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": "failed", "message": str(e), "invented": []}

    committed = pulse_store.commit(stream, pulse, base_revision=loaded["pulse"].get("revision"))
    if not committed.get("ok"):
        return {**committed, "invented": []}
    return {
        "ok": True,
        "invented": invented,
        "mode": mode,
        "pulse": committed.get("pulse"),
        "view": committed.get("view"),
        "revision": committed.get("revision"),
    }


def hook_session_end(ctx_or_payload: Any = None, **kwargs) -> dict[str, Any]:
    """Hermes hook entry. Silent. Resolves stream from cwd/profile."""
    payload = ctx_or_payload if isinstance(ctx_or_payload, dict) else kwargs
    cwd = payload.get("cwd") or ""
    profile = payload.get("profile") or ""
    stream = payload.get("stream")
    if not stream:
        from .snapshot import resolve_stream

        resolved = resolve_stream(cwd=cwd or None, profile=profile or None)
        stream = resolved.get("stream")
    if not stream:
        return {"ok": True, "skipped": True, "reason": "no stream"}
    session = {
        "session_id": payload.get("session_id"),
        "duration_s": payload.get("duration_s"),
        "cwd": cwd,
        "profile": profile,
        "completed": payload.get("completed", True),
        "mission_id": payload.get("mission_id"),
    }
    return run_pass(stream, session=session, transcript=payload.get("transcript") or "")
