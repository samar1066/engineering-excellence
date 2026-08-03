---
title: aws-s3 golden path
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

# aws-s3 golden path

## Purpose

This is the golden path for serving a frontend through CloudFront and storing an object in an uploads bucket in a project built from the aws-s3 pack: read it before you add hosting or a store for uploads. It is written for the AI coding agent or engineer who has a built single page app and a backend, and now needs the app served over HTTPS and a private bucket the backend can write to. Every path and command below exists in this pack's scaffold, so copy working patterns from it instead of inventing new ones. The pack supplies storage and an edge for an application it sits beside; it does not scaffold the application, and the frontend it serves and the backend it stores for are the stack packs', not its own.

## Project shape

The storage component is one small project. One line per directory, one responsibility each:

```
storage/
  s3.json                    the detect marker and the shared names: the uploads bucket env var, the frontend build dir, the app entrypoint
  construct/
    frontend-hosting.ts       the private site bucket, the CloudFront distribution with an origin access control, the HTTPS redirect, the SPA error mapping, and the BucketDeployment
    frontend-hosting.test.ts  vitest assertions over the rendered template: private and encrypted bucket, HTTPS only, origin access control, SPA error mapping
    uploads-bucket.ts         the private uploads bucket: encryption, every public access route blocked, abort incomplete multipart uploads, tags
    uploads-bucket.test.ts    vitest assertions over the rendered template: encryption, public access block, tags
    fixtures/site/            a tiny built site so the deployment stages a real directory in the assertions
  package.json                the Node project for the constructs
  tsconfig.json
  biome.json
  vitest.config.ts
```

The constructs are the only code that knows S3 and CloudFront are behind the served app and the uploads. Everything above them, the frontend in the browser and the backend that writes an object, speaks a URL and a bucket name and never learns which edge or which store answered.

## The rules of the shape

Three rules keep the seam honest.

Private by default. Neither bucket is ever public. The site bucket is reached only by its distribution through an origin access control, and the uploads bucket is reached only by a principal granted an explicit scope. A public bucket, or a bucket served as a website endpoint, is the antipattern this pack exists to avoid: it trades an encrypted, access controlled origin for a plaintext public one.

The edge is the only public door. A viewer reaches the app through CloudFront over HTTPS, never the bucket directly. The distribution redirects an HTTP viewer to HTTPS, serves the app entrypoint as the default root object, and rewrites a 403 or a 404 to that entrypoint with a 200 so a deep link resolves in the browser's router rather than showing an error.

The backend reaches uploads by grant, not by key. The service writes to the uploads bucket with its task role, which the stack grants read and write on that one bucket, and it reads the bucket name from `UPLOADS_BUCKET_NAME`. No access key is embedded anywhere, and the role's policy names exactly that bucket and the actions it uses.

## Serving a frontend and storing an upload

Work from the edge inward. This is the exact order, using the composed full stack app as the worked example:

1. Provision the hosting. Copy `construct/frontend-hosting.ts`: a private, encrypted site bucket, a CloudFront distribution that reaches it through an origin access control, a redirect to HTTPS, the app entrypoint as the default root object, the single page app error mapping, and a BucketDeployment. Compose it into the aws-cdk service stack so it deploys beside the service, and keep its assertions in `frontend-hosting.test.ts`.
2. Publish the build. The BucketDeployment uploads the frontend's build output and invalidates the distribution, so build the frontend before you synth the infra. When the build directory is absent the bucket and the distribution still provision and only the upload is skipped, so a first synth is never blocked on a build that has not run; the deploy that follows a build serves the app.
3. Provision the uploads bucket. Copy `construct/uploads-bucket.ts`: a private, encrypted bucket with every public access route blocked, a lifecycle rule that aborts incomplete multipart uploads, and owner plus environment tags. Compose it into the service stack.
4. Pass the name and grant the role. The stack hands the container `UPLOADS_BUCKET_NAME` and grants the task role read and write on that one bucket with `grantReadWrite`. The service trusts the same bucket the stack provisions because it reads the same name, and it needs no access key because the role carries the grant.
5. Store an object from the backend. Read the bucket name from the environment and use the AWS SDK's S3 client to put the object. The task role already carries the read and write it needs, so nothing here holds a static credential:

   ```python
   import os

   import boto3

   s3 = boto3.client("s3")
   bucket = os.environ["UPLOADS_BUCKET_NAME"]

   def store_upload(key: str, body: bytes, content_type: str) -> None:
       s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
   ```

   In the typescript-node backend the same call is `new S3Client({}).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))`, with the bucket read from `process.env.UPLOADS_BUCKET_NAME`.
