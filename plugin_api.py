"""Workstreamer plugin API — backend for Desktop JS."""

import subprocess
import re
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()
WORKSTREAMS_ROOT = Path("/home/ubuntu/dabbo-state/workstreams")


@router.get("/check")
async def check_workstream(stream: str = "sanziq"):
    """Run check-workstream.sh for a stream."""
    script = WORKSTREAMS_ROOT / stream / "scripts" / "check-workstream.sh"
    if not script.exists():
        return {"stream": stream, "status": "no_script", "violations": []}

    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True, text=True, timeout=30
    )
    return {
        "stream": stream,
        "status": "clean" if result.returncode == 0 else "dirty",
        "output": result.stdout,
    }


@router.get("/pulse")
async def pulse_workstream(stream: str = "sanziq"):
    """Read STATUS-LIVE.md."""
    status_file = WORKSTREAMS_ROOT / stream / "scope" / "STATUS-LIVE.md"
    if not status_file.exists():
        return {"stream": stream, "status": "no_status", "content": ""}
    return {"stream": stream, "status": "ok", "content": status_file.read_text()}


@router.get("/list")
async def list_workstreams():
    """List all workstreams with health metadata."""
    streams = []
    for d in sorted(WORKSTREAMS_ROOT.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        agents = d / "AGENTS.md"
        check_script = d / "scripts" / "check-workstream.sh"
        status_live = d / "scope" / "STATUS-LIVE.md"

        profile = None
        if agents.exists():
            text = agents.read_text()
            m = re.search(r"profile:\s*(\S+)", text, re.MULTILINE)
            if m:
                profile = m.group(1)

        streams.append({
            "name": d.name,
            "has_guide": agents.exists(),
            "has_checker": check_script.exists(),
            "has_status": status_live.exists(),
            "profile": profile,
        })

    return {"streams": streams}