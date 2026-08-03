import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../src/lib/schema.js";
import { applyComposedWiring } from "../src/lib/wiring.js";

// The real corpus, so these run the actual aws-dynamodb wiring block against the actual backend and
// infra scaffolds: a drift between a manifest `from` string and the scaffold it targets fails here
// rather than only in a full composed init.
const CORPUS = repoRoot();

// Each stack and platform scaffold copied verbatim into the component directory a composed init would
// render it into, so the wiring pass sees the same rendered tree init hands it. {{project_name}} is
// left unsubstituted in the copies; the pass substitutes only the lines it injects, which is what the
// owner tag assertion checks.
const SCAFFOLDS: Record<string, string> = {
  backend: "packs/stack/python-fastapi/scaffold",
  service: "packs/stack/typescript-node/scaffold",
  infra: "packs/platform/aws-cdk/scaffold",
};

const dirs: string[] = [];

function newProject(components: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "eep-wiring-"));
  dirs.push(dir);
  for (const component of components) {
    cpSync(join(CORPUS, SCAFFOLDS[component] ?? ""), join(dir, component), { recursive: true });
  }
  return dir;
}

function read(projectDir: string, relPath: string): string {
  return readFileSync(join(projectDir, relPath), "utf8");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("applyComposedWiring", () => {
  it("swaps the python backend onto the DynamoDB repository behind the interface", () => {
    const projectDir = newProject(["backend"]);
    const summary = applyComposedWiring({
      projectDir,
      corpusDir: CORPUS,
      name: "shop",
      placements: [
        { pack: "aws-dynamodb", componentDir: "data" },
        { pack: "python-fastapi", componentDir: "backend" },
      ],
    });

    const deps = read(projectDir, "backend/app/api/deps.py");
    expect(deps).toContain(
      "from app.infrastructure.repositories.dynamo_note_repository import DynamoNoteRepository",
    );
    expect(deps).toContain("DynamoNoteRepository()");
    expect(deps).not.toContain("MemoryNoteRepository");

    expect(
      existsSync(
        join(projectDir, "backend/app/infrastructure/repositories/dynamo_note_repository.py"),
      ),
    ).toBe(true);

    // The adapter reads NOTES_TABLE_NAME from the environment, so the drop in file is unchanged.
    const adapter = read(
      projectDir,
      "backend/app/infrastructure/repositories/dynamo_note_repository.py",
    );
    expect(adapter).toContain("class DynamoNoteRepository(NoteRepository)");

    expect(read(projectDir, "backend/pyproject.toml")).toContain('"aioboto3>=13.0.0",');

    expect(summary.providers).toContain("aws-dynamodb");
  });

  it("copies only the adapter, never the pack's harness fixture tree, into the backend", () => {
    const projectDir = newProject(["backend"]);
    applyComposedWiring({
      projectDir,
      corpusDir: CORPUS,
      name: "shop",
      placements: [
        { pack: "aws-dynamodb", componentDir: "data" },
        { pack: "python-fastapi", componentDir: "backend" },
      ],
    });

    // The pack ships a reference backend tree and a contract suite beside the adapter under
    // scaffold/wiring/python. None of it may land in the real backend; only the adapter does.
    expect(existsSync(join(projectDir, "backend/wiring"))).toBe(false);
    expect(existsSync(join(projectDir, "backend/conftest.py"))).toBe(false);
    expect(existsSync(join(projectDir, "backend/dynamo_note_repository.py"))).toBe(false);
    expect(existsSync(join(projectDir, "backend/tests/test_note_repository_contract.py"))).toBe(
      false,
    );
    // The in memory reference is left in place: the swap is in deps.py, not a deletion.
    expect(
      existsSync(
        join(projectDir, "backend/app/infrastructure/repositories/memory_note_repository.py"),
      ),
    ).toBe(true);
  });

  it("swaps the typescript backend and adds the aws-sdk client dependencies", () => {
    const projectDir = newProject(["service"]);
    applyComposedWiring({
      projectDir,
      corpusDir: CORPUS,
      name: "shop",
      placements: [
        { pack: "aws-dynamodb", componentDir: "data" },
        { pack: "typescript-node", componentDir: "service" },
      ],
    });

    const app = read(projectDir, "service/src/app.ts");
    expect(app).toContain(
      'import { DynamoNoteRepository } from "./infrastructure/dynamo-note-repository.js";',
    );
    expect(app).toContain("new DynamoNoteRepository()");
    expect(app).not.toContain("MemoryNoteRepository");

    expect(
      existsSync(join(projectDir, "service/src/infrastructure/dynamo-note-repository.ts")),
    ).toBe(true);
    // No fixture tree copied here either.
    expect(existsSync(join(projectDir, "service/wiring"))).toBe(false);

    const pkg = JSON.parse(read(projectDir, "service/package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@aws-sdk/client-dynamodb"]).toBe("^3.700.0");
    expect(pkg.dependencies["@aws-sdk/lib-dynamodb"]).toBe("^3.700.0");
    // The packages the pack already shipped are untouched.
    expect(pkg.dependencies.fastify).toBe("^5.11.0");
  });

  it("composes the table construct and its env var into the infra stack", () => {
    const projectDir = newProject(["infra"]);
    applyComposedWiring({
      projectDir,
      corpusDir: CORPUS,
      name: "shop",
      placements: [
        { pack: "aws-dynamodb", componentDir: "data" },
        { pack: "aws-cdk", componentDir: "infra" },
      ],
    });

    expect(existsSync(join(projectDir, "infra/lib/note-table.ts"))).toBe(true);
    // The pack's construct directory is not copied wholesale; only note-table.ts, into lib.
    expect(existsSync(join(projectDir, "infra/construct"))).toBe(false);

    const stack = read(projectDir, "infra/lib/service-stack.ts");
    expect(stack).toContain('import { NoteTable } from "./note-table";');
    expect(stack).toContain('const notes = new NoteTable(this, "Notes", {');
    // The owner tag carries the substituted project name, proving the pass resolves the token the
    // scaffold copy no longer can.
    expect(stack).toContain('owner: "shop",');
    expect(stack).toContain("environment: config.stage,");
    expect(stack).toContain("NOTES_TABLE_NAME: notes.table.tableName,");
    expect(stack).toContain(
      "notes.table.grantReadWriteData(this.service.taskDefinition.taskRole);",
    );
    // The table is declared before the service that is handed its name, and the grant after it.
    expect(stack.indexOf("const notes = new NoteTable")).toBeLessThan(
      stack.indexOf("this.service = new ecsPatterns"),
    );
    expect(stack.indexOf("this.service = new ecsPatterns")).toBeLessThan(
      stack.indexOf("grantReadWriteData"),
    );
  });

  it("throws, naming the file and string, when a declared from is not in the rendered file", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "eep-wiring-"));
    dirs.push(projectDir);
    // A backend whose deps.py does not contain the memory repository import the manifest expects to
    // rewrite. The adapter copy still needs somewhere to land, and the patch is what must fail.
    const depsPath = join(projectDir, "backend/app/api/deps.py");
    mkdirSync(dirname(depsPath), { recursive: true });
    writeFileSync(depsPath, "# a deps.py that never wired in the in memory repository\n");
    mkdirSync(join(projectDir, "backend/app/infrastructure/repositories"), { recursive: true });

    expect(() =>
      applyComposedWiring({
        projectDir,
        corpusDir: CORPUS,
        name: "shop",
        placements: [
          { pack: "aws-dynamodb", componentDir: "data" },
          { pack: "python-fastapi", componentDir: "backend" },
        ],
      }),
    ).toThrow(/string not found in app\/api\/deps\.py/);
  });

  it("leaves a composed set with no provides: repository pack untouched", () => {
    const projectDir = newProject(["backend"]);
    const before = read(projectDir, "backend/app/api/deps.py");

    const summary = applyComposedWiring({
      projectDir,
      corpusDir: CORPUS,
      name: "shop",
      placements: [{ pack: "python-fastapi", componentDir: "backend" }],
    });

    expect(summary.providers).toEqual([]);
    expect(summary.copied).toEqual([]);
    expect(summary.patched).toEqual([]);
    expect(read(projectDir, "backend/app/api/deps.py")).toBe(before);
    expect(read(projectDir, "backend/app/api/deps.py")).toContain("MemoryNoteRepository()");
  });

  it("skips a declared target that is not in the composed set", () => {
    // aws-dynamodb is present and provides a repository, but typescript-node is not composed, so its
    // recipe is skipped while the python backend is still wired.
    const projectDir = newProject(["backend"]);
    const summary = applyComposedWiring({
      projectDir,
      corpusDir: CORPUS,
      name: "shop",
      placements: [
        { pack: "aws-dynamodb", componentDir: "data" },
        { pack: "python-fastapi", componentDir: "backend" },
      ],
    });

    expect(summary.providers).toEqual(["aws-dynamodb"]);
    expect(summary.patched.some((entry) => entry.startsWith("backend/"))).toBe(true);
    expect(summary.patched.some((entry) => entry.startsWith("service/"))).toBe(false);
  });
});
