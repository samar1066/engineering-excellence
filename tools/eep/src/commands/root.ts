import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { corpusRoot } from "../lib/corpus-root.js";
import { detectPacks } from "../lib/detect.js";
import { invocation } from "../lib/eep-on-path.js";
import {
  listCapabilities,
  resolveFrameworks,
  tokensForPacks,
  validTokens,
} from "../lib/frameworks.js";
import { generateAgentFiles } from "../lib/generate.js";
import { offerGlobalInstall } from "../lib/install-offer.js";
import { vendorInto } from "../lib/vendor.js";
import {
  buildEepYamlContent,
  confirmOrAbort,
  installGitHook,
  PLANNED_FILES,
  toWritableProfile,
  type WritableProfile,
} from "./adopt.js";

export type SyncOptions = {
  targetDir: string;
  corpusDir: string;
  tokens: string[];
  // Omitted means "keep whatever this directory already runs", which resolves to the profile in an
  // existing lock file, or evolving when there is none. See resolveProfile.
  profile?: WritableProfile;
  yes: boolean;
  // Omitted means "offer it". Only an explicit false (--no-install-offer) silences both the
  // prompt and the hint, which is what CI and scripted runs want.
  installOffer?: boolean;
};

export type SyncResult = {
  packs: string[];
  profile: WritableProfile;
  comingSoon: string[];
};

const DEFAULT_PROFILE: WritableProfile = "evolving";

const WHAT_EEP_IS =
  "eep vendors engineering laws, executable checks, and generated agent instructions into this directory.";

// Built per call rather than fixed at module load: the examples are printed in whichever form the
// reader's shell can actually run (see lib/eep-on-path.ts).
function usageExamples(): string[] {
  const eep = invocation();
  return [
    `  ${eep} fastapi`,
    `  ${eep} fastapi node angular`,
    "  Add or drop a framework by running the command again with the new full list.",
  ];
}

/**
 * The profile this sync writes.
 *
 * An explicit --profile always wins. Otherwise an existing .eep/lock.yaml is read and its profile
 * kept: syncing a new framework into a repository is a change of scope, not a change of how
 * strictly the gate judges it, and silently demoting a greenfield repository to evolving because
 * the flag was omitted would quietly stop enforcing laws that were passing yesterday.
 *
 * Anything unreadable or unrecognized in the lock (including the reserved "steady", which
 * resolveLaws rejects downstream anyway) falls through to evolving rather than throwing: the lock
 * is about to be rewritten by this very call, so a damaged one is not worth refusing over.
 */
