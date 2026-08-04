import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Command } from "commander";
import { execa } from "execa";
import fg from "fast-glob";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveBlueprintSelection, slicesFromFlag } from "../lib/blueprint.js";
import { corpusRoot } from "../lib/corpus-root.js";
import { invocation } from "../lib/eep-on-path.js";
import { resolveFrameworks, validTokens } from "../lib/frameworks.js";
import {
  componentInstructionFiles,
  generateAgentFiles,
  lockedPackLayout,
  rootSurfaceFiles,
} from "../lib/generate.js";
import { offerGlobalInstall } from "../lib/install-offer.js";
import { findPackDir, loadPack } from "../lib/pack.js";
import type { ToolToken } from "../lib/tools.js";
import { vendorInto } from "../lib/vendor.js";
import { applyComposedWiring } from "../lib/wiring.js";
import {
  buildEepYamlContent,
  installGitHook,
  resolveTools,
  runAdopt,
  toolsFromFlag,
  type WritableProfile,
} from "./adopt.js";

export type InitOptions = {
  name: string;
  targetDir: string;
  corpusDir: string;
  pack?: string;
  // Framework tokens, as typed on the command line. Empty (or omitted) selects the single pack
  // scaffold; anything else composes one project out of every pack the tokens resolve to. A single
  // token that names a blueprint expands into that blueprint's pack set (see resolveBlueprintSelection).
  tokens?: string[];
  // Blueprint slices to include, meaningful only when a token names a blueprint. Each adds its
  // slice's packs to the composed set; a slice whose pack is not built yet is reported and skipped.
  withSlices?: string[];
  // Which backend a blueprint composes, meaningful only when a token names a blueprint. Swaps the
  // stack pack the blueprint lists as its default backend for the one this token maps to (see
  // resolveBlueprintSelection). Undefined or empty keeps the blueprint's default backend.
  backend?: string;
  // Whether a blueprint composes onto its serverless compute, meaningful only when a token names a
  // blueprint. When true, swaps the platform pack the blueprint lists as its default (Fargate) compute
  // for the serverless one, so the same full app composes onto AWS Lambda behind API Gateway (see
  // resolveBlueprintSelection). Undefined or false keeps the blueprint's default Fargate compute.
  serverless?: boolean;
  // Omitted means "offer it". Only an explicit false (--no-install-offer) silences both the
  // prompt and the hint, which is what CI and scripted runs want.
  installOffer?: boolean;
  // The AI coding tools to generate for, as raw tokens. Undefined resolves one the same way adopt
  // does: prompt in a TTY, else the AGENTS.md baseline for a fresh project (see resolveTools). The
  // selection is resolved once and threaded into whichever materialize path runs.
  tools?: string[];
};

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const DEFAULT_PACK = "python-fastapi";
const PROJECT_NAME_TOKEN = "{{project_name}}";

const GITHUB_DIR = ".github";
const ROOT_WORKFLOW = `${GITHUB_DIR}/workflows/ci.yml`;

/**
 * Repository level config files two root packs may each legitimately contribute to, merged rather
 * than collided.
 *
 * `.github/dependabot.yml` is the case the aws-fullstack blueprint is first to hit: containers-k8s
 * ships an updates entry for the docker ecosystem and github-actions ships one for the github-actions
 * ecosystem, and dependabot expects both in one file. Refusing the pair as a collision would block a
 * composition that is entirely correct, and letting the second copy win would silently drop the
 * first pack's ecosystem, which is exactly the silent replacement the collision guard exists to
 * prevent. So the file is exempt from that guard (see rejectCollidingRootFiles) and generated as the
 * union of every root pack's updates entries (see buildRootDependabot), the same way `.gitignore` is
 * unioned. Workflow files under `.github/workflows/` are deliberately not here: CI is authoritative,
 * so two packs shipping one workflow stays a hard collision.
 */
const MERGED_ROOT_FILES = new Set([`${GITHUB_DIR}/dependabot.yml`]);

/**
 * The files a composed root writes for itself and will not accept from a pack.
 *
 * A root placed scaffold shipping one of these would either be silently overwritten by the
 * generated version or silently overwrite it, and either way the repository would end up with a
 * file nobody chose. Shipping one is refused by name (see rejectRootScaffoldConflicts).
 *
 * Two deliberate absences:
 *
 * `.gitignore` is merged rather than generated, so a root scaffold's entries are kept alongside the
 * components' (see buildRootGitignore).
 *
 * `.github/workflows/ci.yml` is generated only when no pack provides one. A delivery pack whose
 * whole purpose is continuous delivery knows more about this repository's CI than a generic
 * generator does (guarded per component jobs, environment promotion, approvals), so pack owned CI
 * wins and the generic is skipped rather than either file being refused. See rootWorkflowProvider.
 */
