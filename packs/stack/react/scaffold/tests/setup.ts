import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

// Vitest runs without globals, so testing-library cannot register its own cleanup hook and the
// axe matchers have to be attached here. Both belong to every suite, including the a11y one.
expect.extend(axeMatchers);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
