import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { runInit } from "../src/commands/init.js";
import { runVerify, type VerifyResult } from "../src/commands/verify.js";
import { repoRoot } from "../src/lib/schema.js";
import { childPath } from "./helpers.js";

/**
 * Composed repository proofs that are executed rather than asserted about.
 *
 * Everything here builds a real composed project and then runs the things a developer would run:
 * `make test`, `make verify`, and the gate itself. Three of the four defects this closes were
 * invisible to text assertions. The root `make verify` recursed into components whose own verify
 * target runs the gate from inside a directory with no `.eep`, so it could never pass, and a test
 * that asserted the Makefile contained the right words said it was fine. The composed root shipped
 * no CI at all while the CI law passed, because each component carried a copy of a workflow that
 * would never run.
 *
 * The fixture packs carry builtin checks only, so a green run needs no language toolchain and no
 * network, which is what lets these run everywhere rather than behind a skip.
 */

const CORPUS = repoRoot();
const PACKAGE_DIR = join(CORPUS, "tools", "eep");
const TSX_CLI = join(PACKAGE_DIR, "node_modules", "tsx", "dist", "cli.mjs");
const CLI = join(PACKAGE_DIR, "src", "index.ts");

// Escape, not the literal glyph, so this source never itself carries the banned character it
// plants in a fixture.
const EM_DASH = "\u2014";
const MAKE_TIMEOUT = 300_000;

type FixtureStack = { pack: string; dir: string };

const STACKS: FixtureStack[] = [
  { pack: "svcfixture", dir: "svc" },
  { pack: "webfixture", dir: "web" },
];

function write(dir: string, relPath: string, contents: string): void {
  const absPath = join(dir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

/**
 * A component Makefile whose `verify` target fails on purpose.
 *
 * The root `verify` must not recurse into components: a component's own verify runs the gate from
 * inside a directory that has no `.eep`, which can only ever report "no .eep found". Making it exit
 * 1 means the executed `make verify` below fails loudly the moment anyone reintroduces recursion.
 */
const COMPONENT_MAKEFILE = [
  ".PHONY: setup test verify",
  "setup:",
  "\t@echo setup {{project_name}}",
  "test:",
  "\t@echo test ok",
  "verify:",
  '\t@echo "a component verify target must never be called from the root"; exit 1',
  "",
].join("\n");

function writeFixtureStackPack(corpus: string, stack: FixtureStack): void {
  const packDir = join("packs", "stack", stack.pack);
  write(
    corpus,
    join(packDir, "pack.yaml"),
    stringifyYaml({
      name: stack.pack,
      kind: "stack",
      version: "1.0.0",
      tier: 1,
      source: "builtin",
      detect: [{ file: `${stack.dir}.json` }],
      component_dir: stack.dir,
      workdir: stack.dir,
      implements: ["EEP-DEVX-01", "EEP-DOCS-02"],
      authors: [{ name: "EEP Fixture", github: "@fixture" }],
      maintainers: ["@fixture"],
    }),
  );
  write(
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
        {
          law: "EEP-DOCS-02",
          kind: "builtin",
          command: "docs-style .",
          proves: "No banned dash characters in markdown.",
        },
      ],
    }),
  );
  write(corpus, join(packDir, "STACK.md"), `# ${stack.pack} golden path\n\nOne make target.\n`);
  write(corpus, join(packDir, "README.md"), `# ${stack.pack}\n\nA fixture pack.\n`);
  write(corpus, join(packDir, "scaffold", "Makefile"), COMPONENT_MAKEFILE);
  write(
    corpus,
    join(packDir, "scaffold", "README.md"),
    `# {{project_name}} ${stack.dir}\n\nOne component of a composed repository.\n`,
  );
  write(corpus, join(packDir, "scaffold", ".gitignore"), "node_modules/\n.eep/cache/\n");
  // A workflow the composed root must refuse to copy into the component: it gates this stack as
  // though it were the whole repository, which is exactly what it stops being here.
  write(
    corpus,
    join(packDir, "scaffold", ".github", "workflows", "ci.yml"),
    "name: ci\njobs:\n  gate:\n    steps:\n      - run: eep verify\n",
  );
}

