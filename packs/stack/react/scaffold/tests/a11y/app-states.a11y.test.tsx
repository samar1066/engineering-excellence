import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { configureAxe } from "vitest-axe";
import { App } from "../../src/components/App";
import { aNote, jsonResponse, stubFetch, stubPendingFetch } from "../support/notes";

// jsdom paints nothing, so the colour contrast rule cannot be evaluated here and only reports as
// incomplete. Contrast belongs to the browser based end to end suite; every other axe rule runs.
const axe = configureAxe({ rules: { "color-contrast": { enabled: false } } });

/**
 * The EEP-FE-01 gate. One case per primary state of this interface, each rendering the real App
 * against a stubbed API and asserting axe finds nothing. `npm run test:a11y` runs this directory
 * alone, so a failure here names accessibility and nothing else.
 */
describe("App accessibility on every primary state", () => {
  it("has no violations while loading", async () => {
    stubPendingFetch();
    const { container } = render(<App />);
    await screen.findByRole("status");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations when empty", async () => {
    stubFetch(async () => jsonResponse([]));
    const { container } = render(<App />);
    await screen.findByText("No notes yet. Write the first one.");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations when populated", async () => {
    stubFetch(async () =>
      jsonResponse([aNote(), aNote({ id: "note-2", title: "Renew passport" })]),
    );
    const { container } = render(<App />);
    await screen.findByRole("heading", { name: "Renew passport" });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations in the error state", async () => {
    stubFetch(async () => jsonResponse({}, 503));
    const { container } = render(<App />);
    await screen.findByRole("alert");

    expect(await axe(container)).toHaveNoViolations();
  });
});
