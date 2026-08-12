"""Parse STATUS-LIVE.md into structured pulse data."""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .constants import STATUS_STALE_DAYS
from .text import milestone_short_id, pct_from, status_tone, strip_md_links


def _split_md_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_sep_row(cells: list[str]) -> bool:
    if not cells:
        return True
    return all(
        re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) is not None for c in cells if c
    )


def _parse_updated(raw: str) -> tuple[str, int | None, bool]:
    """Return (display, epoch_or_none, is_stale)."""
    display = raw.strip()
    epoch = None
    # Try ISO / YYYY-MM-DD
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%b %d, %Y", "%d %b %Y"):
        try:
            dt = datetime.strptime(display[:19], fmt).replace(tzinfo=timezone.utc)
            epoch = int(dt.timestamp())
            break
        except ValueError:
            continue
    stale = False
    if epoch is not None:
        age_days = (time.time() - epoch) / 86400
        stale = age_days > STATUS_STALE_DAYS
    return display, epoch, stale


def _section_matches(key: str, parts: tuple[str, ...]) -> bool:
    """Match heading tokens. Skip internal keys so ``pr`` never hits ``_pre``."""
    if not key or key.startswith("_"):
        return False
    return any(p in key for p in parts)


def parse_status_live(text: str, *, mtime: float | None = None) -> dict[str, Any]:
    lines = text.splitlines()
    title = next((ln.lstrip("# ").strip() for ln in lines if ln.startswith("# ")), "")
    updated = ""
    for ln in lines:
        if "last updated" in ln.lower():
            updated = re.sub(r"[*_`]", "", ln).split(":", 1)[-1].strip()
            break

    updated_display, updated_epoch, stale = _parse_updated(updated) if updated else ("", None, False)
    if updated_epoch is None and mtime is not None:
        updated_epoch = int(mtime)
        age_days = (time.time() - mtime) / 86400
        stale = age_days > STATUS_STALE_DAYS
        if not updated_display:
            updated_display = datetime.fromtimestamp(mtime, tz=timezone.utc).strftime("%Y-%m-%d")

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
            if _section_matches(key, section_key_parts):
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
        pct = pct_from(pct_raw)
        tone = status_tone(status)
        if tone in {"idle", "active"} and notes:
            note_tone = status_tone(notes)
            if tone == "idle" and note_tone != "idle":
                tone = note_tone
        milestones.append(
            {
                "id": mid,
                "short_id": milestone_short_id(mid),
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
        urls.append({"name": cells[0], "status": cells[1], "tone": status_tone(cells[1])})

    def bullets(section_parts: tuple[str, ...]) -> list[str]:
        body: list[str] = []
        for key, val in sections.items():
            if _section_matches(key, section_parts):
                body = val
                break
        out: list[str] = []
        for ln in body:
            s = ln.strip()
            if not s or s.startswith(">") or set(s.replace(" ", "")) <= {"-", "—"}:
                continue
            if s.startswith(("-", "*", "•")) or re.match(r"^\d+[.)]\s+", s):
                s = re.sub(r"^(\d+[.)]\s+|[-*•]\s+)", "", s).strip()
                s = strip_md_links(s)
                if s:
                    out.append(s)
        return out

    prs = bullets(("open pr", "prs", "pull request"))
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

    milestone_chips = [
        {
            "id": m["short_id"],
            "pct": m["pct"],
            "tone": m["tone"],
            "status": m["status"],
            "label": m["label"],
        }
        for m in milestones
    ]

    # Overall progress = mean of known pcts, or count of good/total
    pcts = [m["pct"] for m in milestones if m["pct"] is not None]
    overall_pct = round(sum(pcts) / len(pcts)) if pcts else None
    done_n = sum(1 for m in milestones if m["tone"] == "good")

    return {
        "title": title,
        "updated": updated_display,
        "updated_epoch": updated_epoch,
        "stale": stale,
        "milestones": milestones,
        "milestone_chips": milestone_chips,
        "urls": urls,
        "prs": prs,
        "blockers": blockers,
        "focus": focus,
        "down_urls": down_urls,
        "next_action": next_action,
        "overall_pct": overall_pct,
        "done_count": done_n,
        "milestone_count": len(milestones),
        "has_content": bool(milestones or urls or blockers or prs),
    }


def read_pulse(status_file: Path) -> dict[str, Any] | None:
    if not status_file.exists():
        return None
    try:
        st = status_file.stat()
        text = status_file.read_text(errors="replace")
        return parse_status_live(text, mtime=st.st_mtime)
    except OSError:
        return None