6. Emit and read the URL. The stack emits the distribution's HTTPS URL as a `CfnOutput`, which is the address a browser loads and a smoke test fetches after a deploy.
7. Prove the shape. Run `npm run test:construct` to prove the buckets are private and encrypted, the distribution is HTTPS only and reaches its origin through the access control, the single page app error mapping is present, and the resources carry their tags.

The smallest complete example of this loop is the composed app itself: the frontend build is served through the distribution, and the backend writes to the granted bucket, with the construct assertions covering both halves against a rendered template so the proof needs no AWS account.

## Toolchain

The blessed tools. Do not substitute alternatives without a waiver.

| Category | Tool | Command |
|----------|------|---------|
| Language | TypeScript strict | `npm run build` |
| Infrastructure library | aws-cdk-lib v2 | `npm run test:construct` |
| Package manager | npm | `npm ci` |
| Formatter | biome format | `npx biome format --write .` |
| Linter | biome | `npm run lint` |
| Type checker | tsc --noEmit | `npm run build` |
| Unit tests | vitest with aws-cdk-lib assertions | `npm run test:construct` |

Daily work drives through a few commands:

1. `npm ci`: install the Node project.
2. `npm run test:construct`: assert on the rendered bucket and distribution templates, credential free.
3. `npm run build`: typecheck the constructs.

None of these needs Docker or an AWS account: the construct assertions synthesize the templates in process, including the BucketDeployment against the tiny site fixture, and read them back.

## What verify checks here

`make verify` runs every check in `checks/manifest.yaml`, from the `storage` directory. All four are shell checks you can run by hand while iterating:

| Law | Kind | Command |
|-----|------|---------|
| EEP-SEC-04 | shell | `npm run test:construct -- -t "encrypts objects at rest and rejects plaintext transport"` |
| EEP-SEC-04 | shell | `npm run test:construct -- -t "serves the site only over HTTPS"` |
| EEP-SEC-03 | shell | `npm run test:construct -- -t "restricts bucket reads to the distribution through an origin access control"` |
| EEP-COST-01 | shell | `npm run test:construct -- -t "tags the uploads bucket with an owner and an environment"` |

Each synthesizes a construct in process and reads the rendered template, so none needs an AWS account. They prove the encryption and TLS enforcement on the store and the edge, the least privilege of the site bucket behind its origin access control, and the attribution tags the resources carry.

Thirteen laws are declined by this pack rather than implemented, because they are scoped to the application the backend pack owns or to the pipeline the delivery pack owns. The reasons are recorded one by one in `pack.yaml` and summarized in the pack README.

## When you deviate

The golden path is the default, not a cage. When a rule genuinely does not fit, declare a waiver in `.eep/waivers.yaml` naming the law ID, an owner, and an expiry date, with a sentence on why. Never suppress a check inline without a matching waiver: inline suppressions hide deviations, while waivers keep them visible, owned, and temporary.

One deviation is worth naming in advance. Serving the site bucket as a public S3 website endpoint instead of a CloudFront distribution with an origin access control is the common shortcut, and it fits nothing here: it makes the bucket public, drops the HTTPS redirect and the single page app error mapping, and reopens exactly what the security laws close. If a stage needs a custom domain or a web application firewall, add it to the distribution, which is the one public door, rather than exposing the bucket.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
