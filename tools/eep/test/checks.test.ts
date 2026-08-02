import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuiltin } from "../src/lib/checks.js";

// Every credential shaped literal in this file is assembled from fragments rather than written
// out whole, so this test file can never itself trip the very scan it exercises when the corpus
// runs secrets-scan over its own tree.
const AWS_KEY = `AKIA${"ABCDEFGHIJKLMNOP"}`;
const PRIVATE_KEY_HEADER = `-----BEGIN ${"RSA"} PRIVATE KEY-----`;
const GENERIC_ASSIGNMENT = `secret_key = "${"abcdefghijklmnop1234"}"`;

// The three shapes the widened generic family exists to catch: a bare keyword with no "key"
// suffix, a base64 value carrying "=" padding, and a dotted JWT.
const BARE_PASSWORD = `password = "${"hunter2hunter2hunter2"}"`;
const BASE64_SECRET = `secret_key = "${"YWJjZGVmZ2hpamtsbW5vcA=="}"`;
const JWT_TOKEN = `token: "${"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhYmMxMjMifQ.c2lnbmF0dXJlLXZhbHVl"}"`;

// Built from an escape, not the literal glyph, so this source file stays free of the banned
// character even though the assertion below checks that scanning finds one.
const EM_DASH = "\u2014";

function newDir(): string {
  return mkdtempSync(join(tmpdir(), "eep-checks-"));
}

