# Workstreamer — Hermes Plugin

Maintain [dabbo-state](https://github.com/ahmedlmahmoud/dabbo-state) workstream standards.

## What it does

Workstreamer enforces workstream constitutions — your workstream's `AGENTS.md` is the law, and Workstreamer is the police:

- **`pre_tool_call` hook** — blocks writes to `docs/`, `STATUS.md`, `.env`, and any non-allowlisted root file
- **`/ws check`** — runs `scripts/check-workstream.sh` for your stream
- **`/ws pulse`** — reads `scope/STATUS-LIVE.md` for your stream
- **`/ws adopt <name>`** — creates a new workstream from templates
- **`/ws truth`** — verifies STATUS-LIVE claims vs live URLs
- **Desktop chip** — status bar shows current stream health (clean/dirty/unguided/outside)
- **Workstream Map** — pane listing all workstreams with profile + health

## Install

### Plugin (hooks + slash commands)

```bash
cp -r ~/.hermes/plugins/workstreamer/ /your/hermes/plugins/workstreamer/
hermes gateway restart
```

### Desktop UI

Copy `desktop/plugin.js` to `$HERMES_HOME/desktop-plugins/workstreamer/plugin.js`, then **Reload desktop plugins** from ⌘K.

### Workstreamer skill

The skill ships bundled inside the plugin. Hermes will discover it in `/ws` contexts or when you type `/skill workstreamer`.

## Quick start

```bash
/ws adopt my-new-project   # create a workstream skeleton
cd workstreams/my-new-project
/ws check                   # validate it
/ws pulse                   # see live status
```

## Requirements

- Hermes with plugin support
- Python 3.9+ (for hooks.py, slash.py, plugin_api.py)
- Bash (for check-workstream.sh templates)
- Hermes Desktop app (for Desktop UI chip + map pane)

## Structure

```
workstreamer/
├── plugin.yaml              # Plugin manifest
├── register.py              # Entry point (registers hooks + commands)
├── hooks.py                 # pre_tool_call enforcement
├── slash.py                 # /ws check/pulse/adopt/truth
├── plugin_api.py            # FastAPI backend for Desktop JS
├── skills/workstreamer/     # On-demand skill
│   ├── SKILL.md
│   └── references/rules.md  # R1-R10 checklist
├── templates/               # Starter blueprints for /ws adopt
│   ├── AGENTS.md.tmpl
│   ├── INDEX.md.tmpl
│   ├── TAXONOMY.md.tmpl
│   ├── STATUS-LIVE.md.tmpl
│   ├── check-workstream.sh.tmpl
│   └── README.md.tmpl
└── desktop/plugin.js        # Desktop UI (chip + popover + palette + map)
```
