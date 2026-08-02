# Governance

This file states who decides what in the Engineering Excellence Program, how
rights are earned, and what ceremony each kind of change carries. Read it before
proposing anything that outlives a single pull request. The short version: packs
are cheap to add on purpose, doctrine is expensive to change on purpose, and
nothing that a machine can decide is left to a meeting.

## The contribution ladder

Rights are earned by contribution, and every rung is reachable from the one
below it without an invitation, except the last.

| Rung | Earned by | Rights |
|---|---|---|
| Contributor | One merged pull request | Named in the generated attribution, alongside the documents you wrote |
| Pack maintainer | Authoring a pack, or adopting one that has no maintainer | Merge rights on that pack directory |
| Domain steward | Sustained doctrine contribution in one domain | Reviews law changes in that domain |
| Core maintainer | Invitation | Schemas, the Constitution, and releases |

A pack maintainer owns the directory they authored: its toolchain, its bindings,
its checks, and the review of changes to them. A domain steward owns the
argument in one doctrine domain, such as security or testing, and is the person
a law change in that domain has to convince. Core maintainers hold the pieces
that every pack depends on, which is why that rung is by invitation rather than
by volume.

## Change rules

| Concern | Rule |
|---|---|
| Adding a pack | One pull request adding one directory. Must pass `pack validate` and touch no existing file. Reviewed by any maintainer. Low ceremony by design: this is the growth path. |
| Adding a law | Open an issue and let the discussion settle first. Every existing pack inherits the new obligation, so agreement precedes code. |
| Changing a law statement | Major version bump on the doctrine domain plus a migration note. Never edited in place. |
| Changing a pack's blessed toolchain | Minor bump when configs translate mechanically, major when consumers must act. A migration note is required either way. |
| Retiring a law | Set its status to `deprecated` and point the replacement at it with `supersedes`. IDs are never reused. |
| Versioning | Program level semver, plus independent semver per doctrine domain and per pack. Consumers pin the program, and packs resolve compatibly within it. |
| Breaking change | Any change that turns a previously passing repository red. Requires a major version bump, a migration guide, and a codemod wherever one is mechanically possible. |

Two of those rules carry most of the weight, so they are worth stating plainly.

A law statement is never edited in place because consumers pin the program and
read the pinned text. Editing a statement silently changes what a consumer
agreed to, and no version number would record it. A change ships as a new
version of the domain with a migration note that says what moved, what will now
fail, and what to do about it. Law IDs are immutable for the same reason: an ID
appears in generated agent instructions, in waivers, and in commit history, and
a reused ID makes all of that lie.

A breaking change is defined by its effect, not its intent. If a repository that
passed `eep verify` yesterday fails today because of something we shipped, that
is breaking, whether the cause was a new law, a tightened threshold, a renamed
flag, or a stricter check on an existing law. It requires a major bump, a
migration guide a consumer can follow without reading our source, and a codemod
whenever the migration is mechanical. Adding a pack is never breaking, which is
exactly why the growth path is the cheap one.

## Maintainer

The current maintainer is [@samar1066](https://github.com/samar1066).