function write(dir: string, relPath: string, contents: string): void {
  const target = join(dir, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

describe("runBuiltin secrets-scan", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = newDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("fails on an AWS access key id, naming the file and the pattern family", () => {
    write(tmp, "app/config.py", `AWS_KEY = "${AWS_KEY}"\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("app/config.py");
    expect(result.detail).toContain("aws-access-key-id");
  });

  it("never echoes the matched secret back in the detail", () => {
    write(tmp, "app/config.py", `AWS_KEY = "${AWS_KEY}"\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.detail).not.toContain(AWS_KEY);
  });

  it("passes a clean tree", () => {
    write(tmp, "app/config.py", 'AWS_KEY = os.environ["AWS_KEY"]\n');
    write(tmp, "README.md", "# Clean\n");

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(true);
  });

  it("catches private key headers and generic credential assignments", () => {
    write(tmp, "keys/id_rsa", `${PRIVATE_KEY_HEADER}\nmore\n`);
    write(tmp, "settings.py", `${GENERIC_ASSIGNMENT}\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("private-key-header");
    expect(result.detail).toContain("generic-credential-assignment");
  });

  it("catches a bare password assignment with no key suffix", () => {
    write(tmp, "settings.py", `${BARE_PASSWORD}\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("generic-credential-assignment");
    expect(result.detail).not.toContain("hunter2");
  });

  it("catches a base64 value carrying padding", () => {
    write(tmp, "settings.py", `${BASE64_SECRET}\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("generic-credential-assignment");
    expect(result.detail).not.toContain("YWJjZGVm");
  });

  it("catches a dotted JWT shaped token", () => {
    write(tmp, "config.yaml", `${JWT_TOKEN}\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("config.yaml");
    expect(result.detail).toContain("generic-credential-assignment");
    expect(result.detail).not.toContain("eyJhbGciOi");
  });

  it("catches a value with no closing quote", () => {
    write(tmp, "settings.py", `access_token = "${"abcdefghijklmnop1234"}\n`);

    expect(runBuiltin("secrets-scan", tmp).ok).toBe(false);
  });

  it("does not fire on an environment variable lookup", () => {
    write(tmp, "settings.py", 'password = os.environ["DB_PASSWORD"]\nsecret_key = get_secret()\n');

    expect(runBuiltin("secrets-scan", tmp).ok).toBe(true);
  });

  it("counts only files it actually read and names the ones it did not", () => {
    write(tmp, "a.py", "clean = 1\n");
    write(tmp, "b.py", "clean = 2\n");
    mkdirSync(join(tmp, "assets"), { recursive: true });
    writeFileSync(join(tmp, "assets", "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("in 2 scanned files");
    expect(result.detail).toContain("1 not read");
    expect(result.detail).toContain("assets/blob.bin (binary)");
  });

  it("respects .gitignore: an ignored file carrying a secret does not fail the scan", () => {
    write(tmp, ".gitignore", "ignored/\nlocal.env\n");
    write(tmp, "ignored/leaked.py", `AWS_KEY = "${AWS_KEY}"\n`);
    write(tmp, "local.env", `AWS_KEY=${AWS_KEY}\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(true);
  });

  it("anchors a leading slash pattern to the root, leaving nested directories scanned", () => {
    write(tmp, ".gitignore", "/dist\n");
    write(tmp, "dist/bundle.js", `const k = "${AWS_KEY}";\n`);

    expect(runBuiltin("secrets-scan", tmp).ok).toBe(true);

    write(tmp, "packages/app/dist/bundle.js", `const k = "${AWS_KEY}";\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("packages/app/dist/bundle.js");
  });

  it("lets an unanchored pattern match at any depth", () => {
    write(tmp, ".gitignore", "dist/\n");
    write(tmp, "packages/app/dist/bundle.js", `const k = "${AWS_KEY}";\n`);

    expect(runBuiltin("secrets-scan", tmp).ok).toBe(true);
  });

  it("always ignores .git, node_modules, .venv, and .eep/cache", () => {
    write(tmp, ".git/objects/blob", `AWS_KEY = "${AWS_KEY}"\n`);
    write(tmp, "node_modules/pkg/index.js", `const k = "${AWS_KEY}";\n`);
    write(tmp, ".venv/lib/thing.py", `AWS_KEY = "${AWS_KEY}"\n`);
    write(tmp, ".eep/cache/blob.json", `{"k": "${AWS_KEY}"}\n`);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(true);
  });

  it("skips binary looking files", () => {
    const binary = Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from(AWS_KEY)]);
    mkdirSync(join(tmp, "assets"), { recursive: true });
    writeFileSync(join(tmp, "assets", "blob.bin"), binary);

    const result = runBuiltin("secrets-scan", tmp);

    expect(result.ok).toBe(true);
  });
});

describe("runBuiltin file-contains", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = newDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("passes when the file exists and contains the needle", () => {
    write(tmp, "Makefile", ".PHONY: setup\nsetup:\n\tuv sync\n");

    expect(runBuiltin("file-contains Makefile setup", tmp).ok).toBe(true);
  });

  it("fails naming the missing file", () => {
    const result = runBuiltin("file-contains Makefile setup", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Makefile");
  });

  it("fails naming the missing needle when the file exists", () => {
    write(tmp, "Makefile", "all:\n\techo hi\n");

    const result = runBuiltin("file-contains Makefile setup", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("setup");
  });

  it("treats everything after the path token as the needle", () => {
    write(tmp, "app/core/logging.py", "def configure_logging() -> None:\n    pass\n");

    expect(runBuiltin("file-contains app/core/logging.py def configure_logging", tmp).ok).toBe(
      true,
    );
  });
});

describe("runBuiltin file-contains-any", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = newDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("passes when any file under the directory contains the needle", () => {
    write(tmp, ".github/workflows/ci.yml", "steps:\n  - run: npx --yes eep verify\n");

    expect(runBuiltin("file-contains-any .github/workflows 'eep verify'", tmp).ok).toBe(true);
  });

  it("fails when no file under the directory contains the needle", () => {
    write(tmp, ".github/workflows/ci.yml", "steps:\n  - run: echo hi\n");

    const result = runBuiltin("file-contains-any .github/workflows 'eep verify'", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("eep verify");
  });
});

describe("runBuiltin docs-style", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = newDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reports a skip, not a pass, when the directory does not exist", () => {
    const result = runBuiltin("docs-style docs", tmp);

    expect(result.skipped).toBe(true);
    expect(result.detail).toBe("no docs directory to check");
  });

  it("flags a markdown file carrying a banned dash", () => {
    write(tmp, "docs/note.md", `# Note\n\nOne thing ${EM_DASH} then another.\n`);

    const result = runBuiltin("docs-style docs", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("note.md");
    expect(result.detail).toContain("banned-dash");
    expect(result.detail).toContain(":3");
  });

  it("passes clean markdown and scans the whole tree when the directory is a dot", () => {
    write(tmp, "README.md", "# Clean\n\nOne thing, then another.\n");
    write(tmp, "docs/note.md", "# Note\n\nNothing banned here.\n");

    expect(runBuiltin("docs-style .", tmp).ok).toBe(true);
  });

  it("never looks inside .eep", () => {
    write(tmp, ".eep/doctrine/security/laws/EEP-SEC-01.md", `Vendored ${EM_DASH} copy.\n`);

    expect(runBuiltin("docs-style .", tmp).ok).toBe(true);
  });

  it("honors .gitignore", () => {
    write(tmp, ".gitignore", "vendor/\n");
    write(tmp, "vendor/imported.md", `Imported ${EM_DASH} prose.\n`);

    expect(runBuiltin("docs-style .", tmp).ok).toBe(true);
  });

  it("scans a dot directory rather than silently matching nothing", () => {
    write(tmp, ".github/PULL_REQUEST_TEMPLATE.md", `## Checklist ${EM_DASH} read it.\n`);

    const result = runBuiltin("docs-style .github", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain(".github/PULL_REQUEST_TEMPLATE.md");
    expect(result.detail).toContain("banned-dash");
  });

  it("treats a scope directory name as a literal path, not a glob", () => {
    write(tmp, "docs[1]/note.md", `Numbered ${EM_DASH} prose.\n`);
    write(tmp, "docs(old)/note.md", `Archived ${EM_DASH} prose.\n`);

    const bracketed = runBuiltin("docs-style docs[1]", tmp);
    expect(bracketed.ok).toBe(false);
    expect(bracketed.detail).toContain("docs[1]/note.md");

    const parens = runBuiltin("docs-style docs(old)", tmp);
    expect(parens.ok).toBe(false);
    expect(parens.detail).toContain("docs(old)/note.md");
  });

  it("honors a root anchored .gitignore pattern from inside a subdirectory scope", () => {
    write(tmp, ".gitignore", "docs/generated/\n");
    write(tmp, "docs/generated/api.md", `Generated ${EM_DASH} output.\n`);
    write(tmp, "docs/handwritten.md", "# Clean\n");

    const result = runBuiltin("docs-style docs", tmp);

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("in 1 markdown files");
  });

  /**
   * The brownfield case this exclusion exists for.
   *
   * A repository that has kept its own CLAUDE.md for years has an em dash in it, and adopting eep
   * must not turn that into a blocking gate failure on a file eep only co owns. The generated block
   * inside it is style clean by construction, and the prose around it is the team's, not the
   * corpus's. Every other markdown file in the same tree is still governed, which is what the second
   * half of this asserts: the exclusion is by name, not a hole in the sweep.
   */
  it("ignores CLAUDE.md and AGENTS.md at any depth while still flagging normal markdown", () => {
    write(tmp, "CLAUDE.md", `# House rules\n\nWe ship fast ${EM_DASH} and we test.\n`);
    write(tmp, "AGENTS.md", `# Agents\n\nRead this first ${EM_DASH} then work.\n`);
    write(tmp, "backend/CLAUDE.md", `# Backend\n\nComponent notes ${EM_DASH} keep them short.\n`);

    expect(runBuiltin("docs-style .", tmp).ok).toBe(true);

    write(tmp, "docs/note.md", `# Note\n\nOne thing ${EM_DASH} then another.\n`);
    const result = runBuiltin("docs-style .", tmp);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("docs/note.md");
    expect(result.detail).not.toContain("CLAUDE.md");
  });

  /**
   * macOS and Windows checkouts are case insensitive, so `claude.md` there is the same file the
   * agent reads and the same file eep writes. Exempting only the uppercase spelling would gate the
   * co owned file on exactly the machines most developers use.
   */
  it("ignores the agent file names whatever their casing", () => {
    write(tmp, "claude.md", `# House rules\n\nWe ship fast ${EM_DASH} and we test.\n`);
    write(tmp, "backend/Agents.md", `# Agents\n\nRead this ${EM_DASH} then work.\n`);
    write(tmp, "docs/CLAUDE.MD", `# Docs rules\n\nKeep it short ${EM_DASH} always.\n`);

    expect(runBuiltin("docs-style .", tmp).ok).toBe(true);
  });
});

describe("runBuiltin docs-frontmatter", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = newDir();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // A pass is a claim that something was proved. With no docs directory there are no documents to
  // hold to the frontmatter contract, so the honest answer is the third one.
  it("reports a skip, not a pass, when the directory does not exist", () => {
    const result = runBuiltin("docs-frontmatter docs", tmp);

    expect(result.skipped).toBe(true);
    expect(result.detail).toBe("no docs directory to check");
  });

  it("passes when every document carries title and authors", () => {
    write(tmp, "docs/note.md", "---\ntitle: A note\nauthors: [{ name: A }]\n---\n\nBody.\n");

    expect(runBuiltin("docs-frontmatter docs", tmp).ok).toBe(true);
  });

  it("fails naming the document and the missing key", () => {
    write(tmp, "docs/note.md", "---\ntitle: A note\n---\n\nBody.\n");

    const result = runBuiltin("docs-frontmatter docs", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("note.md");
    expect(result.detail).toContain("authors");
  });

  it("honors .gitignore", () => {
    write(tmp, ".gitignore", "docs/generated/\n");
    write(tmp, "docs/generated/api.md", "# No frontmatter at all\n");

    expect(runBuiltin("docs-frontmatter docs", tmp).ok).toBe(true);
  });

  it("scans a dot directory rather than silently matching nothing", () => {
    write(tmp, ".github/ISSUE_TEMPLATE.md", "# No frontmatter at all\n");

    const result = runBuiltin("docs-frontmatter .github", tmp);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain(".github/ISSUE_TEMPLATE.md");
    expect(result.detail).toContain("missing title and authors");
  });

  // The same co ownership exclusion the style check makes: an agent configuration file is not a
  // governed document, and demanding a title and an authors list inside one would fail every
  // repository the moment it adopts.
  it("ignores CLAUDE.md and AGENTS.md", () => {
    write(tmp, "docs/CLAUDE.md", "# House rules\n\nNo frontmatter at all.\n");
    write(tmp, "docs/AGENTS.md", "# Agents\n\nNo frontmatter at all.\n");

    expect(runBuiltin("docs-frontmatter docs", tmp).ok).toBe(true);
  });
});

describe("runBuiltin unknown", () => {
  it("reports the unknown builtin name", () => {
    const tmp = newDir();
    try {
      const result = runBuiltin("does-not-exist a b", tmp);

      expect(result.ok).toBe(false);
      expect(result.detail).toBe("unknown builtin does-not-exist");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
