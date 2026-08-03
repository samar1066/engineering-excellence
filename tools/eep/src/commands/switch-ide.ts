import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import {
  componentInstructionFiles,
  generateAgentFiles,
  lockedPackLayout,
  rootSurfaceFiles,
} from "../lib/generate.js";
import { formatToolSelection, resolveToolsNonInteractive, type ToolToken } from "../lib/tools.js";
import type { PackLayout } from "../lib/vendor.js";
import {
  buildEepYamlContent,
  resolveTools,
  toolsFromFlag,
  toWritableProfile,
  type WritableProfile,
} from "./adopt.js";

export type SwitchIdeOptions = {
  targetDir: string;
  // The AI coding tools to switch to, as raw tokens. Undefined prompts the multi select preselected
  // to the current set (in a TTY); non interactively with nothing explicit it keeps the current set,
  // which makes a bare `eep switch-ide` in CI a no op rather than a surprise.
  tools?: string[];
};

export type SwitchIdeResult = { before: ToolToken[]; after: ToolToken[] };

// The packs and profile a switch reuses: it changes only the tool selection, so the pack set and the
// profile are read from the lock (the authority) and written straight back into eep.yaml beside the
// new tools. Falls back to evolving for a profile the lock does not carry cleanly, exactly as the
// root sync does.
function readLockPacksAndProfile(targetDir: string): { packs: string[]; profile: WritableProfile } {
  const parsed: unknown = parseYaml(readFileSync(join(targetDir, ".eep", "lock.yaml"), "utf8"));
  const record =
    parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const packs = Array.isArray(record.packs)
    ? record.packs.flatMap((entry) => {
        const name = (entry as { name?: unknown }).name;
        return typeof name === "string" && name !== "" ? [name] : [];
      })
    : [];
  let profile: WritableProfile = "evolving";
  try {
    if (typeof record.profile === "string") profile = toWritableProfile(record.profile);
  } catch {
    profile = "evolving";
  }
  return { packs, profile };
}

// The instruction files a set of tokens owns in this layout: the root surfaces plus, for the two
// component capable tokens, one file per component directory. Used to report what a switch wrote and
// what it removed, computed on the token delta rather than the whole selection.
function surfaceFilesFor(layout: readonly PackLayout[], tokens: readonly ToolToken[]): string[] {
  return [...rootSurfaceFiles(tokens), ...componentInstructionFiles(layout, tokens)];
}

function printList(label: string, files: string[]): void {
  console.log(files.length === 0 ? `eep switch-ide: ${label}: none` : `eep switch-ide: ${label}:`);
  for (const file of files) console.log(`  - ${file}`);
}

/**
 * Changes which AI coding tools this repository generates instructions for, without touching its
 * packs, profile, or gate.
 *
 * The current selection is read from eep.yaml (or inferred from the files present when eep.yaml
 * predates the feature); the target selection comes from explicit tokens or the interactive multi
 * select preselected to the current set. eep.yaml is rewritten with the new tools, and generate then
 * writes the surfaces for newly selected tools and strips eep's footprint from deselected ones,
 * preserving any user content around a co owned block and never touching a team's own .cursor rules
 * (see generateAgentFiles). Throws when there is no vendored .eep to switch within, or on an unknown
 * tool token.
 */
export async function runSwitchIde(opts: SwitchIdeOptions): Promise<SwitchIdeResult> {
  const lockPath = join(opts.targetDir, ".eep", "lock.yaml");
  if (!existsSync(lockPath)) {
    throw new Error("eep: no .eep found; run eep adopt first");
  }

  const before = resolveToolsNonInteractive(opts.targetDir);
  const after = await resolveTools(opts.targetDir, opts.tools, before);

  const { packs, profile } = readLockPacksAndProfile(opts.targetDir);
  writeFileSync(join(opts.targetDir, "eep.yaml"), buildEepYamlContent(profile, packs, after));

  const layout = lockedPackLayout(opts.targetDir);
  const written = surfaceFilesFor(
    layout,
    after.filter((token) => !before.includes(token)),
  );
  const removed = surfaceFilesFor(
    layout,
    before.filter((token) => !after.includes(token)),
  );

  generateAgentFiles(opts.targetDir, after);

  console.log(`eep switch-ide: tools before: ${formatToolSelection(before)}`);
  console.log(`eep switch-ide: tools after: ${formatToolSelection(after)}`);
  printList("wrote", written);
  printList("removed", removed);

  return { before, after };
}

type SwitchIdeCliOptions = { tools?: string };

export function register(program: Command): void {
  program
    .command("switch-ide")
    .description("change which AI coding tools this repo generates instructions for")
    .argument(
      "[tools...]",
      "AI tools to switch to: claude, agents, copilot, cursor, none (empty prompts)",
    )
    .option("--tools <tokens>", "comma separated AI tools, as an alternative to positional tokens")
    .action(async (tokens: string[], options: SwitchIdeCliOptions) => {
      try {
        // Positional tokens and the --tools flag are two spellings of the same input. Either present
        // means an explicit set; neither means prompt (in a TTY) or keep the current set.
        const explicit = tokens.length > 0 ? tokens : toolsFromFlag(options.tools);
        await runSwitchIde({ targetDir: process.cwd(), tools: explicit });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
