import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import fg from "fast-glob";
import { corpusRoot } from "../lib/corpus-root.js";
import { invocation } from "../lib/eep-on-path.js";
import { resolveFrameworks, validTokens } from "../lib/frameworks.js";
import { generateAgentFiles } from "../lib/generate.js";
import { offerGlobalInstall } from "../lib/install-offer.js";
import { findPackDir, loadPack } from "../lib/pack.js";
import { vendorInto } from "../lib/vendor.js";
import { buildEepYamlContent, installGitHook, runAdopt, type WritableProfile } from "./adopt.js";

export type InitOptions = {
  name: string;
  targetDir: string;
  corpusDir: string;
  pack?: string;
  // Framework tokens, as typed on the command line. Empty (or omitted) selects the single pack
  // scaffold; anything else composes one project out of every pack the tokens resolve to.
  tokens?: string[];
  // Omitted means "offer it". Only an explicit false (--no-install-offer) silences both the
  // prompt and the hint, which is what CI and scripted runs want.
  installOffer?: boolean;
};

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const DEFAULT_PACK = "python-fastapi";
const PROJECT_NAME_TOKEN = "{{project_name}}";

// A project eep created is a project with no history to be compatible with, so both init paths
// vendor under the strictest profile.
const INIT_PROFILE: WritableProfile = "greenfield";

// Pinned to the single pack path's only pack rather than interpolated from the resolved pack name:
// both the task brief and dispatch fix this exact commit message, independent of which --pack was
// requested. The composed path names its own set instead (see composedCommitMessage).
const SCAFFOLD_COMMIT_MESSAGE = "feat: scaffold from eep python-fastapi pack";

// Lets `git commit` succeed on a machine with no global user.name/user.email configured, without
// reading or touching that machine's git config. execa's extendEnv defaults to true, so this is
// merged on top of process.env rather than replacing it, keeping PATH and everything else the git
// binary needs.
const GIT_IDENTITY_ENV = {
  GIT_AUTHOR_NAME: "eep",
  GIT_AUTHOR_EMAIL: "eep@localhost",
  GIT_COMMITTER_NAME: "eep",
  GIT_COMMITTER_EMAIL: "eep@localhost",
};

function validateName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      "eep: project name must match ^[a-z][a-z0-9_]*$ (lowercase, digits, underscores)",
    );
  }
}

// Resolved straight off the corpus directory layout (packs/<kind>/<pack>/scaffold) rather than
// through a pack.yaml name lookup like lib/vendor.ts's findPackDir: the single pack path cares
// whether there is a scaffold to copy, not whether a pack exists at all, and the brief states the
// "no scaffold" condition in exactly these directory terms.
function findScaffoldDir(corpusDir: string, pack: string): string {
  const matches = fg
    .sync(`packs/*/${pack}/scaffold`, { cwd: corpusDir, onlyDirectories: true })
    .sort();
  const relPath = matches[0];
  if (relPath === undefined) {
    throw new Error(`eep: pack ${pack} has no scaffold`);
  }
  return join(corpusDir, relPath);
}

// Returns whether projectDir already existed (necessarily empty, since a non-empty one throws)
// before this call, so the caller can tell apart a directory runInit itself created from one that
// was already there, and clean up accordingly if a later step fails.
function ensureEmptyProjectDir(projectDir: string): boolean {
  const existedBefore = existsSync(projectDir);
  if (existedBefore && readdirSync(projectDir).length > 0) {
    throw new Error(`eep: ${projectDir} already exists and is not empty`);
  }
  mkdirSync(projectDir, { recursive: true });
  return existedBefore;
}

// Every scaffold file is UTF-8 text (no binary assets under packs/*/*/scaffold today), so one
// read-replace-write pass over every file, dotfiles included, covers the whole tree without a
// separate binary copy path.
function copyScaffold(scaffoldDir: string, destDir: string, name: string): void {
  const relPaths = fg.sync("**/*", { cwd: scaffoldDir, dot: true, onlyFiles: true }).sort();
  for (const relPath of relPaths) {
    const destPath = join(destDir, relPath);
    mkdirSync(dirname(destPath), { recursive: true });
    const content = readFileSync(join(scaffoldDir, relPath), "utf8");
    writeFileSync(destPath, content.replaceAll(PROJECT_NAME_TOKEN, name));
  }
}

// The one sanctioned git use in runInit: initializing and committing the project directory it
// just created. Never runs against the eep corpus checkout itself.
async function gitInitAndCommit(projectDir: string, message: string): Promise<void> {
  const env = GIT_IDENTITY_ENV;
  await execa("git", ["init"], { cwd: projectDir, env });
  await execa("git", ["add", "-A"], { cwd: projectDir, env });
  await execa("git", ["commit", "-m", message], { cwd: projectDir, env });
}

