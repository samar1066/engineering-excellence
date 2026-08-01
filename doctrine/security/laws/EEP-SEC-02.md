---
id: EEP-SEC-02
domain: SEC
title: Data store queries are parameterized, never assembled from strings
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [backend]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-01"
updated: "2026-08-01"
supersedes: []
related: [EEP-SEC-01]
---

## Statement

Data store queries are parameterized, never assembled from strings.

## Rationale

Injection remains one of the most exploited vulnerability classes in production software, not because the fix is obscure, but because assembling a query through string formatting or concatenation is often the first pattern a developer reaches for, and it works perfectly until untrusted input finally reaches it. A parameterized query keeps the query's structure separate from its data at the point the underlying engine parses it, so a runtime value can never be reinterpreted as query syntax regardless of what characters it contains. The cost of a single missed case is disproportionate to the discipline required to avoid it everywhere: one unparameterized query anywhere in the surface, including a rarely touched script, is enough for an attacker to read or alter data the application was never meant to expose. Because the fix is mechanical and carries no legitimate tradeoff in performance or clarity, this law applies uniformly to every query rather than only to the ones judged high risk.

## Pattern

Every query passes runtime values as bound parameters through placeholders that the data store driver fills in after the query structure has already been parsed, so application code never builds query text by combining trusted syntax with untrusted values. This discipline applies everywhere a query touches a data store, including ad hoc scripts, reporting queries, and schema migration files, not only the request handling path that is easiest to remember to review.

## Antipatterns

Building query text with string formatting, string interpolation, or concatenation, then substituting a runtime value directly into that text, can look identical to a parameterized call on a quick read, and is tempting because it is often shorter to write, but it allows any value containing query syntax to change the meaning of the query itself. A migration script or an internal administrative tool is often exempted from this discipline on the assumption that only trusted operators run it, but trusted operators paste in values copied from tickets, spreadsheets, and support requests, turning the exemption into the weakest point in the entire system.

## Check contract

A static check fails the build when query text is built by string formatting or concatenation with runtime values.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
