#!/usr/bin/env node
import { Command } from "commander";
import { register as registerAdopt } from "./commands/adopt.js";
import { register as registerCorpus } from "./commands/corpus.js";
import { register as registerExplain } from "./commands/explain.js";
import { register as registerInit } from "./commands/init.js";
import { register as registerPack } from "./commands/pack.js";
import { register as registerRoot } from "./commands/root.js";
import { register as registerVerify } from "./commands/verify.js";
import { VERSION } from "./version.js";

/**
 * The program, with positional option parsing turned on.
 *
 * That one call is load bearing. The root framework selector (see commands/root.ts) has to own bare
 * operands, so its options (`--yes`, `--profile`, `--corpus`, `--no-install-offer`) are declared on
 * the program itself. Commander parses the program's options across the whole argument list before
 * it dispatches, so `eep adopt --yes` had `--yes` consumed by the program, and the adopt subcommand
 * ran with its own default of false and refused itself with "refusing to adopt without --yes in non
 * interactive mode". `--profile` was swallowed the same way, silently: `eep adopt --profile
 * greenfield --yes` wrote an evolving lock file. Every flag name the root selector and a subcommand
 * share was affected.
 *
 * enablePositionalOptions stops program option parsing at the first operand that names a
 * subcommand, so everything after `adopt` belongs to adopt. Bare operands are unaffected, which is
 * what keeps `eep fastapi --yes` working: `fastapi` names no subcommand, so the program keeps
 * parsing and takes the flag as its own.
 *
 * The alternative, reading optsWithGlobals() inside each subcommand, was rejected. It leaves the
 * mis-parse in place and papers over it at every call site, so each new subcommand has to remember;
 * and commander merges those globals over locals, which makes a program level default authoritative
 * over a value the subcommand was explicitly given. Fixing the parse fixes it once, for every
 * subcommand, present and future.
 */
export function buildProgram(): Command {
  const program = new Command();
  program.name("eep").description("Engineering Excellence Program CLI").version(VERSION);
  program.enablePositionalOptions();
  return program;
}

const program = buildProgram();
registerCorpus(program);
registerPack(program);
registerAdopt(program);
registerInit(program);
registerVerify(program);
registerExplain(program);
// Registered last, and deliberately so: the root framework selector claims every invocation whose
// first operand does not name one of the subcommands above.
registerRoot(program);
program.parseAsync(process.argv);