const GENERATED_ROOT_FILES = ["README.md", "Makefile"];

// A project eep created is a project with no history to be compatible with, so both init paths
// vendor under the strictest profile.
const INIT_PROFILE: WritableProfile = "greenfield";

// Pinned to the single pack path's only pack rather than interpolated from the resolved pack name:
// both the task brief and dispatch fix this exact commit message, independent of which --pack was
// requested. The composed path names its own set instead (see composedCommitMessage).
const SCAFFOLD_COMMIT_MESSAGE = "feat: scaffold from eep python-fastapi pack";

/**
 * The second commit: the governance the scaffold commit could not carry.
 *
 * `.eep/`, the agent instructions, `eep.yaml`, and the pre-commit hook are all written after the
 * scaffold is committed, because vendoring reads the rendered tree to decide what to pin. Left
 * there, `eep init` finished by handing back a repository whose very first `git status` reported
 * four untracked paths, and the one thing that made it a governed repository was the part that was
 * not committed. One more commit, naming exactly those paths, closes it.
 *
 * The message is fixed rather than interpolated from the pack set: the scaffold commit already
 * names which packs built the tree, and this one is about adopting the gate, which is the same act
 * whatever the tree is made of.
 */
const ADOPT_COMMIT_MESSAGE = "chore: adopt engineering excellence gates";

// The vendor and generate outputs that are always written, whatever the tool selection: the vendored
// tree and the human readable record. The agent instruction surfaces are added per selection at commit
// time (see gitCommitGeneratedArtifacts), because which of them exist now depends on the chosen tools.
// Never `git add -A`: a second sweeping commit would also pick up anything the scaffold's own
// .gitignore does not cover, and a command that commits files the user did not ask it to commit is
// worse than one that leaves them. .git/hooks/pre-commit is deliberately absent: git does not track
// its own hooks directory, so the installed hook is a fact about the checkout rather than a committable
// file.
const GENERATED_ARTIFACTS = [".eep", "eep.yaml"];

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

function scaffoldFiles(scaffoldDir: string): string[] {
  return fg.sync("**/*", { cwd: scaffoldDir, dot: true, onlyFiles: true }).sort();
}

// npm silently drops any file named `.gitignore` from a published tarball (it reads such a file as
// pack ignore rules rather than shipping it), which is why a generated project used to arrive with
// no `.gitignore` at all. So a scaffold stores its ignore file as `gitignore`, without the leading
// dot, which survives publish, and the dot is restored here, on the single path every scaffold file
// takes into a generated project. The emitted project then carries a real `.gitignore` however the
// CLI was installed, and running from a source checkout produces the same result as running from the
// published package. See scripts/bundle-corpus.mjs and packs/*/*/scaffold/gitignore.
const SCAFFOLD_GITIGNORE = "gitignore";
function emittedRelPath(relPath: string): string {
  return basename(relPath) === SCAFFOLD_GITIGNORE ? join(dirname(relPath), ".gitignore") : relPath;
}

// Every scaffold file is UTF-8 text (no binary assets under packs/*/*/scaffold today), so one
// read-replace-write pass over every file, dotfiles included, covers the whole tree without a
// separate binary copy path.
function copyScaffold(
  scaffoldDir: string,
  destDir: string,
  name: string,
  skip?: (relPath: string) => boolean,
): void {
  for (const relPath of scaffoldFiles(scaffoldDir)) {
    if (skip?.(relPath) === true) continue;
    const destPath = join(destDir, emittedRelPath(relPath));
    mkdirSync(dirname(destPath), { recursive: true });
    const content = readFileSync(join(scaffoldDir, relPath), "utf8");
    writeFileSync(destPath, content.replaceAll(PROJECT_NAME_TOKEN, name));
  }
}

// CI belongs to a repository, not to a directory inside one. A component scaffold's own workflows
// describe how to gate that stack when it is the whole repository, which is exactly what it is not
// once it is composed: the composed root generates one workflow covering every component (see
// buildRootWorkflow), and a copy buried in backend/.github would never run on any push while
// looking, to a reader and to EEP-DLV-01 alike, as though CI existed.
function isWorkflowPath(relPath: string): boolean {
  return relPath === GITHUB_DIR || relPath.startsWith(`${GITHUB_DIR}/`);
}

