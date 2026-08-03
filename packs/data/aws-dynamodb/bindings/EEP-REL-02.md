---
title: EEP-REL-02 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-03
updated: 2026-08-03
---

## How this pack satisfies it

The table construct in `construct/note-table.ts` enables point in time recovery on the DynamoDB table, which is the continuous backup DynamoDB keeps of every write for a rolling window, so any mistaken deletion or corrupting write can be undone by restoring the table to a moment just before it. Point in time recovery restores to any second inside its retention window, so the recovery point objective this store commits to is one second of potential data loss, and that objective is a property of the mechanism rather than a number written down and never tested. Recovery is exercised by restoring into a new table and reading from it, never assumed from the fact that the feature is on, because a backup nobody has restored is a claim rather than a guarantee. Replication across availability zones inside DynamoDB is deliberately not treated as the backup here, since a destructive write is copied to every replica and leaves no earlier state to return to; point in time recovery is what holds that earlier state.

## The check

`npm run test:construct -- -t "keeps point in time recovery"` (see `checks/manifest.yaml`) synthesizes the construct with vitest and the aws-cdk-lib assertions module and asserts that the table declares `PointInTimeRecoveryEnabled` true. It runs with no AWS account, so it proves the definition still enables the backup on every change rather than proving a restore succeeded against a live table, which no synth can. A failure means the construct stopped declaring the backup, which is the exposure this law names.

## Notes for agents

Treat a restore as part of adopting this table, not as a thing to discover during an incident: bring up a copy from point in time recovery at least once so the recovery path is known to work before it is needed. When you add a table for a new entity, enable the same recovery and add the same assertion, because a new persistent store with no backup is a single copy whose loss is permanent. Do not substitute cross region replication or an on demand snapshot schedule for point in time recovery without saying so in the construct and updating this binding, so the recovery point objective the check implies stays honest.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-03*
