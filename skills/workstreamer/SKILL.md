---
name: workstreamer
description: "Use when creating or maintaining dabbo-state workstreams — placement rules, root allowlist, red flags, gotchas, profile linking, /workstream /stream slash commands, organic workstream model."
version: 0.3.2
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
- `STATUS.md` at root is always stale. Truth is `scope/STATUS-LIVE.md`.
- AGENTS.md and INDEX.md must be updated together. Stale index worse than none.
- `check-workstream.sh` runs at commit/CI. Must exit 0 for clean stream.
- Profile `cwd` must match the workstream root. SanziQ's old `gethealth/repo` is fixed.
- **Never type `/ stream` (space after slash).** That is an empty command.
- **Do not use `/ws` in the slash search.** Hermes fuzzy-matches description
  words; `ws` is a substring of `workflows`, so `/ws` surfaces
  `inferio-development`. Type `/stream` or `/workstream` instead. `/ws` still
  works as an exact alias once you press Enter on it.

## Slash commands

| Command | Does |
|---------|------|
| `/stream` / `/workstream` | Pulse the current stream (STATUS-LIVE) |
| `/stream check [name]` | Run check-workstream.sh |
| `/stream pulse [name]` | Read STATUS-LIVE.md |
| `/stream adopt <name>` | Create new workstream from templates |
| `/stream truth [name]` | Verify STATUS-LIVE claims vs live URLs |
| `/ws …` | Exact alias only — do not search `/ws` |

REST `GET /api/plugins/workstreamer/stream` is the Desktop chip API, not a
slash command. The slash name is `/stream` (no space).

## Workstream organic model

- Every stream starts with the 6 core files + `scripts/check-workstream.sh`
- Folders appear when needed — never before
- Active folders declared in `AGENTS.md`
- New streams created via `/stream adopt <name>` (copies templates)

## Profile linking

AGENTS.md declares Hermes profile:
```
**Hermes profile:** `sanziq`
```
Desktop chip uses this to anchor. Falls back to `terminal.cwd`.

## References

- `workstreams/AGENTS.md` — parent constitution
- `workstreams/sanziq/AGENTS.md` — reference workstream
- Rules checklist: `references/rules.md`
