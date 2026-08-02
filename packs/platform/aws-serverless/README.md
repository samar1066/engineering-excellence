---
title: aws-serverless
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

# aws-serverless

A Tier 1 platform pack that binds the Engineering Excellence Program to AWS serverless infrastructure declared with CDK v2 in TypeScript. A repository matches this pack when `infra-serverless/cdk.json` exists. The pack ships one HTTP API on Amazon API Gateway backed by AWS Lambda, instantiated once per environment (`dev`, `uat`, `prod`), plus the golden path an agent reads before changing any of it and the executable checks that prove the two laws it implements.

This is the serverless alternative to the aws-cdk pack's Fargate path. The two may coexist in one repository, since they claim different component directories (`infra/` and `infra-serverless/`); `STACK.md` covers when to choose which.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before writing any infrastructure code here, including the promotion contract and the AWS Lambda Powertools upgrade for real handlers.
- A runnable CDK v2 scaffold under `scaffold/` with three environments, one parameterized API stack, an inline handler that keeps `cdk synth` free of bundlers, and template assertions that run with no credentials.
- Blessed configuration templates under `templates/config/` for TypeScript and biome.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.
- One command entry points in the scaffold `Makefile`: `make setup`, `make test`, `make synth`, `make verify`.

## Laws implemented

This pack implements two laws:

- EEP-IAC-01
- EEP-DLV-04

The how and the why for each law on this platform live in `bindings/<LAW-ID>.md`, one file per law above.

It declines the thirteen stack scoped laws, each with a recorded reason in `pack.yaml`: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, and EEP-DEVX-01. In a composed repository each of those belongs to the application component's pack or to the delivery pack, so every law keeps exactly one owner and no law is proved twice from the wrong directory.

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| npm | | Ships with Node, and npm ci restores the committed lockfile exactly. |
| CDK v2 with aws-cdk-lib on TypeScript | | The infrastructure language and construct library; not a toolchain schema category, so it is recorded here. |
| biome format | templates/config/biome.json | One binary formats and lints, so the two can never disagree. |
| biome | templates/config/biome.json | Replaces ESLint and Prettier in a single pass, with no plugin graph to maintain. |
| tsc --noEmit | templates/config/tsconfig.json | Strict from the first file catches a wrong construct property before synthesis does. |
| vitest with the aws-cdk-lib assertions module | | Asserts over the synthesized template, which is the artifact AWS actually receives. |
| cdk synth over every stage | | Renders dev, uat, and prod from a clean checkout with no credentials and no bundler. |
| cdk deploy into a sandbox account, then a request against the stack's ApiUrl output | | The only proof that survives a real deployment; run against an account rather than shipped in this scaffold. |
| aws-lambda-powertools logger | | Structured JSON with invocation context inside handlers; the inline scaffold handler prints the same shape until the first bundled handler pulls the library in. |
| AWS X-Ray active tracing with the aws-lambda-powertools tracer | | The function opts into X-Ray in the scaffold, and the tracer adds handler subsegments to that segment. |

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at `STACK.md`; the eep CLI is an accelerator, not a requirement. The scaffold's `make verify` reaches the full gate either way: it runs an installed `eep` when there is one and otherwise falls back to `npx engineering-excellence verify`, so Node 22 is its only extra prerequisite. Without Node at all there is no scaffold to run, since the CDK CLI is a Node program. The one shell check, `npm run synth`, is a plain command you can run by hand; the single builtin check is implemented inside the CLI and runs only through `eep verify`. The scaffold's `package.json`, `README.md`, and `bin/app.ts` ship with a `{{project_name}}` placeholder, so `make setup` works once `eep init` has rendered it or you have substituted the token by hand. Adopted alone, this pack proves the two infrastructure laws only; the thirteen declined laws stay unproved until a stack pack or a delivery pack joins the repository.

## Related

- Law IDs: EEP-IAC-01, EEP-DLV-04; declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, EEP-DEVX-01.
- Packs: aws-cdk (the Fargate path this pack is the alternative to), github-actions (the delivery pack that promotes the artifact this one synthesizes). This pack requires no other packs.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
