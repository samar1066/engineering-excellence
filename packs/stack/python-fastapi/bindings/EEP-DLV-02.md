---
title: EEP-DLV-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

uv is this stack's package manager, and it produces a lockfile as a normal
side effect of resolving dependencies rather than as a separate opt in step.
Every dependency a consumer repository declares in pyproject.toml resolves to
an exact, pinned version recorded in that lockfile, so a fresh install
reproduces the same dependency graph on any machine and at any later date. The
lockfile is committed alongside pyproject.toml, never generated only on a
developer's own machine and left out of version control.

## The check

`uv lock --check` (see checks/manifest.yaml) asks uv to verify the existing
lockfile without writing to it, and fails when the lockfile is missing or when
it no longer matches what pyproject.toml currently declares. This catches the
common drift case directly: a dependency added or a version bumped in
pyproject.toml without rerunning the resolver to refresh the lockfile.

## Notes for agents

If this check fails because the lockfile is stale, regenerate it with uv's own
lock command and commit the updated lockfile in the same change as the
dependency edit that caused the drift, never in a separate follow up change.
If the lockfile is missing entirely, generate it before the first commit that
declares a dependency; a consumer repository should never reach continuous
integration without one. Resist widening a version constraint in
pyproject.toml just to make a mismatch disappear; refresh the lock instead, so
the exact pinned version stays visible in review.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
