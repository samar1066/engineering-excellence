# Engineering Excellence Program

Doctrine, packs, and tooling that tell AI coding agents the right way to build
software: any language, any platform, any stage of a codebase's life.

Status: foundations under construction. The first stable release ships the
Constitution, the doctrine corpus, the python-fastapi, typescript-node, and
react packs, and the eep CLI.

In an adopting repository, configuration authority is `.eep/lock.yaml`; `eep.yaml` is a human readable record only.

## Quickstart

1. Clone this repository and change into it.
2. Run `cd tools/eep`, then `npm ci`.
3. Run `npx tsx src/index.ts init myproject --dir ../../..` to scaffold a new, compliant project beside this checkout.
4. Run `cd ../../../myproject`, then `make setup` and `make test`. Until `eep-cli` ships on npm, the full gate is `npx tsx <path to this checkout>/tools/eep/src/index.ts verify`, run from the project directory. Once published, `npm install -g eep-cli` puts the `eep` command on your PATH and `make verify` works as written.

License: Apache-2.0. Authored and maintained by @samar1066.
