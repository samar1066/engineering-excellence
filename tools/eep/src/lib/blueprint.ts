import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import { readFrontmatter } from "./frontmatter.js";
import { loadPack } from "./pack.js";

/**
 * A blueprint is a curated composition that expands into a pack set for a composed init. It is not
 * a pack: a pack binds laws to one technology, a blueprint composes many packs, names the cross
 * service pillar laws no single pack can own, and records how the packs wire together. Blueprints
 * live at `blueprints/<name>/blueprint.yaml`, validated by schemas/blueprint.schema.json.
 */
export type Blueprint = {
  name: string;
  description: string;
  // Always included, at least one, in declared order.
  core: string[];
  // Optional named pack sets, added with --with <name,...>. A slice may reference a pack the corpus
  // does not carry yet (a future wave), which is why expansion never checks pack existence.
  slices: Record<string, string[]>;
  // Optional map of backend token to the stack pack that owns the API and domain component, selected
  // with --backend <token>. Empty when the blueprint declares none. One of the values is the backend
  // already named in core (the default); choosing another swaps it in place (see expandBlueprint).
  backends: Record<string, string>;
  // Optional map of compute token to the platform pack that owns how the app runs, selected with
  // --serverless. Empty when the blueprint declares none. One of the values is the compute pack
  // already named in core (the default, fargate); --serverless swaps it for the serverless one in
  // place, the same way --backend swaps the backend (see expandBlueprint and coreWithCompute).
  compute: Record<string, string>;
  // Cross service law ids the blueprint asserts. Referenced only; the doctrine owns them.
  pillars: string[];
  // Reference integration prose between packs. Documentation only, drives no behavior.
  wiring: string[];
  authors: { name: string; github: string }[];
  maintainers: string[];
};

/**
 * The result of resolving a command's tokens against the blueprint vocabulary.
 *
 * `blueprint` null means no token named a blueprint, so the caller proceeds with its own tokens
 * unchanged. Otherwise `packs` is the blueprint's expanded set filtered to the packs that actually
 * exist in the corpus (ready to compose), and `pendingSlicePacks` names the requested slice packs
 * that are not built yet, for the caller to report the way it reports any coming soon token.
 */
export type BlueprintSelection = {
  blueprint: string | null;
  packs: string[];
  pendingSlicePacks: string[];
};

function blueprintPath(corpusDir: string, name: string): string {
  return join(corpusDir, "blueprints", name, "blueprint.yaml");
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toSlices(value: unknown): Record<string, string[]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const slices: Record<string, string[]> = {};
  for (const [key, packs] of Object.entries(value as Record<string, unknown>)) {
    slices[key] = toStringArray(packs);
  }
  return slices;
}

// A map of backend token to pack name, keeping only string valued entries. A malformed entry (a
// number, a nested object) is dropped rather than coerced, so only real token to pack pairs reach the
// swap. Absent or non object backends yields {}, which leaves core untouched when no --backend is asked.
function toBackends(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const backends: Record<string, string> = {};
  for (const [token, pack] of Object.entries(value as Record<string, unknown>)) {
    if (typeof pack === "string") backends[token] = pack;
  }
  return backends;
}

// A map of compute token to pack name, parsed exactly like toBackends: only string valued entries are
// kept, a malformed entry is dropped rather than coerced, and an absent or non object compute yields
// {}, which leaves core untouched when no --serverless is asked. The two are separate axes of the core
// (which backend owns the API, which platform runs it), so they are parsed and swapped independently.
function toCompute(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const compute: Record<string, string> = {};
  for (const [token, pack] of Object.entries(value as Record<string, unknown>)) {
    if (typeof pack === "string") compute[token] = pack;
  }
  return compute;
}

function toAuthors(value: unknown): { name: string; github: string }[] {
  if (!Array.isArray(value)) return [];
  const authors: { name: string; github: string }[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    const github = (entry as { github?: unknown }).github;
    if (typeof name === "string" && typeof github === "string") authors.push({ name, github });
  }
  return authors;
}

function toBlueprint(doc: Record<string, unknown>): Blueprint {
  return {
    name: typeof doc.name === "string" ? doc.name : "",
    description: typeof doc.description === "string" ? doc.description : "",
    core: toStringArray(doc.core),
    slices: toSlices(doc.slices),
    backends: toBackends(doc.backends),
    compute: toCompute(doc.compute),
    pillars: toStringArray(doc.pillars),
    wiring: toStringArray(doc.wiring),
    authors: toAuthors(doc.authors),
    maintainers: toStringArray(doc.maintainers),
  };
}

