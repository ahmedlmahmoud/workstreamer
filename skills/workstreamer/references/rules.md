# Workstream Rules — R1 through R10

## R1 — No dumping grounds
Never use the workstream root as a dumping ground. Root files must be on the
allowlist. Everything else goes in a subfolder.

## R2 — _archive/ is local + dated
Per-folder archives, never one global archive. Use `scope/_archive/`,
`planning/_archive/`, `implementation/_archive/`.

## R3 — Cross-references
Every long-form document ends with a References section listing source specs,
related uxflows, research, and sibling docs.

## R4 — Story spec lives
Stories are never archived when implemented. They are the permanent contract.
Superseded planning docs get archived.

## R5 — Date suffix for snapshots
YYYY-MM-DD in filename for any point-in-time capture.

## R6 — Renamed stories → stories/.archive/
Old story files move to archive, never deleted.

## R7 — No binaries in story folders
PDFs, DOCXs, recordings belong in `client/` or `planning/`. Stories, uxflows,
and research are markdown-only.

## R8 — AGENTS.md and INDEX.md paired
Update both in the same session.

## R9 — No root STATUS.md
Use `scope/STATUS-LIVE.md`. Root `STATUS.md` is always stale.

## R10 — No secrets in files
`SECRETS.md`, `.env`, or any secret in plain text → delete immediately.
Secrets go in Infisical.
