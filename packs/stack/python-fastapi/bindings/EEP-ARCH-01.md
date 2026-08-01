---
title: EEP-ARCH-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

This stack maps the five governed layers, routes, workflow, business process,
repository interfaces, and adapters, onto plain Python packages, then hands
their allowed dependency directions to import-linter as a declared contract
rather than a convention held in someone's head. import-linter walks the
actual import graph of the codebase on every run, so a business process module
reaching for something in the routes package, or a module importing another
module's repository implementation instead of its workflow, becomes a static
fact rather than a judgment call left to review. The contract lives in this
pack's blessed toolchain, so any consumer repository that adopts
python-fastapi gets the same boundary shape by default.

## The check

`uv run lint-imports` (see checks/manifest.yaml) runs import-linter against
the contract declared in importlinter.toml and fails the moment one forbidden
import exists anywhere in the tree. It inspects the whole import graph in a
single pass, so one run catches every violation in a change, not just the
first one encountered. Because the check fails the build rather than merely
warning, the same command run locally reproduces exactly what continuous
integration will see.

## Notes for agents

When this check fails, read the reported importer and imported module before
changing anything: the fix is almost always to route the call through the
target module's workflow rather than to widen the contract. If the violation
is a module bypassing another module's public interface, add or use the
missing workflow method instead of reaching into that module's internals.
Treat an edit to importlinter.toml itself as a last resort that needs its own
justification, not a routine fix.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
