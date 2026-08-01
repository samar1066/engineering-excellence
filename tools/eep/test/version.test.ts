import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

describe("version", () => {
  it("exposes a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
