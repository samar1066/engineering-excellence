import { dirname, join } from "node:path";
import fg from "fast-glob";
import { loadPack } from "./pack.js";

export type Capability = { token: string; pack: string };

export type FrameworkResolution = {
  packs: string[];
  comingSoon: string[];
  unknown: string[];
};

/**
 * The friendly token vocabulary, in roadmap order.
 *
 * The first entry for a pack is that pack's primary token: the spelling printed back in the
 * capability screen, in the "coming soon" notice, and in the detection hint. Later entries are
 * aliases that resolve to the same pack, so `ts`, `typescript`, and `node` are one selection and
 * are reported once, under `node`.
 *
 * This table is a naming convention only. It says nothing about which packs exist: availability is
 * read from the corpus on disk every time (see installedPackNames), so a pack landing in the
 * corpus lights its token up with no code change here, and an empty corpus demotes every token to
 * the roadmap.
 */
const ALIASES: ReadonlyArray<readonly [token: string, pack: string]> = [
  ["fastapi", "python-fastapi"],
  ["python-fastapi", "python-fastapi"],
  ["node", "typescript-node"],
  ["typescript", "typescript-node"],
  ["ts", "typescript-node"],
  ["react", "react"],
  ["angular", "angular"],
  ["react-native", "react-native"],
  ["reactnative", "react-native"],
  ["java", "java-spring"],
  ["spring", "java-spring"],
  ["dotnet", "dotnet-aspnet"],
  ["csharp", "dotnet-aspnet"],
  ["go", "go"],
  ["cpp", "cpp"],
  ["sql", "sql-postgres"],
  ["postgres", "sql-postgres"],
  ["aws", "aws-serverless"],
  ["serverless", "aws-serverless"],
  ["cdk", "aws-cdk"],
  ["terraform", "terraform"],
  ["k8s", "containers-k8s"],
  ["kubernetes", "containers-k8s"],
  // Containers and their orchestration ship as one pack: the Dockerfiles a service builds from and
  // the manifests that run them are the same decision, and a user who types "docker" is asking for
  // that pack, not for a separate one. Listed after k8s so the primary token stays k8s.
  ["docker", "containers-k8s"],
  ["power-platform", "power-platform"],
  ["github-actions", "github-actions"],
  ["azure-devops", "azure-devops"],
  ["gitlab", "gitlab-ci"],
];

const PACK_BY_TOKEN: ReadonlyMap<string, string> = new Map(ALIASES);

// Pack names in table order, deduplicated, each paired with its primary token.
const ROADMAP: readonly Capability[] = (() => {
  const seen = new Set<string>();
  const roadmap: Capability[] = [];
  for (const [token, pack] of ALIASES) {
    if (seen.has(pack)) continue;
    seen.add(pack);
    roadmap.push({ token, pack });
  }
  return roadmap;
})();

const PRIMARY_TOKEN_BY_PACK: ReadonlyMap<string, string> = new Map(
  ROADMAP.map((entry) => [entry.pack, entry.token]),
);

function normalize(token: string): string {
  return token.trim().toLowerCase();
}

// Every pack manifest the corpus carries, by the manifest's own name field. Mirrors the glob
// detect.ts and vendor.ts scan, so "present in the corpus" means the same thing to all three.
function installedPackNames(corpusDir: string): Set<string> {
  const manifestPaths = fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort();
  const names = new Set<string>();
  for (const relPath of manifestPaths) {
    const name = loadPack(dirname(join(corpusDir, relPath))).name;
    if (name !== "") names.add(name);
  }
  return names;
}

/**
 * The pack a token names, or undefined when the token means nothing.
 *
 * A pack's own name is always accepted, whether or not the alias table lists it: the corpus, not
 * this table, decides what exists, and a contributed pack must be selectable the moment it lands
 * rather than waiting for an alias to be added for it.
 */
function packForToken(token: string, installed: Set<string>): string | undefined {
  const mapped = PACK_BY_TOKEN.get(token);
  if (mapped !== undefined) return mapped;
  return installed.has(token) ? token : undefined;
}

function primaryTokenFor(pack: string): string {
  return PRIMARY_TOKEN_BY_PACK.get(pack) ?? pack;
}

/**
 * Splits a list of user typed tokens into the packs to vendor, the tokens whose packs are not
 * built yet, and the tokens that mean nothing at all.
 *
 * Tokens are matched case insensitively after trimming. `packs` is sorted and deduplicated, so the
 * same set typed in any order syncs to the same tree. `comingSoon` and `unknown` keep the order
 * they were typed in, since both are read back to the person who typed them; `comingSoon` reports
 * each unbuilt pack once, under its primary token, so `ts typescript node` is one line, not three.
 */
export function resolveFrameworks(tokens: string[], corpusDir: string): FrameworkResolution {
  const installed = installedPackNames(corpusDir);
  const packs = new Set<string>();
  const comingSoon: string[] = [];
  const unknown: string[] = [];

  for (const raw of tokens) {
    const token = normalize(raw);
    if (token === "") continue;
    const pack = packForToken(token, installed);
    if (pack === undefined) {
      if (!unknown.includes(token)) unknown.push(token);
      continue;
    }
    if (installed.has(pack)) {
      packs.add(pack);
      continue;
    }
    const primary = primaryTokenFor(pack);
    if (!comingSoon.includes(primary)) comingSoon.push(primary);
  }

  return { packs: [...packs].sort(), comingSoon, unknown };
}

/**
 * What this CLI can do right now, read from the corpus on disk: the tokens backed by a pack that
 * exists, and the roadmap tokens still waiting for one. Packs the corpus carries that the alias
 * table has no entry for are listed under their own name, so nothing shipped is ever hidden.
 */
export function listCapabilities(corpusDir: string): {
  available: Capability[];
  comingSoon: string[];
} {
  const installed = installedPackNames(corpusDir);
  const available: Capability[] = [];
  const comingSoon: string[] = [];

  for (const entry of ROADMAP) {
    if (installed.has(entry.pack)) available.push(entry);
    else comingSoon.push(entry.token);
  }
  for (const pack of [...installed].sort()) {
    if (!PRIMARY_TOKEN_BY_PACK.has(pack)) available.push({ token: pack, pack });
  }

  return { available, comingSoon };
}

// Every spelling resolveFrameworks accepts, sorted, for the message an unknown token earns.
export function validTokens(corpusDir: string): string[] {
  const tokens = new Set(ALIASES.map(([token]) => token));
  for (const pack of installedPackNames(corpusDir)) tokens.add(pack);
  return [...tokens].sort();
}

// The friendly tokens for a set of pack names, used to phrase detection results in the same
// vocabulary the command line takes as input.
export function tokensForPacks(packs: string[]): string[] {
  return packs.map((pack) => primaryTokenFor(pack));
}
