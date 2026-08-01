import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import fg from "fast-glob";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
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
});
