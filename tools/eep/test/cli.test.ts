import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { repoRoot } from "../src/lib/schema.js";
import { VERSION } from "../src/version.js";
import { childPath } from "./helpers.js";

/**
 * Parse level tests: every case here spawns the CLI the way a user runs it, so commander's own
 * argument handling is under test rather than bypassed.
 *
 * The rest of the suite calls runAdopt, runSync, and runInit directly, which is what let a real
 * defect ship unnoticed: the root framework selector declares `--yes`, `--profile`, `--corpus`, and
 * `--no-install-offer` on the program, commander parsed them there before dispatching, and every
 * subcommand sharing one of those names received its own default instead. `eep adopt --yes` printed
 * its plan and then refused itself for want of the flag it had just been given. Nothing that skips
 * argv could have caught it.
 */

const PACKAGE_DIR = join(repoRoot(), "tools", "eep");
const CLI = join(PACKAGE_DIR, "src", "index.ts");
// The workspace's own tsx, run as a module argument to this very node binary. Two traps avoided:
// `npx tsx` would resolve against the fixture directory, which is outside this package, and reach
// for the network to install one; and node_modules/.bin/tsx is a shebang script, so it would need
// node on the child's PATH, which the scrubbed PATH below cannot guarantee (on this machine the
// global npm bin directory holds both node and eep, so removing one removes the other).
const TSX_CLI = join(PACKAGE_DIR, "node_modules", "tsx", "dist", "cli.mjs");

const CLI_TIMEOUT = 180_000;

const FASTAPI_PYPROJECT = [
  "[project]",
  'name = "cliproof"',
  'version = "0.1.0"',
  'dependencies = ["fastapi"]',
  "",
].join("\n");

// Resolved once: every case spawns with the same environment, and the link is created at most once.
const CHILD_PATH = childPath();

type CliResult = { exitCode: number; output: string };

async function runCli(cwd: string, args: string[]): Promise<CliResult> {
  const result = await execa(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd,
    reject: false,
    all: true,
    env: { PATH: CHILD_PATH },
  });
  return { exitCode: result.exitCode ?? 1, output: String(result.all ?? "") };
}

function newDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function newFastApiDir(): string {
  const dir = newDir("eep-cli-fastapi-");
  writeFileSync(join(dir, "pyproject.toml"), FASTAPI_PYPROJECT);
  return dir;
}

function write(dir: string, relPath: string, contents: string): void {
  const absPath = join(dir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

function lockProfile(dir: string): string {
  const parsed: unknown = parseYaml(readFileSync(join(dir, ".eep", "lock.yaml"), "utf8"));
  return String((parsed as { profile?: unknown }).profile ?? "");
}

// Sanctioned by the task dispatch: git runs only inside throwaway fixtures under the OS temp
// directory, never against the corpus checkout. Identity is passed per invocation so the fixture
// neither depends on, nor disturbs, whatever global git config the machine carries.
async function gitInitAndCommit(dir: string): Promise<void> {
  await execa("git", ["init", "--quiet"], { cwd: dir });
  await execa("git", ["add", "-A"], { cwd: dir });
  await execa(
    "git",
    [
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "user.name=EEP Fixture",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    { cwd: dir },
  );
}

// A hand built .eep tree whose one check is a builtin, so `verify` runs end to end through the CLI
// with no Python toolchain and no network.
const FIXTURE_PACK = "cli-fixture-pack";
const FIXTURE_LAW = "EEP-DOCS-02";

async function newVerifiableDir(): Promise<string> {
  const dir = newDir("eep-cli-verify-");
  write(
    dir,
    join(".eep", "profiles", "greenfield.yaml"),
    stringifyYaml({ name: "greenfield", enforcement: "all", description: "Fixture profile." }),
  );
  write(
    dir,
    join(".eep", "lock.yaml"),
    stringifyYaml({
      program_version: VERSION,
      profile: "greenfield",
      packs: [{ name: FIXTURE_PACK, version: "1.0.0" }],
      vendored: "2026-08-01",
    }),
  );
  const packDir = join(".eep", "packs", "stack", FIXTURE_PACK);
  write(
    dir,
    join(packDir, "pack.yaml"),
    stringifyYaml({
      name: FIXTURE_PACK,
      kind: "stack",
      version: "1.0.0",
      implements: [FIXTURE_LAW],
    }),
  );
  write(
    dir,
    join(packDir, "checks", "manifest.yaml"),
    stringifyYaml({
      checks: [
        { law: FIXTURE_LAW, kind: "builtin", command: "docs-style .", proves: "Fixture check." },
      ],
    }),
  );
  write(
    dir,
    join(".eep", "doctrine", "fixture", "laws", `${FIXTURE_LAW}.md`),
    `---\n${stringifyYaml({ id: FIXTURE_LAW, title: "Fixture law", severity: "blocking", maturity: "standard" })}---\n\n## Statement\n\nFixture.\n`,
  );
  mkdirSync(join(dir, ".eep", "schemas"), { recursive: true });
  copyFileSync(
    join(repoRoot(), "schemas", "waivers.schema.json"),
    join(dir, ".eep", "schemas", "waivers.schema.json"),
  );
  write(dir, "note.md", "# Note\n\nClean prose.\n");
  await gitInitAndCommit(dir);
  return dir;
}

describe("eep adopt through the command line", () => {
  it(
    "accepts its own --yes and completes, writing .eep",
    async () => {
      const dir = newFastApiDir();

      const { exitCode, output } = await runCli(dir, [
        "adopt",
        "--yes",
        "--tools",
        "claude,agents",
      ]);

      expect(output).not.toContain("refusing to adopt");
      expect(output).toContain("eep: adopted python-fastapi");
      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, ".eep", "lock.yaml"))).toBe(true);
      expect(existsSync(join(dir, "CLAUDE.md"))).toBe(true);
    },
    CLI_TIMEOUT,
  );

  it(
    "accepts its own --profile, and writes that profile into the lock",
    async () => {
      const dir = newFastApiDir();

      const { exitCode, output } = await runCli(dir, ["adopt", "--profile", "greenfield", "--yes"]);

      expect(exitCode).toBe(0);
      expect(output).toContain("under profile greenfield");
      expect(lockProfile(dir)).toBe("greenfield");
    },
    CLI_TIMEOUT,
  );

  it(
    "still defaults to evolving when no profile is named",
    async () => {
      const dir = newFastApiDir();

      const { exitCode } = await runCli(dir, ["adopt", "--yes"]);

      expect(exitCode).toBe(0);
      expect(lockProfile(dir)).toBe("evolving");
    },
    CLI_TIMEOUT,
  );

  it(
    "still refuses when --yes is genuinely absent",
    async () => {
      const dir = newFastApiDir();

      const { exitCode, output } = await runCli(dir, ["adopt"]);

      expect(output).toContain("refusing to adopt without --yes in non interactive mode");
      expect(exitCode).toBe(1);
      expect(existsSync(join(dir, ".eep"))).toBe(false);
    },
    CLI_TIMEOUT,
  );
});

