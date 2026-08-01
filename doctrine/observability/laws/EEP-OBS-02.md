---
id: EEP-OBS-02
domain: OBS
title: Traces propagate across every process boundary
version: 1.0.0
status: stable
maturity: standard
severity: warning
applies_to: [backend]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-01
updated: 2026-08-01
supersedes: []
related: ["EEP-OBS-01"]
---

## Statement

Traces propagate across every process boundary.

## Rationale

A distributed request typically crosses many process boundaries: an entry point, one or more internal calls, a queue, a background worker, an external dependency. Tracing that stops at the first hop describes only a fragment of what actually happened. A trace that dies at a queue boundary is effectively half a trace: it shows that a request arrived and was handed off, but nothing about what happened afterward, which is often exactly where the latency or the failure lives. Consistent tracing across every hop turns a system built from many independently deployed components back into something one person can reason about: a single causal chain instead of a set of disconnected local views. When trace context is not propagated across a boundary, every hop beyond that point starts a new, disconnected trace, and reconstructing the true path requires manually stitching timestamps and identifiers across systems, the same failure mode uncorrelated logging produces.

## Pattern

Initialize tracing instrumentation once, at process startup, through vendor neutral interfaces, so the choice of backend can change later without touching call sites throughout the codebase. Instrument every service entry point, whatever triggers the process to begin handling a unit of work, so a trace always has a defined root. Ensure every outbound call, whether a network request, a queue publish, or a handoff to a background task, propagates the current trace context to the receiving side, so that side continues the same trace instead of starting a new one.

## Antipatterns

Instrumenting only the outermost tier that receives external traffic and stopping there is tempting because that is where problems are first noticed and where instrumentation is easiest to add, but it leaves every internal hop dark. Treating a queue, a scheduled job, or an external call as a hard edge where tracing simply stops, rather than a boundary that context must be threaded across, silently truncates every trace that passes through it. Adding instrumentation calls scattered through business logic as an afterthought, instead of initializing it centrally at startup, produces coverage that depends on which contributor happened to touch which code path last.

## Check contract

A check proves tracing is initialized and instruments the service entry points, and that outbound calls propagate trace context.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