// Where a root placed pack keeps one file per component it can containerize, and what it calls
// them: docker/<component_dir>.Dockerfile. See skipUnselectedComponentFiles.
const DOCKER_DIR = "docker";
const DOCKERFILE_SUFFIX = ".Dockerfile";

// Every component directory any pack in this corpus claims, whether or not it was selected. This
// is the vocabulary that lets a per component file be recognized as one: a Dockerfile named after
// a directory no pack has ever claimed belongs to the pack that shipped it and is left alone.
function corpusComponentDirs(corpusDir: string): Set<string> {
  const dirs = new Set<string>();
  for (const relPath of fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort()) {
    const manifest = loadPack(dirname(join(corpusDir, relPath))).manifest;
    const componentDir = toOptionalString(manifest.component_dir);
    if (componentDir !== null) dirs.add(componentDir);
  }
  return dirs;
}

/**
 * Skips the per component files a root placed scaffold ships for components this project does not
 * have.
 *
 * A root placed pack renders the same scaffold whatever it is composed with, which is right for
 * everything that describes the repository (the compose file, the ignore file) and wrong for the
 * files that describe one component each. `docker/service.Dockerfile` copies `service/package.json`
 * and `service/src` out of the build context; in a project composed without typescript-node there
 * is no `service/`, so every one of its COPY sources resolves to nothing and the image cannot
 * build. The file is committed, it is named after a directory that does not exist, and nothing in
 * the repository records that it was never meant to be there.
 *
 * Only files named after a component directory some pack claims and this project did not select are
 * dropped. The compose file is deliberately left whole: every service in it sits behind a profile,
 * so the file still parses with a Dockerfile gone. `--profile all up --build` then fails loudly,
 * naming the missing file, while a single present component's own profile (`--profile backend`)
 * still builds and starts clean. Rewriting a pack's own YAML from here would put this program in
 * the business of editing pack content.
 */
function skipUnselectedComponentFiles(
  unselected: ReadonlySet<string>,
): ((relPath: string) => boolean) | undefined {
  if (unselected.size === 0) return undefined;
  return (relPath) => {
    if (!relPath.startsWith(`${DOCKER_DIR}/`) || !relPath.endsWith(DOCKERFILE_SUFFIX)) return false;
    const stem = relPath.slice(DOCKER_DIR.length + 1, -DOCKERFILE_SUFFIX.length);
    return unselected.has(stem);
  };
}

// The one sanctioned git use in runInit: initializing and committing the project directory it
// just created. Never runs against the eep corpus checkout itself.
async function gitInitAndCommit(projectDir: string, message: string): Promise<void> {
  const env = GIT_IDENTITY_ENV;
  await execa("git", ["init"], { cwd: projectDir, env });
  await execa("git", ["add", "-A"], { cwd: projectDir, env });
  await execa("git", ["commit", "-m", message], { cwd: projectDir, env });
}

/**
 * Commits the generated artifacts, and only those, into the repository the scaffold commit created.
 *
 * `--no-verify` is not a way around the gate. The pre-commit hook this run installed moments ago
 * would otherwise fire on the commit that installs it, and on a machine with no global install it
 * resolves the gate through `npx -y engineering-excellence`, so `eep init` would reach the network
 * to check a tree it just wrote itself. The gate is for the commits that follow this one, every one
 * of which a developer makes with the hook in place.
 *
 * A composed project's component instruction files are committed here too, read back off the lock
 * the run just wrote rather than derived from the plan: the lock is what decided where they went,
 * and a component file left untracked is the same defect as an untracked root CLAUDE.md, one
 * directory down.
 *
 * The agent surfaces committed are exactly the ones the selection produced, root and component alike,
 * so a project generated for cursor and copilot commits those two and no empty CLAUDE.md. Paths that
 * do not exist are filtered out rather than passed to git, which refuses an unmatched pathspec
 * outright, which also covers a selection of none writing no surfaces at all.
 */
