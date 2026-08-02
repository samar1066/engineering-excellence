---
title: EEP-ARCH-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

The five governed layers land as five directories under `src/`: `routes` speaks
HTTP, `workflows` orchestrates a use case, `domain` holds entities and the
repository contracts expressed in them, `infrastructure` implements those
contracts, and `src/app.ts` is the one composition root that knows a concrete
repository and a route both exist. Routes never construct a repository; they
receive their workflow through fastify plugin options, which is what lets the
two declared contracts stay true without any discipline beyond the tool. Those
contracts live in `.dependency-cruiser.cjs` as rules rather than as a
convention someone has to remember: the domain may not import routes or
infrastructure, and routes may not import infrastructure at all.

## The check

`npx depcruise --config .dependency-cruiser.cjs src` (see
checks/manifest.yaml) walks the real import graph from `src` and exits non zero
on the first forbidden edge, so a violation fails the build rather than a
review. The config parses TypeScript through swc, which reports an
`import type` as a dependency like any other, so a layer cannot be crossed by
importing only a type. Two further rules protect the check itself: a cycle is
an error even when it crosses no single forbidden edge, and an import nobody
can resolve is an error because it would otherwise match no path rule and pass
by accident.

## Notes for agents

When this check fails, read the reported edge before changing anything: the fix
is almost always to move the dependency to the composition root or to route the
call through a workflow, not to widen the rule. A route that needs data reaches
it through a workflow method; a domain module that seems to need infrastructure
usually needs an interface in `src/domain` that infrastructure implements
instead. Treat an edit to `.dependency-cruiser.cjs` as a last resort that needs
its own justification, and never silence a finding by converting a value import
into a type only import, which this configuration catches anyway.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
