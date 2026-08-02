---
title: Infrastructure
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-02"
updated: "2026-08-02"
---

# Infrastructure

This folder holds the laws of the infrastructure and cloud domain, whose IDs carry the IAC prefix: the rules governing how the environments a system runs in are declared, changed, and packaged. It is read by AI coding agents before they touch an infrastructure definition or a service image definition, and implemented by packs that bind these laws to a specific cloud and container toolchain.

## Overview

Infrastructure law covers everything between a passing build and a running system: how an environment is described, how a change to it is reviewed before it takes effect, and how a service is packaged so it runs the same way everywhere it is deployed. Its laws exist because infrastructure mistakes are the expensive kind, deleting data stores and severing network paths in ways no downstream test can undo, and because a runtime that lives only on a host rather than in version control makes a production failure impossible to explain from the source. This domain currently holds two standard laws: infrastructure declared as code with a preview before every apply, and services shipped as container images built from definitions kept under review.

## Contents

<!-- eep:index -->
- [EEP-IAC-01](laws/EEP-IAC-01.md): Infrastructure is declared as code and changes preview before they apply.
- [EEP-IAC-02](laws/EEP-IAC-02.md): Services ship as container images built from version controlled definitions.
<!-- /eep:index -->

## Related

EEP-DLV-03, EEP-DLV-04.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
