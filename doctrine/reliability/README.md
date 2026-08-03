---
title: Reliability
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-03"
updated: "2026-08-03"
---

# Reliability

This folder holds the laws of the reliability and resilience domain, whose IDs carry the REL prefix: the rules governing how a system stays available across a deployment and how it recovers the data it holds when something fails. It is read by AI coding agents before they wire a deployment pipeline or declare a persistent data store, and implemented by packs that bind these laws to a specific deployment and storage toolchain.

## Overview

Reliability law covers what has to be true for a system to survive its own changes and its own failures, beginning with the two moments where availability is most often lost: the deployment of a new version, and the loss or corruption of stored data. A deployment with no health check and no way back turns a bad release into an outage that waits on a human to notice, and a data store with no backup and no declared recovery point turns an ordinary mistake into permanent loss. This domain holds the standard laws for both: a health check and an automatic rollback path on every deployment, and a backup with a defined recovery point for every persistent data store.

## Contents

<!-- eep:index -->
- [EEP-REL-01](laws/EEP-REL-01.md): Every deployment has a health check and an automatic rollback path.
- [EEP-REL-02](laws/EEP-REL-02.md): Every persistent data store has backups and a defined recovery point.
<!-- /eep:index -->

## Related

EEP-DLV-03, EEP-IAC-01.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
