---
title: Data packs
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# Data packs

This folder holds every pack of kind `data`: the packs that bind laws to a persistence technology and supply a repository implementation for a backend interface, rather than scaffolding an application or owning an infrastructure surface. A data pack augments a repository the way a platform pack does, but the thing it augments is the backend's storage seam: it declares `provides: repository`, ships an adapter that drops in behind an existing repository interface, and carries the store's own laws, encryption at rest, backups with a recovery point, and cost attribution, on the resource it provisions to back that adapter.

## Overview

A data pack owns one persistence surface end to end: the resource definition that provisions the store, a repository adapter that satisfies a backend interface as a drop in swap for its in memory reference, and one contract suite that proves the adapter behaves identically to that reference by running the same tests against both. Detection is declarative, the same as any pack kind: a data pack lists the file that identifies its surface, such as `data/dynamodb.json` for a DynamoDB store, so the CLI activates it without a human choosing a database by hand. Substitutability is the guarantee that makes the swap safe, so every data pack implements EEP-ARCH-02 by running its contract suite against the in memory reference and the real store alike, and declines the application and pipeline laws that belong to the backend and delivery packs it sits beside.

## Contents

- `aws-dynamodb/`: binds EEP-SEC-04, EEP-REL-02, EEP-COST-01, and EEP-ARCH-02 to a DynamoDB table and a repository adapter that drops in behind the backend note repository interface, with a contract suite proving it substitutes for the in memory reference.

## Related

Pack names: `aws-dynamodb`. Law IDs implemented: EEP-SEC-04, EEP-REL-02, EEP-COST-01, EEP-ARCH-02. Law IDs declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, EEP-DEVX-01.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
