---
id: EEP-SEC-04
domain: SEC
title: Data is encrypted at rest and in transit at every hop
version: 1.0.0
status: stable
maturity: standard
severity: blocking
applies_to: [infra]
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: "2026-08-03"
updated: "2026-08-03"
supersedes: []
related: [EEP-SEC-03, EEP-REL-02]
---

## Statement

Data is encrypted at rest and in transit at every hop.

## Rationale

Data is exposed at two moments a system does not always control: while it sits in storage that can be copied, snapshotted, or physically removed, and while it crosses a network segment that another party can observe. Encryption at rest and in transit closes both, so a stolen storage volume or an intercepted connection yields ciphertext rather than readable records, and the protection holds even when the perimeter around it has already failed. Leaving one hop unencrypted because it runs inside a trusted boundary is the common gap, since internal segments are assumed safe right up to the moment an attacker is already inside one and reading everything that crosses it in the clear. The discipline has to cover every hop rather than the external edge alone, because a single readable leg between two internal components is the entire exposure. This law is standard rather than foundational because it presumes the data stores and transports it governs are already declared where a check can enumerate them.

## Pattern

Every declared data store holds its contents encrypted at rest, and every transport between components negotiates an encrypted connection, so a value is protected both where it rests and on every leg it travels. Where a component can reach a peer over either an encrypted or an unencrypted endpoint, it is configured to require the encrypted one and to refuse the fallback, so a misconfiguration fails closed rather than quietly downgrading to plaintext.

## Antipatterns

Encrypting the connection a client uses to reach the system while leaving the internal hops between services in plaintext protects the part an outsider sees and exposes the part an intruder who is already inside would target, which is tempting because the external edge is the hop everyone remembers to secure. Leaving a data store unencrypted because it lives on a private network treats a network boundary as if it were a property of the data itself, so a copied backup or a relocated volume carries the records out in readable form the moment it leaves that network.

## Check contract

A check fails when a declared data store or transport lacks encryption, or when a component accepts an unencrypted connection where an encrypted one is available.

## Waiver policy

Waivable with a declared waiver carrying owner and expiry of at most 90 days, except where noted.
