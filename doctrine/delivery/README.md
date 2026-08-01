---
title: Delivery
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# Delivery

This folder holds the laws that govern how a change moves from a contributor's machine to the branch everyone builds on: what has to be true before a change merges, and what has to stay true about the dependencies a build resolves. It is read by AI coding agents before they touch a pipeline configuration or a dependency manifest, and implemented by packs that bind these laws to a specific delivery toolchain.

## Overview

Delivery law covers how a codebase moves from a proposed change to something everyone can rely on, starting with the two guarantees that make every later stage trustworthy: that nothing merges unverified, and that a build resolves the same dependencies today that it resolved yesterday. An unverified merge is a bet that compounds with every change layered on top of it, and an unpinned dependency graph turns a build into something that cannot reliably be reproduced. This domain currently holds the foundational laws for both guarantees: continuous integration as a mandatory gate, and a lockfile kept in sync with what a project declares.

## Contents

<!-- eep:index -->
- EEP-DLV-01: Continuous integration gates every change.
- EEP-DLV-02: Dependencies are pinned by a lockfile that stays fresh.
<!-- /eep:index -->

## Related

EEP-TEST-01: the test suite that the continuous integration gate in this domain is required to run on every change.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
