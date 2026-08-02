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

  // Tokens whose packs no wave of the current roadmap builds. Naming a token that is about to ship
  // would make these assertions expire the day its pack lands, and the subject here is the alias
  // and roadmap machinery, not which packs happen to exist this week.
  it("resolves case insensitively and reports a known but unbuilt pack as coming soon", () => {
    expect(resolveFrameworks(["ANGULAR"], corpusDir)).toEqual({
      packs: [],
      comingSoon: ["angular"],
      unknown: [],
    });
  });

  it("reports every alias of an unbuilt pack under one primary token", () => {
    const resolved = resolveFrameworks(["java", "spring"], corpusDir);
    expect(resolved.comingSoon).toEqual(["java"]);
    expect(resolved.packs).toEqual([]);
  });

  it("reports an unknown token and keeps the rest of the list usable", () => {
    const resolved = resolveFrameworks(["fastapi", "cobol"], corpusDir);
    expect(resolved.unknown).toEqual(["cobol"]);
    expect(resolved.packs).toEqual(["python-fastapi"]);
  });

  it("splits a mixed list into available packs and coming soon tokens, in the typed order", () => {
    const resolved = resolveFrameworks(["fastapi", "java", "angular"], corpusDir);
    expect(resolved.packs).toEqual(["python-fastapi"]);
    expect(resolved.comingSoon).toEqual(["java", "angular"]);
    expect(resolved.unknown).toEqual([]);
  });

  // Containers and their orchestration are one pack, so the token a user reaches for first has to
  // land on it too. Asserted as "docker resolves exactly as k8s does" rather than against a fixed
  // outcome, so this keeps holding the day that pack ships.
  it("maps docker onto the same pack k8s names", () => {
    expect(resolveFrameworks(["docker"], corpusDir)).toEqual(resolveFrameworks(["k8s"], corpusDir));
    expect(validTokens(corpusDir)).toContain("docker");
  });

  it("reports docker under the k8s primary token while that pack is unbuilt", () => {
    const empty = mkdtempSync(join(tmpdir(), "eep-empty-corpus-"));
    try {
      expect(resolveFrameworks(["docker"], empty)).toEqual({
        packs: [],
        comingSoon: ["k8s"],
        unknown: [],
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
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
    expect(comingSoon).toContain("angular");
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
