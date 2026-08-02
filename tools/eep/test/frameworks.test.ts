import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listCapabilities, resolveFrameworks, validTokens } from "../src/lib/frameworks.js";
import { repoRoot } from "../src/lib/schema.js";

const corpusDir = repoRoot();

/**
 * Roadmap tokens are read out of the corpus, never written down here.
 *
 * These cases are about the alias and roadmap machinery, not about which packs happen to exist this
 * week, and every literal token name written into an assertion is a fuse: it burns down the day
 * that pack ships. One already did, mid session, when a sibling landed the pack behind `node`.
 */
function comingSoonTokens(): string[] {
  const { comingSoon } = listCapabilities(corpusDir);
  expect(
    comingSoon.length,
    "the roadmap has no unbuilt packs left to test against",
  ).toBeGreaterThan(1);
  return comingSoon;
}

function anAvailableToken(): string {
  const { available } = listCapabilities(corpusDir);
  const first = available[0];
  expect(first, "the corpus carries no packs at all").toBeDefined();
  return first?.token ?? "";
}

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
    const token = comingSoonTokens()[0] ?? "";

    expect(resolveFrameworks([token.toUpperCase()], corpusDir)).toEqual({
      packs: [],
      comingSoon: [token],
      unknown: [],
    });
  });

  /**
   * Every spelling of one unbuilt pack collapses to that pack's primary token.
   *
   * The group is discovered rather than named: every valid token is resolved, the ones landing on
   * the same coming soon token are collected, and the first group with more than one spelling is
   * the aliased pack. That keeps the case alive as packs ship and aliases are added.
   */
  it("reports every alias of an unbuilt pack under one primary token", () => {
    const spellingsByPrimary = new Map<string, string[]>();
    for (const token of validTokens(corpusDir)) {
      const primary = resolveFrameworks([token], corpusDir).comingSoon[0];
      if (primary === undefined) continue;
      spellingsByPrimary.set(primary, [...(spellingsByPrimary.get(primary) ?? []), token]);
    }

    const aliased = [...spellingsByPrimary.entries()].find(([, spellings]) => spellings.length > 1);
    expect(aliased, "no unbuilt pack has more than one spelling").toBeDefined();
    const [primary, spellings] = aliased ?? ["", []];

    const resolved = resolveFrameworks(spellings, corpusDir);
    expect(resolved.comingSoon).toEqual([primary]);
    expect(resolved.packs).toEqual([]);
  });

  it("reports an unknown token and keeps the rest of the list usable", () => {
    const resolved = resolveFrameworks(["fastapi", "cobol"], corpusDir);
    expect(resolved.unknown).toEqual(["cobol"]);
    expect(resolved.packs).toEqual(["python-fastapi"]);
  });

  it("splits a mixed list into available packs and coming soon tokens, in the typed order", () => {
    const available = anAvailableToken();
    const [first, second] = comingSoonTokens();

    const resolved = resolveFrameworks([available, first ?? "", second ?? ""], corpusDir);

    expect(resolved.packs).toEqual(resolveFrameworks([available], corpusDir).packs);
    expect(resolved.comingSoon).toEqual([first, second]);
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

  // Asserted as a property of every coming soon token, not against a named one: each has to be a
  // token the CLI still accepts, and none may name a pack the corpus already carries.
  it("reports the roadmap tokens with no pack in the corpus as coming soon", () => {
    const { available, comingSoon } = listCapabilities(corpusDir);
    const availablePacks = new Set(available.map((entry) => entry.pack));

    expect(comingSoon.length).toBeGreaterThan(0);
    for (const token of comingSoon) {
      expect(validTokens(corpusDir)).toContain(token);
      expect(resolveFrameworks([token], corpusDir)).toEqual({
        packs: [],
        comingSoon: [token],
        unknown: [],
      });
      expect(availablePacks.has(token)).toBe(false);
    }
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
