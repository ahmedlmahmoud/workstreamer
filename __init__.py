"""Workstreamer plugin — register hooks and slash commands.

Hermes loads the package module and looks for ``register(ctx)`` on
``__init__.py``. A bare ``register.py`` sibling is never imported.
"""

from __future__ import annotations


def register(ctx) -> None:
    from .hooks import pre_tool_call_block
    from .slash import register_slash_commands

    ctx.register_hook("pre_tool_call", pre_tool_call_block)
    register_slash_commands(ctx)
