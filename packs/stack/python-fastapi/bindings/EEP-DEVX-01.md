---
title: EEP-DEVX-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

This stack's whole local setup collapses into targets in a single Makefile:
installing dependencies through uv, wiring the pre-commit hook, and confirming
the toolchain is ready to run, all reachable from one setup target instead of
a page of manual instructions. A contributor or an agent working from a fresh
clone runs that one target and reaches a working, checked out environment
without reading through prose first to assemble the steps themselves. Because
the same target is what documentation points to, the setup instructions and
the setup automation cannot drift apart the way a written checklist and the
real steps eventually do.

## The check

`file-contains Makefile setup` (see checks/manifest.yaml) is a builtin check
that confirms a Makefile exists at the repository root and defines a `setup`
target; it proves the entry point exists, not that running it succeeds on a
clean machine. It is a fast static check, since it inspects the file's text
rather than actually executing the target.

## Notes for agents

If this check fails, add a `setup` target to the Makefile that installs
dependencies, wires local hooks, and leaves the repository ready to run its
checks, rather than a target that only prints instructions for further manual
steps. When you add a new setup dependency, a new tool, a required environment
file, a generated config, fold it into this same target instead of documenting
it as an extra step elsewhere. Verify the target from a genuinely clean
checkout occasionally, not just from a machine that already has most of the
setup cached from a previous run.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
