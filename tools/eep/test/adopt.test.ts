import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { runAdopt } from "../src/commands/adopt.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

function newTargetDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// The one sanctioned git use in this suite: initializing a throwaway fixture directory under the
// OS temp dir so adopt has a real .git to install its hook into. This never touches the corpus
// repository itself.
async function gitInit(dir: string): Promise<void> {
  await execa("git", ["init"], { cwd: dir });
}

function writeFastApiPyproject(dir: string): void {
  writeFileSync(join(dir, "pyproject.toml"), '[project]\ndependencies = ["fastapi"]\n');
}

describe("runAdopt", () => {
  it("adopts a git repo with a detected pack: vendors, generates, and installs the hook", async () => {
    const targetDir = newTargetDir("eep-adopt-git-");
    await gitInit(targetDir);
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "eep.yaml"))).toBe(true);

    const hookPath = join(targetDir, ".git", "hooks", "pre-commit");
    expect(existsSync(hookPath)).toBe(true);
    expect(statSync(hookPath).mode & 0o111).not.toBe(0);
    const hookContent = readFileSync(hookPath, "utf8");
    expect(hookContent).toContain("eep verify --changed");
    // The npx only consumer never has a bare `eep` on PATH; the hook must fall back to the
    // published package rather than failing the commit outright.
    expect(hookContent).toContain("npx -y engineering-excellence");
  });

  it("adopts a plain directory without git: resolves, writes artifacts, installs no hook", async () => {
    const targetDir = newTargetDir("eep-adopt-nogit-");
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "eep.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, ".git"))).toBe(false);
  });

  it("adopts a worktree style directory where .git is a file: resolves, installs no hook", async () => {
    const targetDir = newTargetDir("eep-adopt-worktree-");
    writeFileSync(join(targetDir, ".git"), "gitdir: /elsewhere\n");
    writeFastApiPyproject(targetDir);

    const result = await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(existsSync(join(targetDir, ".eep", "lock.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(targetDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(targetDir, "eep.yaml"))).toBe(true);
    expect(existsSync(join(targetDir, ".git", "hooks", "pre-commit"))).toBe(false);
  });

  // Asserted as "the message names the supported packs", not as a fixed list: the list is every
  // pack the corpus carries, so pinning it to today's corpus would turn this red every time a pack
  // lands, for a reason that has nothing to do with what it is testing.
  it("rejects when no pack is detected, naming the supported packs", async () => {
    const targetDir = newTargetDir("eep-adopt-nomatch-");

    await expect(
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true }),
    ).rejects.toThrow(/no pack detected; supported packs: .*python-fastapi/);
  });

  it("writes eep.yaml that parses to the profile and detected packs", async () => {
    const targetDir = newTargetDir("eep-adopt-yaml-");
    writeFastApiPyproject(targetDir);

    await runAdopt({ targetDir, corpusDir, profile: "evolving", yes: true });

    const parsed = parseYaml(readFileSync(join(targetDir, "eep.yaml"), "utf8"));
    expect(parsed).toEqual({ profile: "evolving", packs: ["python-fastapi"] });
  });

  it("refuses to run without --yes outside a TTY", async () => {
    const targetDir = newTargetDir("eep-adopt-noninteractive-");
    await gitInit(targetDir);
    writeFastApiPyproject(targetDir);

    await expect(
      runAdopt({ targetDir, corpusDir, profile: "evolving", yes: false }),
    ).rejects.toThrow("eep: refusing to adopt without --yes in non interactive mode");
  });
});
