---
title: aws-cdk
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# aws-cdk

A Tier 1 platform pack that binds the Engineering Excellence Program, program version 0.2.0, to AWS infrastructure declared with the AWS CDK v2 in TypeScript. A repository matches this pack when it carries an `infra/cdk.json`. The pack gives a project its runtime: a CDK application that deploys the backend api component to AWS Fargate behind an application load balancer, in three stages, `dev`, `uat`, and `prod`, from a single parameterized stack. The containers pack also builds frontend and node service images, and deploying those as additional Fargate services is a documented later revision of this stack rather than something it ships today. It is a platform pack rather than a stack pack, so it sits beside a stack pack (python-fastapi, typescript-node, react) rather than replacing one, and it scaffolds into the `infra` component directory.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before changing anything under `infra/`, including the stage model, the promotion contract, and the cost notes.
- A runnable CDK v2 application under `scaffold/`: a stage table, one Fargate service stack, and template assertions that synthesize each stage in process.
- Blessed configuration templates under `templates/config/` for biome and TypeScript.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.
- One command entry points in the scaffold `Makefile`: `make setup`, `make test`, `make synth`, `make verify`.

## Laws implemented

This pack implements two laws:

- EEP-IAC-01
- EEP-DLV-04

The how and the why for each law in this stack live in `bindings/<LAW-ID>.md`, one file per law above.

It declines thirteen laws, each with a recorded reason in `pack.yaml`. They are the laws scoped to a service component rather than to the infrastructure that runs it: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, and EEP-DEVX-01. A repository that adopts this pack adopts a stack pack and a delivery pack alongside it, and those packs implement the declined laws for the components they own.

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| TypeScript strict | tsconfig.json in the scaffold | A misconfigured construct is a type error before it is a failed deployment. |
| aws-cdk-lib v2 with constructs | | One library, one deployment model, and a preview command that ships with it. |
| npm | | Ships with Node, and npm ci restores the committed lockfile exactly. |
| biome format | templates/config/biome.json | One binary formats and lints, so the two can never disagree. |
| biome | templates/config/biome.json | Replaces ESLint and Prettier in a single pass, with no plugin graph to maintain. |
| tsc --noEmit | templates/config/tsconfig.json | A misconfigured construct is a type error before it is a failed deployment. |
| vitest with aws-cdk-lib assertions | | Synthesizes each stage in process and asserts on the rendered template, so a stage's shape is proven with no AWS account involved. |

The first two rows are declared in `pack.yaml` as the language and iac toolchain entries. Nine categories are declined outright with reasons in `pack.yaml`: boundaries, integration_test, api_test, e2e_test, coverage, mocking, logging, tracing, and hooks.

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at STACK.md; the eep CLI is an accelerator, not a requirement. Copy `scaffold/` to `infra/`, substitute the `{{project_name}}` token, and `npm ci` restores the shipped lockfile. The scaffold's `make verify` reaches the full gate either way: it runs an installed `eep` when there is one and otherwise falls back to `npx engineering-excellence verify`, so Node 22 is its only extra prerequisite. Without Node at all there is no gate to run, since the whole toolchain is Node based; the shell check is `npm run synth`, a plain command you can run by hand, and the one builtin check is implemented inside the CLI. Deploying needs AWS credentials and a bootstrapped account, but synthesizing, testing, and verifying need neither.

## Related

- Law IDs: EEP-IAC-01, EEP-DLV-04; declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, EEP-DEVX-01.
- Packs: python-fastapi, typescript-node, react (the service components this pack deploys); containers-k8s (the image it runs); github-actions (the pipeline that promotes one image through its stages).

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
