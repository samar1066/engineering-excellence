import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { execa } from "execa";
import fg from "fast-glob";
import { describe, expect, it, vi } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runInit } from "../src/commands/init.js";
import { TIP_LINE } from "../src/lib/install-offer.js";
import { BLOCK_BEGIN_PREFIX, BLOCK_END } from "../src/lib/managed-block.js";
import { repoRoot } from "../src/lib/schema.js";
import type { ToolToken } from "../src/lib/tools.js";
import { childPath } from "./helpers.js";

const corpusDir = repoRoot();

// The CLAUDE.md and AGENTS.md pair. A fresh init with no --tools resolves to the AGENTS.md baseline,
// so tests that assert a CLAUDE.md, root or component, ask for the pair explicitly.
const PAIR: ToolToken[] = ["claude", "agents"];

// The generated managed block of a co owned surface, split on the markers, so a shared body assertion
// can compare the block one tool carries against another's without the differing content around it.
function blockOf(content: string): string {
  const lines = content.split("\n");
  const begin = lines.findIndex((line) => line.startsWith(BLOCK_BEGIN_PREFIX));
  const end = lines.findIndex((line) => line.trim() === BLOCK_END);
  return lines.slice(begin, end + 1).join("\n");
}

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// The same PATH with a stand in for npm's global shim prepended. Never executed: the resolver only
// reads its name, type, and mode.
function pathWithFakeEep(): string {
  const dir = newTargetDir("eep-fake-bin-");
  const file = join(dir, "eep");
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return [dir, childPath()].join(delimiter);
}

async function withPath<T>(value: string, fn: () => T | Promise<T>): Promise<T> {
  const original = process.env.PATH;
  process.env.PATH = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = original;
    }
  }
}

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return lines.join("\n");
}

// A corpus with a python-fastapi scaffold directory but no pack.yaml anywhere. findScaffoldDir
// only looks for packs/*/<pack>/scaffold on disk, so it resolves this fine and copyScaffold plus
// the git commit both succeed; runAdopt's internal detectPacks then finds zero pack manifests to
// match against the new project, so it throws "no pack detected" only after those earlier steps
// already wrote to and committed inside projectDir.
function newScaffoldOnlyCorpusDir(): string {
  const dir = newTargetDir("eep-init-scaffold-only-corpus-");
  const scaffoldDir = join(dir, "packs", "stack", "python-fastapi", "scaffold");
  mkdirSync(scaffoldDir, { recursive: true });
  writeFileSync(join(scaffoldDir, "README.md"), "# {{project_name}}\n");
  return dir;
}

function nonEmptyLines(text: string): string[] {
  return text
    .trim()
    .split("\n")
    .filter((line) => line !== "");
}

// git log lists the newest commit first, so index 0 is the commit init closes on.
async function gitSubjects(projectDir: string): Promise<string[]> {
  const result = await execa("git", ["log", "--format=%s"], { cwd: projectDir });
  return nonEmptyLines(result.stdout);
}

// The paths the HEAD commit actually carries. Existence on disk is not the question these answer:
// the defect was a repository whose governance was written, and then left untracked beside it.
async function gitHeadFiles(projectDir: string): Promise<string[]> {
  const result = await execa("git", ["show", "--name-only", "--format=", "HEAD"], {
    cwd: projectDir,
  });
  return nonEmptyLines(result.stdout);
}

async function gitStatus(projectDir: string): Promise<string> {
  const result = await execa("git", ["status", "--porcelain"], { cwd: projectDir });
  return result.stdout.trim();
}

// Every file under dir except inside .git (git's own internals) and .eep (the vendored corpus
// copy, which is allowed to carry the corpus's own doctrine/pack prose verbatim). The scaffold
// itself, plus the generated AGENTS.md/CLAUDE.md/eep.yaml at the project root, are what must be
// clean of the substitution token.
async function filesExcludingGitAndEep(dir: string): Promise<string[]> {
  return fg("**/*", {
    cwd: dir,
    dot: true,
    onlyFiles: true,
    ignore: ["**/.git/**", "**/.eep/**"],
  });
}

