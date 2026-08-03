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

The table construct in `construct/note-table.ts` turns server side encryption on for the DynamoDB table it provisions, so every item sits as ciphertext on the volume that holds it and a copied snapshot or a relocated backup carries out nothing readable. The construct declares the encryption explicitly rather than leaning on an account default, so the property is visible in the rendered template and cannot silently regress when a default changes underneath it. The other half of the law, protecting the data on the wire, is the AWS SDK's own behavior: both the Python `aioboto3` adapter and the TypeScript `@aws-sdk` adapter reach the regional DynamoDB endpoint over TLS on every request, and only the local test double is spoken to in the clear, on a loopback socket that never leaves the host. There is no unencrypted regional endpoint for a caller to fall back to, so the encrypted hop is the only hop.

## The check

`npm run test:construct -- -t "encrypts the table at rest"` (see `checks/manifest.yaml`) synthesizes the construct into a CloudFormation template with vitest and the aws-cdk-lib assertions module, then asserts that the table resource carries an `SSESpecification` with encryption enabled. It needs no AWS credentials and reaches no AWS account, so it runs the same on a contributor's machine and in continuous integration. A failure means the construct stopped declaring encryption, which is a real regression in the property this law protects rather than a flaky environment.

## Notes for agents

When you compose this table into the aws-cdk service stack, keep the encryption on the construct rather than reaching for a table option somewhere upstream, so the assertion stays true of the resource that actually deploys. Never point an adapter at a plaintext endpoint override for anything but DynamoDB Local on loopback: the `endpoint_url` override exists for the local container, and using it against a real deployment is how the in transit guarantee gets lost. If you add a second table for a new entity, give it the same encryption and add the same assertion, because an unencrypted store on a private network still walks out in readable form the moment its backup is copied.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
