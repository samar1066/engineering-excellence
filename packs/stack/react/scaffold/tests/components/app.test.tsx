import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../src/components/App";
import { aNote, jsonResponse, stubFetch, stubPendingFetch } from "../support/notes";

describe("App primary states", () => {
  it("announces the loading state while the first request is in flight", () => {
    stubPendingFetch();

    render(<App />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading notes");
  });

  it("shows the empty state when the API returns no notes", async () => {
    stubFetch(async () => jsonResponse([]));

    render(<App />);

    expect(await screen.findByText("No notes yet. Write the first one.")).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the populated state when the API returns notes", async () => {
    stubFetch(async () => jsonResponse([aNote()]));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Buy milk" })).toBeDefined();
    expect(screen.queryByText("No notes yet. Write the first one.")).toBeNull();
  });

  it("shows the error state with a retry that recovers", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubFetch(async () => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({}, 503) : jsonResponse([aNote()]);
    });
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GET /notes failed with status 503");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Buy milk" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adds a note through the form and shows it in the list", async () => {
    const user = userEvent.setup();
    const created = aNote({ id: "note-2", title: "Renew passport" });
    stubFetch(async (_url, init) =>
      init?.method === "POST" ? jsonResponse(created, 201) : jsonResponse([]),
    );
    render(<App />);
    await screen.findByText("No notes yet. Write the first one.");

    await user.type(screen.getByLabelText("Title"), "Renew passport");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(await screen.findByRole("heading", { name: "Renew passport" })).toBeDefined();
  });
});
