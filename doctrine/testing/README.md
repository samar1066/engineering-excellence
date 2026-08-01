---
title: Testing
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-01"
---

# Testing

This folder holds every law in the testing domain: the rules governing whether a codebase's behavior is verified by an automated suite, and whether that verification means anything. Packs bind to these laws when they declare which test runner and coverage checks they implement, the corpus validator loads them to confirm every law file is well formed, and any contributor or agent adding new behavior should read them before deciding a feature is done.

## Overview

The testing domain governs whether a codebase's behavior is verified by an automated suite, and whether that verification actually proves something about the public behavior callers depend on. Its laws move in two steps: first that a suite exists and runs on every change, then that the suite's coverage is measured against public behavior rather than raw executed lines. Together they turn "the tests pass" into a claim that means something.

## Contents

<!-- eep:index -->
- [EEP-TEST-01](laws/EEP-TEST-01.md): A test suite exists and runs on every change.
- [EEP-TEST-03](laws/EEP-TEST-03.md): Every public behavior has a test that fails when the behavior breaks.
<!-- /eep:index -->

## Related

EEP-ARCH-01, EEP-DLV-01.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
