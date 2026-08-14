"""Workstreamer plugin API — thin FastAPI router.

Mounted at /api/plugins/workstreamer/ via dashboard/manifest.json.

NOTE: Hermes loads this file via importlib.util.spec_from_file_location as a
standalone module (not a package). Helpers live in ``workstreamer_lib/``
(NOT ``lib/``) so they cannot collide with another plugin that already
registered ``sys.modules['lib']`` — that collision silently 404s every
``/api/plugins/workstreamer/*`` route after auth.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Query
from fastapi.responses import JSONResponse

_DASHBOARD_DIR = Path(__file__).resolve().parent
if str(_DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(_DASHBOARD_DIR))

from workstreamer_lib.check_runner import clear_check_cache, run_check  # noqa: E402
from workstreamer_lib.constants import WORKSTREAMS_ROOT  # noqa: E402
from workstreamer_lib.pulse import read_pulse  # noqa: E402
from workstreamer_lib.snapshot import list_streams, resolve_stream, stream_snapshot  # noqa: E402
from workstreamer_lib.store import apply as apply_lists  # noqa: E402
from workstreamer_lib.store import lists_payload  # noqa: E402

router = APIRouter()


def _http_for_store(result: dict[str, Any]) -> JSONResponse | dict[str, Any]:
    if result.get("ok"):
        return result
    code = result.get("error") or "bad_request"
    status = {"conflict": 409, "invalid": 409, "bad_request": 400}.get(code, 400)
    return JSONResponse(status_code=status, content=result)


@router.get("/health")
async def api_health():
    return {
        "plugin": "workstreamer",
        "ok": True,
        "version": "0.4.0",
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
    stream: str = Query(..., description="workstream slug"),
    force: bool = Query(False, description="Bypass check cache"),
):
    return run_check(stream, force=force)


@router.get("/pulse")
async def pulse_workstream(stream: str = Query(..., description="workstream slug")):
    status_file = WORKSTREAMS_ROOT / stream / "scope" / "STATUS-LIVE.md"
    pulse = read_pulse(status_file)
    lists = lists_payload(stream)
    if pulse is None:
        return {
            "stream": stream,
            "status": "no_status",
            "content": "",
            "pulse": None,
            "lists": lists,
        }
    try:
        content = status_file.read_text(errors="replace")
    except OSError:
        content = ""
    return {
        "stream": stream,
        "status": "ok",
        "content": content,
        "pulse": pulse,
        "lists": lists,
    }


@router.get("/stream")
async def stream_detail(
    stream: str = Query(..., description="workstream slug"),
    check: bool = True,
    force: bool = False,
):
    d = WORKSTREAMS_ROOT / stream
    if not d.is_dir():
        # HTTP 200 on purpose: chip treats 404 as "plugin API missing".
        return {
            "ok": False,
            "error": "not_found",
            "message": f"unknown stream: {stream}",
            "stream": stream,
        }
    if force:
        clear_check_cache(stream)
    snap = stream_snapshot(d, run_check_flag=check, include_pulse=True, force_check=force)
    snap["stream"] = stream
    return snap


@router.patch("/stream")
async def stream_patch(
    stream: str = Query(..., description="workstream slug"),
    op: dict[str, Any] = Body(...),
):
    d = WORKSTREAMS_ROOT / stream
    if not d.is_dir():
        return JSONResponse(
            status_code=404,
            content={"ok": False, "error": "not_found", "message": f"unknown stream: {stream}"},
        )
    result = apply_lists(stream, op)
    return _http_for_store(result)


@router.get("/list")
async def list_workstreams(
    check: bool = False,
    pulse: bool = True,
    force: bool = False,
):
    if force:
        clear_check_cache()
    return list_streams(check=check, pulse=pulse, force_check=force)
