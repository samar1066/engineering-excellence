import { describe, expect, it } from "vitest";
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
