import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { resolveLaws } from "../src/lib/resolve.js";
import { repoRoot } from "../src/lib/schema.js";

const root = repoRoot();

describe("resolveLaws", () => {
  it("resolves python-fastapi under the greenfield profile", () => {
    const laws = resolveLaws(["python-fastapi"], "greenfield", root);

    expect(laws).toHaveLength(13);

    const declined = laws.filter((law) => law.declined !== null);
    expect(declined).toHaveLength(1);
    expect(declined[0]?.id).toBe("EEP-DOCS-03");
    expect(declined[0]?.declined).toContain("Corpus scoped");

    const implemented = laws.filter((law) => law.declined === null);
    expect(implemented).toHaveLength(12);
    for (const law of implemented) {
      expect(law.check).not.toBeNull();
    }

    for (const law of laws) {
      expect(law.changedOnly).toBe(false);
    }

    const ids = laws.map((law) => law.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));

    const testLaw = laws.find((law) => law.id === "EEP-TEST-03");
    expect(testLaw?.severity).toBe("blocking");
    expect(testLaw?.check?.command).toContain("cov-fail-under");
  });

  it("carries the waivable frontmatter flag, defaulting to true when it is absent", () => {
    const laws = resolveLaws(["python-fastapi"], "greenfield", root);

    expect(laws.find((law) => law.id === "EEP-SEC-01")?.waivable).toBe(false);
    expect(laws.find((law) => law.id === "EEP-TEST-03")?.waivable).toBe(true);
    expect(laws.find((law) => law.id === "EEP-DOCS-03")?.waivable).toBe(true);
  });

  // The pack manifest declares a workdir; whether this repository has one is decided at sync time
  // and recorded in the lock. resolveLaws is told, never asks, so a caller with no lock (the agent
  // file generator) gets root scoped entries even for a pack whose manifest names a directory.
  it("leaves workdir null when the caller pins nothing, whatever the manifest declares", () => {
    const laws = resolveLaws(["python-fastapi"], "greenfield", root);

    expect(laws.length).toBeGreaterThan(0);
    for (const law of laws) {
      expect(law.workdir).toBeNull();
    }
  });

  it("carries the caller's pinned workdir on every one of that pack's entries", () => {
    const pinned = new Map([["python-fastapi", "backend"]]);

    const laws = resolveLaws(["python-fastapi"], "greenfield", root, pinned);

    expect(laws.length).toBeGreaterThan(0);
    for (const law of laws) {
      expect(law.workdir).toBe("backend");
    }
  });

  it("marks every entry changedOnly under the evolving profile", () => {
    const laws = resolveLaws(["python-fastapi"], "evolving", root);

    expect(laws.length).toBeGreaterThan(0);
    for (const law of laws) {
      expect(law.changedOnly).toBe(true);
    }
  });

  it("rejects the steady profile with the reserved-status message", () => {
    expect(() => resolveLaws(["python-fastapi"], "steady", root)).toThrow(
      "steady enforcement ships in a later release; run greenfield or evolving",
    );
  });

  it("throws naming an unknown pack", () => {
    expect(() => resolveLaws(["not-a-real-pack"], "greenfield", root)).toThrow("not-a-real-pack");
  });
});

/**
 * Two packs implementing one law is the case the corpus itself cannot show yet, and it is the
 * whole point of resolving per (law, pack): a repository with a backend and a service both have to
 * prove the coverage law, each with its own toolchain, and one passing must never stand in for the
 * other.
 *
 * The fixture corpus carries only what resolveLaws reads: one profile, the law files, and the pack
 * manifests with their checks.
 */
type FixturePack = {
  name: string;
  implements: string[];
  declines?: { law: string; reason: string }[];
  workdir?: string;
};

const SHARED_LAW = "EEP-FIX-01";
const SPLIT_LAW = "EEP-FIX-02";

