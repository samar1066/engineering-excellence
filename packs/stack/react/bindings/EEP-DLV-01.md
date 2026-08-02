---
title: EEP-DLV-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

The scaffold ships `.github/workflows/ci.yml`, which runs on every push to the
default branch and on every pull request, restores the locked dependency tree
with `npm ci`, and then runs the same gates a developer runs locally: the
formatter and linter, the type checker, the boundary cruise, the coverage run,
and the accessibility run. Nothing in that list is CI only, and nothing a
developer runs locally is missing from it, so a green local run and a green
pipeline mean the same thing. Node is pinned to 22 with npm caching enabled, so
the pipeline is reproducible and fast enough that nobody is tempted to skip it.

## The check

`file-contains-any .github/workflows 'eep verify'` (see checks/manifest.yaml)
is a builtin check that reads every file under `.github/workflows` and looks
for the phrase that names the full gate. The scaffold's workflow carries it in
a comment above the gate steps, with a note not to delete the words, which is
the convention this corpus uses while the CLI is not yet published: the comment
names the gate, and the steps below it run the gate's contents directly.

## Notes for agents

If this check fails, the repository has no workflow, or the workflow no longer
names the gate. Add or restore it rather than weakening the check, and keep the
step list aligned with the local one: a pipeline that runs fewer gates than a
developer's machine is worse than no pipeline, because it teaches people the
pipeline is not worth reading. When you add a gate to `make test`, add the same
step to the workflow in the same change. When the CLI is available in your
environment, collapsing the individual steps into a single `eep verify` step is
the intended end state, and it satisfies this check by running the gate rather
than by naming it.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
