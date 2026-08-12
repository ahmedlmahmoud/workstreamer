# Deploy Workstreamer on your Mac (Desktop)

VPS agents push to GitHub. **You** deploy Desktop on the Mac.  
Do not let automation write into a sensitive Hermes profile’s private data.

## Update Desktop UI

```bash
git clone https://github.com/ahmedlmahmoud/workstreamer.git
# or: git pull in existing clone

cd workstreamer
node desktop/assemble.mjs    # optional if plugin.js already committed built

mkdir -p ~/.hermes/desktop-plugins/workstreamer
cp desktop/plugin.js ~/.hermes/desktop-plugins/workstreamer/plugin.js
```

If you use a **named profile** whose desktop home is not default `~/.hermes`, copy into **that profile’s** `$HERMES_HOME/desktop-plugins/workstreamer/plugin.js` only — never scatter copies into profile secrets trees.

## Reload

1. Hermes Desktop focused  
2. **⌘K → Reload desktop plugins**  
3. No “Plugin workstreamer failed to load” toast  

## Expect

- Status chip: live health / focus / down  
- Chip click → popover (milestones, URLs, blockers, constitution)  
- Sidebar **Workstreams** or palette **Workstreamer: Show Map**  
- Right rail resizes smoothly (min/max like Files)  

## Gateway dependency

Chip/map use `ctx.rest` → `/api/plugins/workstreamer/*` on the **dashboard** process.

On the gateway host:

1. Plugin under `~/.hermes/plugins/workstreamer/`  
2. `workstreamer` in `plugins.enabled`  
3. `dashboard/manifest.json` present  
4. Gateway/dashboard restarted after install  

If the map shows **Map failed to load**, Desktop is fine — API not mounted or not reachable.

## Do not

- Long-term hand-edit assembled `plugin.js` on the Mac — edit `desktop/src/*`, assemble, copy  
- Run scripts that write into profile homes / secrets  
- Commit secrets into this repo  
