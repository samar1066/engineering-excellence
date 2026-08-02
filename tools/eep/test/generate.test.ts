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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { generateAgentFiles } from "../src/lib/generate.js";
import { repoRoot } from "../src/lib/schema.js";
import { vendorInto } from "../src/lib/vendor.js";
import { VERSION } from "../src/version.js";

// Built from escapes, not literal glyphs, so this test file's own source never embeds a banned
// dash even though two assertions below check the generated output contains none.
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";

const CORPUS = repoRoot();

function newVendoredTarget(): string {
  const dir = mkdtempSync(join(tmpdir(), "eep-generate-"));
  vendorInto(dir, CORPUS, ["python-fastapi"], "greenfield");
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

  it("writes AGENTS.md and CLAUDE.md as byte identical files", () => {
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

  it("writes both root files, and each component pair, byte identical", () => {
    expect(readFileSync(join(tmp, "AGENTS.md")).equals(readFileSync(join(tmp, "CLAUDE.md")))).toBe(
      true,
    );
    expect(
      readFileSync(join(tmp, COMPONENT_DIR, "AGENTS.md")).equals(
        readFileSync(join(tmp, COMPONENT_DIR, "CLAUDE.md")),
      ),
    ).toBe(true);
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
