import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ajv2020 as Ajv2020Class } from "ajv/dist/2020.js";
import Ajv2020 from "ajv/dist/2020.js";
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
  // ajv and ajv-formats ship as CommonJS. Under NodeNext without esModuleInterop, a default
  // import of a CommonJS module types as the whole module namespace (not constructable or
  // callable); the real class/function lives on `.default` at runtime. Resolve that at
  // runtime and re-type the result against each package's own named type export
  // (Ajv2020Class, FormatsPlugin) instead of widening to `any`.
  const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020Class }).default ??
    Ajv2020) as unknown as typeof Ajv2020Class;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
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
