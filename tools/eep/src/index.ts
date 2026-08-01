#!/usr/bin/env node
import { Command } from "commander";
import { register as registerCorpus } from "./commands/corpus.js";
import { VERSION } from "./version.js";

export function buildProgram(): Command {
  const program = new Command();
  program.name("eep").description("Engineering Excellence Program CLI").version(VERSION);
  return program;
}

const program = buildProgram();
// command modules register themselves here in later tasks
registerCorpus(program);
program.parseAsync(process.argv);
