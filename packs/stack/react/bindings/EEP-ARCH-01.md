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

A frontend has the same inward pointing shape a service does, with different
names: `src/api` owns the wire, `src/hooks` owns state and orchestration, and
`src/components` owns what a person sees. The permitted direction runs
components to hooks to api and never back, and it is declared in
`.dependency-cruiser.cjs` rather than left to review. dependency-cruiser walks
the real module graph on every run, so a component that imports the API client
to save one indirection becomes a build failure instead of a habit. Type only
imports count, because knowing the wire format is the coupling the rule exists
to prevent: `tsPreCompilationDeps` stays on, and the hooks layer re-exports the
wire types so components have a legal way to name them.

## The check

`npx depcruise --config .dependency-cruiser.cjs src` (see
checks/manifest.yaml) cruises the whole `src` graph in one pass and exits non
zero on the first rule that fires, reporting the importing module, the imported
module, and the rule name. Four rules carry the shape: components never import
api, hooks never import components, api stays a leaf, and no cycle anywhere.
A fifth keeps a development only dependency out of shipped code.

## Notes for agents

When this check fails on a component reaching into `src/api`, the fix is
almost always a hook: move the call into `src/hooks`, return the data the
component needs, and let the component take it as a prop or a hook result. If
the component only needed a type, import it from the hook that owns the data,
not from the client. Editing `.dependency-cruiser.cjs` to widen a rule is a
last resort that needs its own justification, since the rule is the only thing
standing between this codebase and components that each know their own way to
the network.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
