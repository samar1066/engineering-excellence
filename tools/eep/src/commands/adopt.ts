import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import fg from "fast-glob";
import { stringify as stringifyYaml } from "yaml";
import { corpusRoot } from "../lib/corpus-root.js";
import { detectPacks } from "../lib/detect.js";
import { generateAgentFiles } from "../lib/generate.js";
import { loadPack } from "../lib/pack.js";
import { vendorInto } from "../lib/vendor.js";

// Deliberately narrower than resolve.ts's Profile: "steady" is reserved and resolveLaws rejects
// it downstream anyway, so adopt never accepts it as a valid target profile in the first place.
type AdoptProfile = "greenfield" | "evolving";

export type AdoptOptions = {
  targetDir: string;
  corpusDir: string;
  profile: AdoptProfile;
  yes: boolean;
};

// Fixed, literal list of what a successful run writes. Printed up front during planning
// regardless of whether .git turns out to exist; the git hook step below prints its own warning
// when it cannot honor the last entry, rather than this list silently omitting it.
const PLANNED_FILES = [".eep/", "AGENTS.md", "CLAUDE.md", "eep.yaml", ".git/hooks/pre-commit"];

const HOOK_CONTENT = [
  "#!/bin/sh",
  "# Installed by eep adopt. The gate runs before the commit exists.",
  "eep verify --changed || exit 1",
  "",
].join("\n");

// Every pack manifest under the corpus, named and sorted, for the "no pack detected" error
// message. Mirrors the glob detectPacks itself scans internally (see lib/detect.ts).
function listAllPackNames(corpusDir: string): string[] {
  const manifestPaths = fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort();
  const names = manifestPaths.map((relPath) => loadPack(dirname(join(corpusDir, relPath))).name);
  return names.sort();
}

function printPlan(packs: string[], profile: AdoptProfile): void {
  console.log(`eep adopt: detected packs: ${packs.join(", ")}`);
  console.log(`eep adopt: profile: ${profile}`);
  console.log("eep adopt: will write:");
  for (const file of PLANNED_FILES) console.log(`  - ${file}`);
}

async function promptProceed(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question("Proceed? [y/N] ");
  } finally {
    rl.close();
  }
}

// Requires explicit consent before anything is written. --yes short circuits both branches below;
// without it, a TTY gets a prompt, and anything else (CI, a pipe, this test suite) is refused
// outright rather than hanging on stdin input that will never arrive.
async function confirmOrAbort(yes: boolean): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY) {
    throw new Error("eep: refusing to adopt without --yes in non interactive mode");
  }
  const answer = (await promptProceed()).trim();
  if (answer !== "y" && answer !== "Y") {
    throw new Error("eep: adopt cancelled");
  }
}

function buildEepYamlContent(profile: AdoptProfile, packs: string[]): string {
  return stringifyYaml({ profile, packs });
}

// Installs the pre-commit gate when the target is a git checkout. When it is not, the rest of
// adoption (vendoring, eep.yaml, the agent files) is still useful on its own, so this warns
// instead of throwing and lets the caller keep going.
//
// ".git exists" is not the same as "a hooks directory can live under it": in a worktree or a
// submodule checkout, ".git" is a plain file containing a "gitdir: <path>" pointer, not a
// directory. mkdirSync would throw a raw ENOTDIR trying to create a "hooks" child of a file, and
// by the time this function runs, vendorInto/eep.yaml/generateAgentFiles have already succeeded,
// so that throw would surface as a confusing partial-failure instead of the same clean warn-and
// continue path the "no .git at all" case already takes.
function installGitHook(targetDir: string): void {
  const gitDir = join(targetDir, ".git");
  if (!existsSync(gitDir)) {
    console.warn("eep: no .git directory; pre-commit hook not installed");
    return;
  }
  if (!statSync(gitDir).isDirectory()) {
    console.warn(
      "eep: .git is not a directory (worktree or submodule); pre-commit hook not installed",
    );
    return;
  }
  const hooksDir = join(gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, HOOK_CONTENT);
  chmodSync(hookPath, 0o755);
}

/**
 * Consumer onboarding, end to end: detect the packs this repo matches, plan and confirm the
 * write, then vendor the corpus, write eep.yaml, generate AGENTS.md/CLAUDE.md, and install the
 * git pre-commit gate. Throws (never exits the process itself) on a failed detection, a declined
 * or non interactive confirmation, or anything the underlying vendor/generate steps throw.
 */
export async function runAdopt(opts: AdoptOptions): Promise<{ packs: string[] }> {
  const packs = detectPacks(opts.targetDir, opts.corpusDir);
  if (packs.length === 0) {
    const supported = listAllPackNames(opts.corpusDir).join(", ");
    throw new Error(`eep: no pack detected; supported packs: ${supported}`);
  }

  printPlan(packs, opts.profile);
  await confirmOrAbort(opts.yes);

  vendorInto(opts.targetDir, opts.corpusDir, packs, opts.profile);
  writeFileSync(join(opts.targetDir, "eep.yaml"), buildEepYamlContent(opts.profile, packs));
  generateAgentFiles(opts.targetDir);

  installGitHook(opts.targetDir);

  return { packs };
}

function toAdoptProfile(value: string): AdoptProfile {
  if (value === "greenfield" || value === "evolving") return value;
  throw new Error(`eep: unknown profile "${value}"; expected greenfield or evolving`);
}

type AdoptCliOptions = { profile: string; corpus?: string; yes: boolean };

export function register(program: Command): void {
  program
    .command("adopt")
    .description("detect, plan, confirm, vendor, generate, and gate this repo")
    .option("--profile <profile>", "greenfield or evolving", "evolving")
    .option("--corpus <dir>", "path to the eep corpus (defaults to this CLI's own corpus checkout)")
    .option("--yes", "skip the interactive confirmation prompt", false)
    .action(async (options: AdoptCliOptions) => {
      try {
        const profile = toAdoptProfile(options.profile);
        const corpusDir = options.corpus ?? corpusRoot();
        const { packs } = await runAdopt({
          targetDir: process.cwd(),
          corpusDir,
          profile,
          yes: options.yes,
        });
        console.log(`eep: adopted ${packs.join(", ")} under profile ${profile}`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
