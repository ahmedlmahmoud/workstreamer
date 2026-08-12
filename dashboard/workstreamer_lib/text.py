"""Text / regex helpers."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

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
_GH = re.compile(
    r"(?:https?://(?:[^/@\s]+@)?|git@)github\.com[:/](?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)",
    re.IGNORECASE,
)

_repo_cache: dict[str, str | None] = {}


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
    parts = re.split(r"[-_]", slug)
    return " ".join(p[:1].upper() + p[1:] for p in parts if p)


def status_tone(text: str) -> str:
    t = (text or "").lower()
    if any(x in t for x in ("fail", "502", "down", "✗", "error", "broke", "offline")):
        return "bad"
    if any(x in t for x in ("signed", "done", "complete", "✓", "live", "pass", "ok")) and "not " not in t:
        return "good"
    if any(x in t for x in ("progress", "~", "wip", "partial", "in motion")):
        return "active"
    if any(x in t for x in ("not started", "todo", "pending", "blocked")):
        if "block" in t and "not started" not in t:
            return "bad"
        return "idle"
    return "idle"


def normalize_github_url(raw: str) -> str | None:
    """https://github.com/owner/repo — strips tokens, .git, ssh form."""
    m = _GH.search(raw or "")
    if not m:
        return None
    owner = m.group("owner")
    repo = m.group("repo").removesuffix(".git")
    if not owner or not repo or owner.lower() in {"http", "https"}:
        return None
    return f"https://github.com/{owner}/{repo}"


def extract_repo_from_text(text: str) -> str | None:
    return normalize_github_url(text or "")


def _has_own_git(path: Path) -> bool:
    """True only if this directory itself is a git work tree / submodule."""
    return (path / ".git").exists()


def discover_repo(stream_dir: Path) -> str | None:
    """Find the stream's GitHub URL. Never a plugin-side registry.

    1. ``git remote get-url origin`` in ``repo/`` then stream root —
       only if that directory has its own ``.git`` (do not walk into dabbo-state)
    2. First github.com URL in AGENTS.md / README.md / INFRASTRUCTURE.md
    """
    key = str(stream_dir)
    if key in _repo_cache:
        return _repo_cache[key]

    url: str | None = None
    for git_dir in (stream_dir / "repo", stream_dir):
        if not _has_own_git(git_dir):
            continue
        try:
            result = subprocess.run(
                ["git", "-C", str(git_dir), "remote", "get-url", "origin"],
                capture_output=True,
                text=True,
                timeout=3,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode != 0:
            continue
        url = normalize_github_url(result.stdout or result.stderr or "")
        if url:
            break

    if not url:
        for fname in ("AGENTS.md", "README.md", "INFRASTRUCTURE.md"):
            path = stream_dir / fname
            if not path.is_file():
                continue
            try:
                url = extract_repo_from_text(path.read_text(errors="replace"))
            except OSError:
                url = None
            if url:
                break

    _repo_cache[key] = url
    return url
