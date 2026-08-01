---
title: Security
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-01"
---

# Security

This folder holds every law in the security domain: the rules governing how credentials are handled and how data store access resists injection. Packs bind to these laws when they declare which scanning and static analysis checks they implement, the corpus validator loads them to confirm every law file is well formed, and any contributor or agent touching configuration, credentials, or query code should read them first.

## Overview

The security domain governs how credentials are kept out of shared history and how data store access resists injection, the two failure modes most likely to turn a routine mistake into a breach. Its laws are deliberately unforgiving: one governs secrets with no waiver path at all, because the cost of a single leaked credential is unbounded and irreversible. Together they set a floor beneath which no pack, however fast moving, is allowed to fall.

## Contents

<!-- eep:index -->
- [EEP-SEC-01](laws/EEP-SEC-01.md): Secrets never enter version control.
- [EEP-SEC-02](laws/EEP-SEC-02.md): Data store queries are parameterized, never assembled from strings.
<!-- /eep:index -->

## Related

EEP-DLV-01.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
