"""Per-stream and fleet snapshots."""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from .check_runner import run_check
from .constants import CORE_FILES, DISPLAY_NAMES, WORKSTREAMS_ROOT
from .pulse import read_pulse
from .text import display_name, extract_profile, milestone_short_id


def core_presence(stream_dir: Path) -> dict[str, Any]:
    present, missing = [], []
    for name in CORE_FILES:
        (present if (stream_dir / name).exists() else missing).append(name)
    has_checker = (stream_dir / "scripts" / "check-workstream.sh").exists()
    has_status = (stream_dir / "scope" / "STATUS-LIVE.md").exists()
    score = len(present) + (1 if has_checker else 0) + (1 if has_status else 0)
    total = len(CORE_FILES) + 2
    return {
        "present": present,
        "missing": missing,
        "has_checker": has_checker,
        "has_status": has_status,
        "score": score,
        "total": total,
        "pct": round(100 * score / total) if total else 0,
    }


def stream_snapshot(
    d: Path,
    *,
    run_check_flag: bool = False,
    include_pulse: bool = True,
    force_check: bool = False,
) -> dict[str, Any]:
    agents = d / "AGENTS.md"
    index = d / "INDEX.md"
    status_live = d / "scope" / "STATUS-LIVE.md"

    profile = None
    if agents.exists():
        try:
            profile = extract_profile(agents.read_text(errors="replace"))
        except OSError:
            profile = None

    core = core_presence(d)
    adopted = agents.exists() and index.exists() and core["has_checker"]
    name = d.name
    title = display_name(name, DISPLAY_NAMES)

    pulse = read_pulse(status_live) if include_pulse else None
    check = run_check(name, force=force_check) if run_check_flag else None

    if not agents.exists():
        health = "bare"
    elif check and check.get("status") == "dirty":
        health = "dirty"
    elif not adopted:
        health = "partial"
    elif pulse and pulse.get("down_urls"):
        health = "degraded"
    elif pulse and pulse.get("stale"):
        health = "stale"
    elif pulse and pulse.get("blockers"):
        health = "active"
    elif check and check.get("status") == "clean":
        health = "clean"
    else:
        health = "adopted"

    focus_label = ""
    if pulse and pulse.get("focus"):
        f = pulse["focus"]
        mid_s = f.get("short_id") or milestone_short_id(f.get("id", ""))
        if f.get("pct") is not None:
            focus_label = f"{mid_s} · {f['pct']}%"
        else:
            focus_label = mid_s or f.get("status") or ""
    elif pulse and pulse.get("next_action"):
        focus_label = pulse["next_action"][:40]

    # Severity rank for sorting (issues first)
    severity = {
        "dirty": 0,
        "degraded": 1,
        "stale": 2,
        "partial": 3,
        "active": 4,
        "clean": 5,
        "adopted": 6,
        "bare": 7,
    }.get(health, 9)

    return {
        "name": name,
        "title": title,
        "path": str(d),
        "has_guide": agents.exists(),
        "has_index": index.exists(),
        "has_checker": core["has_checker"],
        "has_status": core["has_status"],
        "profile": profile,
        "adopted": adopted,
        "core": core,
        "health": health,
        "severity": severity,
        "focus_label": focus_label,
        "blocker_count": len(pulse["blockers"]) if pulse else 0,
        "down_url_count": len(pulse["down_urls"]) if pulse else 0,
        "pr_count": len(pulse["prs"]) if pulse else 0,
        "overall_pct": pulse.get("overall_pct") if pulse else None,
        "stale": bool(pulse and pulse.get("stale")),
        "pulse": pulse,
        "check": check,
    }


def list_streams(*, check: bool = False, pulse: bool = True, force_check: bool = False) -> dict[str, Any]:
    if not WORKSTREAMS_ROOT.is_dir():
        return {
            "streams": [],
            "error": f"workstreams root missing: {WORKSTREAMS_ROOT}",
            "root": str(WORKSTREAMS_ROOT),
        }

    streams = [
        stream_snapshot(d, run_check_flag=check, include_pulse=pulse, force_check=force_check)
        for d in sorted(WORKSTREAMS_ROOT.iterdir())
        if d.is_dir() and not d.name.startswith(".")
    ]

    # Sort: issues first, then alpha
    streams_sorted = sorted(streams, key=lambda s: (s.get("severity", 9), s.get("name", "")))

    return {
        "streams": streams_sorted,
        "count": len(streams_sorted),
        "stats": {
            "adopted": sum(1 for s in streams if s.get("adopted")),
            "bare": sum(1 for s in streams if s.get("health") == "bare"),
            "dirty": sum(1 for s in streams if s.get("health") == "dirty"),
            "degraded": sum(1 for s in streams if s.get("down_url_count", 0) > 0),
            "stale": sum(1 for s in streams if s.get("stale")),
            "partial": sum(1 for s in streams if s.get("health") == "partial"),
            "active": sum(
                1 for s in streams if s.get("health") in {"active", "degraded", "clean", "adopted", "stale"}
            ),
            "issues": sum(
                1
                for s in streams
                if s.get("health") in {"dirty", "degraded", "partial", "stale"}
                or (s.get("down_url_count") or 0) > 0
            ),
        },
        "root": str(WORKSTREAMS_ROOT),
        "generated_at": int(time.time()),
    }


def resolve_stream(*, cwd: str | None = None, profile: str | None = None, stream: str | None = None) -> dict[str, Any]:
    """Three-level resolution: explicit stream → profile link → cwd path."""
    if stream:
        d = WORKSTREAMS_ROOT / stream
        if d.is_dir():
            return {"stream": stream, "source": "explicit", "path": str(d)}
        return {"stream": None, "source": "explicit", "error": f"unknown stream: {stream}"}

    # Profile: scan AGENTS.md for matching profile
    if profile:
        for d in sorted(WORKSTREAMS_ROOT.iterdir()) if WORKSTREAMS_ROOT.is_dir() else []:
            if not d.is_dir() or d.name.startswith("."):
                continue
            agents = d / "AGENTS.md"
            if not agents.exists():
                continue
            try:
                p = extract_profile(agents.read_text(errors="replace"))
            except OSError:
                continue
            if p == profile or d.name == profile:
                return {"stream": d.name, "source": "profile", "path": str(d), "profile": profile}

    # Cwd path
    if cwd:
        m = re.search(r"workstreams/([^/]+)", cwd)
        if m:
            name = m.group(1)
            d = WORKSTREAMS_ROOT / name
            if d.is_dir():
                return {"stream": name, "source": "cwd", "path": str(d), "cwd": cwd}

    return {"stream": None, "source": "none", "cwd": cwd, "profile": profile}
