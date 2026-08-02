import type { ReactElement } from "react";
import { useNotes } from "../hooks/useNotes";
import { NoteForm } from "./NoteForm";
import { NotesList } from "./NotesList";

/**
 * Wires the four primary states of this interface: loading, error, empty, and populated. Each one
 * renders a complete, announceable screen, which is what the accessibility suites assert against.
 */
export function App(): ReactElement {
  const { notes, loading, error, reload, addNote } = useNotes();

  if (loading) {
    return (
      <main aria-labelledby="app-heading">
        <h1 id="app-heading">Notes</h1>
        <p role="status">Loading notes</p>
      </main>
    );
  }

  return (
    <main aria-labelledby="app-heading">
      <h1 id="app-heading">Notes</h1>
      {error !== null ? (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              void reload();
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
      {error === null && notes.length === 0 ? <p>No notes yet. Write the first one.</p> : null}
      {error === null && notes.length > 0 ? <NotesList notes={notes} /> : null}
      <NoteForm onSubmit={addNote} />
    </main>
  );
}
