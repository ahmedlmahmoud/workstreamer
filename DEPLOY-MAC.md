# Deploy Workstreamer on your Mac (Desktop)

VPS agents push to GitHub. **You** deploy on the Mac.  
Do not let automation write into a sensitive Hermes profile’s private data.

## The 404 you just hit

```
Error invoking remote method 'hermes:api':
Error: 404: {"detail":"No such API endpoint: /api/plugins/workstreamer/list"}
```

**Meaning:** Desktop `plugin.js` is loaded (it made the request). The **dashboard process that Desktop is connected to** does **not** have the Python API mounted.

Two distinct causes look identical to Desktop:

1. Plugin tree missing / not in `plugins.enabled` / dashboard not restarted
2. **Router import failed at startup** — discovery still reports `has_api: true`. Classic: helper package named `lib/` colliding with another plugin (`secure-my-profile`) already in `sys.modules['lib']`. Journal: `Failed to load plugin workstreamer API routes: No module named 'lib.check_runner'`

`plugin.js` is only the UI. Routes live in:

```
~/.hermes/plugins/workstreamer/dashboard/manifest.json   # discovery
~/.hermes/plugins/workstreamer/dashboard/plugin_api.py   # FastAPI router
~/.hermes/plugins/workstreamer/dashboard/workstreamer_lib/
```

on the **same host** as that dashboard, plus `workstreamer` in `plugins.enabled`, then a **dashboard/gateway restart**.

Desktop talks to whichever dashboard it is connected to:

| Desktop connection | Where to install the Python plugin |
|---|---|
| Local Mac dashboard (default) | **Mac** `~/.hermes/plugins/workstreamer/` |
| Remote VPS dashboard | **VPS** `~/.hermes/plugins/workstreamer/` + restart that dashboard |

Copying only `desktop/plugin.js` to the Mac is not enough if Desktop uses a local Mac dashboard.

### Check which host is 404ing

On the host Desktop is connected to:

```bash
# 401 = route EXISTS (auth). 404 = not mounted.
curl -s -o /tmp/w.json -w '%{http_code}\n' \
  http://127.0.0.1:9119/api/plugins/workstreamer/health

# should include workstreamer with has_api: true
curl -s http://127.0.0.1:9119/api/dashboard/plugins \
  | python3 -c "import sys,json; print([p for p in json.load(sys.stdin) if p.get('name')=='workstreamer'])"

# mount success? this line must NOT appear after restart
journalctl --user -u hermes-dashboard.service -b --no-pager \
  | grep -i 'Failed to load plugin workstreamer'
```

- **404** → plugin not on this host, or no `dashboard/manifest.json`, or not in `plugins.enabled`, or dashboard not restarted, **or router import failed** (check journal)  
- **401** → mounted; Desktop auth/cookie issue  
- **200** → healthy  

## Install BOTH halves

### A) Python plugin (dashboard API) — on the dashboard host

```bash
git clone https://github.com/ahmedlmahmoud/workstreamer.git
# or: git pull

mkdir -p ~/.hermes/plugins
rsync -a --delete ./workstreamer/ ~/.hermes/plugins/workstreamer/ \
  --exclude .git --exclude __pycache__ --exclude '*.pyc'

# config.yaml — once:
# plugins:
#   enabled:
#     - workstreamer

hermes gateway restart
# if dashboard is a separate unit:
# systemctl --user restart hermes-dashboard.service
```

Must exist after copy:

```
~/.hermes/plugins/workstreamer/dashboard/manifest.json
~/.hermes/plugins/workstreamer/dashboard/plugin_api.py
~/.hermes/plugins/workstreamer/dashboard/workstreamer_lib/
```

### B) Desktop UI — on the Mac

```bash
cd workstreamer
# optional: node desktop/assemble.mjs

mkdir -p ~/.hermes/desktop-plugins/workstreamer
cp desktop/plugin.js ~/.hermes/desktop-plugins/workstreamer/plugin.js
```

Then **⌘K → Reload desktop plugins**.

If you use a named profile, copy into **that profile’s** `$HERMES_HOME/desktop-plugins/workstreamer/plugin.js` only.

## Expect after both halves

- Chip: live health / focus / down  
- Popover: milestones, URLs, blockers  
- Map: fleet list (not 404)  
- Rail resizes like Files  

## Do not

- Install only `plugin.js` and expect `/list` to exist  
- Name the Python helper package `lib/` — another plugin already owns that  
- Long-term hand-edit assembled `plugin.js` — edit `desktop/src/*`, assemble, copy  
- Write into profile secrets / `auth.json` / `.env`  
