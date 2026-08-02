import { describe, expect, it, vi } from "vitest";
import { createNote, listNotes } from "../../src/api/notes";
import { aNote, jsonResponse, stubFetch } from "../support/notes";

describe("notes API client", () => {
  it("lists notes from the default base URL", async () => {
    const fetchSpy = stubFetch(async () => jsonResponse([aNote()]));

    const notes = await listNotes();

    expect(notes).toEqual([aNote()]);
    expect(fetchSpy).toHaveBeenCalledWith("/api/notes", expect.objectContaining({}));
  });

  it("sends the configured base URL when VITE_API_URL is set", async () => {
    vi.stubEnv("VITE_API_URL", "https://notes.example.test");
    const fetchSpy = stubFetch(async () => jsonResponse([]));

    await listNotes();

    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://notes.example.test/notes");
  });

  it("posts a new note as JSON and returns the created note", async () => {
    const created = aNote({ id: "note-2", title: "Call the dentist" });
    const fetchSpy = stubFetch(async () => jsonResponse(created, 201));

    const note = await createNote({ title: "Call the dentist", body: "" });

    expect(note).toEqual(created);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("/api/notes");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ title: "Call the dentist", body: "" }));
    expect(init?.headers).toEqual({ "content-type": "application/json" });
  });

  it("throws with the method, path, and status when the API rejects the request", async () => {
    stubFetch(async () => jsonResponse({ detail: "nope" }, 422));

    await expect(createNote({ title: "", body: "" })).rejects.toThrow(
      "POST /notes failed with status 422",
    );
  });

  it("throws a reachability error when the transport itself fails", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(listNotes()).rejects.toThrow("GET /notes could not reach the API");
  });
});
