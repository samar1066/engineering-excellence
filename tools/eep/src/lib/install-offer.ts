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

// The second consent question, for the project's own dependencies. Unlike the global install it
// touches only the directory just created, and it is the one step that makes `eep verify` pass on a
// fresh scaffold, so it defaults to yes: an empty answer installs. It names the command and warns
// about the wait, because a full stack blueprint installs several package trees.
export const SETUP_OFFER_PROMPT =
  "Install the project's dependencies now, so eep verify passes on this fresh scaffold? [Y/n] (runs: make setup, which can take a few minutes)";

// Said only after make setup actually ran and returned zero: the toolchain is present, the gate is
// green, and the two commands worth knowing next are how to run it and the fast loop.
export const SETUP_DONE_LINE =
  "eep init: dependencies installed and the gate is green; run make dev to start it, make test for the fast loop";

// make setup ran and failed. The project is still complete and committed; setup is a rerunnable
// step, so name it and the reason it usually fails.
export const SETUP_FAILED_LINE =
  "eep init: make setup did not finish (its output is above); rerun it yourself with: make setup, then eep verify";

export type SetupOfferDeps = {
  isInteractive: () => boolean;
  ask: (question: string) => Promise<string>;
  // Resolves to make setup's exit code. Never rejects in the default implementation.
  setup: () => Promise<number>;
  log: (line: string) => void;
};

// stdio inherit so the user watches the installs progress, cwd the project just written, reject
// false so a missing make or a failed install is a code to report rather than a throw that would
// unwind through an init that already succeeded.
async function makeSetup(projectDir: string): Promise<number> {
  const result = await execa("make", ["setup"], {
    cwd: projectDir,
    stdio: "inherit",
    reject: false,
  });
  return result.exitCode ?? 1;
}

export function defaultSetupOfferDeps(projectDir: string): SetupOfferDeps {
  return {
    isInteractive: () => process.stdin.isTTY === true,
    ask: askOnStdin,
    setup: () => makeSetup(projectDir),
    log: (line: string) => {
      console.log(line);
    },
  };
}

/**
 * The dependency install offer: right after the project is written, ask (with consent, defaulting
 * to yes) whether to run its make setup, so a first `eep verify` on the fresh scaffold passes
 * instead of failing every check that needs an installed toolchain. Returns whether setup ran and
 * succeeded, so init can tailor the next steps it prints.
 *
 * Total like offerGlobalInstall: a decline, a non interactive run, a missing make, or a failed
 * install all resolve to false after at most printing what happened, and nothing here throws,
 * because the project is already written and committed and must survive whatever setup does. A
 * decline and a non interactive run stay silent here; init's next-steps line names make setup for
 * both, so there is one place that says it, not two.
 */
export async function offerComponentSetup(deps: SetupOfferDeps): Promise<boolean> {
  if (!deps.isInteractive()) return false;

  let answer = "";
  try {
    answer = (await deps.ask(SETUP_OFFER_PROMPT)).trim();
  } catch {
    answer = "";
  }
  // Defaults to yes: only an answer starting with n (n, N, no) declines; empty, y, and anything
  // else installs, because this readies the project the user just asked eep to build.
  if (answer.toLowerCase().startsWith("n")) return false;

  let exitCode = 1;
  try {
    exitCode = await deps.setup();
  } catch {
    exitCode = 1;
  }
  deps.log(exitCode === 0 ? SETUP_DONE_LINE : SETUP_FAILED_LINE);
  return exitCode === 0;
}
