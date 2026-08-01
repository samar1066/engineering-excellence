---
title: EEP-DLV-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

This stack does not introduce a second gate: the same `eep verify` command an
agent runs locally is the command continuous integration runs on every pull
request and every push to the default branch. There is no separate script that
reimplements a subset of the checks for CI only, so a change that passes
locally cannot fail for a different reason once it reaches a workflow run.
Wiring a new law's check into the manifest extends what that single command
covers in both places at once.

## The check

`file-contains-any .github/workflows 'eep verify'` (see checks/manifest.yaml)
is a builtin check that scans the workflow definitions under .github/workflows
for an invocation of `eep verify`; it proves the gate is wired into
automation, not that every individual check inside it currently passes. It
looks across every file in that directory, so the invocation can live in any
workflow file, not only one with a specific name.

## Notes for agents

If this check fails, add a workflow step that runs `eep verify` on pull
request and on push to the default branch, rather than reimplementing
individual checks as separate workflow steps. Keep the workflow's invocation
identical to the local command; a workflow that runs a narrower or differently
flagged version of the gate reopens the gap this law closes. Treat a workflow
that only lints or only builds, and never actually calls `eep verify`, as not
satisfying this check even if every job shows green.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
