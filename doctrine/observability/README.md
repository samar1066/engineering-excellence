---
title: Observability
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
---

# Observability

This folder holds the laws that govern how a running system makes its own behavior legible: what gets recorded as work happens, and how that record can be followed across every component a single request or message touches. It is read by AI coding agents before they add logging or instrumentation, and implemented by packs that bind these laws to a specific runtime and logging setup.

## Overview

Observability law covers how a system exposes its own behavior for inspection, starting with the two channels that most directly determine whether an incident is a quick lookup or a long investigation: logs and traces. A log line only aggregates usefully once it is structured and tagged with an identifier that ties it to one unit of work, and a trace is only useful once it survives every handoff between processes instead of stopping at the first one. This domain currently holds the foundational laws for both channels: structured, correlated logging, and tracing that propagates across process boundaries.

## Contents

<!-- eep:index -->
- EEP-OBS-01: Logs are structured and carry a correlation identifier.
- EEP-OBS-02: Traces propagate across every process boundary.
<!-- /eep:index -->

## Related

None.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-01*
