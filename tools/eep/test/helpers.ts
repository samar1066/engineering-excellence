import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

function pathEntries(): string[] {
  return (process.env.PATH ?? "").split(delimiter).filter((entry) => entry !== "");
}

function dirHolding(command: string, entries: string[]): string | undefined {
  return entries.find((entry) => existsSync(join(entry, command)));
}

/**
 * This machine's PATH with every directory carrying an eep executable removed, and git guaranteed to
 * still resolve.
 *
 * Scrubbing eep is what makes the install hint and invocation assertions deterministic on a
 * developer machine that has already done a global install: those code paths ask whether a bare
 * `eep` resolves, and the answer must not depend on whose machine is running the suite.
 *
 * Scrubbing it can take git with it. A machine that installed both into the same directory (npm's
 * global bin is a common home for both) loses git the moment eep goes, and init shells out to git.
 * That failure mode is real: the same scrub removed `node` on the machine this was written on,
 * which is why every spawned case exited 127 until it was found. So git is resolved once against the
 * untouched PATH and linked into a directory of its own, prepended to the result. This test suite
 * does not get to decide where a machine keeps its git.
 */
export function childPath(): string {
  const original = pathEntries();
  const scrubbed = original.filter((entry) => !existsSync(join(entry, "eep")));
  const git = dirHolding("git", original);
  if (git === undefined || scrubbed.includes(git)) return scrubbed.join(delimiter);

  const shim = mkdtempSync(join(tmpdir(), "eep-gitshim-"));
  symlinkSync(join(git, "git"), join(shim, "git"));
  return [shim, ...scrubbed].join(delimiter);
}
