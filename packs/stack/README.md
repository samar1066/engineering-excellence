---
title: Stack packs
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-02
---

# Stack packs

This folder holds every pack of kind `stack`: the packs that bind laws to a programming language and framework combination, loaded by the CLI's detect step when a consumer repository matches one of their detect rules.

## Overview

A stack pack owns one language and framework pairing end to end: a blessed toolchain, an executable check for every law it implements, and a binding file that explains the reasoning behind each check in terms an agent can act on. Detection is declarative: a stack pack lists the files and file contents that identify it, such as a `pyproject.toml` containing `fastapi`, so the CLI can activate it without a human choosing a stack by hand. The corpus ships one stack pack today, `python-fastapi`, with room for siblings as new languages and frameworks join the corpus.

## Contents

<!-- eep:index -->
- `python-fastapi/`: binds the implemented laws to a Python service built on FastAPI, with a blessed toolchain, an executable checks manifest, and one binding file per law.
- `typescript-node/`: binds the implemented laws to a Node 22 service built on Fastify 5, with a blessed toolchain, an executable checks manifest, and one binding file per law.
- `react/`: binds the implemented laws to a browser interface built with Vite, React 18, and TypeScript, including the accessibility gate that is this pack's reason to exist as a separate stack.
<!-- /eep:index -->

## Related

Pack names: `python-fastapi`. Law IDs implemented: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DEVX-01. Law IDs declined: EEP-DOCS-03.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
