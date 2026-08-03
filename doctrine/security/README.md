---
title: Security
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-03"
---

# Security

This folder holds every law in the security domain: the rules governing how credentials are handled, how data store access resists injection, how much access each component holds, and how data is protected in storage and in motion. Packs bind to these laws when they declare which scanning and static analysis checks they implement, the corpus validator loads them to confirm every law file is well formed, and any contributor or agent touching configuration, credentials, access grants, or query code should read them first.

## Overview

The security domain governs the failure modes most likely to turn a routine mistake into a breach: credentials reaching shared history, data store access that can be injected, a component holding more access than it uses, and data left readable in storage or on the wire. Its laws are deliberately unforgiving: one governs secrets with no waiver path at all, because the cost of a single leaked credential is unbounded and irreversible, while the rest set floors for parameterized access, least privilege, and encryption at every hop. Together they establish a baseline beneath which no pack, however fast moving, is allowed to fall.

## Contents

<!-- eep:index -->
- [EEP-SEC-01](laws/EEP-SEC-01.md): Secrets never enter version control.
- [EEP-SEC-02](laws/EEP-SEC-02.md): Data store queries are parameterized, never assembled from strings.
- [EEP-SEC-03](laws/EEP-SEC-03.md): Every component runs with least privilege and holds no access it does not use.
- [EEP-SEC-04](laws/EEP-SEC-04.md): Data is encrypted at rest and in transit at every hop.
<!-- /eep:index -->

## Related

EEP-DLV-01.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
