---
title: EEP-SEC-04 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

## How this pack satisfies it

The sensitive data a user pool holds is its directory of identities and the material that proves each one, and this pack protects both where they rest and on every leg they travel. At rest, Cognito encrypts the directory with AWS managed keys as an account default and never stores a password in the clear, only a salted hash; the construct in `construct/user-pool.ts` then fixes a twelve character password policy across four character classes and turns advanced security enforcement on, so the stored secret is expensive to reverse and a compromised credential is detected on the next sign-in. These are declared explicitly on the construct rather than left to a default, so they are visible in the rendered template and an assertion can hold them in place. On the wire, every hop to Cognito is TLS: sign-up, sign-in, and token issuance all cross the encrypted regional endpoint, and the backend guard in `wiring/*/` fetches the pool's public keys only from the `https` JWKS URL built from configuration, with no plaintext endpoint to fall back to. The bearer tokens the guard accepts are short lived, so a token observed on a compromised leg ages out within the hour rather than standing indefinitely.

## The check

`npm run test:construct -- -t "advanced security and a strong password policy"` (see `checks/manifest.yaml`) synthesizes the construct into a CloudFormation template with vitest and the aws-cdk-lib assertions module, then asserts that the pool sets `UserPoolAddOns.AdvancedSecurityMode` to `ENFORCED` and declares a password policy of at least twelve characters requiring lowercase, uppercase, digits, and symbols. It needs no AWS credentials and reaches no AWS account, so it runs the same on a contributor's machine and in continuous integration. A failure means the pool stopped enforcing the credential protections this law depends on, which is a real regression rather than a flaky environment.

## Notes for agents

When you compose this pool into the aws-cdk service stack, keep the password policy and advanced security on the construct rather than relaxing them somewhere upstream, so the assertion stays true of the resource that actually deploys. Never point the backend guard at anything but the pool's real `https` JWKS endpoint: the region and pool id come from configuration, and rewriting them to reach a token verifier over plaintext is how the in transit guarantee is lost. If you add a second pool for another audience, give it the same policy and advanced security and the same assertion, because a directory whose credential floor is weak walks out in a reversible form the moment its backup is copied.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
