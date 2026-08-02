---
title: Frontend
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-02"
updated: "2026-08-02"
---

# Frontend

This folder holds the laws that govern the surface a person actually touches: what has to be true of a user interface before it ships, independent of the rendering technology behind it. It is read by AI coding agents before they add or change a view, and implemented by packs that bind these laws to a specific interface toolchain and test runner.

## Overview

Frontend law covers the obligations an interface owes the people using it, beginning with the one whose failures are both the most common and the least likely to be reported: accessibility. An interface that cannot be operated by keyboard, or whose controls carry no accessible name, excludes users who then have no way to tell anyone, so the defect persists silently while ordinary bugs get filed and fixed. This domain currently holds one law, requiring automated accessibility checks to run in the build and to fail it, which sets the floor that later frontend laws will build on.

## Contents

<!-- eep:index -->
- [EEP-FE-01](laws/EEP-FE-01.md): User interfaces pass automated accessibility checks.
<!-- /eep:index -->

## Related

EEP-TEST-01, EEP-TEST-03.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
