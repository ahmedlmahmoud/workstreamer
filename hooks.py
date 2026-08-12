"""pre_tool_call hook — blocks writes that violate workstream constitution."""

import os
import re
from pathlib import Path
from typing import Any, Dict

WORKSTREAMS_ROOT = Path("/home/ubuntu/dabbo-state/workstreams")

GENERIC_ROOT_ALLOWLIST = {
    "AGENTS.md", "INDEX.md", "TAXONOMY.md",
    "README.md", "AGENT-ONBOARDING.md", "INFRASTRUCTURE.md",
}

FORBIDDEN_ROOT = {"STATUS.md", "SECRETS.md", ".env"}

FORBIDDEN_DIRS = {"docs"}


def _resolve_stream(path: str):
    """Return (stream_name, relative_path_in_stream) or (None, None)."""
    p = Path(path).resolve()
    try:
        rel = p.relative_to(WORKSTREAMS_ROOT)
    except ValueError:
        return None, None
    parts = rel.parts
    if len(parts) < 1:
        return None, None
    stream_name = parts[0]
    stream_rel = str(Path(*parts[1:])) if len(parts) > 1 else "."
    return stream_name, stream_rel


def _read_allowlist(stream_path: Path) -> set:
    agents = stream_path / "AGENTS.md"
    if not agents.exists():
        return GENERIC_ROOT_ALLOWLIST
    try:
        text = agents.read_text()
    except Exception:
        return GENERIC_ROOT_ALLOWLIST
    m = re.search(r'ALLOWED_ROOT="([^"]+)"', text)
    if m:
        return set(m.group(1).split())
    return GENERIC_ROOT_ALLOWLIST


def _suggest_folder(stream_name: str) -> str:
    stream_path = WORKSTREAMS_ROOT / stream_name
    candidates = ["planning", "research", "scope", "implementation", "client"]
    for c in candidates:
        if (stream_path / c).is_dir():
            return c
    return "planning"


def pre_tool_call_block(tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if tool_name not in ("write_file", "patch"):
        return {"action": "allow"}

    path = args.get("path") or args.get("file_path") or ""
    if not path:
        return {"action": "allow"}

    stream_name, stream_rel = _resolve_stream(path)
    if stream_name is None:
        return {"action": "allow"}

    stream_path = WORKSTREAMS_ROOT / stream_name
    rel_parts = Path(stream_rel).parts if stream_rel != "." else ()

    # Block forbidden dirs
    if rel_parts and rel_parts[0] in FORBIDDEN_DIRS:
        return {
            "action": "block",
            "message": (
                "R1: docs/ is eliminated. "
                "Archive to planning/_archive/ if needed."
            ),
        }

    # Root-level checks
    if not rel_parts or (len(rel_parts) == 1 and rel_parts[0] == "."):
        filename = Path(path).name
        if filename in FORBIDDEN_ROOT:
            tag = "R9" if filename == "STATUS.md" else "R10"
            return {
                "action": "block",
                "message": (
                    f"{tag}: {filename} at root is forbidden. "
                    f"{'Use scope/STATUS-LIVE.md' if filename == 'STATUS.md' else 'Secrets go in Infisical'}."
                ),
            }

        allowlist = _read_allowlist(stream_path)
        if filename not in allowlist:
            suggestion = _suggest_folder(stream_name)
            return {
                "action": "block",
                "message": (
                    f"R1: {filename} is not in the root allowlist "
                    f"({', '.join(sorted(allowlist))}). "
                    f"Put this in {suggestion}/ instead."
                ),
            }

    return {"action": "allow"}