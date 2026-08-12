"""Run and parse check-workstream.sh."""
from __future__ import annotations

import re
import subprocess
import time
from typing import Any

from .constants import CHECK_CACHE_TTL_S, WORKSTREAMS_ROOT
from .text import strip_ansi

_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def parse_check_output(output: str, returncode: int) -> dict[str, Any]:
    lines = [strip_ansi(ln).rstrip() for ln in (output or "").splitlines()]
    violations: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    for s in lines:
        s = s.strip()
        if not s or s.startswith("─") or s.startswith("="):
            continue
        low = s.lower()
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


def run_check(stream: str, *, force: bool = False) -> dict[str, Any]:
    now = time.time()
    if not force and stream in _cache:
        ts, payload = _cache[stream]
        if now - ts < CHECK_CACHE_TTL_S:
            return {**payload, "cached": True}

    script = WORKSTREAMS_ROOT / stream / "scripts" / "check-workstream.sh"
    if not script.exists():
        payload = {
            "stream": stream,
            "status": "no_script",
            "violations": [],
            "warnings": [],
            "violation_count": 0,
            "warning_count": 0,
            "output": "",
            "summary_line": "No check-workstream.sh",
            "checked_at": int(now),
            "cached": False,
        }
        _cache[stream] = (now, payload)
        return payload

    try:
        result = subprocess.run(
            ["bash", str(script)],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(WORKSTREAMS_ROOT / stream),
        )
        output = result.stdout or result.stderr or ""
        parsed = parse_check_output(output, result.returncode)
        payload = {
            "stream": stream,
            "output": strip_ansi(output),
            "returncode": result.returncode,
            "checked_at": int(now),
            "cached": False,
            **parsed,
        }
    except subprocess.TimeoutExpired:
        payload = {
            "stream": stream,
            "status": "error",
            "violations": [{"rule": "", "message": "check timed out (30s)", "raw": "timeout"}],
            "warnings": [],
            "violation_count": 1,
            "warning_count": 0,
            "output": "",
            "summary_line": "check timed out",
            "checked_at": int(now),
            "cached": False,
        }
    except Exception as exc:  # noqa: BLE001
        payload = {
            "stream": stream,
            "status": "error",
            "violations": [{"rule": "", "message": str(exc), "raw": str(exc)}],
            "warnings": [],
            "violation_count": 1,
            "warning_count": 0,
            "output": "",
            "summary_line": str(exc),
            "checked_at": int(now),
            "cached": False,
        }

    _cache[stream] = (now, payload)
    return payload


def clear_check_cache(stream: str | None = None) -> None:
    if stream is None:
        _cache.clear()
    else:
        _cache.pop(stream, None)
