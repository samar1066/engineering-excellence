import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eepOnPath, invocation } from "../src/lib/eep-on-path.js";

const ORIGINAL_PATH = process.env.PATH;

function newDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A stand in for the shim npm writes into its global bin directory: a file named exactly "eep"
// with the executable bit set. Nothing in this suite ever runs it; only its name, its type, and
// its mode are what the resolver reads.
function dirWithExecutableEep(): string {
  const dir = newDir("eep-on-path-bin-");
  const file = join(dir, "eep");
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return dir;
}

// The directory npm and npx prepend to the PATH of the process they spawn, carrying this
// package's own shim. Reproduced exactly, name for name, because getting this case wrong is the
// whole defect: under `npx engineering-excellence ...` the CLI can reach eep while the human who
// typed the command cannot.
function injectedBinWithEep(): string {
  const binDir = join(newDir("eep-on-path-npx-"), "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const file = join(binDir, "eep");
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return binDir;
}

function setPath(...entries: string[]): void {
  process.env.PATH = entries.join(delimiter);
}

afterEach(() => {
  if (ORIGINAL_PATH === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = ORIGINAL_PATH;
  }
});

describe("eepOnPath", () => {
  it("finds an executable eep in a directory on PATH", () => {
    setPath(dirWithExecutableEep(), newDir("eep-on-path-empty-"));

    expect(eepOnPath()).toBe(true);
  });

  it("finds an eep that sits in a later PATH entry", () => {
    setPath(newDir("eep-on-path-empty-"), newDir("eep-on-path-empty-"), dirWithExecutableEep());

    expect(eepOnPath()).toBe(true);
  });

  it("is false when no PATH entry carries eep", () => {
    setPath(newDir("eep-on-path-empty-"), newDir("eep-on-path-empty-"));

    expect(eepOnPath()).toBe(false);
  });

  // An unset or empty PATH is the degenerate case: no entries to search, so nothing resolves, and
  // the split must not manufacture a lookup against the current directory.
  it("is false when PATH is empty", () => {
    process.env.PATH = "";

    expect(eepOnPath()).toBe(false);
  });

  it("is false when PATH is not set at all", () => {
    delete process.env.PATH;

    expect(eepOnPath()).toBe(false);
  });

  it("ignores a nonexistent PATH entry", () => {
    setPath(join(newDir("eep-on-path-gone-"), "never-created"));

    expect(eepOnPath()).toBe(false);
  });

  // A readable but non executable file named eep is not a command: a shell would refuse it, so
  // printing `eep verify` on the strength of it would repeat exactly the failure this fixes.
  it("ignores a non executable file named eep", () => {
    const dir = newDir("eep-on-path-notexec-");
    writeFileSync(join(dir, "eep"), "not a program\n");
    chmodSync(join(dir, "eep"), 0o644);
    setPath(dir);

    expect(eepOnPath()).toBe(false);
  });

  // A directory carries the executable bit as "searchable", so an access check alone would call
  // <bin>/eep/ a command. The type test is what keeps that from happening.
  it("ignores a directory named eep", () => {
    const dir = newDir("eep-on-path-dir-");
    mkdirSync(join(dir, "eep"));
    setPath(dir);

    expect(eepOnPath()).toBe(false);
  });

  /**
   * The npx case, and the reason this helper exists at all.
   *
   * `npx engineering-excellence ...` installs the package into the npx cache and prepends
   * <cache>/node_modules/.bin to the PATH of the process it spawns, so this CLI can always find an
   * eep shim there while the shell that invoked it has no such command. Counting those entries
   * would print "next: eep verify" to precisely the user who cannot run it.
   */
  it("ignores the node_modules/.bin entries npm and npx inject into PATH", () => {
    setPath(injectedBinWithEep(), newDir("eep-on-path-empty-"));

    expect(eepOnPath()).toBe(false);
  });

  it("ignores an injected entry written with a trailing separator", () => {
    setPath(`${injectedBinWithEep()}/`);

    expect(eepOnPath()).toBe(false);
  });

  // A global install is still a global install when the run happens to be under npx: the entry
  // that answers is the one outside node_modules.
  it("still finds a real install when an injected entry is on PATH too", () => {
    setPath(injectedBinWithEep(), dirWithExecutableEep());

    expect(eepOnPath()).toBe(true);
  });
});

describe("invocation", () => {
  it("is the bare command when eep resolves on PATH", () => {
    setPath(dirWithExecutableEep());

    expect(invocation()).toBe("eep");
  });

  it("is the npx form when eep does not resolve on PATH", () => {
    setPath(newDir("eep-on-path-empty-"));

    expect(invocation()).toBe("npx engineering-excellence");
  });
});
