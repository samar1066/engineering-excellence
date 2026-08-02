import { createInterface } from "node:readline/promises";
import { execa } from "execa";
import { eepOnPath } from "./eep-on-path.js";

// The consent question, verbatim. It names the exact command that will run, because agreeing to
// this changes the machine outside the directory being synced, and nothing else in this CLI does.
export const OFFER_PROMPT =
  "Install the eep command globally so plain eep works everywhere? [y/N] (runs: npm install -g engineering-excellence)";

// Says the short form is true now, and in this shell too: a global npm bin directory is already on
// PATH, so the newly linked command resolves without reopening the terminal.
export const INSTALLED_LINE = "eep installed; new terminals and this one can now run: eep verify";

// Names the usual cause and, more importantly, the way out. A failed install is an inconvenience,
// never a broken project: everything the sync wrote still works through npx.
export const INSTALL_FAILED_LINE =
  "global install failed (often a permissions or npm prefix issue); everything still works via npx engineering-excellence";

// The one line non interactive runs and declines get instead of a prompt. Mentions both halves so
// a transcript reader learns the option exists and that not taking it costs nothing.
export const TIP_LINE =
  "tip: npm install -g engineering-excellence puts the eep command on your PATH; npx engineering-excellence works without it";

export type InstallOfferDeps = {
  onPath: () => boolean;
  isInteractive: () => boolean;
  ask: (question: string) => Promise<string>;
  // Resolves to the installer's exit code. Never rejects in the default implementation, though
  // offerGlobalInstall tolerates a rejection from an injected one.
  install: () => Promise<number>;
  log: (line: string) => void;
};

const INSTALL_ARGS = ["install", "-g", "engineering-excellence"];

// The trailing space belongs to the terminal, not the question: the prompt constant stays exactly
// what the brief specifies, and injected prompts in tests see that exact string.
async function askOnStdin(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(`${question} `);
  } finally {
    rl.close();
  }
}

// stdio inherit, not captured: the failures worth seeing here are npm's own (EACCES on a root
// owned prefix, a proxy refusing the registry), and swallowing that output would leave the user
// with a bare "it failed". reject false keeps a nonzero exit a value to report rather than a throw
// to unwind through a sync that already succeeded.
async function npmInstallGlobally(): Promise<number> {
  const result = await execa("npm", INSTALL_ARGS, { stdio: "inherit", reject: false });
  return result.exitCode ?? 1;
}

export function defaultInstallOfferDeps(): InstallOfferDeps {
  return {
    onPath: eepOnPath,
    isInteractive: () => process.stdin.isTTY === true,
    ask: askOnStdin,
    install: npmInstallGlobally,
    log: (line: string) => {
      console.log(line);
    },
  };
}

/**
 * The closing offer: when a bare `eep` does not resolve, ask (once, with consent) whether to put
 * it on PATH, and otherwise leave a single hint that the option exists.
 *
 * Runs last, after the sync has already written everything, and is total by construction: a
 * refused install, a missing npm, a closed stdin, all resolve normally after printing what
 * happened. Nothing here may throw, for two reasons: the sync succeeded, so the process must still
 * exit 0, and init's failure path deletes the project directory it built, which must never be
 * triggered by an offer to install a convenience shim.
 *
 * Every dependency is injected so the accept branch is unit testable without a real
 * `npm install -g`, which would mutate the machine running the suite.
 */
export async function offerGlobalInstall(
  deps: InstallOfferDeps = defaultInstallOfferDeps(),
): Promise<void> {
  if (deps.onPath()) return;
  if (!deps.isInteractive()) {
    deps.log(TIP_LINE);
    return;
  }

  let answer = "";
  try {
    answer = (await deps.ask(OFFER_PROMPT)).trim();
  } catch {
    answer = "";
  }
  if (answer !== "y" && answer !== "Y") {
    deps.log(TIP_LINE);
    return;
  }

  let exitCode = 1;
  try {
    exitCode = await deps.install();
  } catch {
    exitCode = 1;
  }
  deps.log(exitCode === 0 ? INSTALLED_LINE : INSTALL_FAILED_LINE);
}
