"""Workstreamer plugin API — backend for Desktop JS.

Mounted at /api/plugins/workstreamer/ via dashboard/manifest.json.
"""

from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter()
WORKSTREAMS_ROOT = Path("/home/ubuntu/dabbo-state/workstreams")

CORE_FILES = (
    "AGENTS.md",
    "INDEX.md",
    "TAXONOMY.md",
    "README.md",
    "AGENT-ONBOARDING.md",
    "INFRASTRUCTURE.md",
)

# Handles: **Hermes profile:** `sanziq`  |  profile: sanziq  |  Hermes profile: sanziq
_PROFILE_ANY = re.compile(
    r"Hermes\s+profile\s*\**\s*:\s*\**\s*[`\"']*(?P<name>[A-Za-z0-9_./-]+)",
    re.IGNORECASE,
)
_PROFILE_LOOSE = re.compile(
    r"\bprofile\s*\**\s*[:=]\s*\**\s*[`\"']*(?P<name>[A-Za-z0-9_./-]+)",
    re.IGNORECASE,
)
_PCT_RE = re.compile(r"~?\s*(\d{1,3})\s*%")
_MD_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _strip_ansi(s: str) -> str:
    return _ANSI_RE.sub("", s or "")


def _extract_profile(text: str) -> str | None:
    for line in text.splitlines():
        if "profile" not in line.lower():
            continue
        m = _PROFILE_ANY.search(line) or _PROFILE_LOOSE.search(line)
        if not m:
            continue
        name = m.group("name").strip("*`\"' :")
        if name and name.lower() not in {"**", "*", "—", "-", "profile", "hermes"}:
            return name
    return None


def _parse_check_output(output: str, returncode: int) -> dict[str, Any]:
    lines = [_strip_ansi(ln).rstrip() for ln in (output or "").splitlines()]
    violations: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    for s in lines:
        s = s.strip()
        if not s or s.startswith("─") or s.startswith("="):
            continue
        low = s.lower()
        # Success lines often contain the word "violations" — skip them
        if "no violations" in low or "✓ clean" in low or low.startswith("✓"):
            continue

        kind = None
        if re.search(r"\bVIOLATION\b", s, re.I) or s.startswith("✗") or s.startswith("✖"):
            kind = "violation"
        elif re.search(r"\bWARNING\b", s, re.I) or s.startswith("⚠"):
            kind = "warning"
        if not kind:
            continue

        msg = re.sub(r"^(VIOLATION|WARNING|FAIL|ERROR)\s*[:\-–]?\s*", "", s, flags=re.I)
        msg = re.sub(r"^[✗✖⚠•\-\*]+\s*", "", msg).strip()
        rule = ""
        rm = re.match(r"^(R\d+|C\d+)\b[:\s\-–]*(.*)$", msg, re.I)
        if rm:
            rule = rm.group(1).upper()
            msg = rm.group(2).strip() or msg
        item = {"rule": rule, "message": msg or s, "raw": s}
        (violations if kind == "violation" else warnings).append(item)

    if returncode == 0 and not violations:
        status = "clean"
    elif returncode != 0 or violations:
        status = "dirty"
    else:
        status = "warn"

    summary = ""
    for ln in reversed(lines):
        s = ln.strip()
        if s and not s.startswith("─") and not s.startswith("="):
            summary = s
            break

    return {
        "status": status,
        "violations": violations,
        "warnings": warnings,
        "violation_count": len(violations),
        "warning_count": len(warnings),
        "summary_line": summary,
    }


def _run_check(stream: str) -> dict[str, Any]:
    script = WORKSTREAMS_ROOT / stream / "scripts" / "check-workstream.sh"
    if not script.exists():
        return {
            "stream": stream,
            "status": "no_script",
            "violations": [],
            "warnings": [],
            "violation_count": 0,
            "warning_count": 0,
            "output": "",
            "summary_line": "No check-workstream.sh",
            "checked_at": int(time.time()),
        }
    try:
        result = subprocess.run(
            ["bash", str(script)],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(WORKSTREAMS_ROOT / stream),
        )
        output = result.stdout or result.stderr or ""
        parsed = _parse_check_output(output, result.returncode)
        return {
            "stream": stream,
            "output": _strip_ansi(output),
            "returncode": result.returncode,
            "checked_at": int(time.time()),
            **parsed,
        }
    except subprocess.TimeoutExpired:
        return {
            "stream": stream,
            "status": "error",
            "violations": [{"rule": "", "message": "check timed out (30s)", "raw": "timeout"}],
            "warnings": [],
            "violation_count": 1,
            "warning_count": 0,
            "output": "",
            "summary_line": "check timed out",
            "checked_at": int(time.time()),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "stream": stream,
            "status": "error",
            "violations": [{"rule": "", "message": str(exc), "raw": str(exc)}],
            "warnings": [],
            "violation_count": 1,
            "warning_count": 0,
            "output": "",
            "summary_line": str(exc),
            "checked_at": int(time.time()),
        }


