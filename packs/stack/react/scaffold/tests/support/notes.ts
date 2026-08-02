import { vi } from "vitest";
import type { Note } from "../../src/hooks/useNotes";

/** One note, with every field filled, so a test overrides only what it is actually about. */
export function aNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Buy milk",
    body: "Two litres, semi skimmed",
    created_at: "2026-08-02T09:30:00Z",
    ...overrides,
  };
}

/**
 * A response object with only the members the API client uses. Built by hand rather than with the
 * platform Response so a test can produce any status without a real body stream.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * A response that arrives with a good status and an unparseable body, rejecting with something
 * that is not an Error. It is how the hook's "unreadable failure" path is reached honestly.
 */
export function unreadableResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.reject("not json"),
  } as Response;
}

/** Replaces global fetch for one test. The vitest setup file restores it afterwards. */
export function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** fetch that never settles: the loading state, held open for as long as the test needs it. */
export function stubPendingFetch() {
  return stubFetch(() => new Promise<Response>(() => {}));
}
