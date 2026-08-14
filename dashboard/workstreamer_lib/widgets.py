"""Widget catalog — extras appear only when the stream earned them."""
from __future__ import annotations

from typing import Any


ALWAYS = ("missions", "blockers", "resources")


def widget_tabs(
    pulse: dict[str, Any] | None,
    *,
    has_repo: bool = False,
    has_checker: bool = False,
    milestones: list | None = None,
) -> list[str]:
    """Return ordered tab ids. Missing data = missing tab. Notes + timeline always."""
    p = pulse if isinstance(pulse, dict) else {}
    tabs = list(ALWAYS)

    urls = [r for r in (p.get("resources") or []) if isinstance(r, dict) and r.get("kind") == "url"]
    prs = [r for r in (p.get("resources") or []) if isinstance(r, dict) and r.get("kind") == "pr"]
    waiting = [
        b
        for b in (p.get("blockers") or [])
        if isinstance(b, dict) and b.get("kind") == "waiting-on" and b.get("status") != "resolved"
    ]
    locks = p.get("locks") or []
    pipe = p.get("pipeline") or []

    if urls:
        tabs.append("health")
    if has_repo or prs:
        tabs.append("ship")
    if pipe:
        tabs.append("pipeline")
    if milestones:
        tabs.append("milestones")
    if waiting:
        tabs.append("waiting-on")
    if has_checker:
        tabs.append("checks")
    if locks:
        tabs.append("locks")
    tabs.append("notes")
    tabs.append("timeline")
    return tabs
