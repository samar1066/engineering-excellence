---
title: aws-cognito
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# aws-cognito

A Tier 1 platform pack that binds the Engineering Excellence Program to Amazon Cognito as the authentication in front of a backend's routes. A project matches this pack when it carries an `auth/cognito.json`. The pack is of kind `platform` and declares `provides: auth`: its job is to add a request guard that authenticates callers with Cognito access tokens, plus the user pool and app client those tokens come from, without the application above the guard learning that Cognito is the identity provider.

It gives a project three things that fit together: a CDK user pool construct the aws-cdk platform pack composes into its service stack, a request guard in Python and in TypeScript that validates a Cognito access token and turns it into a small typed user, and the test override that keeps the guarded routes green with no real Cognito, because the token validation itself is proven by the guard's own unit test against a mocked JWKS.

## What this pack gives you

- `STACK.md`: the golden path an AI coding agent reads before authenticating a route, from provisioning the pool to protecting a router and keeping the API tests green.
- A user pool construct under `construct/`: a Cognito user pool with email sign-in, a strong password policy, advanced security enforced, account recovery by email, an app client scoped to the SRP and refresh flows with no static secret, and owner plus environment tags, with vitest template assertions that prove each property.
- Request guards under `wiring/python/` and `wiring/typescript/`: `require_user` for the python-fastapi backend and `requireUser` for the typescript-node backend, each reading the pool id, client id, and region from the environment and validating the access token's signature, issuer, expiry, token use, and client id.
- Blessed configuration templates under `templates/config/` for biome and TypeScript.
- Executable checks in `checks/manifest.yaml` that map each implemented law to the command proving it.

## Laws implemented

This pack implements three laws:

- EEP-SEC-04: the pool enforces a strong password policy and advanced security over a directory Cognito encrypts at rest, and every hop to it, including the guard's JWKS fetch, is TLS.
- EEP-SEC-03: the app client is scoped to only the SRP and refresh flows with no static secret, and the service needs no AWS permission to validate a token.
- EEP-COST-01: the pool carries owner and environment tags applied where it is declared.

The how and the why for each law live in `bindings`, one file per law named for its ID: [EEP-SEC-04](bindings/EEP-SEC-04.md), [EEP-SEC-03](bindings/EEP-SEC-03.md), and [EEP-COST-01](bindings/EEP-COST-01.md).

It declines thirteen laws, each with a recorded reason in `pack.yaml`. They are the laws scoped to the application the backend pack owns or to the pipeline the delivery pack owns, rather than to the authentication this pack supplies: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, and EEP-DEVX-01. A project that adopts this pack adopts a backend stack pack and a delivery pack alongside it, and those packs implement the declined laws for the components they own.

## What `provides: auth` means

The manifest declares `provides: auth`. It is the signal the composed init step reads to know this pack supplies an authentication guard for a backend rather than a standalone component. On composition, the guard under `wiring/` is copied into the backend, the notes router is protected with it as a router-level dependency, the backend config is extended to read the pool coordinates from the environment, and the API-test fixture is extended to override the guard with a fake authenticated user, while the user pool construct is composed into the aws-cdk service stack. The test override is what keeps that swap green: it lets the guarded routes run with no real Cognito, because the token validation is proven separately by the guard's own unit test.

## Blessed toolchain

| Tool | Config | Rationale |
|------|--------|-----------|
| TypeScript strict | tsconfig.json in the scaffold | The construct and the TypeScript guard are strict mode TypeScript. |
| python 3.11 | | The Python guard targets the floor the python-fastapi backend declares. |
| aws-cdk-lib v2 | | One library defines the user pool construct the aws-cdk pack composes, proven by template assertions. |
| npm | | Ships with Node, and npm ci restores the committed lockfile exactly. |
| biome format | templates/config/biome.json | One binary formats and lints the TypeScript sources. |
| biome | templates/config/biome.json | Replaces ESLint and Prettier in a single pass. |
| tsc --noEmit | templates/config/tsconfig.json | A misconfigured construct or guard is a type error before it is a failed deployment. |
| vitest with aws-cdk-lib assertions | | Proves the password policy, the least privilege client, and the tags against the rendered template with no AWS account. |

Nine categories are declined outright with reasons in `pack.yaml`: integration_test, boundaries, api_test, e2e_test, coverage, mocking, logging, tracing, and hooks.

## Standalone use

Copy this folder plus CONSTITUTION.md into any repository and point your agent at `STACK.md`; the eep CLI is an accelerator, not a requirement. The user pool construct is plain aws-cdk-lib and imports into any CDK app. The guards are plain code: the Python one needs `python-jose[cryptography]`, the TypeScript one needs `aws-jwt-verify`, and both read the pool id, client id, and region from the environment. The construct assertions and the guard's token-validation test are the whole proof, and both run locally with no AWS account.

## Related

- Law IDs implemented: EEP-SEC-04, EEP-SEC-03, EEP-COST-01; declined: EEP-ARCH-01, EEP-TEST-01, EEP-TEST-03, EEP-SEC-01, EEP-SEC-02, EEP-OBS-01, EEP-OBS-02, EEP-DLV-01, EEP-DLV-02, EEP-DOCS-01, EEP-DOCS-02, EEP-DOCS-03, EEP-DEVX-01.
- Packs: python-fastapi and typescript-node (the backends whose routes this guard protects); aws-cdk (the platform pack that composes the user pool construct into its service stack).

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
