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
      // The process entry point binds a port and starts listening, which no test does.
      exclude: ["src/main.ts"],
      reporter: ["text"],
      thresholds: { lines: 85 },
    },
  },
});