// Two lines: the first is the fastest loop a fresh project can run, the second names the whole
// gate. The gate is named in exactly one form, the one this shell can run: a bare `eep` is on PATH
// only after a global install, and anyone who reached this CLI through npx alone runs the npx form
// (which is also what the scaffold's own `make verify` target and pre-commit hook fall back to).
// Printing both, as this once did, left every reader to work out which half applied to them.
function printNextSteps(name: string): void {
  console.log(`eep init: next steps: cd ${name} && make setup && make test`);
  console.log(`eep init: full gate: ${invocation()} verify from the project`);
}

/**
 * Where one pack's files land inside a composed project.
 *
 * `componentDir` null means the project root: a platform or delivery pack that claims no component
 * directory contributes repository level files (workflows, container definitions) rather than a
 * component of its own. `scaffoldDir` null means the pack ships no scaffold at all, so it is
 * vendored and enforced but materializes nothing.
 */
type Placement = {
  pack: string;
  kind: string;
  componentDir: string | null;
  scaffoldDir: string | null;
};

type Plan =
  | { mode: "single"; scaffoldDir: string }
  | { mode: "composed"; packs: string[]; placements: Placement[] };

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function composedCommitMessage(packs: string[]): string {
  return `feat: scaffold from eep packs ${packs.join(", ")}`;
}

function rejectUnknownTokens(unknown: string[], corpusDir: string): void {
  if (unknown.length === 0) return;
  const valid = validTokens(corpusDir).join(", ");
  throw new Error(`eep: unknown framework: ${unknown.join(", ")}; valid tokens: ${valid}`);
}

// Two packs writing into one directory would interleave two scaffolds silently, and the loser
// would be whichever pack happened to be copied second. Refused up front, by name, so the fix is
// obvious: drop one of the two, or give one a component directory of its own.
function rejectCollidingComponentDirs(placements: Placement[]): void {
  const claimed = new Map<string, string>();
  for (const placement of placements) {
    const dir = placement.componentDir;
    if (dir === null) continue;
    const owner = claimed.get(dir);
    if (owner !== undefined) {
      throw new Error(
        `eep: packs ${owner} and ${placement.pack} both claim component directory ${dir}`,
      );
    }
    claimed.set(dir, placement.pack);
  }
}

/**
 * Turns the resolved pack set into a layout, reading only the corpus.
 *
 * Every refusal a composed init can raise happens here, before the project directory exists: a
 * stack pack with no component_dir has nowhere to put its component, a stack pack with no scaffold
 * has no component to put there, two packs claiming one directory would overwrite each other, and
 * a set with no stack pack is a repository of supporting files around an application that was
 * never chosen.
 */
function planComposedLayout(corpusDir: string, packs: string[]): Placement[] {
  const placements: Placement[] = [];

  for (const packName of packs) {
    const packDir = findPackDir(corpusDir, packName);
    const manifest = loadPack(packDir).manifest;
    const kind = toOptionalString(manifest.kind) ?? "";
    const componentDir = toOptionalString(manifest.component_dir);
    const scaffoldPath = join(packDir, "scaffold");
    const scaffoldDir = existsSync(scaffoldPath) ? scaffoldPath : null;

    if (kind === "stack") {
      if (componentDir === null) {
        throw new Error(
          `eep: pack ${packName} declares no component_dir; a composed init cannot place it`,
        );
      }
      if (scaffoldDir === null) throw new Error(`eep: pack ${packName} has no scaffold`);
    }

    placements.push({ pack: packName, kind, componentDir, scaffoldDir });
  }

  rejectCollidingComponentDirs(placements);

  if (!placements.some((placement) => placement.kind === "stack")) {
    throw new Error(`eep: composed init needs at least one stack pack; got ${packs.join(", ")}`);
  }

  return placements;
}

function planLayout(opts: InitOptions, tokens: string[]): Plan {
  if (tokens.length === 0) {
    return {
      mode: "single",
      scaffoldDir: findScaffoldDir(opts.corpusDir, opts.pack ?? DEFAULT_PACK),
    };
  }

  const { packs, comingSoon, unknown } = resolveFrameworks(tokens, opts.corpusDir);
  rejectUnknownTokens(unknown, opts.corpusDir);
  if (comingSoon.length > 0) {
    console.log(`eep init: coming soon, skipped: ${comingSoon.join(", ")}`);
  }
  // Separate from the "no stack pack" refusal below, and worded like the root sync's, because
  // nothing was wrong with what the user typed: every token they named is simply still on the
  // roadmap, and naming them back would read as an accusation.
  if (packs.length === 0) {
    throw new Error("eep: nothing to compose; no requested framework has a pack yet");
  }

  return { mode: "composed", packs, placements: planComposedLayout(opts.corpusDir, packs) };
}

