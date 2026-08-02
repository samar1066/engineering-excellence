import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listCapabilities, resolveFrameworks, validTokens } from "../src/lib/frameworks.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

describe("resolveFrameworks", () => {
  it("maps a friendly token onto the pack it names", () => {
    expect(resolveFrameworks(["fastapi"], corpusDir)).toEqual({
      packs: ["python-fastapi"],
      comingSoon: [],
      unknown: [],
    });
  });

  it("accepts the pack name itself as a token", () => {
    expect(resolveFrameworks(["python-fastapi"], corpusDir)).toEqual({
      packs: ["python-fastapi"],
      comingSoon: [],
      unknown: [],
    });
  });

  it("resolves case insensitively and reports a known but unbuilt pack as coming soon", () => {
    expect(resolveFrameworks(["NODE"], corpusDir)).toEqual({
      packs: [],
      comingSoon: ["node"],
      unknown: [],
    });
  });

  it("reports every alias of an unbuilt pack under one primary token", () => {
    const resolved = resolveFrameworks(["typescript", "ts", "node"], corpusDir);
    expect(resolved.comingSoon).toEqual(["node"]);
    expect(resolved.packs).toEqual([]);
  });

  it("reports an unknown token and keeps the rest of the list usable", () => {
    const resolved = resolveFrameworks(["fastapi", "cobol"], corpusDir);
    expect(resolved.unknown).toEqual(["cobol"]);
    expect(resolved.packs).toEqual(["python-fastapi"]);
  });

  it("splits a mixed list into available packs and coming soon tokens, in the typed order", () => {
    const resolved = resolveFrameworks(["fastapi", "node", "angular"], corpusDir);
    expect(resolved.packs).toEqual(["python-fastapi"]);
    expect(resolved.comingSoon).toEqual(["node", "angular"]);
    expect(resolved.unknown).toEqual([]);
  });

  it("deduplicates repeated tokens and sorts the resolved packs", () => {
    const resolved = resolveFrameworks(["fastapi", "FastAPI", "python-fastapi"], corpusDir);
    expect(resolved.packs).toEqual(["python-fastapi"]);
  });

  it("treats every alias in the table as valid input", () => {
    const tokens = validTokens(corpusDir);
    expect(tokens).toContain("fastapi");
    expect(tokens).toContain("kubernetes");
    expect(tokens).toContain("gitlab");
    expect(resolveFrameworks(tokens, corpusDir).unknown).toEqual([]);
  });
});

describe("listCapabilities", () => {
  it("reports the packs the corpus actually carries as available", () => {
    const { available } = listCapabilities(corpusDir);
    expect(available).toContainEqual({ token: "fastapi", pack: "python-fastapi" });
  });

  it("reports the roadmap tokens with no pack in the corpus as coming soon", () => {
    const { comingSoon } = listCapabilities(corpusDir);
    expect(comingSoon.length).toBeGreaterThan(0);
    expect(comingSoon).toContain("node");
  });

  it("never lists the same token as both available and coming soon", () => {
    const { available, comingSoon } = listCapabilities(corpusDir);
    for (const entry of available) {
      expect(comingSoon).not.toContain(entry.token);
    }
  });

  // Availability is a fact about the corpus on disk, never a hardcoded list, so an empty corpus
  // must demote every token to the roadmap rather than keep claiming fastapi ships.
  it("reports nothing as available against a corpus that carries no packs", () => {
    const empty = mkdtempSync(join(tmpdir(), "eep-empty-corpus-"));
    try {
      const { available, comingSoon } = listCapabilities(empty);
      expect(available).toEqual([]);
      expect(comingSoon).toContain("fastapi");
      expect(resolveFrameworks(["fastapi"], empty).comingSoon).toEqual(["fastapi"]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
