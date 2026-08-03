import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["construct/**/*.test.ts", "wiring/typescript/**/*.test.ts"],
  },
});
