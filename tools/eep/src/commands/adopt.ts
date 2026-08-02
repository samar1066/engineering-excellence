import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { execaSync } from "execa";
import fg from "fast-glob";
import { stringify as stringifyYaml } from "yaml";
import { corpusRoot } from "../lib/corpus-root.js";
import { detectPacks } from "../lib/detect.js";
import { componentInstructionFiles, generateAgentFiles } from "../lib/generate.js";
import { managedBlockState } from "../lib/managed-block.js";
import { loadPack } from "../lib/pack.js";
import { planPackLayout, vendorInto } from "../lib/vendor.js";

// Deliberately narrower than resolve.ts's Profile: "steady" is reserved and resolveLaws rejects
// it downstream anyway, so nothing that writes a lock file accepts it as a target profile in the
// first place. Shared with the root framework sync, which writes the same lock file.
export type WritableProfile = "greenfield" | "evolving";

export type AdoptOptions = {
  targetDir: string;
  corpusDir: string;
  profile: WritableProfile;
  yes: boolean;
};

// What a successful run writes at the repository root, always, whatever the pack set is. Shared
// with the root framework sync, which writes exactly the same set.
const ROOT_AGENT_FILES = ["AGENTS.md", "CLAUDE.md"];
const TRAILING_PLANNED_FILES = ["eep.yaml"];

/**
 * One agent file's line in the plan, saying what will actually happen to it.
 *
 * "will write: CLAUDE.md" was true when this program owned the whole file and is now the single
 * most alarming line a brownfield repository's owner can read, because their CLAUDE.md is where
 * their team wrote down how their repository works. The three outcomes read differently on purpose:
 * a file that does not exist is created, a file that exists gains a block underneath content this
 * run will not touch, and a file that already carries a block has only that block rewritten.
 *
 * A malformed pair of markers is named as a skip rather than as either kind of update, because that
 * is what the write step will do with it (see lib/managed-block.ts).
 */
function agentFilePlanLine(targetDir: string, relPath: string): string {
  switch (managedBlockState(join(targetDir, relPath))) {
    case "created":
      return `create ${relPath} (managed block)`;
    case "appended":
      return `update ${relPath} (managed block appended; your content preserved)`;
    case "malformed":
      return `skip ${relPath} (malformed managed block; left untouched)`;
    default:
      return `update ${relPath} (managed block refreshed)`;
  }
}

/**
 * Every file this run will write, component instruction files included, and what it will do to
 * each agent file it finds already there.
 *
 * A composed repository's instructions are no longer one document: each pack pinned to a component
 * directory gets its own CLAUDE.md and AGENTS.md there (see lib/generate.ts). Those are files the
 * user's repository ends up carrying, so a plan that listed only the root pair would be asking for
 * consent to a smaller write than the one about to happen. Resolved from the corpus and the target
 * with the same rule the sync itself pins by, so the list is exact rather than indicative.
 *
 * The pre-commit line is resolved the same way; hookPlanLine is declared further down, beside the
 * hook constants it reads.
 */
export function plannedFiles(targetDir: string, corpusDir: string, packs: string[]): string[] {
  const component = componentInstructionFiles(planPackLayout(targetDir, corpusDir, packs));
  const agentFiles = [...ROOT_AGENT_FILES, ...component].map((relPath) =>
    agentFilePlanLine(targetDir, relPath),
  );
  return [".eep/", ...agentFiles, ...TRAILING_PLANNED_FILES, hookPlanLine(targetDir)];
}

// The gate must run for a consumer who only ever reaches this CLI through npx, so a bare `eep` is
// never assumed to be on PATH: it is used when present (fast, no network) and the published
// package answers otherwise. Kept byte identical in intent to the pre-commit framework hook in
// packs/stack/python-fastapi/templates/config/pre-commit-config.yaml, which this raw hook stands
// in for whenever the framework has not overwritten .git/hooks/pre-commit.
const HOOK_CONTENT = [
  "#!/bin/sh",
  "# Installed by eep adopt. The gate runs before the commit exists.",
  "if command -v eep >/dev/null 2>&1; then",
  "  eep verify --changed || exit 1",
  "else",
  "  npx -y engineering-excellence verify --changed || exit 1",
  "fi",
  "",
].join("\n");

