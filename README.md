# Engineering Excellence Program

Doctrine, packs, and tooling that tell AI coding agents the right way to build
software: any language, any platform, any stage of a codebase's life. You point
your agent at one generated file; machines verify the result.

Status: v0.1.0 vertical slice. The python-fastapi pack is complete and proven
end to end. The typescript-node and react packs, more doctrine domains, and the
npm release of the CLI (`eep-cli`, command `eep`) are next.

## What is in this repository

| Piece | Where | What it gives you |
|---|---|---|
| The Constitution | [CONSTITUTION.md](CONSTITUTION.md) | Twelve tenets every agent loads first |
| Doctrine | [doctrine/](doctrine/) | 13 language agnostic laws (`EEP-XXX-NN`) with machine check contracts |
| The python-fastapi pack | [packs/stack/python-fastapi/](packs/stack/python-fastapi/) | The golden path ([STACK.md](packs/stack/python-fastapi/STACK.md)), a proven scaffold, blessed tool configs, one binding per law |
| Profiles | [profiles/](profiles/) | greenfield (everything blocks) and evolving (clean as you code) |
| The eep CLI | [tools/eep/](tools/eep/) | init, adopt, verify, explain, plus the validators that gate this repo itself |

## Requirements

1. Node 22 or newer (the CLI).
2. [uv](https://docs.astral.sh/uv/) and Python 3.11 or newer (the python-fastapi pack).
3. git.

Until `eep-cli` ships on npm, run the CLI from this checkout with `npx tsx`.
After `npm install -g eep-cli` exists, every command below shortens to `eep ...`.

## Start a new service

1. Clone this repository and change into it.
2. Run `cd tools/eep`, then `npm ci`.
3. Run `npx tsx src/index.ts init myproject --dir ../../..` to scaffold a new, compliant project beside this checkout.
4. Run `cd ../../../myproject`, then `make setup` and `make test`.

You now have a running FastAPI service with the five layer structure, a worked
example feature, tests above the 85 percent gate, structured logging with
correlation ids, tracing, CI, a pre-commit hook, and two generated agent
instruction files: `CLAUDE.md` and `AGENTS.md`. Open your AI agent in that
directory and type a feature request. Nothing else is needed.

## Adopt an existing FastAPI project

1. From this checkout, run `cd tools/eep`, then `npm ci` (once).
2. Change into your project's root directory.
3. Run `npx tsx <path to this checkout>/tools/eep/src/index.ts adopt`.

Adopt detects FastAPI from your `pyproject.toml`, prints exactly what it will
write, and asks before touching anything (pass `--yes` to skip the prompt, for
example in scripts). It then writes:

1. `.eep/` : the vendored laws, pack, profiles, and schemas, pinned by `.eep/lock.yaml`. Configuration authority lives here; `eep.yaml` is a human readable record only.
2. `CLAUDE.md` and `AGENTS.md` : the generated agent instructions.
3. `.git/hooks/pre-commit` : runs the gate on changed files before every commit.

The default profile is evolving: new and modified code must comply, untouched
legacy is not judged, and your delivery never stops. Pass
`--profile greenfield` to make every law block everywhere.

## Use it with zero tooling

Copy `CONSTITUTION.md` and the folder `packs/stack/python-fastapi/` into any
repository and point your agent at the pack's `STACK.md`. Every pack is self
contained plain markdown; the CLI is an accelerator, not a requirement.

## The gate

From an adopted or scaffolded project:

```
$ eep verify        (today: npx tsx <checkout>/tools/eep/src/index.ts verify)
PASS EEP-ARCH-01 ok
PASS EEP-SEC-01 no credential material in 94 scanned files
PASS EEP-TEST-03 ok
SKIP EEP-DOCS-03 Corpus scoped law; consumer repositories are not required to index every directory.
verify: 0 failed, 0 warnings
```

Failures name the law, the file, and the line. When one puzzles you or your
agent, ask the corpus why the rule exists:

```
$ eep explain EEP-TEST-03
```

The generated `CLAUDE.md` ends with the same loop, so agents run it on their
own: verify before declaring work done, explain on failure, fix the cause.

## Deviations are declared, never silent

Cannot comply yet? Waive it in the open, in `.eep/waivers.yaml`:

```yaml
- law: EEP-DOCS-02
  scope: "docs/legacy/**"
  justification: "Imported vendor documentation, rewrite scheduled."
  owner: "@samar1066"
  created: 2026-08-01
  expires: 2026-11-01
```

Waived failures report as WAIVED with the original evidence preserved. Expired
waivers turn back into failures plus a blocking `EEP-GOV-WAIVER`. Laws marked
never waivable (`EEP-SEC-01`, secrets in version control) refuse waivers by
name.

## Command reference

| Command | Purpose |
|---|---|
| `init <name> [--pack python-fastapi] [--dir <target>]` | New compliant project in one command |
| `adopt [--profile evolving\|greenfield] [--yes]` | Onboard the current directory |
| `verify [--changed]` | Run every active law check; exit 1 on blocking failures |
| `explain <LAW-ID>` | Print the law and the active pack's binding for it |
| `corpus validate` | Contributor gate: style, frontmatter, READMEs, containment |
| `pack validate <dir>` | Contributor gate: the pack contract, end to end |

## Contributing

Packs are the extension point: one directory per technology, added without
touching any existing file, held to an executable contract (`pack validate`).
Read [packs/stack/python-fastapi/](packs/stack/python-fastapi/) as the
reference implementation. Doctrine changes are heavier by design, since every
pack inherits them. Everything in this repository passes its own gates in CI:
the corpus validator, the pack validator, 122 tests, lint, and the same writing
style laws it publishes.

## License

Apache-2.0. Authored and maintained by [@samar1066](https://github.com/samar1066).
