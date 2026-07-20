/**
 * ServerFormDialog — add/edit a saved server (Settings → Servers). Modal form chrome per
 * Paseo's add-host modal: muted 14px labels above inputs, validation fires on submit with
 * one inline error, Cancel/submit as equal-width footer buttons. With `server` set the
 * dialog edits that entry; without it, it adds a new one.
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Dialog } from "@pi-studio-ui/components/primitives/Dialog.js";
import { TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import {
  useSavedServersStore,
  type SavedServer,
} from "@pi-studio-ui/stores/saved-servers-store.js";
import styles from "./ServerFormDialog.module.css";

interface ServerFormError {
  field: "name" | "url";
  message: string;
}

export function ServerFormDialog({
  open,
  onOpenChange,
  server,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit this entry; absent → add a new one. */
  server?: SavedServer;
}) {
  const addServer = useSavedServersStore((s) => s.addServer);
  const updateServer = useSavedServersStore((s) => s.updateServer);
  const formId = useId();
  const passwordInputId = useId();

  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [password, setPassword] = useState(server?.password ?? "");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<ServerFormError | null>(null);

  // Controlled dialogs do not call onOpenChange when their parent opens them. Reset on
  // lifecycle changes so reopening Add — or editing another selected server — never leaks
  // values from the previous form session.
  useEffect(() => {
    setName(server?.name ?? "");
    setUrl(server?.url ?? "");
    setPassword(server?.password ?? "");
    setShowPassword(false);
    setError(null);
  }, [open, server?.id, server?.name, server?.url, server?.password]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setError({ field: "name", message: "Name is required" });
      return;
    }
    if (url.trim() === "") {
      setError({ field: "url", message: "Address is required" });
      return;
    }
    if (server) updateServer(server.id, { name, url, password });
    else addServer({ name, url, password });
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={server ? "Edit server" : "Add server"}
      footer={
        <div className={styles.footerRow}>
          <Button
            type="button"
            variant="secondary"
            className={styles.footerButton}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="default" className={styles.footerButton}>
            {server ? "Save" : "Add server"}
          </Button>
        </div>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit}>
        <p className={styles.helper}>Enter the address of a Pi-Studio daemon.</p>

        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My server"
            aria-invalid={error?.field === "name" || undefined}
            autoFocus
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Address</span>
          <TextInput
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="host:port or ws://… / http://…"
            aria-invalid={error?.field === "url" || undefined}
          />
        </label>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={passwordInputId}>
            Password
          </label>
          <span className={styles.passwordWrap}>
            <TextInput
              id={passwordInputId}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Optional"
            />
            <button
              type="button"
              className={styles.eyeButton}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </div>

        <p className={styles.hint}>
          Saved in plaintext in this browser&apos;s localStorage. Leave empty for a passwordless
          daemon.
        </p>

        {error && (
          <p className={styles.error} role="alert">
            {error.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}
