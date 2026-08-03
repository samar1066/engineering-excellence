---
title: aws-dynamodb
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# aws-dynamodb

A Tier 1 data pack that binds the Engineering Excellence Program to DynamoDB as the persistence behind a backend's repository interface. A repository matches this pack when it carries a `data/dynamodb.json`. The pack is of kind `data`, a kind that supplies a repository implementation rather than scaffolding an application or a platform: it declares `provides: repository`, and its job is to be a drop in swap for the in memory reference repository the backend packs ship, plus the DynamoDB table that repository reads and writes.

It gives a project three things that fit together: a CDK table construct the aws-cdk platform pack composes into its service stack, a repository adapter in Python and in TypeScript that satisfies the backend note repository interface, and one contract suite that proves the adapter behaves identically to the in memory reference by running the same tests against both, with the DynamoDB side pointed at DynamoDB Local so the proof needs no AWS account.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before adding a persisted entity, from defining the interface to wiring the table and running the contract suite against both implementations.
- A table construct under `construct/`: a DynamoDB table with encryption at rest, point in time recovery, on demand billing, an `id` partition key, and owner plus environment tags, with vitest template assertions that prove each property.
- Repository adapters under `wiring/python/` and `wiring/typescript/`: `DynamoNoteRepository` for each backend, reading the table name from an environment variable and accepting an endpoint override so it can point at DynamoDB Local.
- A pinned DynamoDB Local compose file under `local/` and a contract suite that runs against both the in memory reference and the DynamoDB adapter.
- Blessed configuration templates under `templates/config/` for biome and TypeScript.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.

## Laws implemented

This pack implements four laws:

- EEP-SEC-04: the table is encrypted at rest, and the SDK reaches the regional endpoint over TLS.
- EEP-REL-02: the table keeps point in time recovery, the continuous backup that fixes the recovery point.
- EEP-COST-01: the table carries owner and environment tags applied where it is declared.
- EEP-ARCH-02: the DynamoDB adapter is a substitutable drop in for the in memory reference, proven by one contract suite run against both.

The how and the why for each law live in `bindings`, one file per law named for its ID.

It declines thirteen laws, each with a recorded reason in `pack.yaml`. They are the laws scoped to the application the backend pack owns or to the pipeline the delivery pack owns, rather than to the persistence this pack supplies: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, and EEP-DEVX-01. A repository that adopts this pack adopts a backend stack pack and a delivery pack alongside it, and those packs implement the declined laws for the components they own.

## What `provides: repository` means

The manifest declares `provides: repository`. It is the signal the composed init step reads to know this pack supplies an implementation for a backend interface rather than a standalone component. On composition, the adapter under `wiring/` is injected into the backend's infrastructure layer and the dependency injection site is rewritten to bind it in place of the in memory reference, while the table construct is composed into the aws-cdk service stack. The contract suite is what makes that swap safe: it has already shown the adapter and the reference behave the same through the interface.

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| TypeScript strict | tsconfig.json in the scaffold | The construct and the TypeScript adapter are strict mode TypeScript. |
| python 3.11 | | The Python adapter targets the floor the python-fastapi backend declares. |
| aws-cdk-lib v2 | | One library defines the table construct the aws-cdk pack composes, proven by template assertions. |
| npm | | Ships with Node, and npm ci restores the committed lockfile exactly. |
| biome format | templates/config/biome.json | One binary formats and lints the TypeScript sources. |
| biome | templates/config/biome.json | Replaces ESLint and Prettier in a single pass. |
| tsc --noEmit | templates/config/tsconfig.json | A misconfigured construct or adapter is a type error before it is a failed deployment. |
| vitest with aws-cdk-lib assertions | | Proves encryption, recovery, and tags against the rendered template with no AWS account. |
| pytest and vitest against DynamoDB Local | | Runs the one contract suite against both implementations, which is the substitutability proof. |

Eight categories are declined outright with reasons in `pack.yaml`: boundaries, api_test, e2e_test, coverage, mocking, logging, tracing, and hooks.

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at `STACK.md`; the eep CLI is an accelerator, not a requirement. The table construct is plain aws-cdk-lib and imports into any CDK app. The adapters are plain SDK code: the Python one needs `aioboto3`, the TypeScript one needs `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`, and both take an endpoint override so the contract suite can run against DynamoDB Local with Docker and no AWS account. The construct assertions and the contract suite are the whole proof, and both run locally.

## Related

- Law IDs implemented: EEP-SEC-04, EEP-REL-02, EEP-COST-01, EEP-ARCH-02; declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, EEP-DEVX-01.
- Packs: python-fastapi and typescript-node (the backends whose repository interface this pack implements); aws-cdk (the platform pack that composes the table construct into its service stack).

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
