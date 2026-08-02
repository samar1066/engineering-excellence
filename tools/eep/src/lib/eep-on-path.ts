import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, sep } from "node:path";

// The bin name npm installs for this package (see package.json "bin"), and the word a consumer
// types once a global install has put it on PATH.
const EXECUTABLE = "eep";

// What every recommended command is prefixed with when a bare `eep` would not resolve. This is the
// form npx users already ran to get here, so it always works for them.
const NPX_FORM = "npx engineering-excellence";

// The directory npm and npx prepend to the PATH of every process they spawn, one per ancestor of
// the cwd plus, under npx, the npx cache's own.
const NPM_INJECTED_BIN = join("node_modules", ".bin");
const TRAILING_SEPARATORS = /[/\\]+$/;

/**
 * Whether a PATH entry is one npm or npx injected for the lifetime of this one command.
 *
 * This is the crux of the whole feature. `npx engineering-excellence ...` installs the package
 * into ~/.npm/_npx/<hash>/node_modules and puts that tree's .bin on the child's PATH, so an eep
 * shim is always reachable from inside this process while the shell that typed the command has no
 * such command at all. Counting those entries would print "next: eep verify" to exactly the user
 * who cannot run it, which is the defect this module exists to fix.
 *
 * A global install never lands here: npm links it into <prefix>/bin (/usr/local/bin, a version
 * manager's bin, ~/.local/bin), never inside a node_modules tree.
 *
 * The bias is deliberate and one directional. Someone whose interactive PATH really does carry a
 * node_modules/.bin is told to use the npx form, which works for them too; the reverse mistake
 * hands a consumer a command their shell does not have.
 */
function isNpmInjectedBin(entry: string): boolean {
  const trimmed = entry.replace(TRAILING_SEPARATORS, "");
  return trimmed === NPM_INJECTED_BIN || trimmed.endsWith(`${sep}${NPM_INJECTED_BIN}`);
}

// A PATH entry answers only when the candidate is a file (a symlink to one counts, which is what
// npm's global bin actually writes) that the current process may execute. Directories are excluded
// deliberately: the executable bit means "searchable" on a directory, so an access check on its
// own would call a directory named eep a command. Any lookup error (a PATH entry that no longer
// exists, one this process cannot stat) means "not here", never a throw: this runs while printing
// closing guidance, long after the work succeeded.
function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the user who invoked this run could type a bare `eep` in their own shell and reach this
 * CLI. Not "can this process find an eep": see isNpmInjectedBin for why those differ.
 *
 * Resolved by reading PATH directly rather than shelling out to `command -v`: this is called on
 * the success path of every sync, spawning a shell to answer it would be both slower and one more
 * thing that can fail, and the answer only decides how a line of text is printed.
 *
 * An unset or empty PATH is answered false rather than searched: there are no entries, and an
 * empty split element must never be resolved against the current directory, which would let a
 * stray ./eep in the project being synced decide what this CLI recommends.
 */
export function eepOnPath(): boolean {
  const raw = process.env.PATH;
  if (raw === undefined || raw === "") return false;
  return raw
    .split(delimiter)
    .filter((entry) => entry !== "" && !isNpmInjectedBin(entry))
    .some((entry) => isExecutableFile(join(entry, EXECUTABLE)));
}

/**
 * The prefix every command this CLI prints should carry: `eep` for someone who has the command,
 * `npx engineering-excellence` for everyone else.
 *
 * Read at print time, not cached at module load, so a run that installs the command globally can
 * truthfully name the short form afterwards.
 */
export function invocation(): string {
  return eepOnPath() ? EXECUTABLE : NPX_FORM;
}
