import { useState } from "react";

import type { Backend, DocumentView } from "../lib/types";
import styles from "./Items.module.css";

// A panel reads the view and dispatches command ids. It never changes the document itself.
export function Items({ document: doc, hideDone, backend }: { document: DocumentView | null; hideDone: boolean; backend: Backend }) {
  // What is being typed is this component's own business. It becomes a command's params on Add.
  const [draft, setDraft] = useState("");

  if (!doc) {
    return <p className={styles.empty}>No document. File › New starts one.</p>;
  }
  const visible = doc.items.filter((item) => !(hideDone && item.done));

  function execute(command: string, params: Record<string, unknown>) {
    return backend.control("engine.execute", { command, params });
  }

  async function add() {
    const reply = await execute("item.add", { text: draft });
    // On failure the shell puts the reason in the status bar, and the text stays to be fixed.
    if (reply.ok) {
      setDraft("");
    }
  }

  return (
    <>
      <h1 className={styles.title}>{doc.title}</h1>
      <form
        className={styles.add}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input type="text" aria-label="New item" placeholder="New item" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit">Add</button>
      </form>
      <ul className={styles.list}>
        {visible.map((item) => (
          <li key={item.id}>
            <label className={item.done ? styles.done : undefined}>
              {/* Controlled by the document: the click only asks for the change, and the box changes when the new view arrives. */}
              <input type="checkbox" checked={item.done} onChange={() => void execute("item.setDone", { id: item.id, done: !item.done })} />
              <span>{item.text}</span>
            </label>
            <button type="button" className={styles.small} aria-label={`Delete ${item.text}`} onClick={() => void execute("item.delete", { id: item.id })}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
