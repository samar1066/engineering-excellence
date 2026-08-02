---
title: Doctrine
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-02"
---

# Doctrine

This folder is the law of the Engineering Excellence Program: a single, language agnostic corpus of rules that every governed repository, every pack, and every AI coding agent working in one is expected to satisfy. It is loaded by the corpus validator to confirm that every law and every README is well formed, and by packs that bind these laws to a concrete toolchain; a contributor or an agent should read the relevant domain before writing code that touches it.

## Overview

Doctrine is organized as one folder per domain, and each domain folder holds its own README and a laws directory of individual, numbered law files. A law states a single testable rule: what must be true, why it matters, what following it looks like, what violating it looks like, what an automated check must prove, and whether a waiver is possible. The domain inventory itself is not fixed: new domains are added only by RFC, keeping the top level structure deliberate rather than accretive. Once a law ID is published it is immutable: a law can be revised in place, superseded by a new law that names it, or deprecated, but its ID is never reassigned or reused.

## Contents

<!-- eep:index -->
- [architecture](architecture/README.md): layering and dependency direction between modules.
- [testing](testing/README.md): verified, meaningful test coverage on every change.
- [security](security/README.md): keeping secrets out of version control and queries safe from injection.
- [observability](observability/README.md): structured logs and traces that carry a correlation identifier across every process boundary.
- [delivery](delivery/README.md): continuous integration gates, pinned dependencies, and promotion of one artifact through separated environments.
- [iac](iac/README.md): infrastructure declared as code with previewed changes, and services packaged as reviewable images.
- [frontend](frontend/README.md): user interfaces that pass automated accessibility checks in the build.
- [documentation](documentation/README.md): governed document frontmatter, writing style, and a README in every folder.
- [devex](devex/README.md): one command that takes a fresh clone to a working setup.
<!-- /eep:index -->

## Related

None.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