describe("runInit", () => {
  it("scaffolds a project: substitutes the name, commits it, and adopts it", async () => {
    const targetDir = newTargetDir("eep-init-e2e-");

    await runInit({ name: "e2eproof", targetDir, corpusDir, tools: PAIR });

    const projectDir = join(targetDir, "e2eproof");
    expect(existsSync(projectDir)).toBe(true);

    const relFiles = await filesExcludingGitAndEep(projectDir);
    expect(relFiles.length).toBeGreaterThan(0);
    for (const relPath of relFiles) {
      const content = readFileSync(join(projectDir, relPath), "utf8");
      expect(content).not.toContain("{{project_name}}");
    }

    expect(existsSync(join(projectDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(projectDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(true);

    const log = await execa("git", ["log", "--oneline"], { cwd: projectDir });
    expect(log.stdout.trim().split("\n").length).toBeGreaterThanOrEqual(1);

    const pyproject = readFileSync(join(projectDir, "pyproject.toml"), "utf8");
    expect(pyproject).toContain('name = "e2eproof"');
  });

  it("rejects a name that does not match the required pattern", async () => {
    const targetDir = newTargetDir("eep-init-badname-");

    await expect(runInit({ name: "E2E-Proof", targetDir, corpusDir })).rejects.toThrow(
      "must match",
    );
  });

  it("rejects when the project directory already exists and is not empty", async () => {
    const targetDir = newTargetDir("eep-init-exists-");
    const projectDir = join(targetDir, "taken");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, "keep.txt"), "occupied\n");

    await expect(runInit({ name: "taken", targetDir, corpusDir })).rejects.toThrow(
      "already exists",
    );
  });

  it("rejects an unknown pack", async () => {
    const targetDir = newTargetDir("eep-init-badpack-");

    await expect(
      runInit({ name: "nopack", targetDir, corpusDir, pack: "does-not-exist" }),
    ).rejects.toThrow("has no scaffold");
  });

  /**
   * The governance a scaffold commit cannot carry.
   *
   * .eep/, the agent files, and eep.yaml are written after the scaffold is committed, because the
   * vendor step reads the rendered tree to decide what to pin. Init used to stop there, so the
   * first `git status` a new project ever ran reported four untracked paths, and the part that made
   * it a governed repository was the part nobody had committed.
   */
  it("commits the scaffold and then the governance, leaving a clean working tree", async () => {
    const targetDir = newTargetDir("eep-init-commits-");

    await runInit({ name: "twocommits", targetDir, corpusDir, installOffer: false, tools: PAIR });

    const projectDir = join(targetDir, "twocommits");
    expect(await gitSubjects(projectDir)).toEqual([
      "chore: adopt engineering excellence gates",
      "feat: scaffold from eep python-fastapi pack",
    ]);

    const committed = await gitHeadFiles(projectDir);
    expect(committed).toContain(".eep/lock.yaml");
    expect(committed).toContain("CLAUDE.md");
    expect(committed).toContain("AGENTS.md");
    expect(committed).toContain("eep.yaml");
    // Exactly the generated artifacts for this selection: the second commit never sweeps up anything
    // beside them, and the pair selection adds no copilot or cursor surface.
    for (const relPath of committed) {
      expect(
        relPath === "eep.yaml" ||
          relPath === "AGENTS.md" ||
          relPath === "CLAUDE.md" ||
          relPath.startsWith(".eep/"),
        relPath,
      ).toBe(true);
    }

    expect(await gitStatus(projectDir)).toBe("");
  });

  // The tool selection reaches the second commit: a project generated for copilot and cursor commits
  // those surfaces too, and the working tree is still clean afterward.
  it("commits the copilot and cursor surfaces when they are selected", async () => {
    const targetDir = newTargetDir("eep-init-commits-tools-");

    await runInit({
      name: "toolscommit",
      targetDir,
      corpusDir,
      installOffer: false,
      tools: ["copilot", "cursor"],
    });

    const projectDir = join(targetDir, "toolscommit");
    const committed = await gitHeadFiles(projectDir);
    expect(committed).toContain(".github/copilot-instructions.md");
    expect(committed).toContain(".cursor/rules/eep.mdc");
    expect(committed).not.toContain("CLAUDE.md");
    expect(committed).not.toContain("AGENTS.md");
    expect(await gitStatus(projectDir)).toBe("");
  });

  it("cleans up the project dir it created when a later step fails", async () => {
    const targetDir = newTargetDir("eep-init-cleanup-");
    const scaffoldOnlyCorpusDir = newScaffoldOnlyCorpusDir();
    const projectDir = join(targetDir, "willfail");

    await expect(
      runInit({ name: "willfail", targetDir, corpusDir: scaffoldOnlyCorpusDir }),
    ).rejects.toThrow("cleaned up");

    expect(existsSync(projectDir)).toBe(false);
  });
});

/**
 * The closing lines of init are the first commands a new project ever runs, so they have to name
 * the gate in a form the shell that ran init actually has.
 */
describe("runInit guidance and the global install offer", () => {
  it("names the gate in the npx form and prints one install hint when eep is not on PATH", async () => {
    const targetDir = newTargetDir("eep-init-guidance-npx-");

    const output = await withPath(childPath(), () =>
      captureLog(async () => {
        await runInit({ name: "npxguidance", targetDir, corpusDir });
      }),
    );

    expect(output).toContain(
      "eep init: full gate: npx engineering-excellence verify from the project",
    );
    expect(output).toContain("cd npxguidance && make setup && make test");
    expect(output).not.toContain("eep verify");
    expect(output).toContain(TIP_LINE);
  });

  it("names the gate in the bare form and prints no hint when eep is on PATH", async () => {
    const targetDir = newTargetDir("eep-init-guidance-bare-");

    const output = await withPath(pathWithFakeEep(), () =>
      captureLog(async () => {
        await runInit({ name: "eepguidance", targetDir, corpusDir });
      }),
    );

    expect(output).toContain("eep init: full gate: eep verify from the project");
    expect(output).not.toContain("npx engineering-excellence");
    expect(output).not.toContain(TIP_LINE);
    expect(output).not.toContain("tip:");
  });

  it("suppresses the hint entirely when the install offer is turned off", async () => {
    const targetDir = newTargetDir("eep-init-guidance-nooffer-");

    const output = await withPath(childPath(), () =>
      captureLog(async () => {
        await runInit({ name: "nooffer", targetDir, corpusDir, installOffer: false });
      }),
    );

    expect(output).toContain(
      "eep init: full gate: npx engineering-excellence verify from the project",
    );
    expect(output).not.toContain(TIP_LINE);
    expect(output).not.toContain("tip:");
  });
});

/**
 * Composed init: one project, several components.
 *
 * The corpus itself carries one pack today, so a composed run needs a corpus that carries two. The
 * fixture below is the real python-fastapi pack (the component this program actually ships) plus a
 * minimal second stack pack and a delivery pack, copied alongside the doctrine, schemas, profiles,
 * and constitution the vendor step reads. Everything else about the run, including the vendoring
 * and the generated agent files, is the shipping code path.
 */
const FIXTURE_STACK_PACK = "svcfixture";
const FIXTURE_DELIVERY_PACK = "deliveryfixture";

function writeFile(dir: string, relPath: string, contents: string): void {
  const absPath = join(dir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

function writeFixtureStackPack(corpus: string, componentDir: string): void {
  const packDir = join("packs", "stack", FIXTURE_STACK_PACK);
  writeFile(
    corpus,
    join(packDir, "pack.yaml"),
    stringifyYaml({
      name: FIXTURE_STACK_PACK,
      kind: "stack",
      version: "1.0.0",
      tier: 1,
      source: "builtin",
      detect: [{ file: "svc.json" }],
      component_dir: componentDir,
      workdir: componentDir,
      implements: ["EEP-DEVX-01"],
      authors: [{ name: "EEP Fixture", github: "@fixture" }],
      maintainers: ["@fixture"],
    }),
  );
  writeFile(
    corpus,
    join(packDir, "checks", "manifest.yaml"),
    stringifyYaml({
      checks: [
        {
          law: "EEP-DEVX-01",
          kind: "builtin",
          command: "file-contains Makefile setup",
          proves: "One command setup entry point exists.",
        },
      ],
    }),
  );
  writeFile(corpus, join(packDir, "STACK.md"), "# svcfixture golden path\n\nOne make target.\n");
  writeFile(corpus, join(packDir, "README.md"), "# svcfixture\n\nA fixture pack.\n");
  writeFile(corpus, join(packDir, "bindings", "EEP-DEVX-01.md"), "# Binding\n\nmake setup.\n");
  writeFile(
    corpus,
    join(packDir, "scaffold", "Makefile"),
    ".PHONY: setup test verify\nsetup:\n\t@echo setup {{project_name}}\ntest:\n\t@echo test\nverify:\n\t@echo verify\n",
  );
  writeFile(corpus, join(packDir, "scaffold", "README.md"), "# {{project_name}} service\n");
  // .eep/cache/ is deliberately shared with the python-fastapi scaffold's ignore list: the root
  // file is a union, and a duplicated entry there would be the first sign it is a concatenation.
  writeFile(corpus, join(packDir, "scaffold", ".gitignore"), "node_modules/\n.eep/cache/\n");
}

function writeFixtureDeliveryPack(corpus: string): void {
  const packDir = join("packs", "delivery", FIXTURE_DELIVERY_PACK);
  writeFile(
    corpus,
    join(packDir, "pack.yaml"),
    stringifyYaml({
      name: FIXTURE_DELIVERY_PACK,
      kind: "delivery",
      version: "1.0.0",
      tier: 1,
      source: "builtin",
      detect: [{ file: ".github/workflows" }],
      implements: ["EEP-DLV-01"],
      authors: [{ name: "EEP Fixture", github: "@fixture" }],
      maintainers: ["@fixture"],
    }),
  );
  writeFile(
    corpus,
    join(packDir, "checks", "manifest.yaml"),
    stringifyYaml({
      checks: [
        {
          law: "EEP-DLV-01",
          kind: "builtin",
          command: "file-contains-any .github/workflows 'eep verify'",
          proves: "CI runs the gate.",
        },
      ],
    }),
  );
  writeFile(corpus, join(packDir, "STACK.md"), "# deliveryfixture golden path\n\nOne workflow.\n");
  writeFile(corpus, join(packDir, "README.md"), "# deliveryfixture\n\nA fixture pack.\n");
  writeFile(corpus, join(packDir, "bindings", "EEP-DLV-01.md"), "# Binding\n\nThe workflow.\n");
  // deploy.yml, not ci.yml: ci.yml at the repository root is generated by a composed init, and a
  // pack shipping it is a refusal of its own (see the conflict test below).
  writeFile(
    corpus,
    join(packDir, "scaffold", ".github", "workflows", "deploy.yml"),
    "name: deploy\njobs:\n  ship:\n    steps:\n      - run: echo deploy\n",
  );
}

function newComposedCorpus(componentDir = "svc"): string {
  const corpus = newTargetDir("eep-init-composed-corpus-");
  cpSync(join(corpusDir, "CONSTITUTION.md"), join(corpus, "CONSTITUTION.md"));
  for (const rel of ["schemas", "profiles", "doctrine", join("packs", "stack", "python-fastapi")]) {
    cpSync(join(corpusDir, rel), join(corpus, rel), { recursive: true });
  }
  writeFixtureStackPack(corpus, componentDir);
  writeFixtureDeliveryPack(corpus);
  return corpus;
}

function lockPackNames(projectDir: string): string[] {
  const parsed: unknown = parseYaml(readFileSync(join(projectDir, ".eep", "lock.yaml"), "utf8"));
  const packs = (parsed as { packs?: { name?: string }[] }).packs ?? [];
  return packs.map((entry) => entry.name ?? "");
}

describe("runInit composing several packs", () => {
  it("renders one component per stack pack and a root that drives them", async () => {
    const targetDir = newTargetDir("eep-init-composed-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
    });

    const projectDir = join(targetDir, "shop");
    expect(existsSync(join(projectDir, "backend", "pyproject.toml"))).toBe(true);
    expect(existsSync(join(projectDir, "backend", "app", "main.py"))).toBe(true);
    expect(existsSync(join(projectDir, "svc", "Makefile"))).toBe(true);
    // Nothing from either component leaked into the root.
    expect(existsSync(join(projectDir, "pyproject.toml"))).toBe(false);

    // The name substitution runs inside every component, not only the first.
    expect(readFileSync(join(projectDir, "backend", "pyproject.toml"), "utf8")).toContain(
      'name = "shop"',
    );
    expect(readFileSync(join(projectDir, "svc", "Makefile"), "utf8")).toContain("setup shop");
  });

  it("writes a root Makefile that fans every target into both components", async () => {
    const targetDir = newTargetDir("eep-init-composed-make-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: [FIXTURE_STACK_PACK, "fastapi"],
      installOffer: false,
    });

    const makefile = readFileSync(join(targetDir, "shop", "Makefile"), "utf8");

    expect(makefile).toContain("COMPONENTS = backend svc");
    for (const target of ["setup:", "test:", "verify:"]) {
      expect(makefile).toContain(target);
    }
    expect(makefile).toContain("$(MAKE) -C $$c setup");
    expect(makefile).toContain("$(MAKE) -C $$c test");
    // verify never recurses. A component's own verify target runs the gate from inside that
    // component, where there is no .eep to read, so recursing could only ever fail.
    expect(makefile).not.toContain("$(MAKE) -C $$c verify");
    expect(makefile).toContain("@if command -v eep >/dev/null 2>&1; then eep verify; \\");
    expect(makefile).toContain("else npx -y engineering-excellence verify; fi");
  });

  it("generates a root workflow with a job per component and a gate job", async () => {
    const targetDir = newTargetDir("eep-init-composed-ci-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
    });

    const workflow = readFileSync(
      join(targetDir, "shop", ".github", "workflows", "ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("  test-backend:");
    expect(workflow).toContain("run: cd backend && make test");
    expect(workflow).toContain("  test-svc:");
    expect(workflow).toContain("run: cd svc && make test");
    expect(workflow).toContain("  gate:");
    expect(workflow).toContain("eep verify");
    expect(workflow).toContain("else npx -y engineering-excellence verify; fi");
  });

  // A component scaffold's own workflow gates that stack as though it were the whole repository,
  // which is exactly what it stops being once composed. Left in place it would never run, while
  // looking to a reader, and to EEP-DLV-01, as though CI existed.
  it("does not copy a component scaffold's own workflows into the component", async () => {
    const targetDir = newTargetDir("eep-init-composed-nogh-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi"],
      installOffer: false,
    });

    const projectDir = join(targetDir, "shop");
    expect(existsSync(join(projectDir, "backend", ".github"))).toBe(false);
    expect(existsSync(join(projectDir, ".github", "workflows", "ci.yml"))).toBe(true);
    // The rest of the scaffold still arrived.
    expect(existsSync(join(projectDir, "backend", "pyproject.toml"))).toBe(true);
  });

  it("keeps a single pack init's own workflows exactly where the scaffold puts them", async () => {
    const targetDir = newTargetDir("eep-init-single-gh-");

    await runInit({ name: "single", targetDir, corpusDir, installOffer: false });

    expect(existsSync(join(targetDir, "single", ".github", "workflows", "ci.yml"))).toBe(true);
  });

  it("writes a root README naming the project, its components, and the generated instructions", async () => {
    const targetDir = newTargetDir("eep-init-composed-readme-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
    });

    const readme = readFileSync(join(targetDir, "shop", "README.md"), "utf8");

    expect(readme).toContain("# shop");
    expect(readme).toContain("`backend`: python-fastapi");
    expect(readme).toContain(`\`svc\`: ${FIXTURE_STACK_PACK}`);
    expect(readme).toContain("make setup");
    expect(readme).toContain("make test");
    expect(readme).toContain("make verify");
    expect(readme).toContain("CLAUDE.md");
  });

  it("unions the components' ignore entries at the root, without duplicating a shared one", async () => {
    const targetDir = newTargetDir("eep-init-composed-ignore-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
    });

    const lines = readFileSync(join(targetDir, "shop", ".gitignore"), "utf8")
      .split("\n")
      .filter((line) => line !== "");

    expect(lines).toContain(".venv/");
    expect(lines).toContain("node_modules/");
    expect(lines.filter((line) => line === ".eep/cache/")).toHaveLength(1);
  });

  it("ignores each stack's own build artifacts in its scaffold, so a first commit stays clean", () => {
    // A generated project runs `git add -A` on its first commit. Anything the scaffold's .gitignore
    // misses is committed: editor caches, coverage output, incremental build files, OS cruft. Each
    // scaffold has to ignore the artifacts its own stack actually produces, not just node_modules, and
    // the root ignore is the union of these, so a gap here is a gap in every generated project. These
    // four in particular (.DS_Store, *.tsbuildinfo, .vite/, htmlcov/) slipped through before.
    const required: Record<string, string[]> = {
      "packs/stack/python-fastapi/scaffold/.gitignore": [
        ".venv/",
        "__pycache__/",
        ".pytest_cache/",
        ".mypy_cache/",
        ".ruff_cache/",
        "htmlcov/",
        ".DS_Store",
      ],
      "packs/stack/react/scaffold/.gitignore": [
        "node_modules/",
        "dist/",
        ".vite/",
        "*.tsbuildinfo",
        ".DS_Store",
      ],
      "packs/stack/typescript-node/scaffold/.gitignore": [
        "node_modules/",
        "dist/",
        "*.tsbuildinfo",
        ".DS_Store",
      ],
      "packs/platform/aws-cdk/scaffold/.gitignore": [
        "node_modules/",
        "cdk.out/",
        "*.tsbuildinfo",
        ".DS_Store",
      ],
      "packs/platform/aws-serverless/scaffold/.gitignore": [
        "node_modules/",
        "cdk.out/",
        "*.tsbuildinfo",
        ".DS_Store",
      ],
      "packs/platform/aws-s3/scaffold/.gitignore": [
        "node_modules/",
        "cdk.out/",
        "*.tsbuildinfo",
        ".DS_Store",
      ],
      "packs/platform/aws-cognito/scaffold/.gitignore": [
        "node_modules/",
        "cdk.out/",
        "*.tsbuildinfo",
        "htmlcov/",
        ".DS_Store",
      ],
      "packs/data/aws-dynamodb/scaffold/.gitignore": [
        "node_modules/",
        "cdk.out/",
        "*.tsbuildinfo",
        "htmlcov/",
        ".DS_Store",
      ],
    };

    for (const [scaffold, entries] of Object.entries(required)) {
      const lines = readFileSync(join(corpusDir, scaffold), "utf8")
        .split("\n")
        .map((line) => line.trim());
      for (const entry of entries) {
        expect(lines, `${scaffold} must ignore ${entry}`).toContain(entry);
      }
    }
  });

  it("vendors every composed pack into one .eep, one eep.yaml, and one set of agent files", async () => {
    const targetDir = newTargetDir("eep-init-composed-sync-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
      tools: PAIR,
    });

    const projectDir = join(targetDir, "shop");
    expect(lockPackNames(projectDir).sort()).toEqual(["python-fastapi", FIXTURE_STACK_PACK].sort());
    expect(readFileSync(join(projectDir, "eep.yaml"), "utf8")).toContain(FIXTURE_STACK_PACK);
    expect(existsSync(join(projectDir, "backend", ".eep"))).toBe(false);

    // The law table is the whole point of composing: both packs' laws, each attributed.
    const agents = readFileSync(join(projectDir, "AGENTS.md"), "utf8");
    expect(agents).toContain("| Law | Pack | Title | Severity | Check |");
    expect(agents).toContain("| EEP-TEST-03 | python-fastapi |");
    expect(agents).toContain(`| EEP-DEVX-01 | ${FIXTURE_STACK_PACK} |`);
    expect(agents).toContain("| EEP-DEVX-01 | python-fastapi |");
    expect(readFileSync(join(projectDir, "CLAUDE.md"), "utf8")).toEqual(agents);
  });

  it("initializes exactly one git repository, at the root, with the scaffold and adopt commits", async () => {
    const targetDir = newTargetDir("eep-init-composed-git-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
      tools: PAIR,
    });

    const projectDir = join(targetDir, "shop");
    expect(existsSync(join(projectDir, ".git"))).toBe(true);
    expect(existsSync(join(projectDir, "backend", ".git"))).toBe(false);
    expect(existsSync(join(projectDir, "svc", ".git"))).toBe(false);
    expect(existsSync(join(projectDir, ".git", "hooks", "pre-commit"))).toBe(true);

    const subjects = await gitSubjects(projectDir);
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toBe("chore: adopt engineering excellence gates");
    expect(subjects[1]).toBe(`feat: scaffold from eep packs python-fastapi, ${FIXTURE_STACK_PACK}`);

    const committed = await gitHeadFiles(projectDir);
    expect(committed).toContain(".eep/lock.yaml");
    expect(committed).toContain("CLAUDE.md");
    // The component instruction files are governance too, written by the same generate pass and
    // untracked until this commit names them. A composed project whose backend carried an
    // uncommitted CLAUDE.md would be the root file's own defect, one directory down.
    expect(committed).toContain("backend/CLAUDE.md");
    expect(committed).toContain("backend/AGENTS.md");
    expect(committed).toContain("svc/CLAUDE.md");
    expect(committed).toContain("svc/AGENTS.md");
    // The pre-commit hook this run installed lives inside .git, which git never tracks, so the
    // commit that adopts the gate is deliberately not gated by it.
    expect(await gitStatus(projectDir)).toBe("");
  });

  /**
   * What a composed project's agents actually read.
   *
   * The root carries the constitution, the laws, and a router; each component carries the golden
   * path for the stack that lives there. Before this, every component's golden path was inlined
   * into one root document that every agent loaded in full, whichever directory it was working in.
   */
  it("writes a router at the root and one instruction pair per component", async () => {
    const targetDir = newTargetDir("eep-init-composed-router-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
      tools: PAIR,
    });

    const projectDir = join(targetDir, "shop");
    const root = readFileSync(join(projectDir, "CLAUDE.md"), "utf8");

    expect(root).toContain("## Components and where their golden paths live");
    expect(root).toContain("| backend | python-fastapi | backend/CLAUDE.md |");
    expect(root).toContain(`| svc | ${FIXTURE_STACK_PACK} | svc/CLAUDE.md |`);
    // The golden paths themselves are no longer inline at the root.
    expect(root).not.toContain("One make target.");

    const component = readFileSync(join(projectDir, "svc", "CLAUDE.md"), "utf8");
    expect(component).toContain(`# ${FIXTURE_STACK_PACK} golden path (generated by eep`);
    expect(component).toContain("The gate runs from the repository root: `eep verify`.");
    expect(component).toContain("One make target.");
    expect(readFileSync(join(projectDir, "svc", "AGENTS.md"), "utf8")).toEqual(component);
    expect(readFileSync(join(projectDir, "backend", "CLAUDE.md"), "utf8")).toContain(
      "# python-fastapi golden path (generated by eep",
    );
  });

  /**
   * The router must name a file that actually exists for the selection. Under agents and copilot, the
   * components carry AGENTS.md, not CLAUDE.md, so a router row naming CLAUDE.md would point every agent
   * at a nonexistent file. The router row follows the selection, and all four surfaces share one body.
   */
  it("points the router at the per component files the selection wrote, not CLAUDE.md", async () => {
    const targetDir = newTargetDir("eep-init-router-agents-");

    await runInit({
      name: "shop",
      targetDir,
      corpusDir,
      tokens: ["fastapi", "react"],
      installOffer: false,
      tools: ["agents", "copilot"],
    });

    const projectDir = join(targetDir, "shop");
    const agents = readFileSync(join(projectDir, "AGENTS.md"), "utf8");
    expect(agents).toContain("| backend | python-fastapi | backend/AGENTS.md |");
    expect(agents).toContain("| frontend | react | frontend/AGENTS.md |");
    expect(agents).not.toContain("backend/CLAUDE.md");
    expect(agents).not.toContain("frontend/CLAUDE.md");

    // The files the router names are the ones on disk; no CLAUDE.md was written under this selection.
    expect(existsSync(join(projectDir, "backend", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(projectDir, "backend", "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(projectDir, "frontend", "AGENTS.md"))).toBe(true);
    expect(existsSync(join(projectDir, "frontend", "CLAUDE.md"))).toBe(false);

    // The Copilot file carries the same router because all selected surfaces share one body.
    const copilot = readFileSync(join(projectDir, ".github", "copilot-instructions.md"), "utf8");
    expect(blockOf(copilot)).toBe(blockOf(agents));
  });

  /**
   * Copilot and Cursor write no per component files, so under a copilot only selection the router has
   * no component instruction file to point at and must fall back to the vendored STACK.md, which every
   * vendored pack has, rather than naming a CLAUDE.md or AGENTS.md that was never written.
   */
  it("points the router at the vendored STACK paths when the selection writes no component files", async () => {
    const targetDir = newTargetDir("eep-init-router-copilot-");

    await runInit({
      name: "shop",
      targetDir,
      corpusDir,
      tokens: ["fastapi", "react"],
      installOffer: false,
      tools: ["copilot"],
    });

    const projectDir = join(targetDir, "shop");
    const copilot = readFileSync(join(projectDir, ".github", "copilot-instructions.md"), "utf8");
    expect(copilot).toContain(
      "| backend | python-fastapi | .eep/packs/stack/python-fastapi/STACK.md |",
    );
    expect(copilot).toContain("| frontend | react | .eep/packs/stack/react/STACK.md |");
    expect(copilot).not.toContain("backend/CLAUDE.md");
    expect(copilot).not.toContain("backend/AGENTS.md");

    expect(existsSync(join(projectDir, "backend", "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(projectDir, "backend", "AGENTS.md"))).toBe(false);
  });

  it("renders a delivery pack that claims no component directory at the repository root", async () => {
    const targetDir = newTargetDir("eep-init-composed-delivery-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_DELIVERY_PACK],
      installOffer: false,
    });

    const projectDir = join(targetDir, "shop");
    expect(existsSync(join(projectDir, ".github", "workflows", "deploy.yml"))).toBe(true);
    // The pack's workflow and the generated one coexist: different names, one root .github.
    expect(existsSync(join(projectDir, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(existsSync(join(projectDir, "backend", "pyproject.toml"))).toBe(true);
    expect(lockPackNames(projectDir)).toContain(FIXTURE_DELIVERY_PACK);
  });

  it("refuses a root scaffold that ships a file the composed root generates", async () => {
    const targetDir = newTargetDir("eep-init-composed-rootconflict-");
    const corpus = newComposedCorpus();
    // README.md, not the CI workflow: a pack owning the workflow is the one documented exception.
    writeFile(
      corpus,
      join("packs", "delivery", FIXTURE_DELIVERY_PACK, "scaffold", "README.md"),
      "# delivery\n",
    );

    await expect(
      runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", FIXTURE_DELIVERY_PACK],
        installOffer: false,
      }),
    ).rejects.toThrow(`eep: pack ${FIXTURE_DELIVERY_PACK} ships README.md at the repository root`);

    expect(existsSync(join(targetDir, "shop"))).toBe(false);
  });

  /**
   * A delivery pack exists to know how this repository ships. Its workflow carries guarded per
   * component jobs, environment promotion, and approvals, none of which a generic generator can
   * infer from a list of directories, so pack owned CI wins and the generic is never written.
   */
  it("copies a root pack's own ci.yml byte for byte and generates no generic one", async () => {
    const targetDir = newTargetDir("eep-init-composed-packci-");
    const corpus = newComposedCorpus();
    const packWorkflow = [
      "name: ci",
      "on: [push]",
      "jobs:",
      "  backend:",
      "    if: needs.changes.outputs.backend == 'true'",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: cd backend && make test",
      "  gate:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: eep verify",
      "",
    ].join("\n");
    writeFile(
      corpus,
      join(
        "packs",
        "delivery",
        FIXTURE_DELIVERY_PACK,
        "scaffold",
        ".github",
        "workflows",
        "ci.yml",
      ),
      packWorkflow,
    );

    const output = await captureLog(async () => {
      await runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", FIXTURE_DELIVERY_PACK],
        installOffer: false,
      });
    });

    const written = readFileSync(join(targetDir, "shop", ".github", "workflows", "ci.yml"), "utf8");
    expect(written).toBe(packWorkflow);
    // Nothing the generic generator writes survived anywhere in it.
    expect(written).not.toContain("test-backend:");
    expect(output).toContain(`eep init: root ci provided by ${FIXTURE_DELIVERY_PACK}`);
  });

  it("still generates the generic root ci.yml when no pack provides one", async () => {
    const targetDir = newTargetDir("eep-init-composed-genericci-");
    const corpus = newComposedCorpus();

    const output = await captureLog(async () => {
      await runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", FIXTURE_DELIVERY_PACK],
        installOffer: false,
      });
    });

    const written = readFileSync(join(targetDir, "shop", ".github", "workflows", "ci.yml"), "utf8");
    expect(written).toContain("test-backend:");
    expect(written).toContain("  gate:");
    expect(output).not.toContain("root ci provided by");
    // The delivery pack's own, differently named workflow is untouched beside it.
    expect(existsSync(join(targetDir, "shop", ".github", "workflows", "deploy.yml"))).toBe(true);
  });

  it("still refuses two root packs that both ship the CI workflow", async () => {
    const targetDir = newTargetDir("eep-init-composed-twoci-");
    const corpus = newComposedCorpus();
    const second = "deliverytwin";
    writeFile(
      corpus,
      join(
        "packs",
        "delivery",
        FIXTURE_DELIVERY_PACK,
        "scaffold",
        ".github",
        "workflows",
        "ci.yml",
      ),
      "name: ci\n",
    );
    writeFile(
      corpus,
      join("packs", "delivery", second, "pack.yaml"),
      stringifyYaml({
        name: second,
        kind: "delivery",
        version: "1.0.0",
        implements: ["EEP-DLV-01"],
      }),
    );
    writeFile(corpus, join("packs", "delivery", second, "STACK.md"), "# twin\n\nOne workflow.\n");
    writeFile(
      corpus,
      join("packs", "delivery", second, "scaffold", ".github", "workflows", "ci.yml"),
      "name: ci\n",
    );

    await expect(
      runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", FIXTURE_DELIVERY_PACK, second],
        installOffer: false,
      }),
    ).rejects.toThrow(
      `eep: packs ${FIXTURE_DELIVERY_PACK} and ${second} both write .github/workflows/ci.yml at the repository root`,
    );

    expect(existsSync(join(targetDir, "shop"))).toBe(false);
  });

  it("refuses two root packs that write the same file, naming both and the path", async () => {
    const targetDir = newTargetDir("eep-init-composed-rootcollide-");
    const corpus = newComposedCorpus();
    const second = "deliverytwin";
    writeFile(
      corpus,
      join("packs", "delivery", second, "pack.yaml"),
      stringifyYaml({
        name: second,
        kind: "delivery",
        version: "1.0.0",
        implements: ["EEP-DLV-01"],
      }),
    );
    writeFile(corpus, join("packs", "delivery", second, "STACK.md"), "# twin\n\nOne workflow.\n");
    writeFile(
      corpus,
      join("packs", "delivery", second, "scaffold", ".github", "workflows", "deploy.yml"),
      "name: deploy\n",
    );

    await expect(
      runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", FIXTURE_DELIVERY_PACK, second],
        installOffer: false,
      }),
    ).rejects.toThrow(
      `eep: packs ${FIXTURE_DELIVERY_PACK} and ${second} both write .github/workflows/deploy.yml at the repository root`,
    );

    expect(existsSync(join(targetDir, "shop"))).toBe(false);
  });

  it("reports a token whose pack is not built yet and composes the rest", async () => {
    const targetDir = newTargetDir("eep-init-composed-soon-");
    const corpus = newComposedCorpus();

    const output = await captureLog(async () => {
      await runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", "angular", FIXTURE_STACK_PACK],
        installOffer: false,
      });
    });

    expect(output).toContain("eep init: coming soon, skipped: angular");
    expect(existsSync(join(targetDir, "shop", "svc", "Makefile"))).toBe(true);
  });

  it("aborts on an unknown token before creating the project directory", async () => {
    const targetDir = newTargetDir("eep-init-composed-unknown-");
    const corpus = newComposedCorpus();

    await expect(
      runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", "cobol"],
        installOffer: false,
      }),
    ).rejects.toThrow("unknown framework: cobol");

    expect(existsSync(join(targetDir, "shop"))).toBe(false);
  });

  it("refuses two packs that claim the same component directory, before writing anything", async () => {
    const targetDir = newTargetDir("eep-init-composed-collision-");
    const corpus = newComposedCorpus("backend");

    await expect(
      runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["fastapi", FIXTURE_STACK_PACK],
        installOffer: false,
      }),
    ).rejects.toThrow("both claim component directory backend");

    expect(existsSync(join(targetDir, "shop"))).toBe(false);
  });

  it("refuses a selection whose every token is still on the roadmap", async () => {
    const targetDir = newTargetDir("eep-init-composed-allsoon-");
    const corpus = newComposedCorpus();

    await expect(
      runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: ["angular", "go"],
        installOffer: false,
      }),
    ).rejects.toThrow("nothing to compose; no requested framework has a pack yet");

    expect(existsSync(join(targetDir, "shop"))).toBe(false);
  });

  it("refuses a selection with no stack pack in it", async () => {
    const targetDir = newTargetDir("eep-init-composed-nostack-");
    const corpus = newComposedCorpus();

    await expect(
      runInit({
        name: "shop",
        targetDir,
        corpusDir: corpus,
        tokens: [FIXTURE_DELIVERY_PACK],
        installOffer: false,
      }),
    ).rejects.toThrow("at least one stack pack");

    expect(existsSync(join(targetDir, "shop"))).toBe(false);
  });

  /**
   * A root placed pack ships one file per component it can containerize, and it shipped all of them
   * whatever the project was composed from.
   *
   * `docker/service.Dockerfile` copies `service/package.json` and `service/src` out of the build
   * context. Composed without typescript-node there is no `service/`, so every one of its COPY
   * sources resolves to nothing and the image cannot build, while the file sits committed in a
   * repository that has no such component. These run against the real corpus, because the defect is
   * about the real containers-k8s scaffold and the real component directory vocabulary.
   */
  it("omits a root pack's Dockerfile for a component the project does not have", async () => {
    const targetDir = newTargetDir("eep-init-docker-subset-");

    await runInit({
      name: "shop",
      targetDir,
      corpusDir,
      tokens: ["fastapi", "react", "docker"],
      installOffer: false,
    });

    const projectDir = join(targetDir, "shop");
    expect(existsSync(join(projectDir, "docker", "backend.Dockerfile"))).toBe(true);
    expect(existsSync(join(projectDir, "docker", "frontend.Dockerfile"))).toBe(true);
    expect(existsSync(join(projectDir, "docker", "service.Dockerfile"))).toBe(false);
    expect(existsSync(join(projectDir, "service"))).toBe(false);

    // Everything the pack ships that is not per component arrives whole. The compose file keeps its
    // service entry: every service sits behind a profile, so one whose image cannot be built simply
    // never starts, and rewriting a pack's own YAML from here is not this command's business.
    expect(existsSync(join(projectDir, "docker", "nginx.conf"))).toBe(true);
    expect(existsSync(join(projectDir, ".dockerignore"))).toBe(true);
    const compose = readFileSync(join(projectDir, "docker-compose.dev.yaml"), "utf8");
    expect(compose).toContain("docker/service.Dockerfile");
    expect(compose).toContain('profiles: ["all", "service"]');
  });

  it("keeps every Dockerfile when the project has every component they name", async () => {
    const targetDir = newTargetDir("eep-init-docker-all-");

    await runInit({
      name: "shop",
      targetDir,
      corpusDir,
      tokens: ["fastapi", "react", "node", "docker"],
      installOffer: false,
    });

    const projectDir = join(targetDir, "shop");
    for (const name of ["backend.Dockerfile", "frontend.Dockerfile", "service.Dockerfile"]) {
      expect(existsSync(join(projectDir, "docker", name)), name).toBe(true);
    }
    expect(existsSync(join(projectDir, "service", "package.json"))).toBe(true);
  });

  it("names the same next steps a single pack init does", async () => {
    const targetDir = newTargetDir("eep-init-composed-steps-");
    const corpus = newComposedCorpus();

    const output = await withPath(childPath(), () =>
      captureLog(async () => {
        await runInit({
          name: "shop",
          targetDir,
          corpusDir: corpus,
          tokens: ["fastapi", FIXTURE_STACK_PACK],
          installOffer: false,
        });
      }),
    );

    expect(output).toContain("eep init: next steps: cd shop && make setup && make test");
    expect(output).toContain(
      "eep init: full gate: npx engineering-excellence verify from the project",
    );
  });
});