/**
 * Validates a parsed blueprint document against schemas/blueprint.schema.json in the corpus.
 *
 * A fresh Ajv instance per call, mirroring lib/schema.ts: this runs a handful of times per command
 * at most, and a shared, cached compiler is not worth the module level state. `strict: false` keeps
 * Ajv from rejecting the schema's own `$schema`/`$id` metadata. The blueprint schema references no
 * other schema and uses no formats, so nothing else has to be registered.
 */
export function validateBlueprintDoc(
  doc: unknown,
  corpusDir: string,
): { valid: boolean; errors: string[] } {
  const schemaPath = join(corpusDir, "schemas", "blueprint.schema.json");
  if (!existsSync(schemaPath)) {
    throw new Error(`eep: blueprint schema not found at ${schemaPath}`);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")));
  const valid = validate(doc) === true;
  const errors = (validate.errors ?? []).map((e) =>
    `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  return { valid, errors };
}

/**
 * Every blueprint the corpus carries, by directory name, sorted.
 *
 * The name is taken from the `blueprints/<name>/blueprint.yaml` path segment rather than the
 * document's own `name` field: the directory is what a token has to match, and reading it needs no
 * parse, so a blueprint whose YAML is malformed still lists (and then fails its own load).
 */
export function listBlueprints(corpusDir: string): string[] {
  const paths = fg.sync("blueprints/*/blueprint.yaml", { cwd: corpusDir }).sort();
  const names = new Set<string>();
  for (const relPath of paths) {
    const segment = relPath.split("/")[1];
    if (segment !== undefined && segment !== "") names.add(segment);
  }
  return [...names].sort();
}

/**
 * Loads and validates one blueprint by name.
 *
 * Throws when the blueprint does not exist or fails schema validation, so every caller acts on a
 * blueprint whose shape is already guaranteed. This is the load path; the corpus validate command
 * reports schema failures as violations rather than throwing (see commands/corpus.ts).
 */
export function loadBlueprint(name: string, corpusDir: string): Blueprint {
  const path = blueprintPath(corpusDir, name);
  if (!existsSync(path)) {
    throw new Error(`eep: blueprint ${name} not found in corpus`);
  }
  const parsed: unknown = parseYaml(readFileSync(path, "utf8"));
  const doc =
    parsed === null || typeof parsed !== "object" ? {} : (parsed as Record<string, unknown>);
  const { valid, errors } = validateBlueprintDoc(doc, corpusDir);
  if (!valid) {
    throw new Error(`eep: blueprint ${name} is invalid: ${errors.join("; ")}`);
  }
  return toBlueprint(doc);
}

/**
 * The core pack list with the chosen backend swapped in, or the core untouched when no backend was
 * asked for.
 *
 * A blueprint's `backends` map names the swappable stack pack that owns the API and domain component,
 * by token. One of its values is the backend already listed in core (the default). Selecting another
 * with --backend replaces that one core pack in place, so every other core pack and their order are
 * preserved, then deduplicates in case the chosen pack already appeared. The lookup is trimmed and
 * case insensitive, so `--backend Node` and `--backend node ` both resolve. An unknown token throws,
 * naming the tokens the blueprint does define; a blueprint whose core contains none of its own
 * backend values has nothing to swap and throws too, rather than silently composing the default.
 */
function coreWithBackend(
  name: string,
  blueprint: Blueprint,
  backend: string | undefined,
): string[] {
  const requested = (backend ?? "").trim();
  if (requested === "") return [...blueprint.core];

  const token = requested.toLowerCase();
  const match = Object.entries(blueprint.backends).find(
    ([key]) => key.trim().toLowerCase() === token,
  );
  if (match === undefined) {
    const valid = Object.keys(blueprint.backends).join(", ") || "none";
    throw new Error(
      `eep: blueprint ${name} has no backend "${requested}"; valid backends: ${valid}`,
    );
  }
  const chosen = match[1];

  const backendPacks = new Set(Object.values(blueprint.backends));
  const currentIdx = blueprint.core.findIndex((pack) => backendPacks.has(pack));
  if (currentIdx === -1) {
    throw new Error(
      `eep: blueprint ${name} names backends but its core includes none of them to swap; core: ${blueprint.core.join(", ")}`,
    );
  }

  const swapped = [...blueprint.core];
  swapped[currentIdx] = chosen;
  const deduped: string[] = [];
  for (const pack of swapped) {
    if (!deduped.includes(pack)) deduped.push(pack);
  }
  return deduped;
}

/**
 * The (already backend swapped) core with the serverless compute pack in place of the default one, or
 * the core untouched when --serverless was not asked for.
 *
 * This is coreWithBackend on the other axis: a blueprint's `compute` map names the swappable platform
 * pack that runs the app, by token. One of its values is the compute pack already listed in core (the
 * default, fargate -> aws-cdk). --serverless replaces that one core pack in place with the serverless
 * value, so every other core pack and their order are preserved, then deduplicates. Because it takes
 * the core coreWithBackend already produced rather than blueprint.core, --backend and --serverless
 * compose: the backend swap and the compute swap land on two different core members and neither undoes
 * the other. A blueprint that declares no serverless compute, or whose core carries none of its own
 * compute packs to swap, throws rather than silently composing the default.
 */
function coreWithCompute(
  name: string,
  blueprint: Blueprint,
  core: string[],
  serverless: boolean,
): string[] {
  if (!serverless) return [...core];

  const chosen = blueprint.compute.serverless;
  if (chosen === undefined) {
    const valid = Object.keys(blueprint.compute).join(", ") || "none";
    throw new Error(
      `eep: blueprint ${name} has no serverless compute to swap in; declared compute: ${valid}`,
    );
  }

  const computePacks = new Set(Object.values(blueprint.compute));
  const currentIdx = core.findIndex((pack) => computePacks.has(pack));
  if (currentIdx === -1) {
    throw new Error(
      `eep: blueprint ${name} names compute variants but its core includes none of them to swap; core: ${core.join(", ")}`,
    );
  }

  const swapped = [...core];
  swapped[currentIdx] = chosen;
  const deduped: string[] = [];
  for (const pack of swapped) {
    if (!deduped.includes(pack)) deduped.push(pack);
  }
  return deduped;
}

/**
 * Expands a blueprint into the pack set a composed init should build.
 *
 * The core packs come first, in declared order (with the backend swapped when --backend named one,
 * see coreWithBackend), then the packs for each requested slice, appended in the order the slices
 * were asked for and deduplicated. Pack existence is deliberately not checked here: a wave 1 slice
 * references a pack that is not built yet, and the command layer is what partitions the result into
 * existing and pending (see resolveBlueprintSelection). An unknown slice name throws, naming the
 * slices the blueprint does define, because a typo in --with should fail loudly rather than silently
 * compose the core alone.
 *
 * The backend swap (--backend) and the compute swap (--serverless) are applied in that order to the
 * core, before any slice is appended: they land on two different core members, so requesting both
 * swaps both, and requesting neither leaves the core exactly as written.
 */
export function expandBlueprint(
  name: string,
  withSlices: string[],
  corpusDir: string,
  backend?: string,
  serverless?: boolean,
): { packs: string[] } {
  const blueprint = loadBlueprint(name, corpusDir);
  const withBackend = coreWithBackend(name, blueprint, backend);
  const packs: string[] = coreWithCompute(name, blueprint, withBackend, serverless === true);
  const validSlices = Object.keys(blueprint.slices);

  for (const raw of withSlices) {
    const slice = raw.trim();
    if (slice === "") continue;
    const slicePacks = blueprint.slices[slice];
    if (slicePacks === undefined) {
      const known = validSlices.length > 0 ? validSlices.join(", ") : "none";
      throw new Error(`eep: blueprint ${name} has no slice "${slice}"; valid slices: ${known}`);
    }
    for (const pack of slicePacks) {
      if (!packs.includes(pack)) packs.push(pack);
    }
  }

  return { packs };
}

/**
 * Every pack manifest the corpus carries, by the manifest's own name field. Mirrors the glob
 * lib/frameworks.ts and lib/detect.ts scan, so "present in the corpus" means the same thing to all
 * of them.
 */
export function corpusPackNames(corpusDir: string): Set<string> {
  const manifestPaths = fg.sync("packs/*/*/pack.yaml", { cwd: corpusDir }).sort();
  const names = new Set<string>();
  for (const relPath of manifestPaths) {
    const name = loadPack(dirname(join(corpusDir, relPath))).name;
    if (name !== "") names.add(name);
  }
  return names;
}

/**
 * Every doctrine law id the corpus carries.
 *
 * A law file whose frontmatter cannot be read is skipped rather than fatal: this is a lookup set
 * for the pillar existence check, and one malformed law elsewhere in doctrine must not make every
 * pillar read as missing. The corpus validate command reports that malformed file under its own law
 * checks.
 */
export function corpusLawIds(corpusDir: string): Set<string> {
  const files = fg.sync("doctrine/*/laws/*.md", { cwd: corpusDir }).sort();
  const ids = new Set<string>();
  for (const relPath of files) {
    try {
      const { data } = readFrontmatter(join(corpusDir, relPath));
      if (typeof data.id === "string" && data.id !== "") ids.add(data.id);
    } catch {
      // Skipped: reported by the corpus law checks, not here.
    }
  }
  return ids;
}

/**
 * The blueprints all of whose core packs exist in the corpus.
 *
 * Availability is the same idea a framework token has: a blueprint is offered on the capability
 * screen only when everything its core always pulls in is actually built, so composing it can
 * succeed today. Slice packs and pillar laws do not gate availability, since a slice is opt in and a
 * pillar is asserted rather than scaffolded. A blueprint whose YAML is invalid is not available.
 */
export function availableBlueprints(corpusDir: string): string[] {
  const packs = corpusPackNames(corpusDir);
  const available: string[] = [];
  for (const name of listBlueprints(corpusDir)) {
    try {
      const blueprint = loadBlueprint(name, corpusDir);
      if (blueprint.core.every((pack) => packs.has(pack))) available.push(name);
    } catch {
      // An invalid blueprint is not available; corpus validate reports why.
    }
  }
  return available;
}

/**
 * Parses a `--with a,b,c` flag value into a list of slice names. Undefined (flag absent) is an
 * empty list, trimmed, with blanks dropped, so `--with async,` and `--with ""` both come to nothing
 * rather than a slice named "".
 */
export function slicesFromFlag(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

/**
 * Resolves a command's raw tokens against the blueprint vocabulary, before framework resolution.
 *
 * When no token names a blueprint, the caller proceeds unchanged (blueprint null); passing --with,
 * --backend, or --serverless in that case is an error, because slices, a backend swap, and a compute
 * swap only mean something for a blueprint. When a token does name a blueprint, it must be the only
 * token: a blueprint already names a complete pack set, so mixing it with framework tokens (or a
 * second blueprint) is refused, naming the offenders. The blueprint is then expanded with the
 * requested slices, backend, and compute, and the result split into the packs that exist now
 * (returned for composition) and the slice packs that are still on the roadmap (returned as pending
 * for the caller to report). Unknown slice names, unknown backend tokens, and unknown blueprints throw.
 */
export function resolveBlueprintSelection(
  tokens: string[],
  withSlices: string[],
  corpusDir: string,
  backend?: string,
  serverless?: boolean,
): BlueprintSelection {
  const blueprintNames = new Set(listBlueprints(corpusDir));
  const seen: string[] = [];
  for (const raw of tokens) {
    const token = normalizeToken(raw);
    if (token !== "" && !seen.includes(token)) seen.push(token);
  }

  const named = seen.filter((token) => blueprintNames.has(token));
  if (named.length === 0) {
    if (withSlices.length > 0) {
      throw new Error(
        "eep: --with names blueprint slices and only applies to a blueprint token; none was given",
      );
    }
    if ((backend ?? "").trim() !== "") {
      throw new Error("eep: --backend only applies to a blueprint token; none was given");
    }
    if (serverless === true) {
      throw new Error("eep: --serverless only applies to a blueprint token; none was given");
    }
    return { blueprint: null, packs: [], pendingSlicePacks: [] };
  }

  const name = named[0] ?? "";
  const others = seen.filter((token) => token !== name);
  if (others.length > 0) {
    throw new Error(
      `eep: blueprint ${name} may not be combined with other tokens: ${others.join(", ")}; a blueprint already names a complete pack set, use it alone or list framework tokens without it`,
    );
  }

  const { packs: expanded } = expandBlueprint(name, withSlices, corpusDir, backend, serverless);
  const installed = corpusPackNames(corpusDir);
  const packs = expanded.filter((pack) => installed.has(pack));
  const pendingSlicePacks = expanded.filter((pack) => !installed.has(pack));
  return { blueprint: name, packs, pendingSlicePacks };
}
