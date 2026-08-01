---
title: EEP-SEC-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

## How this stack satisfies it

This stack keeps runtime configuration, API keys, database credentials, and
tokens out of source entirely: they arrive through environment variables read
once at startup, never written into pyproject.toml, test fixtures, or example
config committed to the repository. The toolchain's hooks entry wires a
pre-commit hook, so the same scan that runs in continuous integration also
runs before a commit is created, catching a leaked credential before it
reaches a shared branch. There is no accepted pattern in this stack for
checking in a real key temporarily; local development uses an environment file
excluded from version control, never a tracked one.

## The check

`secrets-scan` (see checks/manifest.yaml) is a builtin check that scans
tracked files and staged changes for credential shaped material: API keys,
private keys, tokens, and connection strings carrying an embedded password. It
runs against the full tracked tree in continuous integration and against the
staged diff in the local pre-commit hook, so the same rule applies before a
commit exists and after a push reaches a shared branch.

## Notes for agents

If this check fails, remove the literal secret from the file and replace it
with an environment variable read at startup; deleting only the latest commit
is not enough, because the value may already be reachable in history. Rotate
the exposed credential at its source immediately, since material that touched
version control must be treated as compromised regardless of whether it ever
reached a shared branch. EEP-SEC-01 carries no waiver path, so the only way
through a failure here is removing the material and rotating the credential,
never an exception.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
