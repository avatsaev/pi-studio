/**
 * Rename dialog — one global instance, opened for a session through `useSessionRenameStore`
 * (the session menu's "Rename"). One text field pre-filled with the current title and selected;
 * Enter or Rename confirms, Escape / Cancel / a click outside dismisses. `resolveRenameTitle`
 * decides whether the answer changes anything. Closing returns focus to the session's row.
 */

import { useRef, useState, type FormEvent } from "react";
import { Button, Dialog, DialogClose, TextInput } from "@av-pi-studio/ui-library";
import { useClient } from "../../lib/connection/connection-store.js";
import { useSessionRenameStore } from "../../stores/session-rename-store.js";
import { useSessionStore } from "../../stores/session-store.js";
import { resolveRenameTitle } from "./rename-title.js";
import { applySessionRename } from "./session-actions.js";
import styles from "./RenameSessionDialog.module.css";

const FORM_ID = "rename-session-form";

export function RenameSessionDialog() {
  const sessionId = useSessionRenameStore((s) => s.sessionId);
  const close = useSessionRenameStore((s) => s.close);
  const session = useSessionStore((s) => (sessionId ? s.sessions[sessionId] : undefined));
  const client = useClient();
  const inputRef = useRef<HTMLInputElement>(null);
  // Outlives the close (Radix fires `onCloseAutoFocus` after the store has cleared).
  const lastSessionIdRef = useRef<string | null>(null);
  if (sessionId) lastSessionIdRef.current = sessionId;

  if (!sessionId || !session) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && close()}
      title="Rename session"
      width={400}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }}
      onCloseAutoFocus={(event) => {
        const row = document.querySelector<HTMLElement>(
          `[data-session-row="${lastSessionIdRef.current}"]`,
        );
        if (!row) return;
        event.preventDefault();
        row.focus();
      }}
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" type="submit" form={FORM_ID}>
            Rename
          </Button>
        </>
      }
    >
      <RenameForm
        key={sessionId}
        initialTitle={session.title}
        inputRef={inputRef}
        onSubmit={(input) => {
          const title = resolveRenameTitle(input, session.title);
          if (title !== null) applySessionRename(session, title, client);
          close();
        }}
      />
    </Dialog>
  );
}

function RenameForm({
  initialTitle,
  inputRef,
  onSubmit,
}: {
  initialTitle: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (input: string) => void;
}) {
  const [value, setValue] = useState(initialTitle);
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSubmit(value);
  }
  return (
    <form id={FORM_ID} className={styles.content} onSubmit={handleSubmit}>
      <TextInput
        ref={inputRef}
        value={value}
        aria-label="Session name"
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}