const ROOT_TARGETS = ["setup", "test", "verify"] as const;

// Kept byte identical in intent to the scaffold Makefile's own verify target: a bare `eep` when a
// global install put one on PATH, the published package otherwise, so the root gate runs for a
// consumer who has never installed anything.
const VERIFY_FALLBACK = [
  "\tif command -v eep >/dev/null 2>&1; then eep verify; \\",
  "\telse npx -y engineering-excellence verify; fi",
];

/**
 * The root Makefile: one entry point that fans each target out into every component carrying a
 * Makefile of its own.
 *
 * The `-f $$c/Makefile` guard is not redundant with the generated COMPONENTS list. The list is a
 * fact about the day the project was created, and a component removed or replaced afterwards must
 * degrade to being skipped rather than breaking every target in the repository.
 *
 * `verify` additionally runs the eep gate at the root, which is the only place the whole law set
 * across every pack is resolved and reported.
 */
function buildRootMakefile(componentDirs: string[]): string {
  const lines: string[] = [
    `.PHONY: ${ROOT_TARGETS.join(" ")}`,
    `COMPONENTS = ${componentDirs.join(" ")}`,
    "",
  ];
  for (const target of ROOT_TARGETS) {
    lines.push(`${target}:`);
    lines.push("\t@for c in $(COMPONENTS); do \\");
    lines.push(`\t  if [ -f $$c/Makefile ]; then $(MAKE) -C $$c ${target} || exit 1; fi; \\`);
    lines.push("\tdone");
    if (target === "verify") lines.push(...VERIFY_FALLBACK);
    lines.push("");
  }
  return lines.join("\n");
}

function buildRootReadme(name: string, placements: Placement[]): string {
  const components = placements.map((placement) => {
    const where = placement.componentDir ?? "the repository root";
    return `- \`${where}\`: ${placement.pack}`;
  });

  return [
    `# ${name}`,
    "",
    "Composed by eep. Each component below carries one pack's stack, and every pack's laws are",
    "enforced against the component it governs.",
    "",
    "## Components",
    "",
    ...components,
    "",
    "## Make targets",
    "",
    "- `make setup`: prepare every component that ships a Makefile.",
    "- `make test`: run every component's own test target.",
    "- `make verify`: run every component's verify target, then the full eep gate at the root.",
    "",
    "The laws in force, the pack enforcing each one, and the command that proves it are listed in",
    "CLAUDE.md, which eep generates. Do not edit it by hand.",
    "",
  ].join("\n");
}

/**
 * The root ignore file: the union of what the rendered scaffolds already ignore, deduplicated and
 * in first seen order.
 *
 * Scaffold entries are written unanchored (`.venv/`, `__pycache__/`), which git matches at any
 * depth, so hoisting them to the root keeps each one meaning exactly what its component meant by
 * it. Root rendered scaffolds are read too, before this overwrites the file they wrote, so a pack
 * that ships a root `.gitignore` never loses its entries to the pack composed alongside it.
 */
function buildRootGitignore(destDirs: string[]): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const destDir of destDirs) {
    const path = join(destDir, ".gitignore");
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.trim();
      if (line === "" || seen.has(line)) continue;
      seen.add(line);
      entries.push(line);
    }
  }
  return entries.length === 0 ? "" : `${entries.join("\n")}\n`;
}

// The composed equivalent of runAdopt's tail, minus detection: a composed root carries no
// application files of its own to detect a pack from, so the set the user named on the command
// line is vendored directly.
function syncAtRoot(projectDir: string, corpusDir: string, packs: string[]): void {
  vendorInto(projectDir, corpusDir, packs, INIT_PROFILE);
  writeFileSync(join(projectDir, "eep.yaml"), buildEepYamlContent(INIT_PROFILE, packs));
  generateAgentFiles(projectDir);
  installGitHook(projectDir);
}

async function materializeComposed(
  plan: { packs: string[]; placements: Placement[] },
  projectDir: string,
  opts: InitOptions,
): Promise<void> {
  const destDirs: string[] = [];
  for (const placement of plan.placements) {
    if (placement.scaffoldDir === null) continue;
    const destDir =
      placement.componentDir === null ? projectDir : join(projectDir, placement.componentDir);
    copyScaffold(placement.scaffoldDir, destDir, opts.name);
    destDirs.push(destDir);
  }

  const componentDirs = plan.placements
    .flatMap((placement) => (placement.componentDir === null ? [] : [placement.componentDir]))
    .filter((dir) => existsSync(join(projectDir, dir, "Makefile")));

  writeFileSync(join(projectDir, "README.md"), buildRootReadme(opts.name, plan.placements));
  writeFileSync(join(projectDir, "Makefile"), buildRootMakefile(componentDirs));
  const gitignore = buildRootGitignore(destDirs);
  if (gitignore !== "") writeFileSync(join(projectDir, ".gitignore"), gitignore);

  await gitInitAndCommit(projectDir, composedCommitMessage(plan.packs));
  syncAtRoot(projectDir, opts.corpusDir, plan.packs);
}