/**
 * How a pre-commit hook is recognized as one this program wrote: the marker comment on line 2, which
 * is the shape HOOK_CONTENT has had since it was introduced.
 *
 * The position is the whole point. Searching the file for the marker anywhere looked equivalent and
 * was not: a repository following the chain instruction can end up with our own pre-commit-eep
 * script pasted into the bottom of their hook, marker comment and all, and a search would then read
 * that hook as ours and overwrite the lint and test commands above it. Anything that is not this
 * program's own two opening lines belongs to whoever wrote it.
 */
const HOOK_MARKER = "Installed by eep adopt";
const HOOK_MARKER_LINE_PREFIX = `# ${HOOK_MARKER}`;

function isEepHook(content: string): boolean {
  return (content.split("\n")[1] ?? "").startsWith(HOOK_MARKER_LINE_PREFIX);
}

// Where the gate goes when the repository already has a pre-commit hook of its own. A sibling file
// rather than a rename or an edit: renaming breaks whatever installed the original (husky, lefthook,
// the pre-commit framework, a Makefile target) and editing someone else's shell script is a change
// this program has no way to make safely for every shape that script can take.
const CHAINED_HOOK_NAME = "pre-commit-eep";

// Written with forward slashes rather than joined with path.join: these are the strings printed to a
// reader and pasted into a shell script, both of which are posix separated whatever the platform is.
const HOOK_REL_DIR = ".git/hooks";
const HOOK_REL_PATH = `${HOOK_REL_DIR}/pre-commit`;
const CHAINED_HOOK_REL_PATH = `${HOOK_REL_DIR}/${CHAINED_HOOK_NAME}`;
const CHAIN_LINE = `${CHAINED_HOOK_REL_PATH} "$@" || exit 1`;

/**
 * The value of `core.hooksPath` in this repository, or null when it is unset or unreadable.
 *
 * A repository that sets it has told git to look somewhere else entirely, which is what husky,
 * lefthook, and every other hook manager do. Writing `.git/hooks/pre-commit` there installs a file
 * git will never run, so the gate would be silently absent while every output said it was installed.
 * Read with the synchronous form deliberately: both the planner and the installer need the answer,
 * the planner is called from a synchronous plan printer shared with the root sync, and an async
 * signature would spread through both commands for one `git config` call.
 *
 * `reject: false` because git exits non zero when the key is simply unset, which is the common case
 * and not an error; the catch covers a machine with no git at all.
 */
function hooksPathConfig(targetDir: string): string | null {
  try {
    const result = execaSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: targetDir,
      reject: false,
    });
    const value = result.stdout.trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * The pre-commit hook's line in the plan, saying what will actually happen to it.
 *
 * The list used to name this path unconditionally, which was true when this program overwrote
 * whatever it found. Now the same four cases the install step distinguishes have to be visible
 * before consent, because the ones a reader most needs to see are those where their own hook, or
 * their hook manager, stays and the gate lands beside it under a name they would otherwise never
 * look for.
 *
 * The create case covers a repository with no .git at all, and a worktree or submodule checkout
 * where .git is a plain file: no hook file exists at that path in either, so `create` is what the
 * run will attempt, and installGitHook prints its own warning when it turns out it cannot. That is
 * the same precedent this list has always followed, rather than silently omitting the entry.
 */
function hookPlanLine(targetDir: string): string {
  const hooksPath = hooksPathConfig(targetDir);
  if (hooksPath !== null) {
    return `preserve hook manager (${hooksPath}); create ${CHAINED_HOOK_REL_PATH}`;
  }
  const hookPath = join(targetDir, ".git", "hooks", "pre-commit");
  if (!existsSync(hookPath)) return `create ${HOOK_REL_PATH}`;
  if (isEepHook(readFileSync(hookPath, "utf8"))) {
    return `update ${HOOK_REL_PATH} (eep managed)`;
  }
  return `preserve ${HOOK_REL_PATH} (yours); create ${CHAINED_HOOK_REL_PATH}`;
}

// Every pack manifest under the corpus, named and sorted, for the "no pack detected" error
// message. Mirrors the glob detectPacks itself scans internally (see lib/detect.ts).
function listAllPackNames(corpusDir: string): string[] {
  const manifestPaths = fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort();
  const names = manifestPaths.map((relPath) => loadPack(dirname(join(corpusDir, relPath))).name);
  return names.sort();
}

function printPlan(opts: AdoptOptions, packs: string[]): void {
  console.log(`eep adopt: detected packs: ${packs.join(", ")}`);
  console.log(`eep adopt: profile: ${opts.profile}`);
  console.log("eep adopt: will write:");
  for (const file of plannedFiles(opts.targetDir, opts.corpusDir, packs)) {
    console.log(`  - ${file}`);
  }
}

