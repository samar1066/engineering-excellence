---
title: Architecture
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-03"
---

# Architecture

This folder holds every law in the architecture domain: the rules governing how a codebase is organized into layers and modules, how those layers are allowed to depend on one another, and how an implementation stays substitutable behind its interface. Packs bind to these laws when they declare which boundary checks they implement, the corpus validator loads them to confirm every law file is well formed, and any contributor or agent proposing a structural change should read them before deciding where new code belongs.

## Overview

The architecture domain governs how code is organized into layers and modules, and the direction dependencies are allowed to flow between them. Its laws exist to keep change cost bounded as a system grows: a codebase where every part can reach into every other part's internals becomes one where no change is local and no piece can be tested, replaced, or reasoned about alone. Currently this domain holds two laws: one establishing the dependency rule that every other architecture law builds on, and one requiring that a repository implementation remain substitutable behind its interface.

## Contents

<!-- eep:index -->
- [EEP-ARCH-01](laws/EEP-ARCH-01.md): Layers depend in one direction through declared contracts.
- [EEP-ARCH-02](laws/EEP-ARCH-02.md): A repository implementation is substitutable behind its interface.
<!-- /eep:index -->

## Related

EEP-TEST-03.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
