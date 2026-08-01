---
title: EEP-TEST-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

This stack settles on pytest as the one runner for every test level the
toolchain declares: unit, integration, API, and end to end. Collection and
execution both go through the same pytest entry point locally and in
continuous integration, so there is no separate question of whether a suite
exists apart from whether the suite that exists actually runs here. A consumer
repository scaffolded from this pack starts with a tests package and a pytest
configuration already wired, so collection never begins at zero by accident.

## The check

`uv run pytest --collect-only -q` (see checks/manifest.yaml) asks pytest to
walk the test tree and report what it would run, without executing anything,
and the manifest treats the literal string "no tests collected" appearing in
that output as a failure. This separates two failure modes an agent needs to
tell apart: a missing or misconfigured suite, caught here, from a suite that
exists but fails, caught by the other test checks in this manifest. The check
is cheap enough to run before every other check in the sequence, since a
repository with no collectible tests cannot pass anything downstream of it.

## Notes for agents

If this check fails because no tests were collected, the fix is a real test
file under a path pytest's configuration already watches, not a change to that
configuration to make collection quieter. Check the common causes first: a
tests directory missing an `__init__.py` or `conftest.py` where the project
layout expects one, or a test file whose name does not match pytest's
discovery pattern. Never add a placeholder test whose only purpose is to make
the collected count greater than zero; write the first real test for the
behavior you are about to build instead.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