async function promptProceed(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question("Proceed? [y/N] ");
  } finally {
    rl.close();
  }
}

/**
 * Requires explicit consent before anything is written. --yes short circuits both branches below;
 * without it, a TTY gets a prompt, and anything else (CI, a pipe, this test suite) is refused
 * outright rather than hanging on stdin input that will never arrive.
 *
 * `verb` names the operation in both refusal messages, so the root framework sync can share this
 * gate verbatim and still say "sync" where adopt says "adopt".
 */
export async function confirmOrAbort(yes: boolean, verb: string): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY) {
    throw new Error(`eep: refusing to ${verb} without --yes in non interactive mode`);
  }
  const answer = (await promptProceed()).trim();
  if (answer !== "y" && answer !== "Y") {
    throw new Error(`eep: ${verb} cancelled`);
  }
}

// The human readable record of what was vendored. lock.yaml remains the authority; this file
// exists so a reader (or an agent) can see the active set without parsing the lock. Shared with
// the root framework sync so both commands write byte identical content for the same set.
export function buildEepYamlContent(profile: WritableProfile, packs: string[]): string {
  return stringifyYaml({ profile, packs });
}

// Installs the pre-commit gate when the target is a git checkout. When it is not, the rest of
// adoption (vendoring, eep.yaml, the agent files) is still useful on its own, so this warns
// instead of throwing and lets the caller keep going. Exported because the root framework sync
// installs the identical hook; there must be exactly one definition of what the gate runs.
//
// A pre-commit hook that is already there and is not ours is never overwritten; see the comment on
// the preservation branch below.
//
// ".git exists" is not the same as "a hooks directory can live under it": in a worktree or a
// submodule checkout, ".git" is a plain file containing a "gitdir: <path>" pointer, not a
// directory. mkdirSync would throw a raw ENOTDIR trying to create a "hooks" child of a file, and
// by the time this function runs, vendorInto/eep.yaml/generateAgentFiles have already succeeded,
// so that throw would surface as a confusing partial-failure instead of the same clean warn-and
// continue path the "no .git at all" case already takes.
export function installGitHook(targetDir: string): void {
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

  const writeChainedHook = (): void => {
    const chainedPath = join(hooksDir, CHAINED_HOOK_NAME);
    writeFileSync(chainedPath, HOOK_CONTENT);
    chmodSync(chainedPath, 0o755);
  };

  // core.hooksPath tells git to run hooks from somewhere else entirely, which is exactly what husky
  // and lefthook set. Writing .git/hooks/pre-commit under it produces a file git will never execute:
  // the gate would be reported as installed and would never once run. The manager's directory is not
  // written into either, because its layout is the manager's to define. So the gate is written where
  // it can be called from, and the caller is told the one line that calls it.
  const hooksPath = hooksPathConfig(targetDir);
  if (hooksPath !== null) {
    writeChainedHook();
    console.log(
      `eep: core.hooksPath is set (${hooksPath}); add this line to your hook manager's pre-commit: ${CHAIN_LINE}`,
    );
    return;
  }

  // A pre-commit hook this program did not write belongs to whatever put it there, and it is
  // frequently the only automation a team has: linting, secret scanning, commit message rules,
  // sometimes their whole CI in miniature. Overwriting it (which every release through 0.2.2 did)
  // silently deletes that automation and nothing in the repository records it ever existed. So the
  // gate is written beside it and the one line that chains the two is printed, which leaves the
  // decision, and the ordering, with the person who owns the original hook.
  if (existsSync(hookPath) && !isEepHook(readFileSync(hookPath, "utf8"))) {
    writeChainedHook();
    console.log(
      `eep: existing pre-commit hook preserved; add this line to it to chain the gate: ${CHAIN_LINE}`,
    );
    return;
  }

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

  printPlan(opts, packs);
  await confirmOrAbort(opts.yes, "adopt");

  vendorInto(opts.targetDir, opts.corpusDir, packs, opts.profile);
  writeFileSync(join(opts.targetDir, "eep.yaml"), buildEepYamlContent(opts.profile, packs));
  generateAgentFiles(opts.targetDir);

  installGitHook(opts.targetDir);

  return { packs };
}

export function toWritableProfile(value: string): WritableProfile {
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
        const profile = toWritableProfile(options.profile);
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
