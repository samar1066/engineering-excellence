---
title: Packs
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# Packs

This folder holds every pack in the corpus. A pack binds a law to a concrete technology: the tool that satisfies the law, the configuration that wires the tool in, and the automated check that proves compliance, so an agent working in a real repository inherits a golden path instead of a restatement of the law.

## Overview

A pack is the layer where language agnostic doctrine meets an actual stack. Each pack declares the laws it implements, the laws it deliberately declines with a stated reason, a blessed toolchain, and a set of executable checks that `eep verify` runs against a consumer repository. Packs are grouped by kind. The `stack` kind covers languages and frameworks, such as `python-fastapi`. Other kinds are reserved by the pack schema; only `stack` is populated in this corpus today.

## Contents

<!-- eep:index -->
- `stack/`: packs that bind laws to a programming language and framework combination, one pack per detected stack.
<!-- /eep:index -->

## Related

Pack names: `python-fastapi`.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