function newComposedCorpus(): string {
  const corpus = mkdtempSync(join(tmpdir(), "eep-composed-corpus-"));
  cpSync(join(CORPUS, "CONSTITUTION.md"), join(corpus, "CONSTITUTION.md"));
  for (const rel of ["schemas", "profiles", "doctrine"]) {
    cpSync(join(CORPUS, rel), join(corpus, rel), { recursive: true });
  }
  for (const stack of STACKS) writeFixtureStackPack(corpus, stack);
  return corpus;
}

/**
 * A directory holding an `eep` executable that runs this checkout's CLI.
 *
 * The generated root Makefile and the generated workflow both prefer a bare `eep` and fall back to
 * `npx -y engineering-excellence`, which would reach the network. Putting a real `eep` on PATH is
 * what makes `make verify` an executed proof of this code rather than of whatever is published.
 */
function newEepShimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eep-shim-"));
  const shim = join(dir, "eep");
  writeFileSync(shim, `#!/bin/sh\nexec ${process.execPath} ${TSX_CLI} ${CLI} "$@"\n`);
  chmodSync(shim, 0o755);
  return dir;
}

function find(results: VerifyResult[], law: string, pack: string): VerifyResult | undefined {
  return results.find((result) => result.law === law && result.pack === pack);
}

function describeFailures(results: VerifyResult[]): string {
  const failures = results.filter((result) => result.status === "fail");
  if (failures.length === 0) return "no failures";
  return failures.map((result) => `${result.law} [${result.pack}] ${result.detail}`).join("\n");
}

function lockPacks(projectDir: string): { name: string; workdir?: string }[] {
  const parsed: unknown = parseYaml(readFileSync(join(projectDir, ".eep", "lock.yaml"), "utf8"));
  return (parsed as { packs?: { name: string; workdir?: string }[] }).packs ?? [];
}

