---
id: EEP-COST-01
domain: COST
title: Every provisioned resource is attributable to an owner and an environment
version: 1.0.0
status: stable
maturity: standard
severity: warning
applies_to: [infra]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-03"
updated: "2026-08-03"
supersedes: []
related: [EEP-IAC-01, EEP-DLV-04]
---

## Statement

Every provisioned resource is attributable to an owner and an environment.

## Rationale

A provisioned resource with no attribution is a cost and a risk that belongs to no one, so when spend needs to be explained, when an unused resource needs to be reclaimed, or when a change needs an owner to consult, an unlabeled resource forces a slow investigation to answer a question a tag would have answered instantly. Recording an owner and an environment on every resource at the moment it is provisioned makes the whole estate legible, because spend can be attributed, idle resources can be traced back to whoever can safely remove them, and a resource can be told apart from its counterpart in another environment before anyone acts on it. Attribution is nearly free to add when a resource is declared and painfully manual to reconstruct later, when the person who created it may have moved on and the only record is the resource itself. This law carries a warning rather than a blocking severity because a missing tag is a governance gap to correct rather than a defect that must halt a release. It is scoped to provisioned resources because those are the ones that accrue cost and outlive the memory of why they were created.

## Pattern

Every provisioned resource carries attribution metadata that names both the owner responsible for it and the environment it belongs to, applied as part of the same declaration that creates the resource so the label cannot drift from the thing it describes. The attribution is set from a shared definition rather than typed by hand per resource, so every resource in a deployment inherits a consistent owner and environment and a report can group the entire estate by either one.

## Antipatterns

Provisioning a resource with no owner or environment metadata because it is quick and the resource works without it leaves a nameless line on a bill and an orphan nobody will confidently reclaim, and the omission is tempting precisely because nothing fails at creation time. Tagging only some resource kinds, or applying labels by hand after the fact, produces an estate that is partially attributable and therefore not attributable at all, since any untagged resource can be the one that matters and the gaps stay invisible until someone tries to account for the whole.

## Check contract

A check fails when a provisioned resource carries no attribution metadata identifying its owner and its environment.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
