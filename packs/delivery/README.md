---
title: Delivery packs
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# Delivery packs

This folder holds every pack of kind `delivery`: the packs that bind laws to the pipeline a change travels through, loaded by the CLI's detect step when a consumer repository matches one of their detect rules. A delivery pack owns continuous integration and promotion: it gates every change before merge and moves one built artifact through non production environments before production, rather than scaffolding an application or its infrastructure.

## Overview

A delivery pack owns one pipeline toolchain end to end: a blessed set of workflows, an executable check for every law it implements, and a recorded reason for every law it declines because that law is scoped to the components the pipeline gates rather than to the pipeline itself. Detection is declarative, the same as any pack kind: a delivery pack lists the file that identifies its pipeline, such as `.github/workflows/deploy.yml`, so the CLI activates it without a human wiring continuous integration by hand. The corpus ships one delivery pack today, `github-actions`, which gates every change with a per component check and promotes one built image through dev, uat, and production using GitHub environments and OpenID Connect federation to AWS, with room for siblings as new pipeline toolchains join the corpus.

## Contents

<!-- eep:index -->
- `github-actions/`: binds EEP-DLV-01 and EEP-DLV-03 to the GitHub Actions workflows that gate every change and promote one built image through dev, uat, and production.
<!-- /eep:index -->

## Related

Pack names: `github-actions`. Law IDs implemented: EEP-DLV-01, EEP-DLV-03. Law IDs declined: EEP-DLV-02.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
