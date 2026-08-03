import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["construct/**/*.test.ts", "wiring/typescript/**/*.test.ts"],
    // The contract suite talks to DynamoDB Local over a socket, so it is not parallelized against
    // itself: one table is created and cleared between tests, and two files racing on it would see
    // each other's writes. The construct assertions are pure and would parallelize fine; keeping one
    // pool for both keeps the config a single rule rather than a per file exception.
    fileParallelism: false,
  },
});
