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
import fg from "fast-glob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { generateAgentFiles } from "../src/lib/generate.js";
import {
  AUTHORITY_SENTENCE,
  BLOCK_BEGIN,
  BLOCK_BEGIN_PREFIX,
  BLOCK_END,
} from "../src/lib/managed-block.js";
import { repoRoot } from "../src/lib/schema.js";
import { vendorInto } from "../src/lib/vendor.js";
import { VERSION } from "../src/version.js";

// Built from escapes, not literal glyphs, so this test file's own source never embeds a banned
// dash even though two assertions below check the generated output contains none.
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

const CORPUS = repoRoot();

// The selection most of these tests run under: the CLAUDE.md and AGENTS.md pair, which is what every
// release before the tool selection wrote unconditionally. Written into eep.yaml so a bare
// generateAgentFiles(dir) reads it back, the same way the commands drive generation from the stored
// selection. Tests that exercise other selections pass tools explicitly or write a different eep.yaml.
const PAIR_TOOLS = ["claude", "agents"] as const;

function writeToolsYaml(dir: string, tools: readonly string[]): void {
  writeFileSync(join(dir, "eep.yaml"), stringifyYaml({ tools: [...tools] }));
}

function newVendoredTarget(): string {
  const dir = mkdtempSync(join(tmpdir(), "eep-generate-"));
  vendorInto(dir, CORPUS, ["python-fastapi"], "greenfield");
  writeToolsYaml(dir, PAIR_TOOLS);
  return dir;
}

function readText(dir: string, ...relPath: string[]): string {
  return readFileSync(join(dir, ...relPath), "utf8");
}

function lineCount(text: string): number {
  return text.split("\n").length;
}

// Every agent instruction file below the repository root, which is exactly the set a single
// component layout must never write and a composed one must write one pair of per component.
function componentFilesUnder(dir: string): string[] {
  return fg
    .sync(["*/CLAUDE.md", "*/AGENTS.md", "*/*/CLAUDE.md", "*/*/AGENTS.md"], {
      cwd: dir,
      ignore: ["**/.eep/**"],
      onlyFiles: true,
    })
    .sort();
}

// The three regions of a co owned agent file, split on the markers. Every preservation assertion
// below is stated as an equality on one of these, so a failure says which region moved.
function splitOnBlock(content: string): { above: string; block: string; below: string } {
  const lines = content.split("\n");
  const begin = lines.findIndex((line) => line.startsWith(BLOCK_BEGIN_PREFIX));
  const end = lines.findIndex((line) => line.trim() === BLOCK_END);
  expect(begin, "no begin marker in the file").toBeGreaterThan(-1);
  expect(end, "no end marker after the begin marker").toBeGreaterThan(begin);
  return {
    above: lines.slice(0, begin).join("\n"),
    block: lines.slice(begin, end + 1).join("\n"),
    below: lines.slice(end + 1).join("\n"),
  };
}

function blockOf(content: string): string {
  return splitOnBlock(content).block;
}

// Collected into an array rather than read off the spy afterwards: mockRestore clears the recorded
// calls, so a spy read after it has been restored reports nothing at all.
function captureWarnings(run: () => void): string[] {
  const warnings: string[] = [];
  const warn = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  });
  try {
    run();
  } finally {
    warn.mockRestore();
  }
  return warnings;
}

function tableRows(content: string, heading: string): string[] {
  const lines = content.split("\n");
  const start = lines.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line.startsWith("|"));
}

/**
 * The two shapes a pack can have in a composed repository, as fixtures.
 *
 * `compfixture` is a stack pack pinned to a component directory, so its golden path belongs in that
 * directory. `rootfixture` claims no directory at all, so its golden path stays in the vendored
 * corpus copy and the root instructions point there. Both decline laws, because collapsing declines
 * is what the slimmed table is for, and the counts differ so a summary row cannot be right by
 * accident.
 */
const COMPONENT_PACK = "compfixture";
const ROOT_PACK = "rootfixture";
const COMPONENT_DIR = "svc";
const COMPONENT_SENTINEL = "Component golden path sentinel prose.";
const ROOT_SENTINEL = "Root golden path sentinel prose.";
const COMPONENT_DECLINES = ["EEP-FE-01", "EEP-IAC-01"];
const ROOT_DECLINES = ["EEP-ARCH-01", "EEP-TEST-01", "EEP-TEST-03"];

