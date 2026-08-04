import { describe, expect, it } from "vitest";
import {
  INSTALL_FAILED_LINE,
  INSTALLED_LINE,
  type InstallOfferDeps,
  OFFER_PROMPT,
  offerComponentSetup,
  offerGlobalInstall,
  SETUP_DONE_LINE,
  SETUP_FAILED_LINE,
  SETUP_OFFER_PROMPT,
  type SetupOfferDeps,
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

type SetupRecorder = {
  deps: SetupOfferDeps;
  lines: string[];
  asked: string[];
  setups: number;
};

// Injected like the install suite, so the whole decision table (non interactive, declined, accepted
// by default, failed, thrown) is proven without spawning a real make setup, which would install
// package trees on the machine running the tests.
function setupRecorder(overrides: Partial<SetupOfferDeps> = {}): SetupRecorder {
  const lines: string[] = [];
  const asked: string[] = [];
  const state = { setups: 0 };
  const deps: SetupOfferDeps = {
    isInteractive: () => true,
    ask: async (question: string) => {
      asked.push(question);
      return "";
    },
    setup: async () => {
      state.setups += 1;
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
    get setups() {
      return state.setups;
    },
  };
}

describe("offerComponentSetup", () => {
  // CI, a pipe, and this suite land here. It stays silent and runs nothing: init's next-steps line
  // names make setup, so a non interactive transcript still learns the step exists.
  it("never prompts or runs outside a TTY, and reports it did not run", async () => {
    const rec = setupRecorder({ isInteractive: () => false });

    await expect(offerComponentSetup(rec.deps)).resolves.toBe(false);

    expect(rec.asked).toEqual([]);
    expect(rec.setups).toBe(0);
    expect(rec.lines).toEqual([]);
  });

  it("asks the exact consent question, naming the command it would run", async () => {
    const rec = setupRecorder();

    await offerComponentSetup(rec.deps);

    expect(rec.asked).toEqual([SETUP_OFFER_PROMPT]);
    expect(SETUP_OFFER_PROMPT).toContain("make setup");
  });

  // Defaults to yes: unlike the global install, an empty answer installs, because this readies the
  // project the user just asked for rather than changing the machine.
  it("runs setup on an empty answer and reports the gate is green", async () => {
    const rec = setupRecorder({ ask: async () => "" });

    await expect(offerComponentSetup(rec.deps)).resolves.toBe(true);

    expect(rec.setups).toBe(1);
    expect(rec.lines).toEqual([SETUP_DONE_LINE]);
  });

  it("runs setup on y or Y, trimming surrounding whitespace", async () => {
    for (const answer of ["y", "Y\n", "  y  "]) {
      const rec = setupRecorder({ ask: async () => answer });

      await expect(offerComponentSetup(rec.deps)).resolves.toBe(true);

      expect(rec.setups, `answer ${JSON.stringify(answer)}`).toBe(1);
      expect(rec.lines).toEqual([SETUP_DONE_LINE]);
    }
  });

  // Declines on any answer starting with n. It stays silent and runs nothing; init's next-steps line
  // carries the make setup guidance, so there is one place that says it.
  it("declines on n, N, or no: runs nothing, stays silent", async () => {
    for (const answer of ["n", "N", "no\n"]) {
      const rec = setupRecorder({ ask: async () => answer });

      await expect(offerComponentSetup(rec.deps)).resolves.toBe(false);

      expect(rec.setups, `answer ${JSON.stringify(answer)}`).toBe(0);
      expect(rec.lines).toEqual([]);
    }
  });

  // make setup ran and failed. The project is already written and committed, so a nonzero exit is
  // reported and stepped past, never a throw that would unwind through a finished init.
  it("reports a nonzero setup exit without throwing", async () => {
    const rec = setupRecorder({ ask: async () => "", setup: async () => 2 });

    await expect(offerComponentSetup(rec.deps)).resolves.toBe(false);

    expect(rec.lines).toEqual([SETUP_FAILED_LINE]);
    expect(SETUP_FAILED_LINE).toContain("make setup");
  });

  it("reports a thrown setup (no make on PATH) the same way, without throwing", async () => {
    const rec = setupRecorder({
      ask: async () => "",
      setup: async () => {
        throw new Error("spawn make ENOENT");
      },
    });

    await expect(offerComponentSetup(rec.deps)).resolves.toBe(false);

    expect(rec.lines).toEqual([SETUP_FAILED_LINE]);
  });

  // A failed prompt resolves to the default, which is yes: a closed stdin must not silently skip the
  // one step that makes the fresh scaffold pass its own gate.
  it("treats a failed prompt as the default yes and runs setup", async () => {
    const rec = setupRecorder({
      ask: async () => {
        throw new Error("stdin closed");
      },
    });

    await expect(offerComponentSetup(rec.deps)).resolves.toBe(true);

    expect(rec.setups).toBe(1);
    expect(rec.lines).toEqual([SETUP_DONE_LINE]);
  });
});
