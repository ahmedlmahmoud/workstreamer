---
name: workstreamer
description: "Use when creating or maintaining dabbo-state workstreams — placement rules, root allowlist, red flags, gotchas, profile linking, /workstream /stream slash commands, organic workstream model."
version: 0.4.0
---

# Workstreamer

> Maintains dabbo-state workstream standards. Load this skill before any
> operation inside `workstreams/<name>/`.

## What a workstream is

A self-contained project directory under `workstreams/<name>/`. It has exactly
one `AGENTS.md` as the single source of truth for its structure and rules.
Every workstream inherits from `workstreams/AGENTS.md` (the thin router).

## Placement table

| You're creating... | Put it in |
|---|---|
| Agent operating guide | Root: `AGENTS.md` (always) |
| Artifact index | Root: `INDEX.md` (always) |
| Canonical terms | Root: `TAXONOMY.md` (always) |
| Human overview | Root: `README.md` (always) |
| Agent quick-start | Root: `AGENT-ONBOARDING.md` (always) |
| Infrastructure notes | Root: `INFRASTRUCTURE.md` (always) |
| Research doc | `research/` |
| Planning doc | `planning/` |
| Implementation plan | `implementation/` |
| UX flow | `uxflows/` |
| Feature spec | `stories/` |
| Milestone acceptance | `scope/` |
| Client asset | `client/` |
| Deferred feature | `deferred/` |
| Status | `scope/STATUS-LIVE.md` (update in place) |
| Lists (missions / blockers / resources) | `scope/pulse.json` (update in place) |
| Enforcement script | `scripts/check-workstream.sh` |

## Root allowlist

Only these files at root:
`AGENTS.md`, `INDEX.md`, `TAXONOMY.md`, `README.md`, `AGENT-ONBOARDING.md`, `INFRASTRUCTURE.md`

Everything else → subfolder. Hook blocks writes to root.

## Red flags (block)

- ❌ `docs/` folder at any workstream root
- ❌ `STATUS.md` at root (use `scope/STATUS-LIVE.md`)
- ❌ `SECRETS.md` or `.env` at root
- ❌ Any file at root not on allowlist

## Gotchas

- `docs/` was eliminated in July 2026. If found, archive to `planning/_archive/`.
- `STATUS.md` at root is always stale. Story is `scope/STATUS-LIVE.md`. Lists are `scope/pulse.json`.
- AGENTS.md and INDEX.md must be updated together. Stale index worse than none.
- `check-workstream.sh` runs at commit/CI. Must exit 0 for clean stream.
- Profile `cwd` must match the workstream root.
- **Never type `/ stream` (space after slash).** That is an empty command.
- **Do not use `/ws` in the slash search.** Hermes fuzzy-matches description
  words; `ws` is a substring of `workflows`, so `/ws` surfaces
  `inferio-development`. Type `/stream` or `/workstream` instead. `/ws` still
  works as an exact alias once you press Enter on it.
- Helper Python package is `workstreamer_lib/` — never `lib/`.
- Never restart `hermes-dashboard` / gateway from a child chat unless Ahmed
  says so **this turn**.

## Slash commands

| Command | Does |
|---------|------|
| `/stream` / `/workstream` | Lists from pulse.json, then STATUS-LIVE |
| `/stream check [name]` | Run check-workstream.sh |
| `/stream pulse [name]` | Lists + STATUS-LIVE.md |
| `/stream adopt <name>` | Templates + empty valid `scope/pulse.json` |
| `/stream add <title>` | One-line mission (`todo`) via the same writer |
| `/stream flip <id> <status>` | Flip one mission via the same writer |
| `/stream truth [name]` | Verify STATUS-LIVE claims vs live URLs |
| `/ws …` | Exact alias only — do not search `/ws` |

REST `GET /api/plugins/workstreamer/stream` is the Desktop chip API, not a
slash command. `PATCH /api/plugins/workstreamer/stream?stream=` is the one
writer. The slash name is `/stream` (no space).

## Workstream organic model

- Every stream starts with the 6 core files + `scripts/check-workstream.sh`
- Folders appear when needed — never before
- Active folders declared in `AGENTS.md`
- New streams created via `/stream adopt <name>` (copies templates + pulse.json)

## Profile linking

AGENTS.md declares Hermes profile:
```
**Hermes profile:** `sanziq`
```
Desktop chip uses this to anchor. Falls back to `terminal.cwd`.

## References

- `workstreams/AGENTS.md` — parent constitution
- `workstreams/workstreamer/AGENTS.md` — this product's stream
- Rules checklist: `references/rules.md`
