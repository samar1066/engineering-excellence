#!/usr/bin/env node
// Copies the corpus this CLI reads at runtime into tools/eep/corpus/, so the published package
// works from npm with no repository checkout anywhere on the machine. Runs from prepack, which
// fires for both `npm pack` and `npm publish`, and the result ships because package.json lists
// "corpus" in "files". At runtime lib/corpus-root.ts finds it as a sibling of dist/.
//
// The directory is deleted and recreated every time: a stale pack or a law removed upstream must
// never survive in a published tarball just because it was there on the last build.
//
// Node's standard library only, no dependencies: this has to run in the same install that is
// building the package.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Everything the CLI reads out of a corpus: the constitution and profiles it vendors, the packs
// and the doctrine laws they implement, the blueprints that compose those packs, the schemas that
// validate them, and eep.yaml, which is also one of the two markers corpus-root.ts probes for.
const ENTRIES = ["CONSTITUTION.md", "blueprints", "doctrine", "packs", "profiles", "schemas", "eep.yaml"];

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const corpusDir = join(packageDir, "corpus");

const missing = ENTRIES.filter((entry) => !existsSync(join(repoRoot, entry)));
if (missing.length > 0) {
  console.error(`bundle-corpus: ${repoRoot} is missing ${missing.join(", ")}`);
  process.exit(1);
}

rmSync(corpusDir, { recursive: true, force: true });
mkdirSync(corpusDir, { recursive: true });
for (const entry of ENTRIES) {
  cpSync(join(repoRoot, entry), join(corpusDir, entry), { recursive: true });
}

// npm always includes a package root README.md and LICENSE in the tarball, independent of the
// "files" allow list. Both live at the repository root, two levels up, so copy them in at pack
// time; without this the npmjs.com package page renders empty and the tarball ships unlicensed.
for (const doc of ["README.md", "LICENSE"]) {
  cpSync(join(repoRoot, doc), join(packageDir, doc));
}

console.log(`bundle-corpus: copied ${ENTRIES.join(", ")} plus README.md and LICENSE`);
