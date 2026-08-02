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

The scaffold ships a generated `package-lock.json` alongside `package.json`, and
every entry point installs through `npm ci` rather than `npm install`: the
Makefile's setup target, the CI workflow, and the instructions in the README all
use the form that installs the locked tree exactly and refuses to quietly
rewrite it. A frontend has more transitive dependencies than most services, so
the difference matters: without the lockfile, two machines resolving the same
caret ranges a week apart get different bundlers, different test runners, and
different bugs.

## The check

`npm ci --dry-run` (see checks/manifest.yaml) resolves the lockfile against
`package.json` and reports what it would install, without touching
`node_modules`. It exits non zero when the lockfile is missing, or when the two
files disagree, which is exactly the drift the law is about. Running it as a dry
run keeps the check fast and side effect free, so it is safe to run in any
working tree.

## Notes for agents

When this check fails, the fix is to run `npm install` once, so npm updates the
lockfile from the dependency ranges you changed, and to commit both files in the
same change. Never hand edit `package-lock.json`, and never delete it to make an
install succeed: the failure is telling you the two files disagree, and deleting
the evidence leaves the disagreement in place for the next machine. When you add
a dependency, add it with `npm install <name>` rather than by typing it into
`package.json`, so the lockfile is written by the tool that owns it.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
