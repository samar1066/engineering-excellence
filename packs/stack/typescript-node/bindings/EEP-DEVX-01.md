---
title: EEP-DEVX-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

The whole local setup collapses into `make setup`, which runs `npm ci` against
the committed lockfile and leaves the repository ready to test, lint, type
check, and run, with Node 22 as the only prerequisite the project asks for.
Three more targets sit beside it in the same Makefile, `make test`,
`make verify`, and `make run`, so the entry points a contributor needs are all
in one file rather than spread across prose. Because the service `README.md`
points at those targets rather than restating the commands inside them, the
instructions and the automation cannot drift apart the way a written checklist
and the real steps eventually do.

## The check

`file-contains Makefile setup` (see checks/manifest.yaml) is a builtin check
confirming a Makefile exists at the root of the pack's working directory and
declares a `setup` target. It proves the entry point exists, not that running
it succeeds on a clean machine, which keeps it fast enough to run on every
change; the honest test of the target is a fresh clone.

## Notes for agents

If this check fails, add a `setup` target that installs dependencies and leaves
the repository ready to run its checks, not one that prints instructions for
further manual steps. When you add a new setup prerequisite, a generated file
or a service the tests need, fold it into that same target rather than
documenting it as an extra step somewhere else. Run the target from a genuinely
clean checkout occasionally, since a machine with a warm `node_modules` will
pass a setup that would fail for a newcomer.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
