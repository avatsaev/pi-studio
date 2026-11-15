import type { DocumentView } from "../lib/types";
import styles from "./StatusBar.module.css";

function summary(doc: DocumentView | null): string {
  if (!doc) {
    return "Ready";
  }
  const left = doc.items.filter((item) => !item.done).length;
  return `${left} of ${doc.items.length} left${doc.dirty ? " · edited" : ""}`;
}

export function StatusBar({ document: doc, status }: { document: DocumentView | null; status: string }) {
  return (
    <output className={styles.bar}>
      {status ? <span className={styles.error}>{status}</span> : <span className={styles.summary}>{summary(doc)}</span>}
    </output>
  );
}
