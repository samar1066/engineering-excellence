# Security Policy

The Engineering Excellence Program ships a CLI that runs commands and writes
files inside other people's repositories. That is a privileged position, so it
gets a real policy. This file states which versions are supported, how to report
a vulnerability privately, what we consider in scope, and what response you
should expect.

## Supported versions

| Version | Supported |
|---|---|
| The latest minor of `engineering-excellence` on npm | Yes |
| Anything older | No: upgrade to the latest minor first |

We fix forward. A confirmed vulnerability is fixed in the next patch of the
latest published minor, and older minors are not backported. If you are pinned
to an older version and cannot move, say so in your report and we will tell you
honestly whether a workaround exists.

## Reporting a vulnerability

Use GitHub private vulnerability reporting on this repository: open the Security
tab and choose to report a vulnerability. That opens a private channel with the
maintainer and is the preferred route.

Do not open a public issue for anything exploitable, and do not attach a proof
of concept to a public pull request or discussion. If private reporting is not
available to you, write to the maintainer address recorded in the git history
for recent commits, saying only that you have a security report, and the details
can follow on a private channel.

Include what you have: the version, the exact command, the repository shape that
triggers it, and what an attacker gains. A reproduction we can run is worth more
than a description we have to guess at.

## What counts

The CLI does two things that make it worth attacking, and both are in scope.

1. It executes check commands defined by packs. `eep verify` reads a pack's
   `checks/manifest.yaml` and runs the commands it finds there. Anything that
   lets attacker controlled input reach that execution path is in scope:
   injection through a manifest field, a pack or law identifier, a waiver entry,
   a detected project value, or a CLI argument. Getting the CLI to run a command
   the consumer never consented to is the finding.
2. It vendors content into consumer repositories. `eep adopt` and `eep init`
   write files into a repository the program did not author. Anything that
   escapes the intended target directory is in scope: path traversal through a
   pack path, a template or file name, a project name, or a token that is
   substituted into a path.

Also in scope: getting the CLI to read files outside the corpus it was pointed
at, to overwrite a file it was not asked to touch, or to leak credential
material into a generated file, a lock file, or a log line.

Out of scope, and better filed as ordinary issues: a law or check that fails to
catch an insecure pattern in a consumer's own code, which is a bug in a check
rather than a vulnerability in the program; and a vulnerability in a third party
tool that a pack blesses, which belongs upstream first, though we do want to
hear about it so the pack can pin, patch, or move.

## Disclosure timeline

1. Acknowledgment within 7 days of a report arriving through
   https://github.com/samar1066/engineering-excellence/security/advisories
2. Assessment and a fix or mitigation plan communicated within 30 days.
3. Coordinated disclosure within 90 days of the report, or earlier once the
   fixed version is published, whichever comes first.

## What to expect

1. Acknowledgment within 7 days of your report, from a human, confirming we have
   it and are looking.
2. An assessment with our reading of the severity and the blast radius, plus a
   timeline for a fix or a mitigation. The timeline is honest: if something will
   take a while, or if we judge it not worth fixing, we say that and say why
   rather than letting the thread go quiet.
3. Credit in the release notes when the fix ships, unless you would rather not
   be named. Please hold public disclosure until the fixed version is published.
