---
title: EEP-SEC-03 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

## How this pack satisfies it

The privileges this pack provisions live on the user pool app client, and it is scoped to exactly what a first-party sign-in performs and nothing more. The client in `construct/user-pool.ts` enables only two authentication flows, SRP and refresh, and leaves the admin and plain-password flows off, so it can start a sign-in and renew a session but cannot be driven to authenticate a user by password on the caller's behalf. It generates no static client secret, so there is no long-lived credential to leak, and it suppresses user existence errors, so the pool is not a directory an attacker can enumerate for valid accounts. The hosted-UI OAuth grants are switched off too, along with their broad default scopes and the placeholder callback, because a first-party SRP client uses none of them. The service that consumes the tokens is scoped the same way from the other side: validating a Cognito access token reads the pool's public JWKS over HTTPS and verifies a signature locally, which needs no AWS permission at all, so the task role this pack composes beside carries no grant to reach Cognito. Each of these is declared where the resource is created, so the permission set reads as a list of exactly what the client touches.

## The check

`npm run test:construct -- -t "minimal auth flows"` (see `checks/manifest.yaml`) synthesizes the construct into a CloudFormation template with vitest and the aws-cdk-lib assertions module, then asserts three things about the app client: that its `ExplicitAuthFlows` contain the SRP and refresh flows, that `PreventUserExistenceErrors` is enabled, and that it holds no generated secret. It also asserts, with a negated array matcher, that the admin and plain-password flows are absent, so widening the client to a broader flow reddens the check the moment the new flow appears. It needs no AWS credentials and reaches no AWS account.

## Notes for agents

When you add a flow to the client, add it because a path in the application uses it, not to clear a permission error during development, and add its assertion alongside so the grant stays a description of what the client does. Keep the client secretless: a public SRP client that embeds no secret is the least privilege shape for a browser or mobile front end, and switching on a secret invites one to be committed. Do not reach for an IAM grant to validate tokens in the service; the JWKS is public and the verification is local, so a task that only authenticates callers needs no Cognito permission, and adding one is access the component does not use.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