async function gitCommitGeneratedArtifacts(
  projectDir: string,
  tools: readonly ToolToken[],
): Promise<void> {
  const env = GIT_IDENTITY_ENV;
  const generated = [
    ...GENERATED_ARTIFACTS,
    ...rootSurfaceFiles(tools),
    ...componentInstructionFiles(lockedPackLayout(projectDir), tools),
  ];
  const paths = generated.filter((relPath) => existsSync(join(projectDir, relPath)));
  if (paths.length === 0) return;
  await execa("git", ["add", "--", ...paths], { cwd: projectDir, env });

  // git refuses an empty commit, and a project whose generated artifacts happened to match what the
  // scaffold already committed would otherwise abort here and be rolled back whole. Nothing staged
  // means there is nothing this commit would have had to say. `git diff --cached --quiet` exits
  // non zero exactly when something is staged, which is why the result is read rather than thrown.
  const staged = await execa("git", ["diff", "--cached", "--quiet"], {
    cwd: projectDir,
    env,
    reject: false,
  });
  if (staged.exitCode === 0) return;

  await execa("git", ["commit", "--no-verify", "-m", ADOPT_COMMIT_MESSAGE], {
    cwd: projectDir,
    env,
  });
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

/**
 * Two packs rendering at the repository root must not both write the same file.
 *
 * Unlike component directories, which are one per pack by construction, the root is shared, so two
 * root placed scaffolds can overlap on any path at all. The loser would be whichever pack happened
 * to be copied second, and nothing in the result would record that a file had been replaced. Both
 * packs and the exact path are named, because the fix depends on which file it is.
 */
function rejectCollidingRootFiles(placements: Placement[]): void {
  const owner = new Map<string, string>();
  for (const placement of placements) {
    if (placement.componentDir !== null || placement.scaffoldDir === null) continue;
    for (const relPath of scaffoldFiles(placement.scaffoldDir)) {
      // A merged root file is contributed by design, not collided: see MERGED_ROOT_FILES.
      if (MERGED_ROOT_FILES.has(relPath)) continue;
      const first = owner.get(relPath);
      if (first !== undefined) {
        throw new Error(
          `eep: packs ${first} and ${placement.pack} both write ${relPath} at the repository root`,
        );
      }
      owner.set(relPath, placement.pack);
    }
  }
}

/**
 * The pack whose root placed scaffold provides the repository's CI workflow, if any.
 *
 * `.github/workflows/ci.yml` is the one generated root file a pack is allowed to own. A delivery
 * pack exists to know how this repository ships: its workflow carries guarded per component jobs,
 * environment promotion, and approvals, all of which are strictly richer than what a generic
 * generator can infer from a list of component directories. So when a pack provides one, it is
 * copied and the generic is not written at all, and the run says so rather than leaving the reader
 * to wonder which of the two they got.
 *
 * Two root packs both shipping it is still a collision like any other, caught by
 * rejectCollidingRootFiles: this exemption is about pack versus generated, never pack versus pack.
 */
function rootWorkflowProvider(placements: Placement[]): string | null {
  for (const placement of placements) {
    if (placement.componentDir !== null || placement.scaffoldDir === null) continue;
    if (scaffoldFiles(placement.scaffoldDir).includes(ROOT_WORKFLOW)) return placement.pack;
  }
  return null;
}

// A root placed scaffold may not ship a file the composed root generates for itself. Refused rather
// than resolved by ordering: whichever way it were ordered, one of the two files would be lost, and
// a repository whose README is not the one its author expects is worse than a run that stopped and
// said which pack to talk to. The CI workflow is the documented exception; see
// rootWorkflowProvider.
function rejectRootScaffoldConflicts(placements: Placement[]): void {
  for (const placement of placements) {
    if (placement.componentDir !== null || placement.scaffoldDir === null) continue;
    for (const relPath of scaffoldFiles(placement.scaffoldDir)) {
      if (GENERATED_ROOT_FILES.includes(relPath)) {
        throw new Error(
          `eep: pack ${placement.pack} ships ${relPath} at the repository root, which a composed init generates`,
        );
      }
    }
  }
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
 * has no component to put there, two packs claiming one directory or one root file would overwrite
 * each other, a root scaffold shipping a file the root generates would be overwritten by it, and a
 * set with no stack pack is a repository of supporting files around an application that was never
 * chosen.
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
  rejectCollidingRootFiles(placements);
  rejectRootScaffoldConflicts(placements);

  if (!placements.some((placement) => placement.kind === "stack")) {
    throw new Error(`eep: composed init needs at least one stack pack; got ${packs.join(", ")}`);
  }

  return placements;
}

function planLayout(opts: InitOptions, tokens: string[]): Plan {
  if (tokens.length === 0) {
    // A single pack init names no blueprint, so a backend or compute swap has nothing to apply to;
    // refusing them here mirrors resolveBlueprintSelection's refusal of --backend and --serverless
    // when tokens name no blueprint, so `eep init myapp --backend node` and `eep init myapp
    // --serverless` fail the same way whether or not a framework token follows.
    if ((opts.backend ?? "").trim() !== "") {
      throw new Error("eep: --backend only applies to a blueprint token; none was given");
    }
    if (opts.serverless === true) {
      throw new Error("eep: --serverless only applies to a blueprint token; none was given");
    }
    return {
      mode: "single",
      scaffoldDir: findScaffoldDir(opts.corpusDir, opts.pack ?? DEFAULT_PACK),
    };
  }

  // A blueprint token expands into its pack set before framework resolution, so composed init sees
  // an ordinary list of packs. resolveBlueprintSelection refuses a blueprint mixed with any other
  // token, and refuses --with or --backend when no blueprint was named, both before the project
  // directory exists. When no token names a blueprint it returns the tokens untouched.
  const selection = resolveBlueprintSelection(
    tokens,
    opts.withSlices ?? [],
    opts.corpusDir,
    opts.backend,
    opts.serverless,
  );
  const effectiveTokens = selection.blueprint === null ? tokens : selection.packs;

  const { packs, comingSoon, unknown } = resolveFrameworks(effectiveTokens, opts.corpusDir);
  rejectUnknownTokens(unknown, opts.corpusDir);
  // Separate from the "no stack pack" refusal below, and worded like the root sync's, because
  // nothing was wrong with what the user typed: every token they named is simply still on the
  // roadmap, and naming them back would read as an accusation.
  if (packs.length === 0) {
    throw new Error("eep: nothing to compose; no requested framework has a pack yet");
  }

  const placements = planComposedLayout(opts.corpusDir, packs);

  // Printed only once the layout is known to be buildable. A run that is about to abort should say
  // why it aborted, not first report progress on a project it will never create.
  if (selection.blueprint !== null) {
    console.log(
      `eep init: composing blueprint ${selection.blueprint}: ${selection.packs.join(", ")}`,
    );
  }
  if (comingSoon.length > 0) {
    console.log(`eep init: coming soon, skipped: ${comingSoon.join(", ")}`);
  }
  // A wave 1 slice references a pack that is not built yet, so a requested slice is reported the
  // same way an unbuilt framework token is, and the core composes without it.
  if (selection.pendingSlicePacks.length > 0) {
    console.log(`eep init: coming soon, skipped: ${selection.pendingSlicePacks.join(", ")}`);
  }

  return { mode: "composed", packs, placements };
}

// Targets that fan out into the components. `verify` is deliberately not among them.
const FANOUT_TARGETS = ["setup", "test"] as const;

// The gate, in the one form the shell running it actually has: a bare `eep` when a global install
// put one on PATH, the published package otherwise, so the gate runs for a consumer who has never
// installed anything. `@` because make would otherwise echo the whole conditional before running it,
// which reads as noise above the gate's own output.
const VERIFY_FALLBACK = [
  "\t@if command -v eep >/dev/null 2>&1; then eep verify; \\",
  "\telse npx -y engineering-excellence verify; fi",
];

/**
 * The root Makefile.
 *
 * `setup` and `test` fan out into every component carrying a Makefile of its own. `verify` does
 * not, and that is the whole point: a component's own `verify` target runs the eep gate from inside
 * that component, where there is no `.eep` directory (the composed repository has exactly one, at
 * the root), so recursing into it could only ever produce "no .eep found" and fail. The root gate
 * already covers every component, because it resolves every pack's laws against every pack's pinned
 * workdir, so recursion would be wrong even if it worked.
 *
 * The `-f $$c/Makefile` guard is not redundant with the generated COMPONENTS list. The list is a
 * fact about the day the project was created, and a component removed or replaced afterwards must
 * degrade to being skipped rather than breaking every target in the repository.
 */
function buildRootMakefile(componentDirs: string[]): string {
  const lines: string[] = [
    `.PHONY: ${[...FANOUT_TARGETS, "verify"].join(" ")}`,
    `COMPONENTS = ${componentDirs.join(" ")}`,
    "",
  ];
  for (const target of FANOUT_TARGETS) {
    lines.push(`${target}:`);
    lines.push("\t@for c in $(COMPONENTS); do \\");
    lines.push(`\t  if [ -f $$c/Makefile ]; then $(MAKE) -C $$c ${target} || exit 1; fi; \\`);
    lines.push("\tdone");
    lines.push("");
  }
  lines.push("verify:", ...VERIFY_FALLBACK, "");
  return lines.join("\n");
}

/**
 * The root CI workflow.
 *
 * Generated rather than inherited from a component: a component scaffold's workflow gates that
 * stack as though it were the whole repository, and once composed it is not. One job per component
 * runs that component's own test target where the component actually is, and a final gate job runs
 * the eep gate over the whole tree, which is the only place every pack's laws are resolved together.
 *
 * The gate job is also what EEP-DLV-01 finds: its check greps the repository's workflows for the
 * words `eep verify`, and the workflows a composed repository has are exactly these.
 */
function buildRootWorkflow(componentDirs: string[]): string {
  const lines = ["name: ci", "on:", "  push:", "    branches: [main]", "  pull_request:", "jobs:"];
  for (const dir of componentDirs) {
    lines.push(
      `  test-${dir}:`,
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      `      - name: ${dir} tests`,
      `        run: cd ${dir} && make test`,
    );
  }
  lines.push(
    "  gate:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      # The whole law set, every pack, every component: eep verify",
    "      - name: eep verify",
    "        run: if command -v eep >/dev/null 2>&1; then eep verify; else npx -y engineering-excellence verify; fi",
    "",
  );
  return lines.join("\n");
}

// Only the components that actually exist on disk. A pack can claim a component directory and ship
// no scaffold to fill it, and a README naming a directory the reader cannot open is worse than one
// that says nothing about it.
function buildRootReadme(name: string, componentDirs: string[], placements: Placement[]): string {
  const owner = new Map(
    placements.flatMap((placement) =>
      placement.componentDir === null ? [] : [[placement.componentDir, placement.pack] as const],
    ),
  );
  const components = componentDirs.map(
    (dir) => `- \`${dir}\`: ${owner.get(dir) ?? "unknown pack"}`,
  );

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
    "- `make verify`: run the full eep gate over every component, from the root.",
    "",
    "The laws in force, the pack enforcing each one, and the command that proves it are listed in",
    "CLAUDE.md, which eep generates. Each component directory carries its own generated CLAUDE.md",
    "with that component's golden path. Do not edit either by hand.",
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

// Identifies one dependabot updates entry for deduplication: an ecosystem watched in a directory is
// the unit dependabot itself keys on, so two packs naming the same pair contribute one entry, and
// anything that is not a well formed entry falls back to its serialized form rather than being
// dropped or merged with an unrelated one.
function dependabotEntryKey(entry: unknown): string {
  if (entry === null || typeof entry !== "object") return JSON.stringify(entry);
  const ecosystem = (entry as { "package-ecosystem"?: unknown })["package-ecosystem"];
  const directory = (entry as { directory?: unknown }).directory;
  if (typeof ecosystem === "string" && typeof directory === "string") {
    return `${ecosystem}::${directory}`;
  }
  return JSON.stringify(entry);
}

/**
 * The root `.github/dependabot.yml`: one `version: 2` document whose `updates` list is the union of
 * every root pack's own entries, in first seen order and deduplicated by ecosystem and directory.
 *
 * Read from each pack's scaffold (with the project name substituted, so a token in a path resolves)
 * rather than from the copied tree, because the copy keeps only the last writer at the shared path.
 * Returns null when no root pack ships one, so the caller writes nothing and a project without any
 * dependabot config stays that way. Comments in the source files are not carried: the merged file is
 * generated, and stitching two packs' header comments together would say less than the entries do.
 */
function buildRootDependabot(scaffoldDirs: string[], name: string): string | null {
  const updates: unknown[] = [];
  const seen = new Set<string>();
  let found = false;

  for (const dir of scaffoldDirs) {
    const path = join(dir, `${GITHUB_DIR}/dependabot.yml`);
    if (!existsSync(path)) continue;
    found = true;
    const parsed: unknown = parseYaml(
      readFileSync(path, "utf8").replaceAll(PROJECT_NAME_TOKEN, name),
    );
    const entries = (parsed as { updates?: unknown }).updates;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const key = dependabotEntryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      updates.push(entry);
    }
  }

  if (!found) return null;
  return stringifyYaml({ version: 2, updates });
}

// The composed equivalent of runAdopt's tail, minus detection: a composed root carries no
// application files of its own to detect a pack from, so the set the user named on the command
// line is vendored directly. The tool selection was resolved once in runInit and is threaded through
// so the composed root and the single path store and generate for the identical set.
function syncAtRoot(
  projectDir: string,
  corpusDir: string,
  packs: string[],
  tools: readonly ToolToken[],
): void {
  vendorInto(projectDir, corpusDir, packs, INIT_PROFILE);
  writeFileSync(join(projectDir, "eep.yaml"), buildEepYamlContent(INIT_PROFILE, packs, tools));
  generateAgentFiles(projectDir, tools);
  installGitHook(projectDir);
}

/**
 * Renders the whole composed tree.
 *
 * Order is load bearing. Every pack scaffold, component placed and root placed alike, is copied
 * first; the generated root files are written last, over a tree whose pack contributed contents are
 * already final. That way `.gitignore` can be merged from what the packs actually wrote (including
 * a root pack's own), and the generated README and Makefile describe the components that exist
 * rather than the ones that were planned. Planning has already refused the case where a root pack
 * ships one of the generated files, so writing last cannot destroy anything a pack contributed.
 */
async function materializeComposed(
  plan: { packs: string[]; placements: Placement[] },
  projectDir: string,
  opts: InitOptions,
  tools: readonly ToolToken[],
): Promise<void> {
  const selected = new Set(
    plan.placements.flatMap((placement) =>
      placement.componentDir === null ? [] : [placement.componentDir],
    ),
  );
  const unselected = new Set(
    [...corpusComponentDirs(opts.corpusDir)].filter((dir) => !selected.has(dir)),
  );
  const skipUnselected = skipUnselectedComponentFiles(unselected);

  const destDirs: string[] = [];
  for (const placement of plan.placements) {
    if (placement.scaffoldDir === null) continue;
    const isComponent = placement.componentDir !== null;
    const destDir =
      placement.componentDir === null ? projectDir : join(projectDir, placement.componentDir);
    copyScaffold(
      placement.scaffoldDir,
      destDir,
      opts.name,
      isComponent ? isWorkflowPath : skipUnselected,
    );
    destDirs.push(destDir);
  }

  const componentDirs = plan.placements
    .flatMap((placement) => (placement.componentDir === null ? [] : [placement.componentDir]))
    .filter((dir) => existsSync(join(projectDir, dir)));
  const buildableDirs = componentDirs.filter((dir) =>
    existsSync(join(projectDir, dir, "Makefile")),
  );

  writeFileSync(
    join(projectDir, "README.md"),
    buildRootReadme(opts.name, componentDirs, plan.placements),
  );
  writeFileSync(join(projectDir, "Makefile"), buildRootMakefile(buildableDirs));

  // Pack owned CI wins, and the copy is left exactly as the pack wrote it. Announced because
  // "where did my CI come from" is otherwise answerable only by reading the file.
  const workflowProvider = rootWorkflowProvider(plan.placements);
  if (workflowProvider === null) {
    const workflowPath = join(projectDir, ROOT_WORKFLOW);
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, buildRootWorkflow(buildableDirs));
  } else {
    console.log(`eep init: root ci provided by ${workflowProvider}`);
  }

  const gitignore = buildRootGitignore(destDirs);
  if (gitignore !== "") writeFileSync(join(projectDir, ".gitignore"), gitignore);

  // When two root packs each ship a dependabot config, copyScaffold has left only the last writer at
  // the shared path, so regenerate it as the union of their updates entries (see buildRootDependabot).
  // A single contributor is already correct on disk and keeps its own file, comments and all.
  const dependabotDirs = plan.placements
    .flatMap((placement) =>
      placement.componentDir === null && placement.scaffoldDir !== null
        ? [placement.scaffoldDir]
        : [],
    )
    .filter((dir) => existsSync(join(dir, `${GITHUB_DIR}/dependabot.yml`)));
  if (dependabotDirs.length > 1) {
    const dependabot = buildRootDependabot(dependabotDirs, opts.name);
    if (dependabot !== null) {
      const dependabotPath = join(projectDir, GITHUB_DIR, "dependabot.yml");
      mkdirSync(dirname(dependabotPath), { recursive: true });
      writeFileSync(dependabotPath, dependabot);
    }
  }

  // Data driven wiring: a composed data pack that provides a repository swaps each composed target
  // backend's in memory implementation for its own, behind the unchanged interface, and composes its
  // table construct into the infra stack (see lib/wiring.ts). It runs over the rendered tree here,
  // after every scaffold and every generated root file is final and before the scaffold commit, so
  // the swap is committed with the scaffold rather than left behind as an untracked edit. A single
  // pack (non composed) init never reaches this path, so it never triggers wiring.
  const wiring = applyComposedWiring({
    projectDir,
    corpusDir: opts.corpusDir,
    name: opts.name,
    placements: plan.placements,
  });
  if (wiring.providers.length > 0) {
    console.log(
      `eep init: wired ${wiring.providers.join(", ")} into the composed backend and infra`,
    );
  }

  await gitInitAndCommit(projectDir, composedCommitMessage(plan.packs));
  syncAtRoot(projectDir, opts.corpusDir, plan.packs, tools);
}

