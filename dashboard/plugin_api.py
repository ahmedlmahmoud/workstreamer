"""Workstreamer plugin API — thin FastAPI router.

Mounted at /api/plugins/workstreamer/ via dashboard/manifest.json.

NOTE: Hermes loads this file via importlib.util.spec_from_file_location as a
standalone module (not a package), so we bootstrap ``lib`` onto sys.path.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter, Query

_DASHBOARD_DIR = Path(__file__).resolve().parent
if str(_DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(_DASHBOARD_DIR))

from lib.check_runner import clear_check_cache, run_check  # noqa: E402
from lib.constants import WORKSTREAMS_ROOT  # noqa: E402
from lib.pulse import read_pulse  # noqa: E402
from lib.snapshot import list_streams, resolve_stream, stream_snapshot  # noqa: E402

router = APIRouter()


@router.get("/health")
async def api_health():
    return {
        "plugin": "workstreamer",
        "ok": True,
        "root": str(WORKSTREAMS_ROOT),
        "root_exists": WORKSTREAMS_ROOT.is_dir(),
    }


@router.get("/resolve")
async def api_resolve(
    cwd: str | None = None,
    profile: str | None = None,
    stream: str | None = None,
):
    return resolve_stream(cwd=cwd, profile=profile, stream=stream)


@router.get("/check")
async def check_workstream(
    stream: str = "sanziq",
    force: bool = Query(False, description="Bypass check cache"),
):
    return run_check(stream, force=force)


@router.get("/pulse")
async def pulse_workstream(stream: str = "sanziq"):
    status_file = WORKSTREAMS_ROOT / stream / "scope" / "STATUS-LIVE.md"
    pulse = read_pulse(status_file)
    if pulse is None:
        return {"stream": stream, "status": "no_status", "content": "", "pulse": None}
    try:
        content = status_file.read_text(errors="replace")
    except OSError:
        content = ""
    return {"stream": stream, "status": "ok", "content": content, "pulse": pulse}


@router.get("/stream")
async def stream_detail(
    stream: str = "sanziq",
    check: bool = True,
    force: bool = False,
):
    d = WORKSTREAMS_ROOT / stream
    if not d.is_dir():
        return {"error": f"unknown stream: {stream}", "stream": stream}
    if force:
        clear_check_cache(stream)
    snap = stream_snapshot(d, run_check_flag=check, include_pulse=True, force_check=force)
    snap["stream"] = stream
    return snap


@router.get("/list")
async def list_workstreams(
    check: bool = False,
    pulse: bool = True,
    force: bool = False,
):
    if force:
        clear_check_cache()
    return list_streams(check=check, pulse=pulse, force_check=force)
