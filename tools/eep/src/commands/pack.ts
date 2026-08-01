import { resolve } from "node:path";
import type { Command } from "commander";
import { validatePack } from "../lib/pack.js";

export function register(program: Command): void {
  const pack = program.command("pack").description("pack maintenance");
  pack
    .command("validate")
    .description("validate a pack directory against the pack contract")
    .argument("<dir>", "path to the pack directory, relative to the current directory or absolute")
    .action(async (dirArg: string) => {
      const dir = resolve(process.cwd(), dirArg);
      const violations = await validatePack(dir);
      for (const v of violations) console.error(`${v.path}:${v.line ?? 1} ${v.rule} ${v.detail}`);
      console.log(`pack: ${violations.length} violations`);
      if (violations.length > 0) process.exitCode = 1;
    });
}