describe("eep verify through the command line", () => {
  it(
    "routes --changed to the verify command and prints the pack column",
    async () => {
      const dir = await newVerifiableDir();

      const { exitCode, output } = await runCli(dir, ["verify", "--changed"]);

      expect(output).not.toContain("unknown option");
      // The note only appears when --changed reached the command and narrowed the sweep.
      expect(output).toContain("(changed files only)");
      expect(output).toContain(`PASS ${FIXTURE_LAW} [${FIXTURE_PACK}]`);
      expect(output).toContain("verify: 0 failed, 0 warnings");
      expect(exitCode).toBe(0);
    },
    CLI_TIMEOUT,
  );

  it(
    "scans the whole tree without --changed",
    async () => {
      const dir = await newVerifiableDir();

      const { exitCode, output } = await runCli(dir, ["verify"]);

      expect(output).not.toContain("(changed files only)");
      expect(output).toContain(`PASS ${FIXTURE_LAW} [${FIXTURE_PACK}] no style issues in 1`);
      expect(exitCode).toBe(0);
    },
    CLI_TIMEOUT,
  );
});

describe("the root framework selector through the command line", () => {
  it(
    "still takes --yes as its own and syncs the directory",
    async () => {
      const dir = newDir("eep-cli-root-");

      const { exitCode, output } = await runCli(dir, ["fastapi", "--yes", "--no-install-offer"]);

      expect(exitCode).toBe(0);
      expect(output).toContain("eep: active set: python-fastapi");
      expect(existsSync(join(dir, ".eep", "lock.yaml"))).toBe(true);
    },
    CLI_TIMEOUT,
  );

  it(
    "prints the capability screen when it is given nothing at all",
    async () => {
      const dir = newDir("eep-cli-bare-");

      const { exitCode, output } = await runCli(dir, []);

      expect(exitCode).toBe(0);
      expect(output).toContain("Available now:");
      expect(output).toContain("fastapi (python-fastapi)");
      expect(output).toContain("Usage:");
      expect(existsSync(join(dir, ".eep"))).toBe(false);
    },
    CLI_TIMEOUT,
  );
});

describe("eep init through the command line", () => {
  it(
    "composes from a token and honors its own --no-install-offer",
    async () => {
      const dir = newDir("eep-cli-init-");

      const { exitCode, output } = await runCli(dir, [
        "init",
        "cliproof",
        "fastapi",
        "--no-install-offer",
      ]);

      expect(exitCode).toBe(0);
      // The hint is what a swallowed --no-install-offer prints, and eep is off this PATH, so its
      // absence is the assertion that the flag reached init rather than the program.
      expect(output).not.toContain("tip:");
      expect(output).toContain("eep init: next steps: cd cliproof");
      expect(existsSync(join(dir, "cliproof", "backend", "pyproject.toml"))).toBe(true);
      expect(existsSync(join(dir, "cliproof", "Makefile"))).toBe(true);
    },
    CLI_TIMEOUT,
  );

  it(
    "scaffolds at the root when no token is given",
    async () => {
      const dir = newDir("eep-cli-init-single-");

      const { exitCode } = await runCli(dir, ["init", "cliproof", "--no-install-offer"]);

      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, "cliproof", "pyproject.toml"))).toBe(true);
      expect(existsSync(join(dir, "cliproof", "backend"))).toBe(false);
    },
    CLI_TIMEOUT,
  );
});
