import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { inspectBlueprints } from "../src/commands/corpus.js";
import { capabilityScreenLines } from "../src/commands/root.js";
import {
  availableBlueprints,
  corpusLawIds,
  expandBlueprint,
  listBlueprints,
  loadBlueprint,
  resolveBlueprintSelection,
  slicesFromFlag,
} from "../src/lib/blueprint.js";
import { listCapabilities } from "../src/lib/frameworks.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

// The core, in declared order, is the pack set aws-fullstack composes today. Every one of these
// already ships, which is what lets the blueprint compose and validate now; aws-dynamodb joined in
// the data wave, aws-cognito in the auth wave, and aws-s3 in the storage wave; the core is complete.
const CORE = [
  "react",
  "python-fastapi",
  "aws-dynamodb",
  "aws-cognito",
  "aws-s3",
  "aws-cdk",
  "containers-k8s",
  "github-actions",
];
const SLICE_PACKS = [
  "aws-messaging",
  "aws-opensearch",
  "aws-elasticache",
  "aws-kinesis",
  "aws-aurora",
];
const PILLARS = ["EEP-SEC-03", "EEP-SEC-04", "EEP-REL-01", "EEP-REL-02", "EEP-COST-01"];

function write(root: string, relPath: string, contents: string): void {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
}

// A schema valid blueprint document with the required scaffolding filled in, so a case can vary
// only the field it is about (core, slices, pillars) and still validate.
function validBlueprint(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "fixture",
    description: "A fixture blueprint.",
    authors: [{ name: "Fixture Author", github: "@fixture" }],
    maintainers: ["@fixture"],
    ...fields,
  };
}

// A throwaway corpus that carries the real schemas (so blueprint.schema.json resolves), one blueprint
// document, and whatever packs and doctrine laws the case needs. Used for the corpus check's hard
// paths, which the real corpus cannot exercise because its blueprint is deliberately valid.
function newBlueprintCorpus(options: {
  blueprint: Record<string, unknown>;
  packs?: string[];
  lawIds?: string[];
}): string {
  const root = mkdtempSync(join(tmpdir(), "eep-blueprint-corpus-"));
  cpSync(join(corpusDir, "schemas"), join(root, "schemas"), { recursive: true });
  write(root, "blueprints/fixture/blueprint.yaml", stringifyYaml(options.blueprint));
  for (const pack of options.packs ?? []) {
    write(root, join("packs", "stack", pack, "pack.yaml"), stringifyYaml({ name: pack }));
  }
  for (const id of options.lawIds ?? []) {
    const domain = id.split("-")[1]?.toLowerCase() ?? "misc";
    write(root, join("doctrine", domain, "laws", `${id}.md`), `---\nid: ${id}\n---\n\nBody.\n`);
  }
  return root;
}

describe("loadBlueprint", () => {
  it("loads and validates the real aws-fullstack blueprint", () => {
    const blueprint = loadBlueprint("aws-fullstack", corpusDir);

    expect(blueprint.name).toBe("aws-fullstack");
    expect(blueprint.core).toEqual(CORE);
    expect(Object.keys(blueprint.slices)).toEqual(["async", "search", "cache", "streaming", "sql"]);
    expect(blueprint.slices.async).toEqual(["aws-messaging"]);
    expect(blueprint.backends).toEqual({ fastapi: "python-fastapi", node: "typescript-node" });
    expect(blueprint.compute).toEqual({ fargate: "aws-cdk", serverless: "aws-serverless" });
    expect(blueprint.pillars).toEqual(PILLARS);
    expect(blueprint.wiring).toHaveLength(3);
    expect(blueprint.maintainers).toContain("@samar1066");
  });

  it("throws on an unknown blueprint", () => {
    expect(() => loadBlueprint("does-not-exist", corpusDir)).toThrow(
      /blueprint does-not-exist not found/,
    );
  });

  it("throws on a blueprint that fails the schema", () => {
    // Missing the required description field.
    const root = newBlueprintCorpus({ blueprint: { name: "fixture", core: ["react"] } });
    try {
      expect(() => loadBlueprint("fixture", root)).toThrow(/is invalid/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listBlueprints and availability", () => {
  it("lists aws-fullstack", () => {
    expect(listBlueprints(corpusDir)).toContain("aws-fullstack");
  });

  it("reports aws-fullstack as available because its whole core exists", () => {
    expect(availableBlueprints(corpusDir)).toContain("aws-fullstack");
  });

  it("adds a blueprints group to listCapabilities", () => {
    expect(listCapabilities(corpusDir).blueprints).toContain("aws-fullstack");
  });

  it("does not offer a blueprint whose core packs are absent", () => {
    const root = newBlueprintCorpus({ blueprint: validBlueprint({ core: ["ghost"] }) });
    try {
      expect(availableBlueprints(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("expandBlueprint", () => {
  it("returns the eight core packs with no slices", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir).packs).toEqual(CORE);
  });

  it("appends a slice's packs after the core", () => {
    expect(expandBlueprint("aws-fullstack", ["async"], corpusDir).packs).toEqual([
      ...CORE,
      "aws-messaging",
    ]);
  });

  it("appends multiple slices in the requested order", () => {
    expect(expandBlueprint("aws-fullstack", ["search", "async"], corpusDir).packs).toEqual([
      ...CORE,
      "aws-opensearch",
      "aws-messaging",
    ]);
  });

  it("throws on an unknown slice, naming the valid ones", () => {
    expect(() => expandBlueprint("aws-fullstack", ["nope"], corpusDir)).toThrow(
      /no slice "nope"; valid slices: async, search, cache, streaming, sql/,
    );
  });

  it("throws on an unknown blueprint", () => {
    expect(() => expandBlueprint("nope", [], corpusDir)).toThrow(/not found/);
  });
});

// The core with python-fastapi swapped for the node backend: every other core pack, and their order,
// is left exactly as the fastapi core has them.
const NODE_CORE = [
  "react",
  "typescript-node",
  "aws-dynamodb",
  "aws-cognito",
  "aws-s3",
  "aws-cdk",
  "containers-k8s",
  "github-actions",
];

describe("expandBlueprint with a backend", () => {
  it("swaps python-fastapi for the node backend, leaving every other core pack in place", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir, "node").packs).toEqual(NODE_CORE);
  });

  it("leaves python-fastapi in place when no backend is asked for", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir).packs).toEqual(CORE);
    expect(expandBlueprint("aws-fullstack", [], corpusDir, "").packs).toEqual(CORE);
  });

  it("keeps the default fastapi backend when its own token is named", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir, "fastapi").packs).toEqual(CORE);
  });

  it("resolves the backend token trimmed and case insensitively", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir, " Node ").packs).toEqual(NODE_CORE);
  });

  it("appends requested slices after the swapped core", () => {
    expect(expandBlueprint("aws-fullstack", ["async"], corpusDir, "node").packs).toEqual([
      ...NODE_CORE,
      "aws-messaging",
    ]);
  });

  it("throws on an unknown backend token, naming the valid ones", () => {
    expect(() => expandBlueprint("aws-fullstack", [], corpusDir, "rust")).toThrow(
      /has no backend "rust"; valid backends: fastapi, node/,
    );
  });
});

