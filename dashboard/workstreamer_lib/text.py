"""Text / regex helpers."""
from __future__ import annotations

import re

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
_M_ID = re.compile(r"^(M\d+)", re.I)


def strip_ansi(s: str) -> str:
    return _ANSI_RE.sub("", s or "")


def extract_profile(text: str) -> str | None:
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


def pct_from(text: str) -> int | None:
    m = _PCT_RE.search(text or "")
    return int(m.group(1)) if m else None


def strip_md_links(s: str) -> str:
    return _MD_LINK.sub(r"\1", s or "")


def milestone_short_id(mid: str) -> str:
    m = _M_ID.match(mid or "")
    return m.group(1).upper() if m else (mid or "")[:6]


def display_name(slug: str, table: dict[str, str]) -> str:
    if slug in table:
        return table[slug]
    if not slug:
        return ""
    # title-case kebab/snake
    parts = re.split(r"[-_]", slug)
    return " ".join(p[:1].upper() + p[1:] for p in parts if p)


def status_tone(text: str) -> str:
    t = (text or "").lower()
    # Order matters: explicit failure beats "live" words inside failure phrases
    if any(x in t for x in ("fail", "502", "down", "✗", "error", "broke", "offline")):
        return "bad"
    if any(x in t for x in ("signed", "done", "complete", "✓", "live", "pass", "ok")) and "not " not in t:
        return "good"
    if any(x in t for x in ("progress", "~", "wip", "partial", "in motion")):
        return "active"
    if any(x in t for x in ("not started", "todo", "pending", "blocked")):
        # "blocked" alone is bad-ish; keep idle for not-started
        if "block" in t and "not started" not in t:
            return "bad"
        return "idle"
    return "idle"
