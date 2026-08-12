"""Workstreamer plugin — register hooks and slash commands."""

def register(ctx):
    from .hooks import pre_tool_call_block
    from .slash import register_slash_commands

    ctx.register_hook("pre_tool_call", pre_tool_call_block)
    register_slash_commands(ctx)