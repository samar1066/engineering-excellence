---
id: EEP-DLV-02
domain: DLV
title: Dependencies are pinned by a lockfile that stays fresh
version: 1.0.0
status: stable
maturity: foundational
severity: blocking
applies_to: [all]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
supersedes: []
related: ["EEP-DLV-01"]
---

## Statement

Dependencies are pinned by a lockfile that stays fresh.

## Rationale

A build that resolves its dependency versions differently on each run is not reproducible: the same source code can produce a working artifact today and a broken one tomorrow, with nothing in the change history explaining why. A lockfile fixes the exact resolved version, and often the exact content, of every dependency, direct and transitive, so any machine, at any time, installing from the same lockfile gets the identical dependency graph. A lockfile that is present but stale, no longer matching the declared dependencies, is nearly as dangerous as having none: it creates the appearance of reproducibility while the two sources of truth quietly drift apart. The cost of an unpinned or drifted dependency graph rarely surfaces until it fails, typically as an intermittent build break or an incident that nobody can reproduce locally, at which point the debugging cost far exceeds the discipline it would have taken to keep the lockfile current.

## Pattern

Commit the lockfile to version control alongside the declared dependency manifest, so the exact dependency graph a project builds against is reviewable history rather than something regenerated silently on every install. Verify in the automated gate that the lockfile still matches the declared dependencies, so a manifest change without a corresponding lockfile update fails the build instead of silently resolving to something different on the next install. Update the lockfile deliberately, as its own reviewable change, whenever a dependency is added, removed, or upgraded.

## Antipatterns

Declaring dependencies with floating version ranges and no lockfile at all is tempting because it means never having to think about upgrades, but it means every install can silently resolve to different versions, including versions that did not exist when the code was written. Committing a lockfile once and then letting the declared dependencies drift away from it without regenerating it produces the appearance of pinning while the two files quietly disagree. Regenerating the lockfile locally only when convenient, rather than verifying it in the automated gate, lets a mismatch merge and surface only when someone else's install behaves differently than expected.

## Check contract

A check fails when no lockfile exists or when the lockfile does not match the declared dependencies.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
