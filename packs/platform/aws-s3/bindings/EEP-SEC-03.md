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

The site bucket in `construct/frontend-hosting.ts` is private and has exactly one reader. Every public access route is blocked, so no ACL and no bucket policy can ever open an object to the internet, and the bucket is never a website endpoint. The distribution reaches it through an origin access control, which signs each origin request with SigV4, and the bucket policy CloudFront generates for it allows only `s3:GetObject` to the CloudFront service principal, scoped by an `AWS:SourceArn` condition to this one distribution. The result is a reader set of one: this distribution, and nothing else, can read the objects, which is narrower than a legacy origin access identity and far narrower than a public bucket. The uploads bucket is scoped the same way from the other side. It grants no standing access of its own; the service task role is handed read and write on that one bucket where the stack composes it, through `grantReadWrite`, so the role holds a policy naming exactly that bucket and the two actions it uses rather than a wildcard over the account's storage. Each of these is declared where the resource is created, so the permission set reads as a list of exactly what each principal touches.

## The check

`npm run test:construct -- -t "restricts bucket reads to the distribution through an origin access control"` (see `checks/manifest.yaml`) synthesizes the frontend hosting construct into a CloudFormation template with vitest and the aws-cdk-lib assertions module, then asserts three things: that exactly one `AWS::CloudFront::OriginAccessControl` is rendered with SigV4 signing always on, that the site bucket policy allows `s3:GetObject` to the `cloudfront.amazonaws.com` principal under a `StringEquals` condition on `AWS:SourceArn`, and, alongside it, that every public access setting on the bucket is on. It needs no AWS credentials and reaches no AWS account, so widening the reader set, dropping the source ARN condition, or opening public access all redden the check the moment they appear.

## Notes for agents

When you grant the service access to the uploads bucket, grant the least it uses: `grantReadWrite` on the one bucket, not a broad policy over every bucket in the account, and add read or write only where a path in the application actually reads or writes. Keep the site bucket private and behind the origin access control; do not switch it to a public website endpoint or attach a bucket policy that widens the reader beyond the distribution, because a public origin is access the design does not need and cannot take back once an object is indexed. If you add a distribution or a bucket, scope its policy the same way and add the same assertion, so the grant stays a description of what the principal does.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
