import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, stubFetch } from "../support/notes";

// main.tsx runs its work at import time, so every case here needs a fresh module registry.
afterEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
});

describe("main entry point", () => {
  it("mounts the app into the root element", async () => {
    stubFetch(async () => jsonResponse([]));
    document.body.innerHTML = '<div id="root"></div>';

    await import("../../src/main");

    expect(await screen.findByRole("heading", { name: "Notes" })).toBeDefined();
  });

  it("fails loudly when index.html has no root element", async () => {
    stubFetch(async () => jsonResponse([]));

    await expect(import("../../src/main")).rejects.toThrow(
      "index.html must contain an element with id root",
    );
  });
});