async function materializeSingle(
  scaffoldDir: string,
  projectDir: string,
  opts: InitOptions,
): Promise<void> {
  copyScaffold(scaffoldDir, projectDir, opts.name);
  await gitInitAndCommit(projectDir, SCAFFOLD_COMMIT_MESSAGE);
  await runAdopt({
    targetDir: projectDir,
    corpusDir: opts.corpusDir,
    profile: INIT_PROFILE,
    yes: true,
  });
}

// Failure recovery for everything runInit does once projectDir is guaranteed to exist. Without
// this, a mid way failure (a bad scaffold file, git refusing to commit, runAdopt finding no pack)
// would leave a half built, deceptively complete looking directory behind, and a retry would fail
// immediately on ensureEmptyProjectDir's "already exists and is not empty" guard. Contents are
// always removed; projectDir itself is only removed when runInit created it (never when the
// caller already had an empty projectDir waiting before calling runInit). Never touches anything
// outside projectDir.
function cleanupProjectDir(projectDir: string, existedBefore: boolean): void {
  if (existedBefore) {
    for (const entry of readdirSync(projectDir)) {
      rmSync(join(projectDir, entry), { recursive: true, force: true });
    }
  } else {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

/**
 * Greenfield scaffold to compliant repo in one command.
 *
 * With no tokens: validate the project name, copy the requested pack's scaffold with
 * {{project_name}} substituted throughout, commit it as a fresh git repository, then adopt it
 * (greenfield profile, no prompt) so .eep/, AGENTS.md, CLAUDE.md, and the pre-commit gate all
 * exist from the first commit onward.
 *
 * With tokens: the same outcome for a project made of several components. Each stack pack's
 * scaffold is rendered into its own component directory, platform and delivery scaffolds into
 * theirs or the repository root, and the root gains a README, a Makefile that fans setup, test,
 * and verify into the components, and the union of their ignore entries. The whole tree is one git
 * repository with one initial commit, and one vendor pass at the root puts every selected pack's
 * laws into a single .eep, a single eep.yaml, and one set of agent instructions.
 *
 * Nothing is written until the layout is fully resolved, so an unknown token, a pack with no
 * component directory, or two packs claiming one directory all abort with no project directory
 * created. If a later step fails, projectDir is cleaned up (see cleanupProjectDir) and the
 * original error is rethrown with "; cleaned up <projectDir>" appended to its message, so a retry
 * never has to manually delete a half built directory first.
 *
 * A complete run closes by offering the global install that makes the bare `eep` in its own next
 * steps true, unless installOffer is false. See lib/install-offer.ts.
 */
export async function runInit(opts: InitOptions): Promise<void> {
  validateName(opts.name);

  const plan = planLayout(opts, opts.tokens ?? []);

  const projectDir = join(opts.targetDir, opts.name);
  const projectDirExistedBefore = ensureEmptyProjectDir(projectDir);

  try {
    if (plan.mode === "single") {
      await materializeSingle(plan.scaffoldDir, projectDir, opts);
    } else {
      await materializeComposed(plan, projectDir, opts);
    }

    printNextSteps(opts.name);
  } catch (error) {
    cleanupProjectDir(projectDir, projectDirExistedBefore);
    if (error instanceof Error) {
      error.message = `${error.message}; cleaned up ${projectDir}`;
      throw error;
    }
    throw new Error(`${String(error)}; cleaned up ${projectDir}`);
  }

  // Outside the cleanup guarded block on purpose. The catch above rethrows, so this runs only
  // after a complete success, and an offer to install a convenience shim can never reach the path
  // that deletes the project it just built.
  if (opts.installOffer !== false) await offerGlobalInstall();
}

type InitCliOptions = { pack: string; dir: string; installOffer: boolean };

export function register(program: Command): void {
  program
    .command("init")
    .description("scaffold a new, EEP compliant project from one corpus pack or several")
    .argument("<name>", "project name: lowercase letters, digits, underscores")
    .argument("[tokens...]", "framework tokens to compose the project from, space separated")
    .option(
      "--pack <pack>",
      "which corpus pack to scaffold from when no tokens are given",
      DEFAULT_PACK,
    )
    .option("--dir <target>", "directory to create the project under", process.cwd())
    .option("--no-install-offer", "skip the global install offer and its hint (CI and scripts)")
    .action(async (name: string, tokens: string[], options: InitCliOptions) => {
      try {
        await runInit({
          name,
          targetDir: options.dir,
          corpusDir: corpusRoot(),
          pack: options.pack,
          tokens,
          installOffer: options.installOffer,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
