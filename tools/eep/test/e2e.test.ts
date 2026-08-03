import {
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
import fg from "fast-glob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAdopt } from "../src/commands/adopt.js";
import { validateCorpus } from "../src/commands/corpus.js";
import { runExplain } from "../src/commands/explain.js";
import { runInit } from "../src/commands/init.js";
import { runVerify, type VerifyResult } from "../src/commands/verify.js";
import { AUTHORITY_SENTENCE, BLOCK_BEGIN, BLOCK_END } from "../src/lib/managed-block.js";
import { repoRoot } from "../src/lib/schema.js";

/**
 * The slice's acceptance test: the whole user journey, from an empty directory to a doctrine
 * compliant, verified project, plus the files first floor that has to hold when the CLI is not
 * used at all.
 *
 * Six scenarios, in the order a consumer meets them:
 *   1. greenfield        eep init, then eep verify reports zero blocking failures
 *   2. adopt             an existing application gains AGENTS.md/CLAUDE.md from the corpus
 *   3. violations        planted breakages fail, each named by its law id
 *   4. waivers           a waiver flips a failure to waived, and expires back into a failure
 *   5. files first floor the pack folder plus CONSTITUTION.md stands alone, no CLI involved
 *   6. explain           a law id resolves to its body and its active pack binding
 *
 * Scenarios 1, 3, and 4 drive the real Python toolchain and are gated on uv being installed.
 * Scenarios 2, 5, and 6 touch no Python at all, so they are ungated and always run.
 */

const CORPUS = repoRoot();
const PACK_DIR = join(CORPUS, "packs", "stack", "python-fastapi");
const SCAFFOLD = join(PACK_DIR, "scaffold");

const PROJECT_NAME = "e2eproof";
const ADOPTEE_NAME = "adoptee";
const NAME_TOKEN = "{{project_name}}";

// Escapes, not literal glyphs, so this source file never itself carries the banned character it
// plants in a fixture, nor a credential shaped string the secrets scan would flag.
const EM_DASH = "\u2014";
const AWS_KEY = `AKIA${"ABCDEFGHIJKLMNOP"}`;
const AWS_KEY_LINE = `AWS_KEY = "${AWS_KEY}"\n`;

const SECRET_TARGET = join("app", "core", "config.py");
const BAD_DOC = join("docs", "bad.md");

// uv sync plus several pytest runs. Generous on purpose: a cold uv cache on a CI runner pays the
// full download once, inside the one beforeAll that builds the fixture.
const BUILD_TIMEOUT = 900_000;
const VERIFY_TIMEOUT = 300_000;

async function uvAvailable(): Promise<boolean> {
  try {
    const result = await execa("which", ["uv"], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const hasUv = await uvAvailable();

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => text(item)).join("\n");
  return value === undefined || value === null ? "" : String(value);
}

function write(dir: string, relPath: string, contents: string): void {
  const absPath = join(dir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

function find(results: VerifyResult[], law: string): VerifyResult | undefined {
  return results.find((result) => result.law === law);
}

// Assertion message for the greenfield scenario. A bare "expected 0, received 3" would say nothing
// about which laws broke or why, and this is the one test whose failure has to read as a diagnosis.
function describeFailures(results: VerifyResult[]): string {
  const failures = results.filter((result) => result.status === "fail");
  if (failures.length === 0) return "no failures";
  return failures.map((result) => `${result.law} [${result.severity}] ${result.detail}`).join("\n");
}

function substituteProjectName(dir: string, name: string): void {
  for (const relPath of fg.sync("**/*", { cwd: dir, dot: true, onlyFiles: true })) {
    const absPath = join(dir, relPath);
    const content = readFileSync(absPath, "utf8");
    if (!content.includes(NAME_TOKEN)) continue;
    writeFileSync(absPath, content.replaceAll(NAME_TOKEN, name));
  }
}

// Sanctioned by the task dispatch: git runs only inside throwaway fixtures under the OS temp
// directory, never against the corpus checkout. Identity is passed per invocation so the fixture
// neither depends on, nor disturbs, whatever global git config the machine carries.
async function gitInitAndCommit(dir: string, message: string): Promise<void> {
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
      message,
    ],
    { cwd: dir },
  );
}

async function uvSync(dir: string): Promise<void> {
  const result = await execa("uv", ["sync", "--quiet"], { cwd: dir, reject: false, all: true });
  if (result.exitCode !== 0) {
    throw new Error(
      `uv sync failed in ${dir} (exit ${String(result.exitCode)}): ${text(result.all)}`,
    );
  }
}

function waiverYaml(expires: string): string {
  return [
    "- law: EEP-DOCS-02",
    "  scope: '**/*.md'",
    '  justification: "The imported vendor note is rewritten next sprint."',
    "  owner: '@samar1066'",
    "  created: 2026-08-01",
    `  expires: ${expires}`,
    "",
  ].join("\n");
}

/**
 * Scenario 1, and the fixture every uv dependent scenario is built from.
 *
 * Built once. runInit is the whole greenfield command (scaffold, substitute, commit, adopt), and
 * uv sync materializes the virtual environment the pack's five shell checks run inside.
 */
describe.skipIf(!hasUv)("the greenfield journey: eep init to a verified project", () => {
  let tmp: string;
  let project: string;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "eep-e2e-"));
    project = join(tmp, PROJECT_NAME);
    await runInit({ name: PROJECT_NAME, targetDir: tmp, corpusDir: CORPUS });
    await uvSync(project);
  }, BUILD_TIMEOUT);

  afterAll(() => {
    if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  });

  it(
    "reports zero blocking failures on a project eep init just produced",
    async () => {
      const report = await runVerify(project);

      expect(report.failedBlocking, describeFailures(report.results)).toBe(0);
      // A gate that resolved almost no laws could also report zero failures. The scaffold's pack
      // implements twelve laws and declines one, so anything much smaller means the resolve step,
      // not the project, is what passed.
      expect(report.results.length).toBeGreaterThanOrEqual(12);
      expect(existsSync(join(project, ".eep", "lock.yaml"))).toBe(true);
      expect(existsSync(join(project, "AGENTS.md"))).toBe(true);
    },
    VERIFY_TIMEOUT,
  );

  /**
   * Scenarios 3 and 4, against a copy so scenario 1's project stays pristine.
   *
   * The copy carries the pristine project's .venv rather than syncing a second one. The console
   * scripts inside a copied venv keep the shebang of the directory they were created in, so this
   * copy resolves its interpreter through the pristine project's .venv, which is why both live
   * under the same tmp root and are removed together in afterAll. Test collection, the app package
   * under test, and every builtin check still resolve inside the copy, which is what these
   * scenarios assert on.
   */
  describe("with violations planted in a copy of that project", () => {
    let dirty: string;

    beforeAll(() => {
      dirty = join(tmp, "dirty");
      cpSync(project, dirty, { recursive: true });

      // Two test files, not one. Deleting only tests/api/test_notes_api.py leaves coverage at
      // 88.27 percent, comfortably over the pack's 85 percent gate, so it proves nothing; the
      // workflow unit test has to go as well to land at 79.63 percent. See the task report: the
      // brief's one file assumption does not hold against today's scaffold.
      rmSync(join(dirty, "tests", "api", "test_notes_api.py"), { force: true });
      rmSync(join(dirty, "tests", "unit", "test_notes_workflow.py"), { force: true });

      // Frontmatter is deliberately valid so EEP-DOCS-01 keeps passing and the only thing this
      // document breaks is the style law under test.
      write(
        dirty,
        BAD_DOC,
        `---\ntitle: An imported note\nauthors: [{ name: EEP Fixture }]\n---\n\nOne thing ${EM_DASH} then another.\n`,
      );

      const secretPath = join(dirty, SECRET_TARGET);
      writeFileSync(secretPath, `${readFileSync(secretPath, "utf8")}\n${AWS_KEY_LINE}`);
    }, BUILD_TIMEOUT);

    it(
      "fails the coverage, style, and secrets laws, each named by its own law id",
      async () => {
        const report = await runVerify(dirty);

        const coverage = find(report.results, "EEP-TEST-03");
        expect(coverage?.status, describeFailures(report.results)).toBe("fail");
        expect(coverage?.severity).toBe("blocking");
        // The detail is the developer's diagnosis, so it has to be the coverage shortfall itself.
        // It once was not: runShellCheck keeps the last 200 characters of the command's combined
        // output, and the scaffold's OpenTelemetry console exporter used to write a traceback at
        // interpreter shutdown, after pytest had closed the capture file, which pushed the
        // shortfall line out of the window entirely. The scaffold now installs no span exporter
        // under pytest (app/core/otel.py), so these two assertions guard that fix from here.
        expect(coverage?.detail).not.toContain("Exception while exporting Span");
        expect(coverage?.detail).toContain("coverage");

        const docs = find(report.results, "EEP-DOCS-02");
        expect(docs?.status).toBe("fail");
        expect(docs?.detail).toContain("docs/bad.md");

        const secrets = find(report.results, "EEP-SEC-01");
        expect(secrets?.status).toBe("fail");
        expect(secrets?.detail).toContain("app/core/config.py");
        expect(secrets?.detail).toContain("aws-access-key-id");
        // The gate names the file and the pattern family, and never echoes the material it found:
        // a report that reprinted the credential would leak it into every log that carried it.
        expect(secrets?.detail).not.toContain(AWS_KEY);

        expect(report.failedBlocking).toBeGreaterThanOrEqual(3);
      },
      VERIFY_TIMEOUT,
    );

    it(
      "flips the style failure to waived while the waiver holds, and back to a failure once it expires",
      async () => {
        const waiversPath = join(".eep", "waivers.yaml");

        write(dirty, waiversPath, waiverYaml("2026-11-01"));
        const waived = await runVerify(dirty);
        const waivedDocs = find(waived.results, "EEP-DOCS-02");

        expect(waivedDocs?.status).toBe("waived");
        expect(waivedDocs?.detail).toContain("waived:");
        expect(waivedDocs?.detail).toContain("@samar1066");
        // The original failure survives the waiver, so the reviewer approving it, and whoever
        // reads the log the day it lapses, can both see exactly what was bought out.
        expect(waivedDocs?.detail).toContain("original:");
        expect(waivedDocs?.detail).toContain("docs/bad.md");
        expect(find(waived.results, "EEP-GOV-WAIVER")).toBeUndefined();

        write(dirty, waiversPath, waiverYaml("2026-07-01"));
        const expired = await runVerify(dirty);

        expect(find(expired.results, "EEP-DOCS-02")?.status).toBe("fail");
        const waiverFail = find(expired.results, "EEP-GOV-WAIVER");
        expect(waiverFail?.status).toBe("fail");
        expect(waiverFail?.severity).toBe("blocking");
        expect(waiverFail?.detail).toContain("expired");
      },
      VERIFY_TIMEOUT,
    );
  });
});

