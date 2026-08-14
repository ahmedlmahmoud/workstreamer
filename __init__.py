"""Workstreamer plugin — register hooks and slash commands.

Hermes loads the package module and looks for ``register(ctx)`` on
``__init__.py``. A bare ``register.py`` sibling is never imported.
"""

from __future__ import annotations


def register(ctx) -> None:
    from .hooks import pre_tool_call_block
    from .slash import register_slash_commands

    ctx.register_hook("pre_tool_call", pre_tool_call_block)
    try:
        from dashboard.workstreamer_lib.hidden_pass import hook_session_end
    except Exception:
        import sys
        from pathlib import Path

        dash = Path(__file__).resolve().parent / "dashboard"
        if str(dash) not in sys.path:
            sys.path.insert(0, str(dash))
        from workstreamer_lib.hidden_pass import hook_session_end

    ctx.register_hook("on_session_end", hook_session_end)
    ctx.register_hook("on_session_finalize", hook_session_end)
    register_slash_commands(ctx)
