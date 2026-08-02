import { describe, expect, it } from "vitest";
import {
  INSTALL_FAILED_LINE,
  INSTALLED_LINE,
  type InstallOfferDeps,
  OFFER_PROMPT,
  offerGlobalInstall,
  TIP_LINE,
} from "../src/lib/install-offer.js";

type Recorder = {
  deps: InstallOfferDeps;
  lines: string[];
  asked: string[];
  installs: number;
};

// Every dependency is injected, so this suite proves the whole decision table (already installed,
// non interactive, declined, accepted, failed) without ever spawning npm. A real
// `npm install -g` inside a test run would mutate the developer's machine, which is exactly what
// the consent prompt exists to prevent.
function recorder(overrides: Partial<InstallOfferDeps> = {}): Recorder {
  const lines: string[] = [];
  const asked: string[] = [];
  const state = { installs: 0 };
  const deps: InstallOfferDeps = {
    onPath: () => false,
    isInteractive: () => true,
    ask: async (question: string) => {
      asked.push(question);
      return "n";
    },
    install: async () => {
      state.installs += 1;
      return 0;
    },
    log: (line: string) => {
      lines.push(line);
    },
    ...overrides,
  };
  return {
    deps,
    lines,
    asked,
    get installs() {
      return state.installs;
    },
  };
}

describe("offerGlobalInstall", () => {
  it("says nothing at all when eep already resolves on PATH", async () => {
    const rec = recorder({ onPath: () => true, isInteractive: () => true });

    await offerGlobalInstall(rec.deps);

    expect(rec.lines).toEqual([]);
    expect(rec.asked).toEqual([]);
    expect(rec.installs).toBe(0);
  });

  // CI, a pipe, and this test suite all land here. Prompting would hang on input that never
  // arrives, so the offer degrades to a single hint the transcript can carry.
  it("prints one hint line and never prompts outside a TTY", async () => {
    const rec = recorder({ isInteractive: () => false });

    await offerGlobalInstall(rec.deps);

    expect(rec.lines).toEqual([TIP_LINE]);
    expect(rec.asked).toEqual([]);
    expect(rec.installs).toBe(0);
  });

  it("asks the exact consent question, naming the command it would run", async () => {
    const rec = recorder();

    await offerGlobalInstall(rec.deps);

    expect(rec.asked).toEqual([OFFER_PROMPT]);
    expect(OFFER_PROMPT).toContain("npm install -g engineering-excellence");
  });

  it("installs on y and reports that the plain command now works", async () => {
    const rec = recorder({ ask: async () => "y" });

    await offerGlobalInstall(rec.deps);

    expect(rec.installs).toBe(1);
    expect(rec.lines).toEqual([INSTALLED_LINE]);
  });

  it("accepts an uppercase Y", async () => {
    const rec = recorder({ ask: async () => "Y\n" });

    await offerGlobalInstall(rec.deps);

    expect(rec.installs).toBe(1);
    expect(rec.lines).toEqual([INSTALLED_LINE]);
  });

  it("treats anything else as a decline: hint only, nothing installed", async () => {
    for (const answer of ["", "n", "N", "no", "yes"]) {
      const rec = recorder({ ask: async () => answer });

      await offerGlobalInstall(rec.deps);

      expect(rec.installs, `answer ${JSON.stringify(answer)}`).toBe(0);
      expect(rec.lines).toEqual([TIP_LINE]);
    }
  });

  // The offer runs after the sync has already written everything, so a global install that npm
  // refuses (a root owned prefix is the common one) must report and step aside, never turn a
  // finished sync into a failed command.
  it("reports a nonzero install exit without throwing", async () => {
    const rec = recorder({ ask: async () => "y", install: async () => 1 });

    await expect(offerGlobalInstall(rec.deps)).resolves.toBeUndefined();

    expect(rec.lines).toEqual([INSTALL_FAILED_LINE]);
    expect(INSTALL_FAILED_LINE).toContain("npx engineering-excellence");
  });

  it("reports a thrown installer (no npm on PATH) the same way, without throwing", async () => {
    const rec = recorder({
      ask: async () => "y",
      install: async () => {
        throw new Error("spawn npm ENOENT");
      },
    });

    await expect(offerGlobalInstall(rec.deps)).resolves.toBeUndefined();

    expect(rec.lines).toEqual([INSTALL_FAILED_LINE]);
  });

  it("falls back to the hint when the prompt itself fails", async () => {
    const rec = recorder({
      ask: async () => {
        throw new Error("stdin closed");
      },
    });

    await expect(offerGlobalInstall(rec.deps)).resolves.toBeUndefined();

    expect(rec.lines).toEqual([TIP_LINE]);
    expect(rec.installs).toBe(0);
  });
});
