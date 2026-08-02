# Contributing

This repository accepts work from people the maintainers have never met, and the
corpus does not drift, because of one premise: machines review format so that
maintainers review judgment. Every pack is held to an executable contract, every
document to a style law with a check behind it, and both run in CI before a
human reads your pull request. Your job is to bring the judgment. The
conformance suite handles the rest, and it will tell you exactly what it wants.

## Adding a framework pack

This is the growth path and the lowest ceremony contribution here. A new
framework is one directory, not a redesign.

1. Create `packs/<kind>/<name>`, where kind is `stack`, `platform`, or
   `delivery`, and name is the framework as its own community writes it.
2. Copy `packs/stack/react/` or `packs/stack/python-fastapi/` and work from
   there. They are the reference packs: manifest, standalone README, the
   `STACK.md` golden path an agent reads, one binding file per implemented law,
   an executable check per law in `checks/manifest.yaml`, blessed tool configs
   under `templates/config/`, and a scaffold that already passes its own gate.
3. Answer every toolchain category or decline it with a reason. Silence is a
   validation failure, and so is naming a linter without shipping its rules.
4. Pass `pack validate`. The suite checks the manifest against its schema, that
   every implemented law has both a binding and a check, that every applicable
   law is implemented or explicitly declined, that no binding restates a law,
   and that nothing in the pack references a file outside it.
5. Touch no existing file. A pull request that adds a pack adds one directory.
   If you find yourself editing something shared to make your pack work, that is
   a signal about the contract, so open an issue about the contract instead.
6. Sign your work. Name yourself in the `authors` list in `pack.yaml` and in the
   frontmatter of the documents you write. Attribution is generated from there,
   so you write your name once and it appears in the pack README credits and in
   the release notes.

## Development setup

1. Clone the repository:
   `git clone https://github.com/samar1066/engineering-excellence.git`.
2. Change into `tools/eep`. The CLI and both validators live there, and every
   command below is run from that directory.
3. Install the pinned dependencies with `npm ci`.
4. Run the test suite with `npx vitest run`.
5. Validate the corpus with `npx tsx src/index.ts corpus validate`. It scans
   every markdown file in the tree for style violations, missing READMEs, law
   frontmatter, and pack containment.
6. Validate a pack with
   `npx tsx src/index.ts pack validate ../../packs/stack/react`, substituting
   your own pack directory. CI runs the same command over every pack in the
   tree, so a pack that lands unvalidated does not exist.

Both validators print one line per violation with the file, the line, and the
rule, then exit non zero. Green locally means green in CI.

## The writing style laws that CI enforces

These apply to every markdown file in this repository and to every document the
program generates.

1. No dash punctuation. The characters U+2014 and U+2013 are banned corpus wide
   and checked on every line, including inside code blocks. Do not simulate one
   with a spaced hyphen either. Use a colon, a comma, parentheses, or a new
   sentence.
2. Ordered lists start at 1. So do layer labels, wave labels, and every other
   numbered sequence. Zero based labels do not appear in documents.
3. Hyphens belong inside identifiers only: law IDs, pack names, file names, CLI
   flags, and tool names. Prose uses plain words, so write open source as two
   words and machine readable as two words.
4. Attribution frontmatter goes on every governed document: the laws under
   `doctrine/` and every markdown file inside a pack carry `title`, `version`,
   `status`, `authors`, `maintainers`, `created`, and `updated`, plus the
   attribution footer. Community files at the repository root, this one
   included, carry none.

## Doctrine changes

Doctrine is heavier by design, because every pack inherits it and every consumer
repository is gated by it.

1. Open an issue first and let the discussion settle before you write anything.
   A new law is an obligation on every pack that already exists, so agreement
   comes before code.
2. A law statement is never edited in place. Changing what a law says is a major
   version bump on its doctrine domain plus a migration note, so that a consumer
   who pinned the old statement can see what moved and when.
3. Law IDs are immutable and never reused. Retiring a law means setting its
   status to `deprecated` and pointing its replacement at it with `supersedes`.
   An ID that meant one thing in 2026 means that same thing forever.

## What to expect in review

The conformance suite runs first: the test suite, the linter, `corpus validate`,
and `pack validate` over every pack. Read what it reports and fix it before you
ask for a human, because a maintainer will not spend a review round on something
a command already told you.

Once it is green, review is about judgment. Expect questions about whether the
toolchain choice is defensible against the alternatives, whether the check
actually proves the law rather than approximating it, whether the golden path is
the one you would genuinely follow, and whether the prose earns its space. Bring
evidence and the review is short.
