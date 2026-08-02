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

The whole local story collapses into four Makefile targets: `setup` installs
the locked dependency tree with `npm ci`, `test` runs the coverage gate and the
accessibility gate, `verify` runs the full program gate, and `run` starts the
dev server. A contributor or an agent arriving at a fresh clone runs one target
and has a working environment, with no page of prose to assemble first, and the
README points at the same targets rather than describing the steps a second
time, so the instructions and the automation cannot drift apart. The dev server
target needs no extra configuration either: it proxies the API prefix to a
backend on the conventional port, so the two halves of the application meet
without a setup document.

## The check

`file-contains Makefile setup` (see checks/manifest.yaml) is a builtin check
that confirms a Makefile exists at the component root and defines a `setup`
target. It proves the entry point exists, not that running it succeeds on a
clean machine, and it is a fast text inspection rather than an execution.

## Notes for agents

If this check fails, add a `setup` target that leaves the component ready to
run its own checks, rather than one that prints instructions for further manual
steps. When setup grows a new prerequisite, a tool, a generated file, an
environment variable, fold it into that same target instead of documenting it
somewhere else. Prove the target from a genuinely clean checkout now and then,
with `node_modules` deleted, since a machine that already has everything cached
will pass a setup target that would fail for a new contributor.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
