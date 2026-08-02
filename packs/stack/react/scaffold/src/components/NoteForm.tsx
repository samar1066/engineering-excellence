import { type FormEvent, type ReactElement, useState } from "react";
import type { NoteDraft } from "../hooks/useNotes";

export type NoteFormProps = {
  onSubmit: (draft: NoteDraft) => Promise<void>;
};

/**
 * The only write path in the interface. Every control carries a visible label bound by htmlFor,
 * which is what the accessibility gate checks first: a placeholder is not a label.
 */
export function NoteForm({ onSubmit }: NoteFormProps): ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") return;
    await onSubmit({ title: trimmedTitle, body: body.trim() });
    setTitle("");
    setBody("");
  }

  return (
    <form
      aria-labelledby="note-form-heading"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2 id="note-form-heading">Add a note</h2>
      <p>
        <label htmlFor="note-title">Title</label>
        <input
          id="note-title"
          name="title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </p>
      <p>
        <label htmlFor="note-body">Body</label>
        <textarea
          id="note-body"
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </p>
      <button type="submit">Save note</button>
    </form>
  );
}
