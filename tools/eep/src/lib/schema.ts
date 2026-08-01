import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import addFormats from "ajv-formats";

export type SchemaName = "law" | "pack" | "toolchain" | "eep" | "waivers";

export function repoRoot(start = process.cwd()): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, "eep.yaml")) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("eep: not inside a repository (no eep.yaml or .git found)");
    dir = parent;
  }
}

function schemasDir(): string {
  // corpus checkout: <root>/schemas. Consumer checkout: <root>/.eep/schemas (vendored).
  const root = repoRoot();
  const corpus = join(root, "schemas");
  const vendored = join(root, ".eep", "schemas");
  if (existsSync(corpus)) return corpus;
  if (existsSync(vendored)) return vendored;
  throw new Error("eep: schemas directory not found; run eep adopt first");
}

export function validateAgainst(
  name: SchemaName,
  data: unknown,
): { valid: boolean; errors: string[] } {
  const dir = schemasDir();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  // ajv-formats ships as CommonJS with only a default export (no named export for the plugin
  // function itself). Under NodeNext without esModuleInterop, that default import types as the
  // whole module namespace, not a callable; resolve the real function from `.default` at
  // runtime and re-type it against the package's own named type export (FormatsPlugin) instead
  // of widening to `any`.
  const addFormatsFn = ((addFormats as unknown as { default?: FormatsPlugin }).default ??
    addFormats) as unknown as FormatsPlugin;
  addFormatsFn(ajv);
  for (const n of ["toolchain", "law", "pack", "eep", "waivers"]) {
    ajv.addSchema(
      JSON.parse(readFileSync(join(dir, `${n}.schema.json`), "utf8")),
      `./${n}.schema.json`,
    );
  }
  const validate = ajv.getSchema(`./${name}.schema.json`);
  if (!validate) throw new Error(`eep: unknown schema ${name}`);
  const valid = validate(data) === true;
  const errors = (validate.errors ?? []).map((e) =>
    `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  return { valid, errors };
}