function write(dir: string, relPath: string, contents: string): void {
  const absPath = join(dir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

function writeLaw(dir: string, id: string): void {
  const frontmatter = stringifyYaml({
    id,
    title: `Fixture law ${id}`,
    severity: "blocking",
    maturity: "standard",
  });
  write(dir, join("doctrine", "fixture", "laws", `${id}.md`), `---\n${frontmatter}---\n\nBody.\n`);
}

function writePack(dir: string, pack: FixturePack): void {
  const manifest: Record<string, unknown> = {
    name: pack.name,
    kind: "stack",
    version: "1.0.0",
    implements: pack.implements,
  };
  if (pack.declines !== undefined) manifest.declines = pack.declines;
  if (pack.workdir !== undefined) manifest.workdir = pack.workdir;

  const packDir = join("packs", "stack", pack.name);
  write(dir, join(packDir, "pack.yaml"), stringifyYaml(manifest));
  write(
    dir,
    join(packDir, "checks", "manifest.yaml"),
    stringifyYaml({
      checks: pack.implements.map((law) => ({
        law,
        kind: "builtin",
        command: `file-contains ${pack.name}.txt marker`,
        proves: "Fixture check.",
      })),
    }),
  );
}

function buildFixtureCorpus(packs: FixturePack[], lawIds: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "eep-resolve-corpus-"));
  write(
    dir,
    join("profiles", "greenfield.yaml"),
    stringifyYaml({ name: "greenfield", enforcement: "all", description: "Fixture profile." }),
  );
  for (const id of lawIds) writeLaw(dir, id);
  for (const pack of packs) writePack(dir, pack);
  return dir;
}

describe("resolveLaws across two packs", () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function corpusWith(packs: FixturePack[]): string {
    const dir = buildFixtureCorpus(packs, [SHARED_LAW, SPLIT_LAW]);
    dirs.push(dir);
    return dir;
  }

  const twoPacks: FixturePack[] = [
    { name: "beta-pack", implements: [SHARED_LAW, SPLIT_LAW], workdir: "beta" },
    {
      name: "alpha-pack",
      implements: [SHARED_LAW],
      declines: [{ law: SPLIT_LAW, reason: "Not applicable to this component at all." }],
    },
  ];

  it("resolves one entry per (law, pack) pair, each carrying its own pack's check", () => {
    const corpus = corpusWith(twoPacks);

    const laws = resolveLaws(["beta-pack", "alpha-pack"], "greenfield", corpus);
    const shared = laws.filter((law) => law.id === SHARED_LAW);

    expect(shared).toHaveLength(2);
    expect(shared.map((law) => law.pack)).toEqual(["alpha-pack", "beta-pack"]);
    expect(shared[0]?.check?.command).toBe("file-contains alpha-pack.txt marker");
    expect(shared[1]?.check?.command).toBe("file-contains beta-pack.txt marker");
  });

  it("resolves a decline per pack, so one pack declining says nothing about the other", () => {
    const corpus = corpusWith(twoPacks);

    const split = resolveLaws(["beta-pack", "alpha-pack"], "greenfield", corpus).filter(
      (law) => law.id === SPLIT_LAW,
    );

    expect(split).toHaveLength(2);
    const declined = split.find((law) => law.pack === "alpha-pack");
    const implemented = split.find((law) => law.pack === "beta-pack");
    expect(declined?.declined).toContain("Not applicable");
    expect(implemented?.declined).toBeNull();
    expect(implemented?.check).not.toBeNull();
  });

  it("sorts by law id and then by pack name, whatever order the packs were named in", () => {
    const corpus = corpusWith(twoPacks);

    const forwards = resolveLaws(["alpha-pack", "beta-pack"], "greenfield", corpus);
    const backwards = resolveLaws(["beta-pack", "alpha-pack"], "greenfield", corpus);

    const keys = forwards.map((law) => `${law.id} ${law.pack}`);
    expect(keys).toEqual([
      `${SHARED_LAW} alpha-pack`,
      `${SHARED_LAW} beta-pack`,
      `${SPLIT_LAW} alpha-pack`,
      `${SPLIT_LAW} beta-pack`,
    ]);
    expect(backwards.map((law) => `${law.id} ${law.pack}`)).toEqual(keys);
  });

  it("carries each pack's own pinned workdir, and null for a pack with none pinned", () => {
    const corpus = corpusWith(twoPacks);
    const pinned = new Map([["beta-pack", "beta"]]);

    const laws = resolveLaws(["alpha-pack", "beta-pack"], "greenfield", corpus, pinned);

    for (const law of laws.filter((entry) => entry.pack === "beta-pack")) {
      expect(law.workdir).toBe("beta");
    }
    for (const law of laws.filter((entry) => entry.pack === "alpha-pack")) {
      expect(law.workdir).toBeNull();
    }
  });

  it("resolves a single pack to exactly its own entries, unchanged by the sibling in the corpus", () => {
    const corpus = corpusWith(twoPacks);

    const laws = resolveLaws(["alpha-pack"], "greenfield", corpus);

    expect(laws).toHaveLength(2);
    for (const law of laws) expect(law.pack).toBe("alpha-pack");
  });
});