async function materializeSingle(
  scaffoldDir: string,
  projectDir: string,
  opts: InitOptions,
  tools: readonly ToolToken[],
): Promise<void> {
  copyScaffold(scaffoldDir, projectDir, opts.name);
  await gitInitAndCommit(projectDir, SCAFFOLD_COMMIT_MESSAGE);
  // The selection is passed as explicit tokens, so runAdopt uses it directly and never re prompts:
  // runInit already asked the tool question once, before any directory was created.
  await runAdopt({
    targetDir: projectDir,
    corpusDir: opts.corpusDir,
    profile: INIT_PROFILE,
    yes: true,
    tools: [...tools],
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
 * Either mode ends on two commits: the scaffold, then the governance the vendor step could only
 * write once the scaffold existed (see gitCommitGeneratedArtifacts). A finished init hands back a
 * clean working tree, not a governed repository whose governance is untracked.
 *
 * With tokens: the same outcome for a project made of several components. Each stack pack's
 * scaffold is rendered into its own component directory, platform and delivery scaffolds into
 * theirs or the repository root, and the root gains a README, a Makefile that fans setup and test
 * into the components while running the whole eep gate at the root for verify (see
 * buildRootMakefile), and the union of their ignore entries. The whole tree is one git
 * repository, and one vendor pass at the root puts every selected pack's laws into a single .eep,
 * a single eep.yaml, and one set of agent instructions. A root placed pack's per component files
 * are filtered to the components this project actually has (see skipUnselectedComponentFiles).
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

  // Resolved once, before the project directory is created, so an unknown --tools token aborts with
  // nothing written (like an unknown framework token), the tool question is asked at most once, and
  // the single and composed paths store and generate for the identical set. A project that does not
  // exist yet has no files to detect from, so without --tools or a prompt this is the AGENTS.md
  // baseline.
  const tools = await resolveTools(projectDir, opts.tools);

  const projectDirExistedBefore = ensureEmptyProjectDir(projectDir);

  try {
    if (plan.mode === "single") {
      await materializeSingle(plan.scaffoldDir, projectDir, opts, tools);
    } else {
      await materializeComposed(plan, projectDir, opts, tools);
    }

    // Both modes end the same way, so the second commit is made here rather than twice. Inside the
    // guarded block: a repository left with a scaffold commit and uncommitted governance is exactly
    // the half built state cleanupProjectDir exists to prevent.
    await gitCommitGeneratedArtifacts(projectDir, tools);

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

type InitCliOptions = {
  pack: string;
  dir: string;
  installOffer: boolean;
  tools?: string;
  with?: string;
  backend?: string;
  serverless?: boolean;
};

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
    .option(
      "--tools <tokens>",
      "comma separated AI tools to generate for: claude, agents, copilot, cursor, none",
    )
    .option("--with <slices>", "comma separated blueprint slices to include (blueprint token only)")
    .option("--backend <name>", "for a blueprint, which backend to compose, for example node")
    .option(
      "--serverless",
      "for a blueprint, compose onto AWS Lambda and API Gateway instead of Fargate",
    )
    .action(async (name: string, tokens: string[], options: InitCliOptions) => {
      try {
        await runInit({
          name,
          targetDir: options.dir,
          corpusDir: corpusRoot(),
          pack: options.pack,
          tokens,
          installOffer: options.installOffer,
          tools: toolsFromFlag(options.tools),
          withSlices: slicesFromFlag(options.with),
          backend: options.backend,
          serverless: options.serverless,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
