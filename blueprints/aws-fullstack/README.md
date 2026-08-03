---
title: aws-fullstack blueprint
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# aws-fullstack blueprint

A blueprint is a curated composition that expands into a pack set for a composed init. It is not a
pack. A pack binds laws to one technology; a blueprint composes many packs, names the cross service
laws no single pack can own, and records how the packs wire together into a coherent architecture.
The aws-fullstack blueprint produces a Well Architected full stack AWS application where every
service is still its own validated pack underneath.

## What it composes

Running `eep init myapp aws-fullstack` expands the blueprint into its core pack set and hands that
set to the existing composed init machinery. Wave 1 core lists only packs that already ship, so the
blueprint composes and validates today:

1. `react`: the frontend, served as a static build.
2. `python-fastapi`: the API and domain, built on the five layer architecture.
3. `aws-cdk`: the infrastructure, targeting AWS Fargate compute.
4. `containers-k8s`: the container image definitions for each component.
5. `github-actions`: the promotion pipeline from dev to uat to prod.

`aws-dynamodb`, `aws-cognito`, and `aws-s3` join the core in later waves, once each lands as its own
validated pack with the cross pack wiring described below.

## Slices

Slices are optional pack sets added with `--with <name,...>`. Each slice names one capability and
the pack that provides it. Wave 1 slices are documented placeholders: every slice pack is still on
the roadmap, so requesting a slice composes the core and reports the pending pack rather than
failing. The slices, and the packs they will pull in, are:

1. `async`: `aws-messaging` for SQS, SNS, EventBridge, and Step Functions.
2. `search`: `aws-opensearch`.
3. `cache`: `aws-elasticache`.
4. `streaming`: `aws-kinesis`.
5. `sql`: `aws-aurora`.

## Pillars

The pillars are the cross service laws only a composition can assert. They stay vendor neutral in
doctrine, so a second cloud blueprint reuses them, and the AWS packs bind each one where they can.
The aws-fullstack blueprint asserts EEP-SEC-03 and EEP-SEC-04 for least privilege and encryption,
EEP-REL-01 and EEP-REL-02 for health checked deploys and recoverable data stores, and EEP-COST-01
for cost attribution on every resource.

## Wiring

Wiring is reference documentation for how the packs fit together. It drives no behavior in wave 1;
the composed wiring step that acts on it lands with the data pack wave:

1. `aws-dynamodb` provides the repository implementation for the backend interface.
2. `aws-cognito` provides the API authorizer for the backend routes.
3. `aws-s3` and CloudFront front the react frontend build.

## How to use it

1. Compose the core: `eep init shop aws-fullstack` scaffolds one monorepo with a component per core
   pack, one vendored `.eep`, and one generated set of agent instructions.
2. Add a slice: `eep init shop aws-fullstack --with async` composes the core and reports any slice
   pack still on the roadmap.
3. Do not mix a blueprint with individual framework tokens. A blueprint already names a complete
   pack set, so `eep init shop aws-fullstack fastapi` is refused; use the blueprint alone, or list
   framework tokens without it.
4. See the composed project's own `CLAUDE.md` for the laws in force and the gate that proves them,
   then run `eep verify` from the project root.

## Related

1. Packs: react, python-fastapi, aws-cdk, containers-k8s, github-actions.
2. Pillars: EEP-SEC-03, EEP-SEC-04, EEP-REL-01, EEP-REL-02, EEP-COST-01.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