function writeFixtureFile(dir: string, relPath: string, contents: string): void {
  const absPath = join(dir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

function newFixtureCorpus(): string {
  const corpus = mkdtempSync(join(tmpdir(), "eep-generate-corpus-"));
  cpSync(join(CORPUS, "CONSTITUTION.md"), join(corpus, "CONSTITUTION.md"));
  for (const rel of ["schemas", "profiles", "doctrine"]) {
    cpSync(join(CORPUS, rel), join(corpus, rel), { recursive: true });
  }
  writeFixturePack(corpus, {
    pack: COMPONENT_PACK,
    kind: "stack",
    workdir: COMPONENT_DIR,
    law: "EEP-DEVX-01",
    command: "file-contains Makefile setup",
    sentinel: COMPONENT_SENTINEL,
    declines: COMPONENT_DECLINES,
  });
  writeFixturePack(corpus, {
    pack: ROOT_PACK,
    kind: "delivery",
    workdir: null,
    law: "EEP-DLV-01",
    command: "file-contains-any .github/workflows 'eep verify'",
    sentinel: ROOT_SENTINEL,
    declines: ROOT_DECLINES,
  });
  return corpus;
}

function writeFixturePack(
  corpus: string,
  spec: {
    pack: string;
    kind: string;
    workdir: string | null;
    law: string;
    command: string;
    sentinel: string;
    declines: string[];
  },
): void {
  const packDir = join("packs", spec.kind, spec.pack);
  const manifest: Record<string, unknown> = {
    name: spec.pack,
    kind: spec.kind,
    version: "1.0.0",
    tier: 1,
    source: "builtin",
    implements: [spec.law],
    declines: spec.declines.map((law) => ({ law, reason: `${spec.pack} does not govern ${law}` })),
  };
  if (spec.workdir !== null) {
    manifest.component_dir = spec.workdir;
    manifest.workdir = spec.workdir;
  }
  writeFixtureFile(corpus, join(packDir, "pack.yaml"), stringifyYaml(manifest));
  writeFixtureFile(
    corpus,
    join(packDir, "checks", "manifest.yaml"),
    stringifyYaml({
      checks: [
        { law: spec.law, kind: "builtin", command: spec.command, proves: "The fixture check." },
      ],
    }),
  );
  writeFixtureFile(
    corpus,
    join(packDir, "STACK.md"),
    `# ${spec.pack} golden path\n\n${spec.sentinel}\n`,
  );
  writeFixtureFile(corpus, join(packDir, "README.md"), `# ${spec.pack}\n\nA fixture pack.\n`);
}

describe("generateAgentFiles", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = newVendoredTarget();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // Into a repository carrying neither file there is nothing to preserve, so both come out as the
  // block and nothing else, which makes them byte identical as well as block identical. The pair
  // invariant that survives user content is asserted separately below.
  it("writes AGENTS.md and CLAUDE.md as byte identical files when neither existed", () => {
    generateAgentFiles(tmp);

    expect(existsSync(join(tmp, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(true);
    const agents = readFileSync(join(tmp, "AGENTS.md"));
    const claude = readFileSync(join(tmp, "CLAUDE.md"));
    expect(agents.equals(claude)).toBe(true);
  });

  it("opens with the generated header line and the profile block", () => {
    generateAgentFiles(tmp);
    const content = readFileSync(join(tmp, "AGENTS.md"), "utf8");

    // Read off the shipped constant rather than a pinned literal: the header carries the CLI
    // version, so a release bump must not require editing this assertion.
    expect(content).toContain(
      `# Agent instructions (generated by eep ${VERSION}; do not edit, regenerate with eep adopt)`,
    );
    expect(content).toContain(
      "Profile: greenfield. Every law blocks. Scaffold with eep init output patterns; never hand roll what a template covers.",
    );
  });

  it("includes the constitution body and the pack's STACK.md golden path", () => {
    generateAgentFiles(tmp);
    const content = readFileSync(join(tmp, "AGENTS.md"), "utf8");

    expect(content).toContain("twelve tenets");
    expect(content).toContain("golden path");
  });

  it("includes a law table row for an implemented law and for a declined law", () => {
    generateAgentFiles(tmp);
    const content = readFileSync(join(tmp, "AGENTS.md"), "utf8");

    expect(content).toContain("## The laws in force");
    expect(content).toContain("| Law | Pack | Title | Severity | Check |");

    const implementedRow = content.split("\n").find((line) => line.includes("EEP-TEST-03"));
    expect(implementedRow).toBeDefined();
    expect(implementedRow).toContain("`");

    const declinedRow = content.split("\n").find((line) => line.includes("EEP-DOCS-03"));
    expect(declinedRow).toBeDefined();
    expect(declinedRow).toContain("declined");
  });

  // Which pack enforces a law is what an agent needs to know before it goes looking for the
  // command, and it is the only thing telling two rows for one law apart once several packs are
  // vendored side by side.
  it("names the enforcing pack in every row, including the declined one", () => {
    generateAgentFiles(tmp);
    // Sliced at the section heading, not grepped for "| EEP-" across the whole document: the
    // vendored STACK.md carries its own law tables, whose columns are in a different order.
    const lines = readFileSync(join(tmp, "AGENTS.md"), "utf8").split("\n");
    const start = lines.indexOf("## The laws in force");
    expect(start).toBeGreaterThan(-1);
    const rows = lines.slice(start).filter((line) => line.startsWith("| EEP-"));

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.split("|")[2]?.trim()).toBe("python-fastapi");
    }
    expect(rows.find((row) => row.includes("EEP-DOCS-03"))).toContain("| python-fastapi |");
  });

  it("ends with the verify footer and contains no dash characters or unstripped footers", () => {
    generateAgentFiles(tmp);
    const content = readFileSync(join(tmp, "AGENTS.md"), "utf8");

    expect(content).toContain(
      "Before declaring work done run `eep verify`. On failure run `eep explain <LAW-ID>`.",
    );
    // The generated file must not let a reader believe eep.yaml is what the gate reads.
    expect(content).toContain(
      "Configuration authority is .eep/lock.yaml; eep.yaml is a human readable record only.",
    );
    expect(content.includes(EM_DASH)).toBe(false);
    expect(content.includes(EN_DASH)).toBe(false);

    const lines = content.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if ((lines[i] ?? "").trim() === "---") {
        expect((lines[i + 1] ?? "").startsWith("*Authored by")).toBe(false);
      }
    }
  });

  /**
   * The layout every release before progressive disclosure wrote, unchanged.
   *
   * One pack, no pinned component directory: the golden path stays inline, the declines keep their
   * own rows (asserted above), and nothing at all is written outside the repository root. The whole
   * fork exists to leave this case exactly as it was.
   */
  it("keeps the golden path inline and writes no component instruction files", () => {
    generateAgentFiles(tmp);
    const content = readText(tmp, "CLAUDE.md");

    expect(content).toContain("# python-fastapi golden path");
    expect(content).toContain("## The laws in force");
    expect(content).not.toContain("## Components and where their golden paths live");
    expect(content).not.toContain("declined with reasons");
    expect(componentFilesUnder(tmp)).toEqual([]);
  });

  it("throws when .eep is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "eep-generate-empty-"));
    try {
      expect(() => generateAgentFiles(empty)).toThrow("run eep adopt first");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

/**
 * Brownfield coexistence: every shape a CLAUDE.md can already be in when eep first runs.
 *
 * CLAUDE.md and AGENTS.md are not this program's files. A repository that carries one carries it
 * because a team wrote it, and through 0.2.2 adopting eep silently replaced it. Each case below is
 * one pre state and the one thing that may happen to it, and every one of them ends with a file
 * carrying a well formed block, which is what makes the second run a refresh and nothing else.
 */
describe("generateAgentFiles into agent files a repository already owns", () => {
  // Genuinely opinionated, and in one place genuinely contradictory: the em dash is what the docs
  // style law bans, and the last sentence is what the authority sentence inside the block exists to
  // overrule. Both belong in the fixture, because both are what real repositories contain.
  const OWN_CLAUDE = [
    "# House rules",
    "",
    `Deploys go out on Thursdays ${EM_DASH} never on a Friday.`,
    "",
    "Skip tests for prototypes; we clean up before the demo.",
    "",
  ].join("\n");

  const OWN_AGENTS = ["# Agent notes", "", "Ask before touching the payments module.", ""].join(
    "\n",
  );

  let tmp: string;

  beforeEach(() => {
    tmp = newVendoredTarget();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeOwn(relPath: string, content: string): void {
    writeFileSync(join(tmp, relPath), content);
  }

  it("writes the block and nothing else when the file is absent", () => {
    generateAgentFiles(tmp);
    const content = readText(tmp, "CLAUDE.md");

    expect(content.startsWith(`${BLOCK_BEGIN}\n`)).toBe(true);
    expect(content.endsWith(`${BLOCK_END}\n`)).toBe(true);

    // The authority sentence is the first line of the block body, above the generated header, so it
    // is read before any of the instructions it orders.
    const lines = content.split("\n");
    expect(lines[1]).toBe(AUTHORITY_SENTENCE);
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe(
      `# Agent instructions (generated by eep ${VERSION}; do not edit, regenerate with eep adopt)`,
    );
  });

  it("appends below an existing file, preserving it byte for byte with one blank line between", () => {
    writeOwn("CLAUDE.md", OWN_CLAUDE);

    generateAgentFiles(tmp);
    const content = readText(tmp, "CLAUDE.md");

    // The strongest statement available: the file the team wrote is a byte exact prefix of the file
    // this program left behind.
    expect(content.startsWith(OWN_CLAUDE)).toBe(true);
    expect(content.slice(OWN_CLAUDE.length)).toBe(`\n${blockOf(content)}\n`);

    // Exactly one blank line of separation, stated on the lines rather than inferred from the slice.
    const lines = content.split("\n");
    const begin = lines.findIndex((line) => line.startsWith(BLOCK_BEGIN_PREFIX));
    expect(lines[begin - 1]).toBe("");
    expect(lines[begin - 2]).not.toBe("");

    // The user's own words are still there, contradiction and banned dash included. Neither is this
    // program's to edit.
    expect(content).toContain("Skip tests for prototypes");
    expect(content).toContain(EM_DASH);
  });

  it("refreshes an existing block in place, preserving the bytes above and below it", () => {
    const above = "# House rules\n\nDeploys go out on Thursdays.\n";
    const below = "## Local conventions\n\nRun make dev before anything else.\n";
    const stale = [
      `${BLOCK_BEGIN_PREFIX}0.2.9; do not edit inside this block; regenerate with eep sync -->`,
      AUTHORITY_SENTENCE,
      "",
      "Stale generated body from an older release.",
      BLOCK_END,
    ].join("\n");
    writeOwn("CLAUDE.md", `${above}\n${stale}\n\n${below}`);

    generateAgentFiles(tmp);
    const content = readText(tmp, "CLAUDE.md");
    const { above: keptAbove, block, below: keptBelow } = splitOnBlock(content);

    expect(keptAbove).toBe(above);
    expect(keptBelow).toBe(`\n${below}`);
    expect(block.startsWith(BLOCK_BEGIN)).toBe(true);
    expect(block).not.toContain("Stale generated body");
    expect(block).toContain("## The laws in force");
    expect(content).toContain("Run make dev before anything else.");
  });

  it("leaves a file carrying a stray begin marker untouched and names it in a warning", () => {
    const damaged = `# House rules\n\n${BLOCK_BEGIN}\n${AUTHORITY_SENTENCE}\n\nHalf a block.\n`;
    writeOwn("CLAUDE.md", damaged);

    const warnings = captureWarnings(() => generateAgentFiles(tmp));

    expect(readText(tmp, "CLAUDE.md")).toBe(damaged);
    const message = warnings.join("\n");
    expect(message).toContain("CLAUDE.md");
    expect(message).toContain("malformed eep managed block");
    expect(message).toContain("deleting the whole block");

    // One damaged file stops nothing else: the other half of the pair is written normally.
    expect(readText(tmp, "AGENTS.md").startsWith(BLOCK_BEGIN)).toBe(true);
  });

  it("leaves a file whose end marker precedes its begin marker untouched", () => {
    const damaged = `${BLOCK_END}\n\n# House rules\n\n${BLOCK_BEGIN}\n${AUTHORITY_SENTENCE}\n`;
    writeOwn("CLAUDE.md", damaged);

    const warnings = captureWarnings(() => generateAgentFiles(tmp));

    expect(readText(tmp, "CLAUDE.md")).toBe(damaged);
    expect(warnings.join("\n")).toContain("CLAUDE.md");
  });

  /**
   * A CLAUDE.md that documents eep is the likeliest brownfield file of all, and it will quote both
   * markers inside a fenced example. Read as markers, the fenced begin and the real end below it
   * would bracket every word the team wrote in between.
   */
  it("treats markers quoted inside a fenced code block as prose, not as a block", () => {
    const own = [
      "# House rules",
      "",
      "We use eep. Its generated region looks like this:",
      "",
      "```markdown",
      BLOCK_BEGIN,
      AUTHORITY_SENTENCE,
      "",
      "...the generated instructions...",
      BLOCK_END,
      "```",
      "",
      "Do not edit inside it.",
      "",
    ].join("\n");
    writeOwn("CLAUDE.md", own);

    generateAgentFiles(tmp);
    const content = readText(tmp, "CLAUDE.md");

    // Asserted on the tail rather than through splitOnBlock, whose naive line search would find the
    // quoted begin inside the fence: that is the very confusion this test is about.
    expect(content.startsWith(own)).toBe(true);
    const appended = content.slice(own.length);
    expect(appended.startsWith(`\n${BLOCK_BEGIN}\n${AUTHORITY_SENTENCE}\n`)).toBe(true);
    expect(appended.endsWith(`${BLOCK_END}\n`)).toBe(true);
    // The fenced example is still there, both quoted markers intact.
    expect(content).toContain("```markdown");
    expect(content).toContain("Do not edit inside it.");
    // Exactly one real block was added, under the user's content, not inside their code sample.
    expect(content.split(BLOCK_END).length - 1).toBe(2);
  });

  /**
   * The probe the fence guard alone does not answer: a begin marker pasted into unfenced prose, with
   * the team's own paragraphs under it and a real end marker somewhere below. Recognizing that begin
   * would delete every paragraph between the two.
   */
  it("treats a begin marker not followed by the authority sentence as prose", () => {
    const own = [
      "# House rules",
      "",
      "Our generated block starts with this line:",
      "",
      BLOCK_BEGIN,
      "",
      "Everything from here down is ours, not eep's.",
      "The billing squad owns app/orders.py.",
      "",
      "And it closes with this one:",
      "",
      BLOCK_END,
      "",
    ].join("\n");
    writeOwn("CLAUDE.md", own);

    generateAgentFiles(tmp);

    // No begin qualifies, one end does, so this is malformed: nothing is written and every byte the
    // team wrote between the two lines is still there.
    expect(readText(tmp, "CLAUDE.md")).toBe(own);
    expect(readText(tmp, "CLAUDE.md")).toContain("The billing squad owns app/orders.py.");
  });

  /**
   * Merge residue: two well formed blocks. The first is refreshed so the gate's instructions are
   * current, the rest are named and left alone, because deleting a region of somebody's file on a
   * guess is the failure this whole module exists to prevent.
   */
  it("refreshes the first of several blocks and warns that stale ones remain", () => {
    const staleBlock = [
      `${BLOCK_BEGIN_PREFIX}0.2.9; do not edit inside this block; regenerate with eep sync -->`,
      AUTHORITY_SENTENCE,
      "",
      "Stale body from a bad merge.",
      BLOCK_END,
    ].join("\n");
    writeOwn("CLAUDE.md", `# House rules\n\n${staleBlock}\n\n## Notes\n\n${staleBlock}\n`);

    const warnings = captureWarnings(() => generateAgentFiles(tmp));
    const content = readText(tmp, "CLAUDE.md");

    expect(blockOf(content)).toContain("## The laws in force");
    // The second block is untouched, body and all.
    expect(content).toContain("Stale body from a bad merge.");
    expect(content.split(BLOCK_END).length - 1).toBe(2);
    const message = warnings.join("\n");
    expect(message).toContain("CLAUDE.md");
    expect(message).toContain("more than one eep managed block");
    expect(message).toContain("left in place");
  });

  /**
   * The legacy headers are anchored to the start of the first line. A document that merely mentions
   * the phrase, which is exactly what a repository's own notes about eep would do, is user content,
   * and matching it mid line would replace that entire file with generated text.
   */
  it.each([
    [
      "root header mid line",
      "Our onboarding mentions # Agent instructions (generated by eep 0.2.2).",
    ],
    ["component header mid line", "See the golden path (generated by eep 0.2.2) note in the wiki."],
  ])("does not treat a %s as a file it generated", (_label, first) => {
    const own = `${first}\n\nThe billing squad owns app/orders.py.\n`;
    writeOwn("CLAUDE.md", own);

    generateAgentFiles(tmp);
    const content = readText(tmp, "CLAUDE.md");

    expect(content.startsWith(own)).toBe(true);
    expect(content).toContain("The billing squad owns app/orders.py.");
  });

  /**
   * A file 0.1.x or 0.2.x wrote is generated whole, so there is no user content in it to preserve
   * and appending underneath would leave a second, stale copy of the instructions above the current
   * ones. The whole file becomes the marked form.
   */
  it("migrates a file an earlier release generated whole", () => {
    const legacy = [
      "# Agent instructions (generated by eep 0.2.2; do not edit, regenerate with eep adopt)",
      "",
      "Profile: greenfield. Every law blocks.",
      "",
      "Stale law table from the release before managed blocks.",
      "",
    ].join("\n");
    writeOwn("CLAUDE.md", legacy);

    generateAgentFiles(tmp);
    const content = readText(tmp, "CLAUDE.md");

    expect(content.startsWith(`${BLOCK_BEGIN}\n`)).toBe(true);
    expect(content.endsWith(`${BLOCK_END}\n`)).toBe(true);
    expect(content).not.toContain("Stale law table");
    // Exactly one generated header survives: the one inside the block.
    expect(content.split("# Agent instructions (generated by eep").length - 1).toBe(1);
  });

  /**
   * The invariant that replaces "the two files are byte identical".
   *
   * A repository may have carried its own CLAUDE.md for years and its own AGENTS.md for a week, and
   * neither is this program's to reconcile. What must never differ is the generated region, because
   * an agent reading one name or the other has to be held to exactly the same laws.
   */
  it("keeps the pair's blocks identical while the files themselves differ", () => {
    writeOwn("CLAUDE.md", OWN_CLAUDE);
    writeOwn("AGENTS.md", OWN_AGENTS);

    generateAgentFiles(tmp);
    const claude = readText(tmp, "CLAUDE.md");
    const agents = readText(tmp, "AGENTS.md");

    expect(blockOf(claude)).toBe(blockOf(agents));
    expect(claude).not.toBe(agents);
    expect(claude.startsWith(OWN_CLAUDE)).toBe(true);
    expect(agents.startsWith(OWN_AGENTS)).toBe(true);
  });

  // Idempotence is what makes this safe to run from a pre-commit hook and from CI: the same input
  // has to produce the same bytes, from every pre state, forever.
  it.each([
    ["absent", null],
    ["appended", OWN_CLAUDE],
    ["legacy", "# Agent instructions (generated by eep 0.2.2; do not edit)\n\nOld body.\n"],
  ])("regenerates to the same bytes from the %s state", (_label, pre) => {
    if (pre !== null) writeOwn("CLAUDE.md", pre);

    generateAgentFiles(tmp);
    const first = readText(tmp, "CLAUDE.md");
    generateAgentFiles(tmp);

    expect(readText(tmp, "CLAUDE.md")).toBe(first);
  });
});

/**
 * The composed layout: a router at the root, one instruction file per component.
 *
 * Both fixture packs are vendored into a target that already carries the component directory, so
 * the workdir pins exactly as a real sync pins it, and everything below is the shipping code path
 * reading a real lock.
 */
describe("generateAgentFiles in a repository composed of several packs", () => {
  let corpus: string;
  let tmp: string;

  beforeEach(() => {
    corpus = newFixtureCorpus();
    tmp = mkdtempSync(join(tmpdir(), "eep-generate-multi-"));
    mkdirSync(join(tmp, COMPONENT_DIR), { recursive: true });
    vendorInto(tmp, corpus, [COMPONENT_PACK, ROOT_PACK], "greenfield");
    writeToolsYaml(tmp, PAIR_TOOLS);
    generateAgentFiles(tmp);
  });

  afterEach(() => {
    for (const dir of [corpus, tmp]) rmSync(dir, { recursive: true, force: true });
  });

  it("routes to each pack's golden path rather than carrying any of them", () => {
    const content = readText(tmp, "CLAUDE.md");
    const rows = tableRows(content, "## Components and where their golden paths live");

    expect(rows).toContain("| Component | Pack | Golden path location |");
    expect(rows).toContain(`| ${COMPONENT_DIR} | ${COMPONENT_PACK} | ${COMPONENT_DIR}/CLAUDE.md |`);
    expect(rows).toContain(
      `| repo root | ${ROOT_PACK} | .eep/packs/delivery/${ROOT_PACK}/STACK.md |`,
    );
    expect(content).toContain("should read that directory's CLAUDE.md before writing code there");

    // The bodies are gone from the root, which is the entire point of the layout.
    expect(content).not.toContain(COMPONENT_SENTINEL);
    expect(content).not.toContain(ROOT_SENTINEL);

    // What the root still owns, because it is true of the whole repository.
    expect(content).toContain(
      `# Agent instructions (generated by eep ${VERSION}; do not edit, regenerate with eep adopt)`,
    );
    expect(content).toContain("twelve tenets");
    expect(content).toContain("## The laws in force");
    expect(content).toContain("Before declaring work done run `eep verify`.");
    expect(content.includes(EM_DASH)).toBe(false);
    expect(content.includes(EN_DASH)).toBe(false);
  });

  // Into a repository carrying no agent files of its own, block identity and byte identity are the
  // same statement. The pair invariant that survives user content is asserted where user content
  // exists, below.
  it("writes both root files, and each component pair, with identical blocks", () => {
    for (const dir of [tmp, join(tmp, COMPONENT_DIR)]) {
      const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
      const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8");
      expect(blockOf(agents)).toBe(blockOf(claude));
      expect(agents).toBe(claude);
    }
  });

  it("gives the pinned component its own golden path and nothing the root already owns", () => {
    const content = readText(tmp, COMPONENT_DIR, "CLAUDE.md");

    expect(content).toContain(
      `# ${COMPONENT_PACK} golden path (generated by eep ${VERSION}; component of the repository root instructions; do not edit)`,
    );
    expect(content).toContain("The gate runs from the repository root: `eep verify`.");
    expect(content).toContain(COMPONENT_SENTINEL);
    expect(content).not.toContain("twelve tenets");
    expect(content).not.toContain("## The laws in force");

    // A pack claiming no component directory materializes nothing outside the root.
    expect(componentFilesUnder(tmp)).toEqual([
      `${COMPONENT_DIR}/AGENTS.md`,
      `${COMPONENT_DIR}/CLAUDE.md`,
    ]);
  });

  it("collapses each pack's declines to one row and keeps every implemented row", () => {
    const rows = tableRows(readText(tmp, "CLAUDE.md"), "## The laws in force");

    expect(rows).toContain("| Law | Pack | Title | Severity | Check |");
    expect(
      rows.some(
        (row) =>
          row.startsWith(`| EEP-DEVX-01 | ${COMPONENT_PACK} |`) &&
          row.includes("builtin: file-contains Makefile setup"),
      ),
    ).toBe(true);
    expect(rows.some((row) => row.startsWith(`| EEP-DLV-01 | ${ROOT_PACK} |`))).toBe(true);

    const summaries = rows.filter((row) => row.startsWith("| declined |"));
    expect(summaries).toEqual([
      `| declined | ${COMPONENT_PACK} | ${COMPONENT_DECLINES.length} laws declined with reasons | see .eep/packs/stack/${COMPONENT_PACK}/pack.yaml | - |`,
      `| declined | ${ROOT_PACK} | ${ROOT_DECLINES.length} laws declined with reasons | see .eep/packs/delivery/${ROOT_PACK}/pack.yaml | - |`,
    ]);
    for (const law of [...COMPONENT_DECLINES, ...ROOT_DECLINES]) {
      expect(rows.some((row) => row.startsWith(`| ${law} |`))).toBe(false);
    }
  });

  it("regenerates to the same bytes", () => {
    const before = [readText(tmp, "CLAUDE.md"), readText(tmp, COMPONENT_DIR, "CLAUDE.md")];

    generateAgentFiles(tmp);

    expect([readText(tmp, "CLAUDE.md"), readText(tmp, COMPONENT_DIR, "CLAUDE.md")]).toEqual(before);
  });

  /**
   * Narrowing the pack set drops the governance, and the dropped pack's instructions have to go
   * with it. An agent that kept reading `svc/CLAUDE.md` would be following a golden path this
   * repository no longer enforces, with nothing at the root to contradict it.
   */
  it("removes a dropped pack's component instruction files on the next sync", () => {
    vendorInto(tmp, corpus, [ROOT_PACK], "greenfield");
    generateAgentFiles(tmp);

    expect(existsSync(join(tmp, COMPONENT_DIR, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(tmp, COMPONENT_DIR, "AGENTS.md"))).toBe(false);
    // The component directory itself is the user's code and is never touched.
    expect(existsSync(join(tmp, COMPONENT_DIR))).toBe(true);

    // One pack, no pinned workdir: back to the single document layout, golden path inline.
    const content = readText(tmp, "CLAUDE.md");
    expect(content).toContain(ROOT_SENTINEL);
    expect(content).not.toContain("## Components and where their golden paths live");
  });

  it("never deletes a CLAUDE.md it did not generate", () => {
    mkdirSync(join(tmp, "notes"), { recursive: true });
    writeFileSync(join(tmp, "notes", "CLAUDE.md"), "# Team notes\n\nHand written.\n");

    vendorInto(tmp, corpus, [ROOT_PACK], "greenfield");
    generateAgentFiles(tmp);

    expect(readText(tmp, "notes", "CLAUDE.md")).toBe("# Team notes\n\nHand written.\n");
  });
});

/**
 * The same coexistence, one directory down.
 *
 * A component directory is where a team is most likely to have written instructions of their own,
 * because it is where the code they own lives. The component files get the identical treatment the
 * root pair gets, and the component's own content is preserved on a narrowing sync too, where the
 * block is removed and the file is not.
 */
describe("generateAgentFiles into component agent files a repository already owns", () => {
  const OWN_COMPONENT = [
    "# Service notes",
    "",
    "The queue consumer is not idempotent yet.",
    "",
  ].join("\n");
  const OWN_COMPONENT_AGENTS = [
    "# Service agent notes",
    "",
    "Deploy through the pipeline.",
    "",
  ].join("\n");

  let corpus: string;
  let tmp: string;

  beforeEach(() => {
    corpus = newFixtureCorpus();
    tmp = mkdtempSync(join(tmpdir(), "eep-generate-multi-own-"));
    mkdirSync(join(tmp, COMPONENT_DIR), { recursive: true });
    writeFileSync(join(tmp, COMPONENT_DIR, "CLAUDE.md"), OWN_COMPONENT);
    writeFileSync(join(tmp, COMPONENT_DIR, "AGENTS.md"), OWN_COMPONENT_AGENTS);
    vendorInto(tmp, corpus, [COMPONENT_PACK, ROOT_PACK], "greenfield");
    writeToolsYaml(tmp, PAIR_TOOLS);
    generateAgentFiles(tmp);
  });

  afterEach(() => {
    for (const dir of [corpus, tmp]) rmSync(dir, { recursive: true, force: true });
  });

  it("appends the component block below the component's own content, preserving it", () => {
    const claude = readText(tmp, COMPONENT_DIR, "CLAUDE.md");
    const agents = readText(tmp, COMPONENT_DIR, "AGENTS.md");

    expect(claude.startsWith(OWN_COMPONENT)).toBe(true);
    expect(agents.startsWith(OWN_COMPONENT_AGENTS)).toBe(true);
    expect(claude).toContain(COMPONENT_SENTINEL);
    expect(blockOf(claude)).toBe(blockOf(agents));
    expect(claude).not.toBe(agents);
  });

  it("regenerates the component files to the same bytes", () => {
    const before = [
      readText(tmp, COMPONENT_DIR, "CLAUDE.md"),
      readText(tmp, COMPONENT_DIR, "AGENTS.md"),
    ];

    generateAgentFiles(tmp);

    expect([
      readText(tmp, COMPONENT_DIR, "CLAUDE.md"),
      readText(tmp, COMPONENT_DIR, "AGENTS.md"),
    ]).toEqual(before);
  });

  /**
   * Narrowing the pack set still removes the golden path this repository no longer enforces, but a
   * file is only deleted when it was nothing but the block. Here it was not, so the block goes and
   * the team's own notes stay exactly where they were.
   */
  it("removes only the block from a dropped component, keeping the component's own content", () => {
    vendorInto(tmp, corpus, [ROOT_PACK], "greenfield");
    generateAgentFiles(tmp);

    expect(existsSync(join(tmp, COMPONENT_DIR, "CLAUDE.md"))).toBe(true);
    expect(readText(tmp, COMPONENT_DIR, "CLAUDE.md")).toBe(OWN_COMPONENT);
    expect(readText(tmp, COMPONENT_DIR, "AGENTS.md")).toBe(OWN_COMPONENT_AGENTS);
  });
});

/**
 * The measured defect, against the real corpus.
 *
 * Five packs composed produced a 940 line root document loaded into every agent conversation, of
 * which five sixths was golden path prose for stacks the reader was not editing plus forty three
 * rows about laws no pack proves. The component directories are created first so every workdir pins
 * exactly as a composed init pins them.
 */
describe("generateAgentFiles against the shipped five pack set", () => {
  const PACKS = ["python-fastapi", "react", "aws-cdk", "github-actions", "containers-k8s"];
  const COMPONENT_DIRS = ["backend", "frontend", "infra"];
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "eep-generate-corpus-five-"));
    for (const dir of COMPONENT_DIRS) mkdirSync(join(tmp, dir), { recursive: true });
    vendorInto(tmp, CORPUS, PACKS, "greenfield");
    writeToolsYaml(tmp, PAIR_TOOLS);
    generateAgentFiles(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps the root instructions short and puts each stack's golden path in its component", () => {
    expect(lineCount(readText(tmp, "CLAUDE.md"))).toBeLessThan(350);

    expect(readText(tmp, "backend", "CLAUDE.md")).toContain("# python-fastapi golden path");
    expect(readText(tmp, "frontend", "CLAUDE.md")).toContain("# react golden path");
    expect(readText(tmp, "infra", "CLAUDE.md")).toContain("# aws-cdk golden path");
  });

  it("names every pack in the router, and every component that has one", () => {
    const rows = tableRows(
      readText(tmp, "CLAUDE.md"),
      "## Components and where their golden paths live",
    );

    expect(rows).toContain("| backend | python-fastapi | backend/CLAUDE.md |");
    expect(rows).toContain("| frontend | react | frontend/CLAUDE.md |");
    expect(rows).toContain("| infra | aws-cdk | infra/CLAUDE.md |");
    expect(rows).toContain(
      "| repo root | github-actions | .eep/packs/delivery/github-actions/STACK.md |",
    );
    expect(rows).toContain(
      "| repo root | containers-k8s | .eep/packs/platform/containers-k8s/STACK.md |",
    );
  });
});

/**
 * Selection driven generation: only the surfaces the chosen tools name are written, and each unchosen
 * tool leaves nothing behind. The four root surfaces carry the identical body, so an agent reaching
 * the repository through any chosen tool is held to the same instructions.
 */
describe("generateAgentFiles writes only the selected tool surfaces", () => {
  const COPILOT = ".github/copilot-instructions.md";
  const CURSOR = ".cursor/rules/eep.mdc";
  const CURSOR_FRONTMATTER =
    "---\ndescription: Engineering Excellence Program doctrine and golden paths\nalwaysApply: true\n---\n";

  let tmp: string;

  beforeEach(() => {
    tmp = newVendoredTarget();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const has = (relPath: string): boolean => existsSync(join(tmp, relPath));

  it("writes only the Cursor rule for a cursor only selection", () => {
    generateAgentFiles(tmp, ["cursor"]);

    expect(has(CURSOR)).toBe(true);
    expect(has("CLAUDE.md")).toBe(false);
    expect(has("AGENTS.md")).toBe(false);
    expect(has(COPILOT)).toBe(false);

    const rule = readText(tmp, ".cursor", "rules", "eep.mdc");
    expect(rule.startsWith(CURSOR_FRONTMATTER)).toBe(true);
    expect(rule).toContain("alwaysApply: true");
    // The instruction body sits below the frontmatter, the same body the block surfaces carry.
    expect(rule).toContain("## The laws in force");
    expect(rule).toContain("# python-fastapi golden path");
    // No managed block markers: eep owns this file whole.
    expect(rule).not.toContain(BLOCK_BEGIN_PREFIX);
  });

  it("writes CLAUDE.md and the Copilot file for a claude,copilot selection, and nothing else", () => {
    generateAgentFiles(tmp, ["claude", "copilot"]);

    expect(has("CLAUDE.md")).toBe(true);
    expect(has(COPILOT)).toBe(true);
    expect(has("AGENTS.md")).toBe(false);
    expect(has(CURSOR)).toBe(false);

    // Both co owned surfaces carry the identical generated block.
    expect(blockOf(readText(tmp, "CLAUDE.md"))).toBe(blockOf(readText(tmp, COPILOT)));
    expect(readText(tmp, COPILOT)).toContain("## The laws in force");
  });

  it("writes no agent instruction files at all for a none selection, keeping the vendored tree", () => {
    generateAgentFiles(tmp, []);

    for (const relPath of ["CLAUDE.md", "AGENTS.md", COPILOT, CURSOR]) {
      expect(has(relPath), relPath).toBe(false);
    }
    // The gate's own configuration is untouched: only the agent surfaces are optional.
    expect(has(".eep/lock.yaml")).toBe(true);
  });

  it("gives all four root surfaces the identical instruction body", () => {
    generateAgentFiles(tmp, ["claude", "agents", "copilot", "cursor"]);

    const claudeBlock = blockOf(readText(tmp, "CLAUDE.md"));
    expect(blockOf(readText(tmp, "AGENTS.md"))).toBe(claudeBlock);
    expect(blockOf(readText(tmp, COPILOT))).toBe(claudeBlock);
    // The Cursor rule carries the same body inside it, minus the block markers it does not use.
    const body = claudeBlock.split("\n").slice(2, -1).join("\n");
    expect(readText(tmp, ".cursor", "rules", "eep.mdc")).toContain(body);
  });

  it("reads the selection from eep.yaml when none is passed", () => {
    writeToolsYaml(tmp, ["copilot"]);

    generateAgentFiles(tmp);

    expect(has(COPILOT)).toBe(true);
    expect(has("CLAUDE.md")).toBe(false);
    expect(has("AGENTS.md")).toBe(false);
    expect(has(CURSOR)).toBe(false);
  });

  it("regenerates a subset selection to the same bytes", () => {
    generateAgentFiles(tmp, ["claude", "copilot", "cursor"]);
    const before = [
      readText(tmp, "CLAUDE.md"),
      readText(tmp, COPILOT),
      readText(tmp, ".cursor", "rules", "eep.mdc"),
    ];

    generateAgentFiles(tmp, ["claude", "copilot", "cursor"]);

    expect([
      readText(tmp, "CLAUDE.md"),
      readText(tmp, COPILOT),
      readText(tmp, ".cursor", "rules", "eep.mdc"),
    ]).toEqual(before);
  });

  /**
   * Deselecting a tool on a later run removes exactly what eep wrote for it and nothing a team wrote
   * around it: the CLAUDE.md block is stripped while the prose above and below it stays byte for byte,
   * and the newly selected Cursor rule appears.
   */
  it("strips a deselected tool's block while preserving user content, and writes the newly selected one", () => {
    const preface = "# House rules\n\nDeploys go out on Thursdays.\n";
    const epilogue = "\n## Local conventions\n\nRun make dev first.\n";
    generateAgentFiles(tmp, ["claude"]);
    const generated = readText(tmp, "CLAUDE.md");
    writeFileSync(join(tmp, "CLAUDE.md"), `${preface}\n${generated}${epilogue}`);

    generateAgentFiles(tmp, ["cursor"]);

    const claude = readText(tmp, "CLAUDE.md");
    // The bytes above and below the block are preserved; only eep's block is gone.
    expect(claude.startsWith(preface)).toBe(true);
    expect(claude).toContain("Run make dev first.");
    expect(claude).not.toContain(BLOCK_BEGIN_PREFIX);
    expect(existsSync(join(tmp, ".cursor", "rules", "eep.mdc"))).toBe(true);
  });

  it("deletes a wholly generated file for a deselected tool", () => {
    generateAgentFiles(tmp, ["claude"]);
    expect(has("CLAUDE.md")).toBe(true);

    generateAgentFiles(tmp, ["agents"]);

    expect(has("CLAUDE.md")).toBe(false);
    expect(has("AGENTS.md")).toBe(true);
  });
});
