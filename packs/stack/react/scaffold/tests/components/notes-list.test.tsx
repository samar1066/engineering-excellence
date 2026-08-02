import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotesList } from "../../src/components/NotesList";
import { aNote } from "../support/notes";

describe("NotesList", () => {
  it("renders one list item per note, titled and dated", () => {
    render(
      <NotesList
        notes={[aNote(), aNote({ id: "note-2", title: "Renew passport", body: "Photos first" })]}
      />,
    );

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Buy milk" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Renew passport" })).toBeDefined();
    expect(screen.getByText("Photos first")).toBeDefined();
    expect(screen.getAllByText("2026-08-02")).toHaveLength(2);
  });

  it("labels the region with its own heading", () => {
    render(<NotesList notes={[aNote()]} />);

    expect(screen.getByRole("region", { name: "Saved notes" })).toBeDefined();
  });
});
