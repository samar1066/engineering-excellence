---
title: EEP-DLV-01 binding
version: 1.0.0
status: stable
authors:
  - { name: Samar Swami, github: "@samar1066" }
maintainers: ["@samar1066"]
created: 2026-08-02
updated: 2026-08-02
---

## How this stack satisfies it

The scaffold ships its own workflow at `.github/workflows/ci.yml`, triggered on
every pull request and on every push to the default branch, so a service
generated from this pack is gated from its first commit rather than after
somebody remembers to add a pipeline. The job installs from the lockfile with
`npm ci` and then runs `npm run test:cov`, which is the same command
`make test` runs locally, so the pipeline and a contributor's machine cannot
drift into two different definitions of passing. Shipping the workflow inside
the service scaffold also means a standalone service repository and a composed
repository both satisfy this law from the directory the pack's checks run in.

## The check

`file-contains-any .github/workflows 'eep verify'` (see checks/manifest.yaml)
is a builtin check that reads every file under the workflows directory and
passes when one of them names the gate. The workflow carries those words in a
comment above the run line, with a note not to delete them, because the full
`eep verify` gate becomes the pipeline's own command once the CLI is installed
there; until then the direct test gate is what actually runs, and the check
still proves a pipeline exists and names the gate it stands in for.

## Notes for agents

If this check fails, add the workflow rather than the words: a comment that
names the gate without a job that runs anything is exactly the advisory
pipeline this law rejects. When you change what verification means locally,
change the workflow in the same commit, since a pipeline that runs a smaller
set of checks than the local gate produces a clean pull request that fails
after merge. Keep the gate fast enough that contributors run it before pushing.

---
*Authored by Samar Swami (@samar1066) · Maintained by @samar1066 · v1.0.0 · Last reviewed 2026-08-02*
