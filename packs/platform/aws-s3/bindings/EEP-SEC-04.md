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

Both buckets this pack provisions turn server side encryption on where they are declared, so every object sits as ciphertext on the volume that holds it and a copied snapshot or a relocated backup carries out nothing readable. The `construct/uploads-bucket.ts` and `construct/frontend-hosting.ts` constructs declare the encryption explicitly rather than leaning on an account default, so the property is visible in the rendered template and cannot silently regress when a default changes underneath it. Protecting the same objects while they move is handled at two hops. The uploads bucket sets `enforceSSL`, which renders a bucket policy that denies any request whose `aws:SecureTransport` is false, so a caller cannot reach an object over plain HTTP and the only path to it is a TLS one. The served frontend is protected at the public hop by the distribution: its viewer protocol policy redirects a viewer arriving over HTTP to HTTPS rather than answering in the clear, and the distribution reaches its private origin bucket over the AWS network through an origin access control, so neither the browser hop nor the origin hop is unencrypted. There is no plaintext endpoint for a caller to fall back to on either bucket, so the encrypted hop is the only hop.

## The check

Two checks in `checks/manifest.yaml` cover the two halves of this law, each synthesizing a construct into a CloudFormation template with vitest and the aws-cdk-lib assertions module and reaching no AWS account. `npm run test:construct -- -t "encrypts objects at rest and rejects plaintext transport"` asserts that the uploads bucket carries an `SSESpecification` with encryption enabled and a bucket policy statement that denies transport when `aws:SecureTransport` is false, which is the at rest and the in transit guarantee for the store. `npm run test:construct -- -t "serves the site only over HTTPS"` asserts that the distribution's viewer protocol policy is `redirect-to-https`, which is the in transit guarantee at the edge. A failure in either means a construct stopped declaring a protection this law depends on, which is a real regression rather than a flaky environment.

## Notes for agents

When you compose these constructs into the aws-cdk service stack, keep the encryption and the TLS enforcement on the constructs rather than reaching for an option somewhere upstream, so the assertions stay true of the resources that actually deploy. Never relax the site bucket to a public website endpoint to skip CloudFront: that trades the encrypted, access controlled origin hop for a plaintext public one and reopens exactly what this law closes. If you add a second bucket for a new kind of object, give it the same encryption and the same `enforceSSL`, and add the same assertions, because an unencrypted store on a private network still walks out in readable form the moment its backup is copied.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
