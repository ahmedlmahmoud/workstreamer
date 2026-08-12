# Workstreamer — Hermes Plugin

Maintain [dabbo-state](https://github.com/ahmedlmahmoud/dabbo-state) workstream standards.

**Desktop UI is production-oriented:** status chip + popover + fleet map, backed by a structured FastAPI (`/list`, `/stream`, `/check`, `/pulse`, `/resolve`).

---

## What it does

| Layer | Job |
|---|---|
| **`pre_tool_call` hook** | Blocks `docs/`, root `STATUS.md`, `.env`, non-allowlisted root files |
| **`/ws check`** | Runs `scripts/check-workstream.sh` |
| **`/ws pulse`** | Reads `scope/STATUS-LIVE.md` |
| **`/ws adopt <name>`** | Scaffolds a stream from **templates only** |
| **`/ws truth`** | Light STATUS-LIVE vs live URL checks |
| **Desktop chip** | Current stream health · focus · down URLs (from `/stream`) |
| **Popover** | Next action, milestones, live URLs, blockers, PRs, constitution, violations |
| **Workstream Map** | Fleet stats, filters, search, detail drawer |
| **Skill** | On-demand how-to (`/skill workstreamer`) |

Constitution files live **in each workstream**. This plugin ships **templates + enforcement + UI** only.

---

## Install (Mac desktop + VPS gateway)

Gateway/API and Desktop UI are separate surfaces.

### 1) Python plugin (gateway + dashboard API)

On the machine that runs **Hermes gateway / dashboard** (often the VPS):

```bash
git clone https://github.com/ahmedlmahmoud/workstreamer.git
# or: cd existing checkout && git pull

mkdir -p ~/.hermes/plugins
rsync -a --delete ./ ~/.hermes/plugins/workstreamer/ \
  --exclude .git --exclude __pycache__ --exclude '*.pyc'

# enable once in config.yaml under plugins.enabled:
#   - workstreamer

hermes gateway restart
# if dashboard is a separate unit:
# systemctl --user restart hermes-dashboard.service
```

**Critical:** Hermes mounts dashboard APIs from:

```
~/.hermes/plugins/workstreamer/dashboard/manifest.json
  → "api": "plugin_api.py"
```

not from root `plugin.yaml` alone. Without `dashboard/manifest.json`, `/list` never mounts and the map looks empty.

**Also critical:** never name the helper package `lib/`. Another plugin (`secure-my-profile`) already registers `sys.modules['lib']`. Workstreamer's old `from lib.check_runner` then fails at mount (`No module named 'lib.check_runner'`), discovery still reports `has_api: true`, and authenticated Desktop calls 404 with `No such API endpoint`. Helpers live in `dashboard/workstreamer_lib/`.

### 2) Desktop UI (your Mac)

See **[DEPLOY-MAC.md](./DEPLOY-MAC.md)** for the short Mac path.

```bash
cd /path/to/workstreamer
node desktop/assemble.mjs    # optional if plugin.js already built

mkdir -p ~/.hermes/desktop-plugins/workstreamer
cp desktop/plugin.js ~/.hermes/desktop-plugins/workstreamer/plugin.js
```

Then: **⌘K → Reload desktop plugins**.

### 3) Verify API (gateway host)

```bash
curl -s http://127.0.0.1:9119/api/dashboard/plugins | jq '.[] | select(.name=="workstreamer")'
# has_api can be true even when the router FAILED to import (discovery ≠ mount).
# After restart, journal must NOT say: Failed to load plugin workstreamer API routes
# Authenticated /list must be 200. Unauthenticated 401 is expected; 404 is a miss.
```

---

## Desktop architecture

Disk plugins **cannot** use relative imports (runtime allows only `@hermes/plugin-sdk` + `react*`).  
Modular source → single assembled file:

```
desktop/
├── src/                    # edit these
│   ├── constants.js        # pane sizing, filters, storage keys
│   ├── health.js           # health → StatusDot tone + badge
│   ├── format.js           # cwd parse, ago, errors
│   ├── atoms.js            # MilestoneRail, UrlPills, ProgressBar, …
│   ├── chip.js             # status bar chip + popover
│   ├── map.js              # fleet map pane / page
│   └── plugin.entry.js     # register() surfaces
├── assemble.mjs            # builds plugin.js (repo only — never profiles)
└── plugin.js               # SHIP THIS to Mac desktop-plugins/
```

### Pane resize (sash)

Right rail sized like core **files** browser (fixed track + min/max):

| Field | Value | Why |
|---|---|---|
| `width` | `237px` | Fixed track (sidebar semantics) |
| `minWidth` | `10rem` | Shrink without collapse thrash |
| `maxWidth` | `20rem` | Cap rail; leftover → main |
| `placement` | `right` | Stacks with files/review |
| `collapsible` | `true` | Narrow viewport overlay |

**Do not** set only bare `width: '340px'` — that caused shrink-on-drag then snap-on-release.

### StatusDot API

Hermes `StatusDot` takes **`tone`**: `good | muted | warn | bad` — **not** `color: 'green'`.

### Keybinds / palette

| Action | Default |
|---|---|
| Show map | `mod+alt+w` |
| Recheck current stream | `mod+alt+c` |
| Palette | Workstreamer: Show Map / Recheck / Pulse |

---

## Backend API (`/api/plugins/workstreamer`)

| Route | Purpose |
|---|---|
| `GET /health` | Plugin alive + workstreams root |
| `GET /resolve?cwd=&profile=&stream=` | Explicit → profile link → cwd |
| `GET /list?pulse=true&check=false` | Fleet list (issues-first) |
| `GET /stream?stream=&check=true&force=` | Full snapshot for chip/popover |
| `GET /check?stream=&force=` | Structured check (cached ~20s) |
| `GET /pulse?stream=` | Parsed STATUS-LIVE |

```
dashboard/
├── manifest.json           # REQUIRED for mount
├── plugin_api.py           # thin router
└── workstreamer_lib/       # NEVER name this `lib/` — collisions 404 the API
    ├── constants.py
    ├── text.py
    ├── check_runner.py
    ├── pulse.py
    └── snapshot.py
```

---

## Safety / handoff

- **GitHub is the handoff.** VPS agents should not write Mac paths or sensitive named-profile trees (`auth.json`, `.env`, memories).
- `desktop/assemble.mjs` writes **only** `desktop/plugin.js` inside this repo.
- Plugin ships **templates**, never real project constitution files.

## Version

**0.2.1** — rename `dashboard/lib` → `dashboard/workstreamer_lib` so mount cannot collide with `secure-my-profile`'s `lib` package.