/**
 * Scenario 2. Deliberately ungated: adopt detects, vendors, and generates entirely from the corpus
 * and the target's pyproject.toml, so it needs no Python toolchain and must not skip on a machine
 * without uv.
 */
describe("eep adopt on an existing application that has never seen eep", () => {
  let adoptee: string;

  beforeAll(async () => {
    adoptee = mkdtempSync(join(tmpdir(), "eep-e2e-adopt-"));
    cpSync(SCAFFOLD, adoptee, { recursive: true });
    substituteProjectName(adoptee, ADOPTEE_NAME);
    expect(existsSync(join(adoptee, ".eep"))).toBe(false);
    await gitInitAndCommit(adoptee, "the application as it was before eep");
  }, VERIFY_TIMEOUT);

  afterAll(() => {
    if (adoptee !== undefined) rmSync(adoptee, { recursive: true, force: true });
  });

  it("writes agent instructions carrying the golden path and the law table", async () => {
    const result = await runAdopt({
      targetDir: adoptee,
      corpusDir: CORPUS,
      profile: "evolving",
      yes: true,
      tools: ["claude", "agents", "copilot", "cursor"],
    });

    expect(result.packs).toEqual(["python-fastapi"]);
    expect(result.tools).toEqual(["claude", "copilot", "cursor", "agents"]);

    const agentsPath = join(adoptee, "AGENTS.md");
    expect(existsSync(agentsPath)).toBe(true);
    const agents = readFileSync(agentsPath, "utf8");

    expect(agents).toContain("# python-fastapi golden path");
    expect(agents).toContain("| Law | Pack | Title | Severity | Check |");
    expect(agents).toContain("| EEP-TEST-03 | python-fastapi |");
    expect(agents).toContain("cov-fail-under=85");
    expect(agents).toContain("Profile: evolving.");

    // Everything generated sits inside the managed block, so a repository that later adds prose of
    // its own around it keeps that prose across every sync (see lib/managed-block.ts).
    expect(agents.startsWith(BLOCK_BEGIN)).toBe(true);
    expect(agents.endsWith(`${BLOCK_END}\n`)).toBe(true);
    expect(agents).toContain(AUTHORITY_SENTENCE);

    // This application carried no agent files of its own, so both names come out as the block and
    // nothing else, which makes them byte identical as well as block identical. An agent reading
    // either name has to be held to exactly the same instructions.
    expect(readFileSync(join(adoptee, "CLAUDE.md"))).toEqual(readFileSync(agentsPath));

    // All four selected surfaces landed, the two extra ones with the same block body and the Cursor
    // rule with its frontmatter.
    const copilot = readFileSync(join(adoptee, ".github", "copilot-instructions.md"), "utf8");
    expect(copilot.startsWith(BLOCK_BEGIN)).toBe(true);
    expect(copilot).toContain("| Law | Pack | Title | Severity | Check |");
    const cursor = readFileSync(join(adoptee, ".cursor", "rules", "eep.mdc"), "utf8");
    expect(cursor.startsWith("---\n")).toBe(true);
    expect(cursor).toContain("alwaysApply: true");
    expect(cursor).toContain("# python-fastapi golden path");
  });

  /**
   * The same application one release later, once its team has written instructions of their own
   * into the file eep also writes into. Their bytes survive, ours are refreshed in place, and the
   * result is stable under a second run.
   */
  it("refreshes only its own block when the application adds prose around it", async () => {
    const claudePath = join(adoptee, "CLAUDE.md");
    const generated = readFileSync(claudePath, "utf8");
    const preface = "# House rules\n\nDeploys go out on Thursdays.\n";
    const epilogue = "\n## Local conventions\n\nRun make dev first.\n";
    writeFileSync(claudePath, `${preface}\n${generated}${epilogue}`);

    await runAdopt({ targetDir: adoptee, corpusDir: CORPUS, profile: "evolving", yes: true });

    const after = readFileSync(claudePath, "utf8");
    expect(after.startsWith(preface)).toBe(true);
    expect(after.endsWith(epilogue)).toBe(true);
    expect(after).toContain("| Law | Pack | Title | Severity | Check |");

    await runAdopt({ targetDir: adoptee, corpusDir: CORPUS, profile: "evolving", yes: true });
    expect(readFileSync(claudePath, "utf8")).toBe(after);
  });
});

