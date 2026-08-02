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

Everything that varies by environment is read from the process environment in
`src/core/config.ts`, where `SERVICE_NAME`, `LOG_LEVEL`, and `PORT` each fall
back to a safe default, so a running service needs no file of values checked in
beside it. Nothing in the scaffold reads a `.env` file, and `.gitignore`
already excludes the trees where credential material tends to accumulate.
`eep adopt` installs the pre-commit gate, so the same scan that runs in
verification also runs before a commit exists, which is the only point where
the mistake is still cheap to undo.

## The check

`secrets-scan` (see checks/manifest.yaml) is a builtin check that walks the
repository's tracked text files, skipping what `.gitignore` already excludes,
and fails on credential shaped material: an AWS access key id, a private key
header, or an assignment of an api key, secret, token, or password to a long
literal. It reports the file and the pattern family rather than the matched
text, so a finding never echoes the credential into a log that is itself
shared.

## Notes for agents

If this check fires, treat the credential as compromised: rotate it first, then
remove it from the working tree, because deleting the line in a later commit
does not remove it from history or from any clone that already exists. Replace
the literal with a read from the environment in `src/core/config.ts` and give
the variable a documented default that is safe in development. If the finding
is genuinely a false positive, a fixture that looks like a key for example,
move the fixture out of the pattern's shape rather than reaching for a waiver:
this law has no waiver path at all.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
