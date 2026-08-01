import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import fg from "fast-glob";
import { corpusRoot } from "../lib/corpus-root.js";
import { runAdopt } from "./adopt.js";

export type InitOptions = {
  name: string;
  targetDir: string;
  corpusDir: string;
  pack?: string;
};

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const DEFAULT_PACK = "python-fastapi";
const PROJECT_NAME_TOKEN = "{{project_name}}";

// Pinned to today's only pack rather than interpolated from the resolved pack name: both the task
// brief and dispatch fix this exact commit message, independent of which --pack was requested.
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
// through a pack.yaml name lookup like lib/vendor.ts's findPackDir: init cares whether there is a
// scaffold to copy, not whether a pack exists at all, and the brief states the "no scaffold"
// condition in exactly these directory terms.
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
function copyScaffold(scaffoldDir: string, projectDir: string, name: string): void {
  const relPaths = fg.sync("**/*", { cwd: scaffoldDir, dot: true, onlyFiles: true }).sort();
  for (const relPath of relPaths) {
    const destPath = join(projectDir, relPath);
    mkdirSync(dirname(destPath), { recursive: true });
    const content = readFileSync(join(scaffoldDir, relPath), "utf8");
    writeFileSync(destPath, content.replaceAll(PROJECT_NAME_TOKEN, name));
  }
}

// The one sanctioned git use in runInit: initializing and committing the project directory it
// just created. Never runs against the eep corpus checkout itself.
async function gitInitAndCommit(projectDir: string): Promise<void> {
  const env = GIT_IDENTITY_ENV;
  await execa("git", ["init"], { cwd: projectDir, env });
  await execa("git", ["add", "-A"], { cwd: projectDir, env });
  await execa("git", ["commit", "-m", SCAFFOLD_COMMIT_MESSAGE], { cwd: projectDir, env });
}

// Two lines, and deliberately not `make verify`: that target shells out to a bare `eep`, which is
// on PATH only once the CLI ships as a package. `make test` is the part of the gate a fresh
// project can run today, so the second line names the whole gate and how to reach it meanwhile.
function printNextSteps(name: string): void {
  console.log(`eep init: next steps: cd ${name} && make setup && make test`);
  console.log(
    "eep init: full gate: eep verify (or npx tsx <corpus>/tools/eep/src/index.ts verify) from the project",
  );
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
 * Greenfield scaffold to compliant repo in one command: validate the project name, copy the
 * requested pack's scaffold with {{project_name}} substituted throughout, commit it as a fresh
 * git repository, then adopt it (greenfield profile, no prompt) so .eep/, AGENTS.md, CLAUDE.md,
 * and the pre-commit gate all exist from the first commit onward.
 *
 * If copying the scaffold, the git steps, or adopt fails, projectDir is cleaned up (see
 * cleanupProjectDir) and the original error is rethrown with "; cleaned up <projectDir>"
 * appended to its message, so a retry never has to manually delete a half built directory first.
 */
export async function runInit(opts: InitOptions): Promise<void> {
  validateName(opts.name);

  const pack = opts.pack ?? DEFAULT_PACK;
  const scaffoldDir = findScaffoldDir(opts.corpusDir, pack);

  const projectDir = join(opts.targetDir, opts.name);
  const projectDirExistedBefore = ensureEmptyProjectDir(projectDir);

  try {
    copyScaffold(scaffoldDir, projectDir, opts.name);
    await gitInitAndCommit(projectDir);

    await runAdopt({
      targetDir: projectDir,
      corpusDir: opts.corpusDir,
      profile: "greenfield",
      yes: true,
    });

    printNextSteps(opts.name);
  } catch (error) {
    cleanupProjectDir(projectDir, projectDirExistedBefore);
    if (error instanceof Error) {
      error.message = `${error.message}; cleaned up ${projectDir}`;
      throw error;
    }
    throw new Error(`${String(error)}; cleaned up ${projectDir}`);
  }
}

type InitCliOptions = { pack: string; dir: string };

export function register(program: Command): void {
  program
    .command("init")
    .description("scaffold a new, EEP compliant project from a corpus pack")
    .argument("<name>", "project name: lowercase letters, digits, underscores")
    .option("--pack <pack>", "which corpus pack to scaffold from", DEFAULT_PACK)
    .option("--dir <target>", "directory to create the project under", process.cwd())
    .action(async (name: string, options: InitCliOptions) => {
      try {
        await runInit({
          name,
          targetDir: options.dir,
          corpusDir: corpusRoot(),
          pack: options.pack,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
