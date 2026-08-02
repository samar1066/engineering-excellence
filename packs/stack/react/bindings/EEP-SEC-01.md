---
title: EEP-SEC-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

A frontend leaks credentials differently from a service: anything the bundler
inlines is public the moment the bundle ships, and Vite makes that boundary
explicit by exposing only variables prefixed `VITE_` to client code. This pack
keeps that boundary honest. The one variable the scaffold reads,
`VITE_API_URL`, is a location rather than a credential, and it is declared in
`src/env.d.ts` so adding a second one is a deliberate act with a type behind it.
No `.env` file ships in the scaffold, `.gitignore` keeps build output and caches
out of the tree, and browser code that needs privileged data gets it from an
API component that holds the credential server side, never from a value baked
into the bundle.

## The check

`secrets-scan` (see checks/manifest.yaml) is a builtin check that walks every
tracked file, skipping ignored trees, and fails on credential shaped material:
key identifiers, private key headers, and assignments of a secret or token to a
long literal value. It is a static scan over content, so it catches a key
pasted into a config, a test fixture, or a comment, wherever it landed.

## Notes for agents

If this check fires, rotate the credential before doing anything else: it is
public from the moment it was committed, and deleting the line does not undo
that. Then take the value out of the tree, read it from the environment on the
server side, and let the browser reach it through an API call. Resist the
reflex to prefix a secret with `VITE_` to make it available in a component;
that prefix does not protect anything, it publishes it. A value that genuinely
belongs in the bundle, a public API base URL, a feature flag, is configuration
rather than a secret, and naming that distinction in the pull request is part
of the fix.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