/**
 * Scenario 5, the files first floor: the pack folder plus CONSTITUTION.md, copied into a directory
 * that has no eep CLI, no .eep tree, no git, and no Python. What lands there has to stand on its
 * own, because that is the fallback the pack's README promises.
 */
describe("the files first floor: the pack folder copied on its own", () => {
  const PACK_REL = join("packs", "stack", "python-fastapi");
  let floor: string;
  let copiedPack: string;

  beforeAll(() => {
    floor = mkdtempSync(join(tmpdir(), "eep-e2e-floor-"));
    copiedPack = join(floor, PACK_REL);
    mkdirSync(dirname(copiedPack), { recursive: true });
    cpSync(join(CORPUS, "CONSTITUTION.md"), join(floor, "CONSTITUTION.md"));
    cpSync(PACK_DIR, copiedPack, { recursive: true });
  });

  afterAll(() => {
    if (floor !== undefined) rmSync(floor, { recursive: true, force: true });
  });

  it("carries a nonempty golden path and README next to the constitution", () => {
    for (const relPath of ["STACK.md", "README.md"]) {
      const absPath = join(copiedPack, relPath);
      expect(existsSync(absPath), `${relPath} is missing from the copied pack`).toBe(true);
      expect(readFileSync(absPath, "utf8").trim().length).toBeGreaterThan(0);
    }
    expect(readFileSync(join(floor, "CONSTITUTION.md"), "utf8").trim().length).toBeGreaterThan(0);
  });

  it("resolves every relative markdown link inside the copy, and every path its prose names", async () => {
    const markdown = fg.sync("**/*.md", { cwd: copiedPack }).sort();
    expect(markdown.length).toBeGreaterThan(10);

    // The corpus's own containment checker, pointed at the temporary root. It walks every inline
    // markdown link under packs/*/* and reports any whose target resolves outside the pack
    // directory, which is exactly the question "does this folder still work once it is copied
    // away from the corpus" reduces to.
    const violations = await validateCorpus(floor);
    expect(violations.filter((violation) => violation.rule === "pack-containment")).toEqual([]);

    // The containment sweep above passes vacuously today: the pack's markdown carries no inline
    // links at all, only backticked paths in prose. These are those paths, so the floor is proved
    // by what actually holds it up rather than by an empty walk. See the task report.
    for (const relPath of [
      "pack.yaml",
      "checks/manifest.yaml",
      "templates/config",
      "bindings/EEP-TEST-03.md",
      "scaffold/Makefile",
      "scaffold/pyproject.toml",
    ]) {
      expect(
        existsSync(join(copiedPack, relPath)),
        `${relPath} is missing from the copied pack`,
      ).toBe(true);
    }
  });

  it("tells the reader the CLI is optional", () => {
    const readme = readFileSync(join(copiedPack, "README.md"), "utf8");

    expect(readme).toContain("Standalone use");
    expect(readme).toContain("accelerator");
  });
});

/**
 * Scenario 6. Pure corpus reads, so this runs everywhere.
 */
describe("eep explain resolves a law to its body and its binding", () => {
  it("prints the law statement and the binding's concrete check for EEP-SEC-01", () => {
    const output = runExplain("EEP-SEC-01", CORPUS);

    expect(output).toContain("## Statement");
    expect(output).toContain("secrets-scan");
  });

  it("prints the concrete coverage command for EEP-TEST-03", () => {
    const output = runExplain("EEP-TEST-03", CORPUS);

    expect(output).toContain("## Statement");
    expect(output).toContain("cov-fail-under");
  });

  it("throws listing the known law ids for an id the corpus does not carry", () => {
    expect(() => runExplain("EEP-NOPE-99", CORPUS)).toThrow("EEP-TEST-03");
  });
});
