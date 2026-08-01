import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

export type Waiver = {
  law: string;
  scope: string;
  justification: string;
  owner: string;
  approved_by?: string;
  created: string;
  expires: string;
};

export type WaiverProblem = { detail: string };

export type LoadedWaivers = { active: Waiver[]; problems: WaiverProblem[] };

const WAIVERS_PATH = join(".eep", "waivers.yaml");
const SCHEMA_PATH = join(".eep", "schemas", "waivers.schema.json");

/**
 * Reads the vendored waivers schema straight from `${targetDir}/.eep/schemas/`, rather than going
 * through `validateAgainst`.
 *
 * `validateAgainst` resolves its schema directory from `repoRoot(process.cwd())`, so inside the
 * corpus checkout it would validate a consumer's waivers file against the corpus's own schemas,
 * not the ones that consumer actually vendored. Waivers are read for a specific target directory,
 * which may be any repository on disk, so the schema is loaded from that target's vendored copy.
 * The waivers schema has no `$ref`s to sibling schemas, so it compiles standalone.
 */
function loadItemValidator(targetDir: string): ValidateFunction | Error {
  const schemaPath = join(targetDir, SCHEMA_PATH);
  if (!existsSync(schemaPath)) {
    return new Error(`${WAIVERS_PATH} exists but ${SCHEMA_PATH} does not; run eep adopt first`);
  }

  let document: unknown;
  try {
    document = JSON.parse(readFileSync(schemaPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return new Error(`${SCHEMA_PATH} is not valid JSON: ${reason}`);
  }

  const items =
    document !== null && typeof document === "object"
      ? (document as { items?: unknown }).items
      : undefined;
  if (items === undefined) {
    return new Error(`${SCHEMA_PATH} has no items subschema to validate entries against`);
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  // Same CommonJS default-export dance schema.ts documents: ajv-formats types as a namespace under
  // NodeNext without esModuleInterop, so the callable is pulled off .default at runtime.
  const addFormatsFn = ((addFormats as unknown as { default?: FormatsPlugin }).default ??
    addFormats) as unknown as FormatsPlugin;
  addFormatsFn(ajv);

  try {
    return ajv.compile(items as object);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return new Error(`${SCHEMA_PATH} could not be compiled: ${reason}`);
  }
}

// Day granularity comparison over the ISO date strings the schema's "format: date" already
// guarantees. Both sides are reduced to YYYY-MM-DD in UTC so a lexical compare is a date compare.
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function describeErrors(validate: ValidateFunction): string {
  const errors = validate.errors ?? [];
  if (errors.length === 0) return "does not match the waivers schema";
  return errors
    .map((error) => {
      const where = error.instancePath === "" ? "" : `${error.instancePath} `;
      const missing = (error.params as { missingProperty?: unknown }).missingProperty;
      const key = typeof missing === "string" ? ` (${missing})` : "";
      return `${where}${error.message ?? "is invalid"}${key}`.trim();
    })
    .join("; ");
}

function lawLabel(entry: unknown): string {
  if (entry !== null && typeof entry === "object") {
    const law = (entry as { law?: unknown }).law;
    if (typeof law === "string") return law;
  }
  return "unknown law";
}

/**
 * Loads `${targetDir}/.eep/waivers.yaml`.
 *
 * A missing file is not a problem: it is the normal state of a repository with nothing waived.
 * Every entry is validated individually against the vendored schema's item subschema, so one
 * malformed waiver is reported without invalidating its valid neighbours. Entries whose `expires`
 * date is before `today` are reported as problems rather than silently dropped, because a stale
 * waiver left in the file is itself a governance failure.
 */
export function loadWaivers(targetDir: string, today: Date = new Date()): LoadedWaivers {
  const path = join(targetDir, WAIVERS_PATH);
  if (!existsSync(path)) return { active: [], problems: [] };

  let document: unknown;
  try {
    document = parseYaml(readFileSync(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { active: [], problems: [{ detail: `${WAIVERS_PATH} is not valid YAML: ${reason}` }] };
  }

  if (document === null || document === undefined) return { active: [], problems: [] };
  if (!Array.isArray(document)) {
    return { active: [], problems: [{ detail: `${WAIVERS_PATH} must be a list of waivers` }] };
  }

  const validate = loadItemValidator(targetDir);
  if (validate instanceof Error) {
    return { active: [], problems: [{ detail: validate.message }] };
  }

  const cutoff = isoDay(today);
  const active: Waiver[] = [];
  const problems: WaiverProblem[] = [];

  document.forEach((entry: unknown, index) => {
    if (validate(entry) !== true) {
      problems.push({
        detail: `${WAIVERS_PATH}[${index}] for ${lawLabel(entry)}: ${describeErrors(validate)}`,
      });
      return;
    }
    const waiver = entry as Waiver;
    if (waiver.expires < cutoff) {
      problems.push({
        detail: `${WAIVERS_PATH}[${index}] waiver for ${waiver.law} expired on ${waiver.expires}`,
      });
      return;
    }
    active.push(waiver);
  });

  return { active, problems };
}
