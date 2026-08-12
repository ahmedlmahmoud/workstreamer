"""Slash command handlers for /workstream, /stream, and /ws.

``/ws`` is kept as an exact alias so muscle memory still works. It is a
terrible *search* token: Hermes fuzzy-matches description words, and
``ws`` is a substring of ``workflows`` — which is why ``/ws`` used to
surface the inferio-development skill. Prefer ``/workstream`` or
``/stream``.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

WORKSTREAMS_ROOT = Path("/home/ubuntu/dabbo-state/workstreams")
_SUBS = frozenset({"check", "pulse", "adopt", "truth"})
_USAGE = (
    "Usage: /workstream [check|pulse|adopt|truth] [stream]\n"
    "       /stream  [check|pulse|adopt|truth] [stream]\n"
    "Bare /stream or /workstream pulses the current stream.\n"
    "/stream <name> pulses that stream. Alias: /ws (exact only)."
)


def _resolve_stream(ctx, stream_arg=None):
    if stream_arg:
        return stream_arg
    cwd = Path.cwd()
    try:
        rel = cwd.relative_to(WORKSTREAMS_ROOT)
        return rel.parts[0]
    except (ValueError, IndexError):
        return None


def _cmd_check(ctx, stream=None):
    name = _resolve_stream(ctx, stream)
    if not name:
        return "Not inside a workstream. Specify one: /workstream check <name>"

    script = WORKSTREAMS_ROOT / name / "scripts" / "check-workstream.sh"
    if not script.exists():
        return f"No check script found for {name}. Run /workstream adopt first?"

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True, text=True, timeout=30
    )
    return result.stdout + (result.stderr if result.stderr else "")


def _cmd_pulse(ctx, stream=None):
    name = _resolve_stream(ctx, stream)
    if not name:
        return "Not inside a workstream. Specify one: /workstream pulse <name>"

    status_file = WORKSTREAMS_ROOT / name / "scope" / "STATUS-LIVE.md"
    if not status_file.exists():
        return f"No STATUS-LIVE.md found for {name}. Create scope/STATUS-LIVE.md first."

    return status_file.read_text()


def _cmd_adopt(ctx, stream: str):
    templates = Path.home() / ".hermes" / "plugins" / "workstreamer" / "templates"
    if not templates.exists():
        return "Templates not found. Reinstall the workstreamer plugin."

    target = WORKSTREAMS_ROOT / stream
    if target.exists():
        return f"workstreams/{stream}/ already exists. Aborting."

    target.mkdir(parents=True)
    (target / "scripts").mkdir()
    (target / "scope").mkdir()

    placeholders = {
        "{{STREAM_NAME}}": stream,
        "{{DATE}}": "2026-08-12",
        "{{PROFILE_NAME}}": stream,
        "{{ONE_LINE_DESCRIPTION}}": f"{stream} workstream",
    }

    tmpl_map = {
        "AGENTS.md.tmpl": "AGENTS.md",
        "INDEX.md.tmpl": "INDEX.md",
        "TAXONOMY.md.tmpl": "TAXONOMY.md",
        "README.md.tmpl": "README.md",
        "STATUS-LIVE.md.tmpl": "scope/STATUS-LIVE.md",
        "check-workstream.sh.tmpl": "scripts/check-workstream.sh",
    }

    created = []
    for tmpl_name, dest_name in tmpl_map.items():
        tmpl_path = templates / tmpl_name
        dest_path = target / dest_name
        if tmpl_path.exists():
            content = tmpl_path.read_text()
            for ph, val in placeholders.items():
                content = content.replace(ph, val)
            dest_path.write_text(content)
            if dest_name.endswith(".sh"):
                dest_path.chmod(0o755)
            created.append(str(dest_name))

    lines = "\n  ".join(f"\u2713 {c}" for c in created)
    return f"Created workstreams/{stream}/:\n  {lines}"


def _cmd_truth(ctx, stream=None):
    name = _resolve_stream(ctx, stream)
    if not name:
        return "Not inside a workstream. Specify one: /workstream truth <name>"

    status_file = WORKSTREAMS_ROOT / name / "scope" / "STATUS-LIVE.md"
    if not status_file.exists():
        return f"No STATUS-LIVE.md found for {name}."

    content = status_file.read_text()
    mismatches = []

    urls = re.findall(r'([a-z]+\.sq)', content)
    for u in set(urls):
        try:
            import urllib.request
            req = urllib.request.Request(f"https://{u}", method="HEAD")
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            mismatches.append(f"  \u2717 {u} is DOWN")

    if mismatches:
        return "MISMATCHES:\n" + "\n".join(mismatches)
    return "\u2713 All STATUS-LIVE claims verified (URL checks only)."


def dispatch_ws(raw_args: str = "") -> str:
    """Shared handler for /workstream, /stream, and /ws."""
    parts = raw_args.strip().split(maxsplit=1)
    if not parts:
        return _cmd_pulse(None, None)

    head = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if head == "check":
        return _cmd_check(None, rest or None)
    if head == "pulse":
        return _cmd_pulse(None, rest or None)
    if head == "adopt":
        if not rest:
            return "Usage: /workstream adopt <stream-name>"
        return _cmd_adopt(None, rest)
    if head == "truth":
        return _cmd_truth(None, rest or None)

    # `/stream sanziq` — treat unknown first token as a stream name (pulse).
    if rest:
        return (
            f"Unknown subcommand: {head}. Try: check, pulse, adopt, truth\n"
            f"{_USAGE}"
        )
    return _cmd_pulse(None, head)


def register_slash_commands(ctx):
    # PluginContext.register_command(name, handler, description="", args_hint="")
    # — no aliases kwarg. Register each name. Handler: fn(raw_args: str) -> str
    desc = "Workstreamer: check, pulse, adopt, or truth a workstream"
    hint = "[check|pulse|adopt|truth] [stream]"

    def _handler(raw_args: str = "") -> str:
        return dispatch_ws(raw_args)

    # Canonical first. /stream is what people type. /ws stays as exact alias
    # only — do not advertise it (fuzzy-collides with "workflows").
    for name in ("workstream", "stream", "ws"):
        ctx.register_command(
            name,
            handler=_handler,
            description=desc,
            args_hint=hint,
        )
