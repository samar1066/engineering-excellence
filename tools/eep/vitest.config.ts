import { defineConfig } from "vitest/config";

/**
 * The suite is this package's own tests, and only those.
 *
 * Without an explicit include, vitest also collects `corpus/`, which is a build artifact:
 * scripts/bundle-corpus.mjs copies the repository's packs there at pack time so the published
 * tarball carries them. Those packs ship scaffold test suites for the projects eep generates, which
 * are meant to run inside a generated project against that project's own installed dependencies,
 * never here. Collected from this package they fail on missing imports (fastify, zod, pino) and
 * turn a green gauntlet red for a reason that has nothing to do with the CLI.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
