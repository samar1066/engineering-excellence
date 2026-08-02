import type { ReactElement } from "react";
import type { Note } from "../hooks/useNotes";

export type NotesListProps = {
  notes: Note[];
};

/**
 * The populated state. A labelled region wraps a real list, so a screen reader announces both the
 * section and how many notes it holds without any ARIA beyond the labelling relationship.
 */
export function NotesList({ notes }: NotesListProps): ReactElement {
  return (
    <section aria-labelledby="notes-list-heading">
      <h2 id="notes-list-heading">Saved notes</h2>
      <ul>
        {notes.map((note) => (
          <li key={note.id}>
            <article aria-labelledby={`note-title-${note.id}`}>
              <h3 id={`note-title-${note.id}`}>{note.title}</h3>
              <p>{note.body}</p>
              <p>
                Created <time dateTime={note.created_at}>{note.created_at.slice(0, 10)}</time>
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
