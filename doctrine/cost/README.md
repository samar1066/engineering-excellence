---
title: Cost
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-03"
updated: "2026-08-03"
---

# Cost

This folder holds the laws of the cost and FinOps domain, whose IDs carry the COST prefix: the rules governing how the resources a system provisions stay accountable to the people and the environments that own them. It is read by AI coding agents before they declare a provisioned resource, and implemented by packs that bind these laws to a specific provisioning toolchain.

## Overview

Cost law covers how an estate of provisioned resources stays legible to the organization paying for it, starting with the attribution that every later cost decision depends on. A resource that names neither an owner nor an environment cannot be billed back, cannot be safely reclaimed when it goes idle, and cannot be told apart from its counterpart elsewhere, so the spend it drives becomes a number no one can explain or reduce. This domain currently holds one law, requiring every provisioned resource to carry attribution for its owner and its environment, which is the foundation the rest of cost governance builds on.

## Contents

<!-- eep:index -->
- [EEP-COST-01](laws/EEP-COST-01.md): Every provisioned resource is attributable to an owner and an environment.
<!-- /eep:index -->

## Related

EEP-IAC-01, EEP-DLV-04.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
