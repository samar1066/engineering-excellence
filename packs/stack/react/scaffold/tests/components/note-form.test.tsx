import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NoteForm } from "../../src/components/NoteForm";

describe("NoteForm", () => {
  it("submits the trimmed draft and clears the fields", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<NoteForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Title"), "  Buy milk  ");
    await user.type(screen.getByLabelText("Body"), " Two litres ");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(onSubmit).toHaveBeenCalledWith({ title: "Buy milk", body: "Two litres" });
    expect(screen.getByLabelText<HTMLInputElement>("Title").value).toBe("");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Body").value).toBe("");
  });

  it("refuses to submit a blank title", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<NoteForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
