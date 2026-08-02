/**
 * Typed client for the notes API. This module is the only place in the application that knows a
 * network exists: it owns the base URL, the request shape, and the wire types. Components never
 * import it; the hooks layer does.
 */

export type Note = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

export type NoteDraft = {
  title: string;
  body: string;
};

// A relative default means the dev server proxy and a reverse proxy in production both work with
// no build time configuration. VITE_API_URL overrides it when the API lives on another origin.
const DEFAULT_BASE_URL = "/api";

function baseUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  return configured !== undefined && configured !== "" ? configured : DEFAULT_BASE_URL;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json" },
    });
  } catch (cause) {
    // A transport failure (offline, DNS, CORS preflight) is not a Response at all. Translate it
    // into the same error shape a bad status produces so callers handle one failure type.
    throw new Error(`${method} ${path} could not reach the API`, { cause });
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function listNotes(): Promise<Note[]> {
  return request<Note[]>("/notes");
}

export async function createNote(draft: NoteDraft): Promise<Note> {
  return request<Note>("/notes", { method: "POST", body: JSON.stringify(draft) });
}