// The core with the Fargate compute swapped for the serverless one: aws-cdk becomes aws-serverless,
// and every other core pack, and their order, is left exactly as the default core has them.
const SERVERLESS_CORE = [
  "react",
  "python-fastapi",
  "aws-dynamodb",
  "aws-cognito",
  "aws-s3",
  "aws-serverless",
  "containers-k8s",
  "github-actions",
];

// The node backend and the serverless compute swapped together: two different core members change,
// and neither swap undoes the other.
const NODE_SERVERLESS_CORE = [
  "react",
  "typescript-node",
  "aws-dynamodb",
  "aws-cognito",
  "aws-s3",
  "aws-serverless",
  "containers-k8s",
  "github-actions",
];

describe("expandBlueprint with serverless compute", () => {
  it("swaps aws-cdk for aws-serverless, leaving every other core pack in place", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir, undefined, true).packs).toEqual(
      SERVERLESS_CORE,
    );
  });

  it("keeps the default Fargate compute when serverless is not asked for", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir, undefined, false).packs).toEqual(CORE);
    expect(expandBlueprint("aws-fullstack", [], corpusDir).packs).toEqual(CORE);
  });

  it("composes with a backend swap, changing both core members", () => {
    expect(expandBlueprint("aws-fullstack", [], corpusDir, "node", true).packs).toEqual(
      NODE_SERVERLESS_CORE,
    );
  });

  it("appends requested slices after the serverless swapped core", () => {
    expect(expandBlueprint("aws-fullstack", ["async"], corpusDir, undefined, true).packs).toEqual([
      ...SERVERLESS_CORE,
      "aws-messaging",
    ]);
  });
});

describe("resolveBlueprintSelection", () => {
  it("expands a lone blueprint token into its existing core packs", () => {
    expect(resolveBlueprintSelection(["aws-fullstack"], [], corpusDir)).toEqual({
      blueprint: "aws-fullstack",
      packs: CORE,
      pendingSlicePacks: [],
    });
  });

  it("reports a requested slice whose pack is not built yet as pending", () => {
    const selection = resolveBlueprintSelection(["aws-fullstack"], ["async"], corpusDir);
    expect(selection.packs).toEqual(CORE);
    expect(selection.pendingSlicePacks).toEqual(["aws-messaging"]);
  });

  it("refuses a blueprint mixed with a framework token", () => {
    expect(() => resolveBlueprintSelection(["aws-fullstack", "fastapi"], [], corpusDir)).toThrow(
      /blueprint aws-fullstack may not be combined with other tokens: fastapi/,
    );
  });

  it("passes framework tokens straight through with no blueprint", () => {
    expect(resolveBlueprintSelection(["fastapi"], [], corpusDir)).toEqual({
      blueprint: null,
      packs: [],
      pendingSlicePacks: [],
    });
  });

  it("refuses --with when no blueprint was named", () => {
    expect(() => resolveBlueprintSelection(["fastapi"], ["async"], corpusDir)).toThrow(/--with/);
  });

  it("threads a backend through, swapping the composed pack set to the node backend", () => {
    expect(resolveBlueprintSelection(["aws-fullstack"], [], corpusDir, "node")).toEqual({
      blueprint: "aws-fullstack",
      packs: NODE_CORE,
      pendingSlicePacks: [],
    });
  });

  it("refuses --backend when no blueprint was named", () => {
    expect(() => resolveBlueprintSelection(["fastapi"], [], corpusDir, "node")).toThrow(
      /--backend only applies to a blueprint token; none was given/,
    );
  });

  it("threads serverless through, swapping the composed pack set to the serverless compute", () => {
    expect(resolveBlueprintSelection(["aws-fullstack"], [], corpusDir, undefined, true)).toEqual({
      blueprint: "aws-fullstack",
      packs: SERVERLESS_CORE,
      pendingSlicePacks: [],
    });
  });

  it("refuses --serverless when no blueprint was named", () => {
    expect(() => resolveBlueprintSelection(["fastapi"], [], corpusDir, undefined, true)).toThrow(
      /--serverless only applies to a blueprint token; none was given/,
    );
  });
});

