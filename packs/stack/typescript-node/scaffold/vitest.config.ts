import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Requests are logged through the same pino pipeline the service uses in production, so the
    // suite silences the level rather than swapping the logger for a fake one: what the tests
    // exercise stays the real wiring.
    env: { LOG_LEVEL: "silent" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The process entry point binds a port and starts listening, which no test does. A store
      // repository adapter a data pack composes in (dynamo-*-repository.ts, and any other store added
      // the same way) reaches an external data store and is proven by that pack's own contract suite
      // against a local store in CI (EEP-ARCH-02), not by these fast unit tests, so it is excluded
      // from the measurement, matching the python-fastapi backend's coverage omit. The in memory
      // reference implementation stays measured.
      exclude: ["src/main.ts", "src/infrastructure/dynamo-*-repository.ts"],
      reporter: ["text"],
      thresholds: { lines: 85 },
    },
  },
});
