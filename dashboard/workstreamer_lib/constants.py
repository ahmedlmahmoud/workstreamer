"""Shared constants for the workstreamer API."""
from __future__ import annotations

from pathlib import Path

WORKSTREAMS_ROOT = Path("/home/ubuntu/dabbo-state/workstreams")

CORE_FILES = (
    "AGENTS.md",
    "INDEX.md",
    "TAXONOMY.md",
    "README.md",
    "AGENT-ONBOARDING.md",
    "INFRASTRUCTURE.md",
)

# Display names for known streams (optional polish; falls back to title-case slug)
DISPLAY_NAMES = {
    "sanziq": "SanziQ",
    "inf-api": "inf-api",
    "dipzin": "Dipzin",
    "faceless": "Faceless",
    "fincy": "Fincy",
    "operations": "Operations",
    "upwork": "Upwork",
    "yengko": "Yengko",
}

# STATUS-LIVE older than this (days) is "stale"
STATUS_STALE_DAYS = 7

# In-process check cache TTL (seconds) — avoids re-running bash on every hover
CHECK_CACHE_TTL_S = 20
