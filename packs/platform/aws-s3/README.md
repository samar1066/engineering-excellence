---
title: aws-s3
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# aws-s3

A Tier 1 platform pack that binds the Engineering Excellence Program to Amazon S3 and Amazon CloudFront as the object storage and the frontend edge in front of a full stack application. A project matches this pack when it carries a `storage/s3.json`. The pack is of kind `platform` and declares `provides: storage`: its job is to serve a built single page app through a private bucket and a CloudFront distribution, and to give the backend a private encrypted bucket for uploads that its task role is granted the exact scope it uses.

It gives a project two CDK constructs the aws-cdk platform pack composes into its service stack: a frontend hosting construct that puts a CloudFront distribution with an origin access control in front of a private, encrypted site bucket and publishes the frontend's build output to it, and an uploads bucket construct that provisions a private, encrypted bucket for application uploads. On composition, the service stack instantiates both, hands the container the uploads bucket name, grants the task role read and write on that one bucket, and emits the distribution's HTTPS URL. Every property the laws depend on is proven by vitest assertions over the rendered CloudFormation template, so the proof needs no AWS account.

## What this pack gives you

1. `STACK.md`: the golden path an AI coding agent reads before serving a frontend or storing an upload, from provisioning the distribution to publishing the build and writing an object from the backend.
1. A frontend hosting construct under `construct/`: a private, encrypted S3 bucket reachable only by a CloudFront distribution through an origin access control, with a redirect to HTTPS, `index.html` as the default root object, a single page app error mapping that rewrites a 403 or a 404 to the app shell with a 200, sensible caching, and a BucketDeployment that publishes the frontend's build output, with vitest template assertions that prove each property.
1. An uploads bucket construct under `construct/`: a private, encrypted S3 bucket for application uploads with every public access route blocked, a lifecycle rule that aborts incomplete multipart uploads, and owner plus environment tags, with vitest template assertions that prove each property.
1. Blessed configuration templates under `templates/config/` for biome and TypeScript.
1. Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.

## Laws implemented

This pack implements three laws:

1. EEP-SEC-04: both buckets encrypt at rest and deny plaintext transport, and the distribution redirects every viewer to HTTPS and reaches its private origin through an origin access control.
1. EEP-SEC-03: the site bucket is readable only by its one distribution through an origin access control and a source scoped bucket policy, and the uploads bucket grants the task role the exact read and write it uses and no more.
1. EEP-COST-01: the buckets and the distribution carry owner and environment tags applied where they are declared.

The how and the why for each law live in `bindings`, one file per law named for its ID: [EEP-SEC-04](bindings/EEP-SEC-04.md), [EEP-SEC-03](bindings/EEP-SEC-03.md), and [EEP-COST-01](bindings/EEP-COST-01.md).

It declines thirteen laws, each with a recorded reason in `pack.yaml`. They are the laws scoped to the application the backend pack owns or to the pipeline the delivery pack owns, rather than to the storage and the edge this pack supplies: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, and EEP-DEVX-01. A project that adopts this pack adopts a backend stack pack and a delivery pack alongside it, and those packs implement the declined laws for the components they own.

## What `provides: storage` means

The manifest declares `provides: storage`. It is the signal the composed init step reads to know this pack supplies object storage and a frontend edge for an application rather than a standalone component. On composition, both constructs are copied into the infra library, the service stack instantiates the uploads bucket and the frontend hosting distribution, passes `UPLOADS_BUCKET_NAME` into the container environment, grants the task role read and write on the uploads bucket, and emits the distribution's HTTPS URL as a stack output. The frontend's build output is published to the site bucket so CloudFront serves the app. The construct assertions are what make that composition safe: they have already shown the buckets are private and encrypted, the distribution is HTTPS only and reaches its origin through an access control, and the resources are attributable.

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| TypeScript strict | tsconfig.json in the scaffold | The two constructs are strict mode TypeScript. |
| aws-cdk-lib v2 | | One library defines the constructs the aws-cdk pack composes, proven by template assertions. |
| npm | | Ships with Node, and npm ci restores the committed lockfile exactly. |
| biome format | templates/config/biome.json | One binary formats and lints the TypeScript sources. |
| biome | templates/config/biome.json | Replaces ESLint and Prettier in a single pass. |
| tsc --noEmit | templates/config/tsconfig.json | A misconfigured construct is a type error before it is a failed deployment. |
| vitest with aws-cdk-lib assertions | | Proves the buckets, the distribution, and the tags against the rendered template with no AWS account. |

Nine categories are declined outright with reasons in `pack.yaml`: integration_test, boundaries, api_test, e2e_test, coverage, mocking, logging, tracing, and hooks.

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at `STACK.md`; the eep CLI is an accelerator, not a requirement. Both constructs are plain aws-cdk-lib and import into any CDK app: the frontend hosting construct takes an owner, an environment, and the path to the built site, and the uploads bucket construct takes an owner and an environment. The construct assertions are the whole proof, and they run locally with no AWS account, because they synthesize the CloudFormation template in process and read it back.

## Related

- Law IDs implemented: EEP-SEC-04, EEP-SEC-03, EEP-COST-01; declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, EEP-DEVX-01.
- Packs: react (the frontend whose build output the distribution serves); python-fastapi and typescript-node (the backends whose task role writes to the uploads bucket); aws-cdk (the platform pack that composes both constructs into its service stack).

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
