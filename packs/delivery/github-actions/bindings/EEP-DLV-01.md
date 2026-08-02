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

## How this pack satisfies it

The other packs in this program each carry a workflow that gates their own
component. This pack carries the one that gates the repository, and in a
composed project it is the only one GitHub actually reads, because GitHub
looks for workflows in `.github/workflows` at the repository root and nowhere
else. `scaffold/.github/workflows/ci.yml` is therefore not a second gate
layered on top of the component gates; it is the place those gates are run
from. It fires on every pull request and on every push to every branch, so a
change is verified before it can reach a review and again before it can reach
the branch anything is released from.

One job per component, and each job runs that component's own gate command
rather than a workflow local reimplementation of it: `make test` in `backend`,
`npm run test:cov` in `service`, the coverage and accessibility suites in
`frontend`, the test suite and `synth` in `infra`. What passes locally is
what passes here, because it is the same command reading the same
configuration files. Each job checks the repository out and then guards its
real steps on `hashFiles`, so a repository composed from only some of the
packs passes on the components it actually has. That guard sits on the steps
and never on the job, because a job level condition is evaluated before any
runner has a workspace, where `hashFiles` can only return an empty string and
would silently skip every gate while reporting green.

The `gate` job is the one to require in a branch protection rule. It depends
on all four component jobs, runs with `always()`, and inspects each result,
failing on anything that is neither a success nor a skip. Without `always()`
it would inherit a skip from any absent component and report nothing at all,
and a status check that reports nothing is not a gate.

## The check

`file-contains-any .github/workflows 'eep verify'` (see checks/manifest.yaml)
is a builtin that scans every file under the repository's workflow directory
for an invocation of the gate, proving continuous integration is wired to it
rather than proving each check inside it currently passes. This pack declares
no `workdir`, so the core resolves that path from the repository root, which
is exactly where the workflow GitHub reads has to live. The words appear in
the `gate` job's comment, which explains that `eep verify` is the whole gate
and that the jobs above run its component parts directly until the CLI ships
on npm; that comment is load bearing, and the file says so.

## Notes for agents

If this check fails, the repository has no root workflow at all. Add this
pack's `ci.yml` rather than writing a narrower one, and never satisfy the
check by moving a component's workflow up to the root, since a component
workflow gates one directory and would leave the others ungated while looking
green. When you add a component to a composed repository, add its job here in
the same change and add it to the `gate` job's `needs` list; a component with
no job is a component nothing verifies. Keep every step's `if` guard on the
marker file that proves the component exists, and keep the guard on the step
rather than moving it to the job, which is the one edit that turns this whole
file into a gate that cannot fail.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