describe("slicesFromFlag", () => {
  it("parses a comma list and drops blanks", () => {
    expect(slicesFromFlag("async, search ,")).toEqual(["async", "search"]);
    expect(slicesFromFlag(undefined)).toEqual([]);
  });
});

describe("inspectBlueprints", () => {
  it("finds no hard violations for the real corpus, with slices and missing pillars pending", async () => {
    const { violations, pending } = await inspectBlueprints(corpusDir);

    // Core packs all exist and the document is schema valid, so there is nothing hard to report.
    expect(violations).toEqual([]);

    // Every wave 1 slice references a pack that is not built yet, so each is a pending note.
    for (const pack of SLICE_PACKS) {
      expect(
        pending.some((note) => note.includes(pack)),
        pack,
      ).toBe(true);
    }

    // A pillar is pending exactly when doctrine does not carry it yet, so this holds whether or not
    // the parallel doctrine wave has landed by the time it runs.
    const lawIds = corpusLawIds(corpusDir);
    for (const pillar of PILLARS) {
      expect(
        pending.some((note) => note.includes(pillar)),
        pillar,
      ).toBe(!lawIds.has(pillar));
    }
  });

  it("reports a missing core pack as a hard violation", async () => {
    const root = newBlueprintCorpus({ blueprint: validBlueprint({ core: ["ghost"] }) });
    try {
      const { violations } = await inspectBlueprints(root);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.rule).toBe("blueprint-core-pack-missing");
      expect(violations[0]?.detail).toContain("ghost");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a missing slice pack out of the hard violations, listing it as pending", async () => {
    const root = newBlueprintCorpus({
      blueprint: validBlueprint({ core: ["real"], slices: { x: ["future"] } }),
      packs: ["real"],
    });
    try {
      const { violations, pending } = await inspectBlueprints(root);
      expect(violations).toEqual([]);
      expect(pending.some((note) => note.includes("future"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("clears a pillar from pending once the doctrine law exists", async () => {
    const present = newBlueprintCorpus({
      blueprint: validBlueprint({ core: ["real"], pillars: ["EEP-REL-01"] }),
      packs: ["real"],
      lawIds: ["EEP-REL-01"],
    });
    const absent = newBlueprintCorpus({
      blueprint: validBlueprint({ core: ["real"], pillars: ["EEP-REL-01"] }),
      packs: ["real"],
    });
    try {
      expect((await inspectBlueprints(present)).pending).toEqual([]);
      expect((await inspectBlueprints(absent)).pending.some((n) => n.includes("EEP-REL-01"))).toBe(
        true,
      );
      // A pending pillar is never a hard violation, so corpus validate still passes on it.
      expect((await inspectBlueprints(absent)).violations).toEqual([]);
    } finally {
      for (const root of [present, absent]) rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a schema failure as a hard violation and stops there", async () => {
    const root = newBlueprintCorpus({
      blueprint: { name: "fixture", core: ["real"] },
      packs: ["real"],
    });
    try {
      const { violations } = await inspectBlueprints(root);
      expect(violations.some((v) => v.rule === "blueprint-schema")).toBe(true);
      // The deeper checks did not run, so no core or pending noise on top of the schema failure.
      expect(violations.every((v) => v.rule === "blueprint-schema")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is inert on a corpus that carries no blueprints", async () => {
    const root = mkdtempSync(join(tmpdir(), "eep-no-blueprints-"));
    try {
      expect(await inspectBlueprints(root)).toEqual({ violations: [], pending: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the capability screen", () => {
  it("lists aws-fullstack under its own Blueprints group", () => {
    const targetDir = mkdtempSync(join(tmpdir(), "eep-blueprint-screen-"));
    try {
      const screen = capabilityScreenLines(corpusDir, targetDir).join("\n");
      expect(screen).toContain("Blueprints");
      expect(screen).toContain("aws-fullstack");
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
