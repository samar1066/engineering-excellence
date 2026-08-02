import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { execa } from "execa";
import fg from "fast-glob";
import { describe, expect, it, vi } from "vitest";
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
