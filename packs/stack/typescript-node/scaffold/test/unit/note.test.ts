import { describe, expect, it } from "vitest";
import { createNote } from "../../src/domain/note.js";

describe("Note", () => {
  it("trims the title and stamps a creation time", () => {
    const note = createNote({ id: "id1", title: "  padded  " });

    expect(note.title).toBe("padded");
    expect(note.body).toBe("");
    expect(note.createdAt).toBeInstanceOf(Date);
  });

  it("keeps the body it was given", () => {
    expect(createNote({ id: "id1", title: "t", body: "hello" }).body).toBe("hello");
  });

  it("rejects a title that is only whitespace", () => {
    expect(() => createNote({ id: "id1", title: "   " })).toThrow(/title must not be blank/);
  });
});