function resolveProfile(opts: SyncOptions): WritableProfile {
  if (opts.profile !== undefined) return opts.profile;
  const lockPath = join(opts.targetDir, ".eep", "lock.yaml");
  if (!existsSync(lockPath)) return DEFAULT_PROFILE;
  try {
    const parsed: unknown = parseYaml(readFileSync(lockPath, "utf8"));
    if (parsed === null || typeof parsed !== "object") return DEFAULT_PROFILE;
    const profile = (parsed as { profile?: unknown }).profile;
    if (profile === "greenfield" || profile === "evolving") return profile;
    return DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

function printPlan(packs: string[], profile: WritableProfile): void {
  console.log(`eep: syncing this directory to: ${packs.join(", ")}`);
  console.log(`eep: profile: ${profile}`);
  console.log("eep: will write:");
  for (const file of PLANNED_FILES) console.log(`  - ${file}`);
}

// The three commands that matter the moment a sync lands: set the project up, run the gate, and
// look up any law the gate names. Each is printed in the form this shell can run: a consumer who
// reached this CLI through npx has no bare `eep`, and telling them to run one was the whole defect
// this addresses.
function printNextSteps(packs: string[], profile: WritableProfile): void {
  const eep = invocation();
  console.log(`eep: active set: ${packs.join(", ")} under profile ${profile}`);
  console.log(
    `eep: next: 1. make setup, or your own project setup 2. ${eep} verify 3. ${eep} explain <LAW-ID>`,
  );
}

/**
 * The zero argument screen: what this CLI is, what it can do today, what is coming, how to ask for
 * it, and what it already sees in this directory. Built as lines rather than printed directly so
 * the content is testable without capturing stdout.
 */
export function capabilityScreenLines(corpusDir: string, targetDir: string): string[] {
  const { available, comingSoon } = listCapabilities(corpusDir);
  const lines: string[] = [WHAT_EEP_IS, ""];

  lines.push("Available now:");
  if (available.length === 0) lines.push("  nothing yet: this corpus carries no packs");
  for (const entry of available) lines.push(`  ${entry.token} (${entry.pack})`);

  if (comingSoon.length > 0) {
    lines.push("", "In development:", `  ${comingSoon.join(", ")}`);
  }

  lines.push("", "Usage:", ...usageExamples());

  const detected = tokensForPacks(detectPacks(targetDir, corpusDir));
  if (detected.length > 0) {
    lines.push(
      "",
      `Detected in this project: ${detected.join(", ")}. Run: ${invocation()} ${detected.join(" ")}`,
    );
  }

  return lines;
}

export function printCapabilityScreen(corpusDir: string, targetDir: string): void {
  for (const line of capabilityScreenLines(corpusDir, targetDir)) console.log(line);
}

function rejectUnknownTokens(unknown: string[], corpusDir: string): void {
  if (unknown.length === 0) return;
  const valid = validTokens(corpusDir).join(", ");
  throw new Error(`eep: unknown framework: ${unknown.join(", ")}; valid tokens: ${valid}`);
}

/**
 * Declarative sync: makes this directory carry exactly the framework set named on the command
 * line, whatever it carried before.
 *
 * Unknown tokens are refused before anything is written, so a typo in a long list never leaves a
 * repository half converted. Tokens whose packs are not built yet are reported and skipped, and
 * only an empty remainder is fatal. Detection never gates the result: naming a framework is a
 * declaration of intent, and a user may add a pack before writing the first line of code it
 * governs.
 *
 * A successful sync closes by naming the next commands in a form this shell can run, then offers
 * the global install that would make the short form true, unless installOffer is false. See
 * lib/install-offer.ts.
 *
 * Re-running with a different list is the whole add and remove story: vendorInto rewrites .eep to
 * exactly the requested set (preserving the consumer's waivers), eep.yaml is rewritten to match,
 * and the agent files are regenerated from the new lock. Throws (never exits the process itself)
 * on an unknown token, an empty available subset, a declined or non interactive confirmation, or
 * anything the vendor and generate steps throw.
 */
export async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const { packs, comingSoon, unknown } = resolveFrameworks(opts.tokens, opts.corpusDir);
  rejectUnknownTokens(unknown, opts.corpusDir);

  if (comingSoon.length > 0) {
    console.log(`eep: coming soon, skipped: ${comingSoon.join(", ")}`);
  }
  if (packs.length === 0) {
    printCapabilityScreen(opts.corpusDir, opts.targetDir);
    throw new Error("eep: nothing to sync; no requested framework has a pack yet");
  }

  const profile = resolveProfile(opts);
  printPlan(packs, profile);
  await confirmOrAbort(opts.yes, "sync");

  vendorInto(opts.targetDir, opts.corpusDir, packs, profile);
  writeFileSync(join(opts.targetDir, "eep.yaml"), buildEepYamlContent(profile, packs));
  generateAgentFiles(opts.targetDir);

  installGitHook(opts.targetDir);

  printNextSteps(packs, profile);
  // Last, and only ever additive: everything above has already landed, and offerGlobalInstall
  // never throws, so nothing this does can turn a completed sync into a failed command.
  if (opts.installOffer !== false) await offerGlobalInstall();
  return { packs, profile, comingSoon };
}

type RootCliOptions = { profile?: string; corpus?: string; yes: boolean; installOffer: boolean };

/**
 * Wires the framework selector onto the program itself, as a variadic positional argument.
 *
 * Registered subcommands keep absolute precedence: commander dispatches to one whenever the first
 * operand names it, so `eep verify` reaches the verify command and only a first operand that names
 * no command (`eep fastapi`) reaches this action. Register this last, after every subcommand, so
 * that precedence is obvious in the reading order too.
 */
export function register(program: Command): void {
  program
    .argument("[frameworks...]", "framework tokens to sync this directory to, space separated")
    .option("--profile <profile>", "greenfield or evolving (default: keep the current profile)")
    .option("--corpus <dir>", "path to the eep corpus (defaults to this CLI's own corpus)")
    .option("--yes", "skip the interactive confirmation prompt", false)
    .option("--no-install-offer", "skip the global install offer and its hint (CI and scripts)")
    .action(async (frameworks: string[], options: RootCliOptions) => {
      try {
        const corpusDir = options.corpus ?? corpusRoot();
        if (frameworks.length === 0) {
          printCapabilityScreen(corpusDir, process.cwd());
          return;
        }
        await runSync({
          targetDir: process.cwd(),
          corpusDir,
          tokens: frameworks,
          profile: options.profile === undefined ? undefined : toWritableProfile(options.profile),
          yes: options.yes,
          installOffer: options.installOffer,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
