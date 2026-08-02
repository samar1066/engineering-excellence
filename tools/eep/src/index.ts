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

export function buildProgram(): Command {
  const program = new Command();
  program.name("eep").description("Engineering Excellence Program CLI").version(VERSION);
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
