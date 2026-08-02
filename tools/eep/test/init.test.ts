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
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// This machine's PATH with every directory carrying an eep executable removed, and nothing else
// touched: runInit shells out to git, which still has to resolve. Pinning it is what makes the
// guidance assertions deterministic on a developer machine that may already have eep installed.
function pathWithoutEep(): string {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry !== "" && !existsSync(join(entry, "eep")))
    .join(delimiter);
}

// The same PATH with a stand in for npm's global shim prepended. Never executed: the resolver only
// reads its name, type, and mode.
function pathWithFakeEep(): string {
  const dir = newTargetDir("eep-fake-bin-");
  const file = join(dir, "eep");
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return [dir, pathWithoutEep()].join(delimiter);
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

    await runInit({ name: "e2eproof", targetDir, corpusDir });

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

    const output = await withPath(pathWithoutEep(), () =>
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

    const output = await withPath(pathWithoutEep(), () =>
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
  writeFile(
    corpus,
    join(packDir, "scaffold", ".github", "workflows", "ci.yml"),
    "name: ci\njobs:\n  gate:\n    steps:\n      - run: eep verify\n",
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
    expect(makefile).toContain("$(MAKE) -C $$c verify");
    // The root gate runs after the components, in the form the reader's shell can answer.
    expect(makefile).toContain("if command -v eep >/dev/null 2>&1; then eep verify; \\");
    expect(makefile).toContain("else npx -y engineering-excellence verify; fi");
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

  it("vendors every composed pack into one .eep, one eep.yaml, and one set of agent files", async () => {
    const targetDir = newTargetDir("eep-init-composed-sync-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
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

  it("initializes exactly one git repository, at the root, with one commit", async () => {
    const targetDir = newTargetDir("eep-init-composed-git-");
    const corpus = newComposedCorpus();

    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: ["fastapi", FIXTURE_STACK_PACK],
      installOffer: false,
    });

    const projectDir = join(targetDir, "shop");
    expect(existsSync(join(projectDir, ".git"))).toBe(true);
    expect(existsSync(join(projectDir, "backend", ".git"))).toBe(false);
    expect(existsSync(join(projectDir, "svc", ".git"))).toBe(false);
    expect(existsSync(join(projectDir, ".git", "hooks", "pre-commit"))).toBe(true);

    const log = await execa("git", ["log", "--oneline"], { cwd: projectDir });
    expect(log.stdout.trim().split("\n")).toHaveLength(1);
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
    expect(existsSync(join(projectDir, ".github", "workflows", "ci.yml"))).toBe(true);
    expect(existsSync(join(projectDir, "backend", "pyproject.toml"))).toBe(true);
    expect(lockPackNames(projectDir)).toContain(FIXTURE_DELIVERY_PACK);
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

  it("names the same next steps a single pack init does", async () => {
    const targetDir = newTargetDir("eep-init-composed-steps-");
    const corpus = newComposedCorpus();

    const output = await withPath(pathWithoutEep(), () =>
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
