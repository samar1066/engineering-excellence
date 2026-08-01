---
title: Profiles
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# Profiles

Adoption postures that modulate how laws bind to projects without changing what the laws themselves declare. Each profile represents a different enforcement strategy and readiness level for applying the Engineering Excellence Program to your codebase.

## Overview

Profiles determine the enforcement mode for laws when a project adopts the program. They answer the question: should all code comply, only new code, or code at some baseline? Each profile is a policy choice, not a change to law definitions. This separation keeps laws universal and stable while allowing projects to adopt excellence at their own pace and maturity level.

## Contents

<!-- eep:index -->
- greenfield.yaml: Zero debt from the first commit. Every law blocks at its declared severity.
- evolving.yaml: Clean as you code. New and modified code must comply; untouched code is baselined.
- steady.yaml: Baseline plus no regression. Enforcement ships in a later release. (reserved)
<!-- /eep:index -->

## Related

None.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
