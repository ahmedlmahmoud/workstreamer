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
from datetime import date
from pathlib import Path

WORKSTREAMS_ROOT = Path("/home/ubuntu/dabbo-state/workstreams")
_USAGE = (
    "Usage: /workstream [check|pulse|adopt|truth|add|flip] [stream]\n"
    "       /stream  [check|pulse|adopt|truth|add|flip] …\n"
    "Bare /stream or /workstream pulses the current stream.\n"
    "/stream <name> pulses that stream. Alias: /ws (exact only).\n"
    "/stream add <title>   one-line mission\n"
    "/stream flip <id> <status>"
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


def _store():
    """Import store from the plugin dashboard package (same tree as slash)."""
    import sys

    dash = Path(__file__).resolve().parent / "dashboard"
    if str(dash) not in sys.path:
        sys.path.insert(0, str(dash))
    from workstreamer_lib import store as pulse_store

    return pulse_store


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


def _fmt_lists(name: str) -> str:
    store = _store()
    loaded = store.load(name)
    if not loaded["ok"]:
        return f"lists: INVALID ({loaded.get('error')}) — file not touched.\n"
    pulse = loaded["pulse"]
    view = loaded["view"]
    lines = [
        f"lists  rev={pulse.get('revision')}  mode={pulse.get('mode')}  src={loaded['source']}",
    ]
    nxt = (view or {}).get("next_mission")
    if nxt:
        lines.append(f"next   {nxt.get('status')}  {nxt.get('title')}")
    missions = sorted(
        pulse.get("missions") or [],
        key=lambda m: (float(m.get("order") or 0), m.get("id") or ""),
    )
    open_m = [m for m in missions if m.get("status") not in {"done", "cancelled"}]
    for m in open_m[:8]:
        due = f"  due {m['due']}" if m.get("due") else ""
        blk = f"  ⊘ {m['blocker_id']}" if m.get("status") == "blocked" else ""
        lines.append(f"  · {m['id']:16} {m['status']:9} {m['title']}{due}{blk}")
    blockers = [b for b in (pulse.get("blockers") or []) if b.get("status") != "resolved"]
    if blockers:
        lines.append("blockers")
        for b in blockers[:6]:
            who = f" · {b['waiting_on']}" if b.get("waiting_on") else ""
            lines.append(f"  · {b['id']:16} {b['kind']:11} {b['title']}{who}")
    return "\n".join(lines) + "\n"


def _cmd_pulse(ctx, stream=None):
    name = _resolve_stream(ctx, stream)
    if not name:
        return "Not inside a workstream. Specify one: /workstream pulse <name>"

    head = _fmt_lists(name)
    status_file = WORKSTREAMS_ROOT / name / "scope" / "STATUS-LIVE.md"
    if not status_file.exists():
        return head + f"\nNo STATUS-LIVE.md for {name}."
    return head + "\n--- STATUS-LIVE ---\n" + status_file.read_text()


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
        "{{DATE}}": date.today().isoformat(),
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

    store = _store()
    adopted = store.adopt_empty(stream)
    if adopted.get("ok"):
        created.append("scope/pulse.json")

    lines = "\n  ".join(f"\u2713 {c}" for c in created)
    return f"Created workstreams/{stream}/:\n  {lines}"


def _cmd_add(ctx, rest: str):
    parts = rest.split(maxsplit=1)
    if not rest.strip():
        return "Usage: /stream add <title>"
    name = _resolve_stream(ctx, None)
    title = rest.strip()
    if parts and (WORKSTREAMS_ROOT / parts[0]).is_dir() and len(parts) == 2:
        name = parts[0]
        title = parts[1]
    if not name:
        return "Not inside a workstream. /stream add <stream> <title>"
    store = _store()
    r = store.apply(
        name,
        {"op": "upsert", "collection": "missions", "record": {"title": title, "status": "todo"}},
    )
    if not r.get("ok"):
        return f"add failed: {r.get('message') or r.get('error')}"
    mid = None
    for m in r["pulse"]["missions"]:
        if m.get("title") == title:
            mid = m["id"]
            break
    return f"added {mid}: {title}"


def _cmd_flip(ctx, rest: str):
    parts = rest.split()
    if len(parts) < 2:
        return "Usage: /stream flip <id> <status>   or  /stream flip <stream> <id> <status>"
    name = _resolve_stream(ctx, None)
    if len(parts) >= 3 and (WORKSTREAMS_ROOT / parts[0]).is_dir():
        name, mid, status = parts[0], parts[1], parts[2]
    else:
        mid, status = parts[0], parts[1]
    if not name:
        return "Not inside a workstream. /stream flip <stream> <id> <status>"
    store = _store()
    r = store.apply(
        name,
        {"op": "upsert", "collection": "missions", "id": mid, "record": {"status": status}},
    )
    if not r.get("ok"):
        return f"flip failed: {r.get('message') or r.get('error')}"
    return f"flipped {mid} → {status}"


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
    if head == "add":
        return _cmd_add(None, rest)
    if head == "flip":
        return _cmd_flip(None, rest)

    if rest:
        return (
            f"Unknown subcommand: {head}. Try: check, pulse, adopt, truth, add, flip\n"
            f"{_USAGE}"
        )
    return _cmd_pulse(None, head)


def register_slash_commands(ctx):
    desc = "Workstreamer: check, pulse, adopt, truth, add, or flip"
    hint = "[check|pulse|adopt|truth|add|flip] [stream]"

    def _handler(raw_args: str = "") -> str:
        return dispatch_ws(raw_args)

    for name in ("workstream", "stream", "ws"):
        ctx.register_command(
            name,
            handler=_handler,
            description=desc,
            args_hint=hint,
        )
