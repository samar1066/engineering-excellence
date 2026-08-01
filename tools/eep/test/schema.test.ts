import { describe, expect, it } from "vitest";
import { validateAgainst } from "../src/lib/schema.js";

const goodLaw = {
  id: "EEP-TEST-03",
  domain: "TEST",
  title: "Every public behavior has a test that fails when the behavior breaks",
  version: "1.0.0",
  status: "stable",
  maturity: "standard",
  severity: "blocking",
  applies_to: ["all"],
  authors: [{ name: "Samar Swami", github: "@samar1066" }],
  maintainers: ["@samar1066"],
  created: "2026-08-01",
  updated: "2026-08-01",
};

describe("validateAgainst", () => {
  it("accepts a valid law", () => {
    expect(validateAgainst("law", goodLaw).valid).toBe(true);
  });
  it("rejects a bad law id", () => {
    const r = validateAgainst("law", { ...goodLaw, id: "TEST-3" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("id");
  });
  it("rejects unknown profile in eep config", () => {
    expect(validateAgainst("eep", { profile: "yolo", packs: [] }).valid).toBe(false);
  });
});