describe("a composed repository, built and then run", () => {
  let corpus: string;
  let targetDir: string;
  let projectDir: string;
  let makeEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    corpus = newComposedCorpus();
    targetDir = mkdtempSync(join(tmpdir(), "eep-composed-target-"));
    await runInit({
      name: "shop",
      targetDir,
      corpusDir: corpus,
      tokens: STACKS.map((stack) => stack.pack),
      installOffer: false,
    });
    projectDir = join(targetDir, "shop");
    makeEnv = { PATH: [newEepShimDir(), childPath()].join(":") };
  }, MAKE_TIMEOUT);

  afterAll(() => {
    for (const dir of [corpus, targetDir]) {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pins each component's workdir in the lock", () => {
    const packs = lockPacks(projectDir);

    expect(packs.map((pack) => pack.name).sort()).toEqual(["svcfixture", "webfixture"]);
    for (const pack of packs) {
      const expected = STACKS.find((stack) => stack.pack === pack.name)?.dir;
      expect(pack.workdir).toBe(expected);
    }
  });

  /**
   * The instructions an agent in this repository actually loads.
   *
   * The root keeps what is true of the whole repository and routes to the rest; each component
   * carries only its own golden path. These files are markdown at the repository root and inside
   * every component, so the style law's repository wide scan reads all of them: the passing gate
   * asserted below is also the proof that what this generator writes is publishable prose.
   */
  it("routes from the root to a golden path inside each component", () => {
    const root = readFileSync(join(projectDir, "CLAUDE.md"), "utf8");

    expect(root).toContain("## Components and where their golden paths live");
    for (const stack of STACKS) {
      expect(root).toContain(`| ${stack.dir} | ${stack.pack} | ${stack.dir}/CLAUDE.md |`);
      // The golden path itself lives in the component, not in the document every agent loads.
      const component = readFileSync(join(projectDir, stack.dir, "CLAUDE.md"), "utf8");
      expect(component).toContain(`# ${stack.pack} golden path (generated by eep`);
      expect(component).toContain("One make target.");
      expect(component).not.toContain("## The laws in force");
      expect(readFileSync(join(projectDir, stack.dir, "AGENTS.md"), "utf8")).toEqual(component);
      expect(root).not.toContain("One make target.");
    }
  });

  it("ships a root workflow with a job per component and a gate job", () => {
    const workflowPath = join(projectDir, ".github", "workflows", "ci.yml");
    expect(existsSync(workflowPath)).toBe(true);

    const parsed: unknown = parseYaml(readFileSync(workflowPath, "utf8"));
    const jobs = (parsed as { jobs?: Record<string, unknown> }).jobs ?? {};

    expect(Object.keys(jobs).sort()).toEqual(["gate", "test-svc", "test-web"]);
    const text = readFileSync(workflowPath, "utf8");
    expect(text).toContain("cd svc && make test");
    expect(text).toContain("cd web && make test");
    expect(text).toContain("eep verify");

    // No component carries a workflow of its own, which is what made the CI law pass over a
    // repository that had no CI.
    for (const stack of STACKS) {
      expect(existsSync(join(projectDir, stack.dir, ".github"))).toBe(false);
    }
  });

  it(
    "runs make test into every component",
    async () => {
      const result = await execa("make", ["test"], {
        cwd: projectDir,
        env: makeEnv,
        reject: false,
        all: true,
      });

      expect(String(result.all ?? ""), String(result.all ?? "")).toContain("test ok");
      expect(result.exitCode).toBe(0);
    },
    MAKE_TIMEOUT,
  );

  it(
    "runs make verify to a passing gate, without recursing into any component",
    async () => {
      const result = await execa("make", ["verify"], {
        cwd: projectDir,
        env: makeEnv,
        reject: false,
        all: true,
      });
      const output = String(result.all ?? "");

      expect(output, output).not.toContain("must never be called from the root");
      expect(output).toContain("[svcfixture]");
      expect(output).toContain("[webfixture]");
      expect(output).toContain("verify: 0 failed, 0 warnings");
      expect(result.exitCode, output).toBe(0);
    },
    MAKE_TIMEOUT,
  );

  it("proves every law of both packs from the root, each in its own component", async () => {
    const report = await runVerify(projectDir);

    expect(report.failedBlocking, describeFailures(report.results)).toBe(0);
    for (const stack of STACKS) {
      expect(find(report.results, "EEP-DEVX-01", stack.pack)?.detail).toContain(
        `${stack.dir}/Makefile contains`,
      );
    }
  });

  /**
   * The reviewer's second probe, reproduced.
   *
   * The root README belongs to no component. With the style law scoped to each pack's workdir,
   * nothing checked the one document a reader of this repository sees first, and a banned dash
   * could sit there through a green gate.
   */
  it(
    "fails the style law on the root README, and the executed gate fails with it",
    async () => {
      const readmePath = join(projectDir, "README.md");
      const original = readFileSync(readmePath, "utf8");
      writeFileSync(readmePath, `${original}\nOne thing ${EM_DASH} then another.\n`);

      try {
        const report = await runVerify(projectDir);
        const rows = report.results.filter((result) => result.law === "EEP-DOCS-02");

        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.status).toBe("fail");
          expect(row.detail).toContain("README.md");
          expect(row.detail).toContain("banned-dash");
        }
        expect(report.failedBlocking).toBe(2);

        const result = await execa("make", ["verify"], {
          cwd: projectDir,
          env: makeEnv,
          reject: false,
          all: true,
        });
        // make reports a failed recipe with its own exit 2, so the assertion is "the gate failed
        // the build", not a particular code.
        expect(result.exitCode).toBeGreaterThan(0);
        expect(String(result.all ?? "")).toContain("banned-dash");
      } finally {
        writeFileSync(readmePath, original);
      }
    },
    MAKE_TIMEOUT,
  );
});