def _split_md_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_sep_row(cells: list[str]) -> bool:
    if not cells:
        return True
    return all(
        re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) is not None for c in cells if c
    )


def _status_tone(text: str) -> str:
    t = (text or "").lower()
    if any(x in t for x in ("signed", "done", "complete", "✓", "live", "pass", "ok")) and not any(
        x in t for x in ("not", "fail", "502", "down")
    ):
        return "good"
    if any(x in t for x in ("block", "fail", "502", "down", "✗", "error", "broke")):
        return "bad"
    if any(x in t for x in ("progress", "~", "wip", "partial")):
        return "active"
    if any(x in t for x in ("not started", "todo", "pending")):
        return "idle"
    return "idle"


def _parse_status_live(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    title = next((ln.lstrip("# ").strip() for ln in lines if ln.startswith("# ")), "")
    updated = ""
    for ln in lines:
        if "last updated" in ln.lower():
            updated = re.sub(r"[*_`]", "", ln).split(":", 1)[-1].strip()
            break

    sections: dict[str, list[str]] = {}
    current = "_pre"
    sections[current] = []
    for ln in lines:
        if ln.startswith("## "):
            current = ln[3:].strip().lower()
            sections[current] = []
        else:
            sections.setdefault(current, []).append(ln)

    def table_rows(section_key_parts: tuple[str, ...]) -> list[list[str]]:
        body: list[str] = []
        for key, val in sections.items():
            if any(p in key for p in section_key_parts):
                body = val
                break
        rows: list[list[str]] = []
        for ln in body:
            if not ln.strip().startswith("|"):
                continue
            cells = _split_md_row(ln)
            if _is_sep_row(cells):
                continue
            rows.append(cells)
        return rows

    milestone_rows = table_rows(("milestone",))
    milestones: list[dict[str, Any]] = []
    start = 1 if milestone_rows and milestone_rows[0] and milestone_rows[0][0].lower() in {"m", "milestone"} else 0
    for cells in milestone_rows[start:]:
        if len(cells) < 2:
            continue
        mid = cells[0]
        status = cells[1] if len(cells) > 1 else ""
        pct_raw = cells[2] if len(cells) > 2 else ""
        paid = cells[3] if len(cells) > 3 else ""
        notes = cells[4] if len(cells) > 4 else ""
        pm = _PCT_RE.search(pct_raw)
        pct = int(pm.group(1)) if pm else None
        tone = _status_tone(status)
        # Notes like "Blocked on GSC" should not override an in-progress status to bad
        if tone in {"idle", "active"} and notes:
            note_tone = _status_tone(notes)
            if tone == "idle" and note_tone != "idle":
                tone = note_tone
            elif tone == "active" and note_tone == "good":
                tone = note_tone
        milestones.append(
            {
                "id": mid,
                "label": re.sub(r"^M\d+\s*", "", mid).strip() or mid,
                "status": status,
                "pct": pct,
                "paid": "" if paid in {"—", "-", ""} else paid,
                "notes": notes,
                "tone": tone,
            }
        )

    url_rows = table_rows(("url", "live"))
    urls: list[dict[str, Any]] = []
    ustart = 1 if url_rows and url_rows[0] and url_rows[0][0].lower() in {"url", "host"} else 0
    for cells in url_rows[ustart:]:
        if len(cells) < 2:
            continue
        urls.append({"name": cells[0], "status": cells[1], "tone": _status_tone(cells[1])})

    def bullets(section_parts: tuple[str, ...]) -> list[str]:
        body: list[str] = []
        for key, val in sections.items():
            if any(p in key for p in section_parts):
                body = val
                break
        out: list[str] = []
        for ln in body:
            s = ln.strip()
            if not s or s.startswith(">") or set(s.replace(" ", "")) <= {"-", "—"}:
                continue
            if s.startswith(("-", "*", "•")) or re.match(r"^\d+[.)]\s+", s):
                s = re.sub(r"^(\d+[.)]\s+|[-*•]\s+)", "", s).strip()
                s = _MD_LINK.sub(r"\1", s)
                if s:
                    out.append(s)
        return out

    prs = bullets(("pr", "open pr"))
    blockers = bullets(("blocker",))

    focus = None
    for m in milestones:
        if m["tone"] != "good":
            focus = m
            break
    if focus is None and milestones:
        focus = milestones[-1]

    down_urls = [u for u in urls if u["tone"] == "bad"]
    next_action = blockers[0] if blockers else (focus.get("notes") if focus else "")

    # Compact milestone chips for UI: id + pct
    milestone_chips = [
        {
            "id": re.match(r"^(M\d+)", m["id"]).group(1) if re.match(r"^(M\d+)", m["id"]) else m["id"][:4],
            "pct": m["pct"],
            "tone": m["tone"],
            "status": m["status"],
        }
        for m in milestones
    ]

    return {
        "title": title,
        "updated": updated,
        "milestones": milestones,
        "milestone_chips": milestone_chips,
        "urls": urls,
        "prs": prs,
        "blockers": blockers,
        "focus": focus,
        "down_urls": down_urls,
        "next_action": next_action,
        "has_content": bool(milestones or urls or blockers or prs),
    }


def _core_presence(stream_dir: Path) -> dict[str, Any]:
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


def _stream_snapshot(d: Path, *, run_check: bool = False, include_pulse: bool = True) -> dict[str, Any]:
    agents = d / "AGENTS.md"
    index = d / "INDEX.md"
    status_live = d / "scope" / "STATUS-LIVE.md"

    profile = None
    if agents.exists():
        try:
            profile = _extract_profile(agents.read_text(errors="replace"))
        except OSError:
            profile = None

    core = _core_presence(d)
    adopted = agents.exists() and index.exists() and core["has_checker"]

    pulse = None
    if include_pulse and status_live.exists():
        try:
            pulse = _parse_status_live(status_live.read_text(errors="replace"))
        except OSError:
            pulse = None

    check = _run_check(d.name) if run_check else None

    if not agents.exists():
        health = "bare"
    elif check and check.get("status") == "dirty":
        health = "dirty"
    elif not adopted:
        health = "partial"
    elif pulse and pulse.get("down_urls"):
        health = "degraded"
    elif pulse and pulse.get("blockers"):
        health = "active"
    elif check and check.get("status") == "clean":
        health = "clean"
    else:
        health = "adopted"

    focus_label = ""
    if pulse and pulse.get("focus"):
        f = pulse["focus"]
        mid = f.get("id", "")
        short = re.match(r"^(M\d+)", mid)
        mid_s = short.group(1) if short else mid
        if f.get("pct") is not None:
            focus_label = f"{mid_s} · {f['pct']}%"
        else:
            focus_label = mid_s or f.get("status") or ""
    elif pulse and pulse.get("next_action"):
        focus_label = pulse["next_action"][:40]

    return {
        "name": d.name,
        "has_guide": agents.exists(),
        "has_index": index.exists(),
        "has_checker": core["has_checker"],
        "has_status": core["has_status"],
        "profile": profile,
        "adopted": adopted,
        "core": core,
        "health": health,
        "focus_label": focus_label,
        "blocker_count": len(pulse["blockers"]) if pulse else 0,
        "down_url_count": len(pulse["down_urls"]) if pulse else 0,
        "pr_count": len(pulse["prs"]) if pulse else 0,
        "pulse": pulse,
        "check": check,
    }


@router.get("/check")
async def check_workstream(stream: str = "sanziq"):
    return _run_check(stream)


@router.get("/pulse")
async def pulse_workstream(stream: str = "sanziq"):
    status_file = WORKSTREAMS_ROOT / stream / "scope" / "STATUS-LIVE.md"
    if not status_file.exists():
        return {"stream": stream, "status": "no_status", "content": "", "pulse": None}
    content = status_file.read_text(errors="replace")
    return {
        "stream": stream,
        "status": "ok",
        "content": content,
        "pulse": _parse_status_live(content),
        "read_at": int(time.time()),
    }


@router.get("/stream")
async def stream_detail(stream: str = "sanziq", check: bool = True):
    d = WORKSTREAMS_ROOT / stream
    if not d.is_dir():
        return {"error": f"unknown stream: {stream}", "stream": stream}
    snap = _stream_snapshot(d, run_check=check, include_pulse=True)
    snap["stream"] = stream
    return snap


@router.get("/list")
async def list_workstreams(check: bool = False, pulse: bool = True):
    if not WORKSTREAMS_ROOT.is_dir():
        return {
            "streams": [],
            "error": f"workstreams root missing: {WORKSTREAMS_ROOT}",
            "root": str(WORKSTREAMS_ROOT),
        }

    streams = [
        _stream_snapshot(d, run_check=check, include_pulse=pulse)
        for d in sorted(WORKSTREAMS_ROOT.iterdir())
        if d.is_dir() and not d.name.startswith(".")
    ]

    return {
        "streams": streams,
        "count": len(streams),
        "stats": {
            "adopted": sum(1 for s in streams if s.get("adopted")),
            "bare": sum(1 for s in streams if s.get("health") == "bare"),
            "dirty": sum(1 for s in streams if s.get("health") == "dirty"),
            "degraded": sum(1 for s in streams if s.get("down_url_count", 0) > 0),
            "partial": sum(1 for s in streams if s.get("health") == "partial"),
            "active": sum(1 for s in streams if s.get("health") in {"active", "degraded", "clean", "adopted"}),
        },
        "root": str(WORKSTREAMS_ROOT),
        "generated_at": int(time.time()),
    }
