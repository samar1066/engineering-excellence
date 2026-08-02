import { useCallback, useEffect, useState } from "react";
import type { Note, NoteDraft } from "../api/notes";
import { createNote, listNotes } from "../api/notes";

// The hooks layer re-exports the wire types so a component never has to import from src/api, not
// even for a type. The boundary check in .dependency-cruiser.cjs enforces that direction.
export type { Note, NoteDraft };

export type UseNotes = {
  notes: Note[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  addNote: (draft: NoteDraft) => Promise<void>;
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The notes API returned an unreadable failure";
}

/**
 * Owns every piece of notes state a screen needs: the notes themselves, whether a load is in
 * flight, and the last failure. Components read these values and call the two actions; they never
 * touch the API client directly.
 */
export function useNotes(): UseNotes {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setNotes(await listNotes());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const addNote = useCallback(async (draft: NoteDraft): Promise<void> => {
    setError(null);
    try {
      const created = await createNote(draft);
      setNotes((current) => [...current, created]);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { notes, loading, error, reload, addNote };
}
