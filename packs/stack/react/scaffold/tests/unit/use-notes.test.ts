import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNotes } from "../../src/hooks/useNotes";
import {
  aNote,
  jsonResponse,
  stubFetch,
  stubPendingFetch,
  unreadableResponse,
} from "../support/notes";

describe("useNotes", () => {
  it("starts in the loading state before the first response arrives", () => {
    stubPendingFetch();

    const { result } = renderHook(() => useNotes());

    expect(result.current.loading).toBe(true);
    expect(result.current.notes).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads notes on mount and leaves the loading state", async () => {
    stubFetch(async () => jsonResponse([aNote()]));

    const { result } = renderHook(() => useNotes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notes).toEqual([aNote()]);
    expect(result.current.error).toBeNull();
  });

  it("records the failure message when the load fails", async () => {
    stubFetch(async () => jsonResponse({}, 500));

    const { result } = renderHook(() => useNotes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("GET /notes failed with status 500");
    expect(result.current.notes).toEqual([]);
  });

  it("reports an unreadable failure when the rejection is not an error", async () => {
    stubFetch(async () => unreadableResponse());

    const { result } = renderHook(() => useNotes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("The notes API returned an unreadable failure");
  });

  it("appends a created note to the loaded list", async () => {
    const created = aNote({ id: "note-2", title: "Water the plants" });
    stubFetch(async (_url, init) =>
      init?.method === "POST" ? jsonResponse(created, 201) : jsonResponse([aNote()]),
    );
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addNote({ title: "Water the plants", body: "" });
    });

    expect(result.current.notes).toEqual([aNote(), created]);
    expect(result.current.error).toBeNull();
  });

  it("keeps the loaded notes and reports the error when a create fails", async () => {
    stubFetch(async (_url, init) =>
      init?.method === "POST" ? jsonResponse({}, 422) : jsonResponse([aNote()]),
    );
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addNote({ title: "", body: "" });
    });

    expect(result.current.notes).toEqual([aNote()]);
    expect(result.current.error).toBe("POST /notes failed with status 422");
  });

  it("clears the error and refetches when reload is called", async () => {
    let attempt = 0;
    stubFetch(async () => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({}, 500) : jsonResponse([aNote()]);
    });
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.notes).toEqual([aNote()]);
  });
});
