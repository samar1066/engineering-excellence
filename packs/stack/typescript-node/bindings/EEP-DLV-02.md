---
title: EEP-DLV-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

The pack ships a generated `package-lock.json` beside `package.json`, so the
exact dependency graph, direct and transitive, is reviewable history from the
first commit rather than something resolved differently on each machine.
`make setup` installs with `npm ci`, which installs strictly from the lockfile
and refuses to reconcile a drifted one, so a contributor cannot quietly move
the graph by running setup. The continuous integration job installs the same
way, which is what makes the pipeline's dependency graph identical to the one
that was reviewed.

## The check

`npm ci --dry-run` (see checks/manifest.yaml) resolves the full install from
the lockfile without writing `node_modules`, and exits non zero when the
lockfile is missing or no longer agrees with the declared dependencies. It is
the cheapest form of the real install, so it catches the drift a manifest edit
introduces at the moment the change is proposed, rather than on the next
machine that installs from scratch.

## Notes for agents

When this check fails, run `npm install` to regenerate the lockfile and commit
the result as part of the same change that touched the dependency, rather than
editing either file by hand. Never delete `package-lock.json` to make an
install succeed: the failure is telling you the two files disagree, and
removing one of them removes the evidence instead of the disagreement. Treat a
lockfile diff as reviewable content, and be suspicious of one that changes far
more than the dependency you intended to move.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
