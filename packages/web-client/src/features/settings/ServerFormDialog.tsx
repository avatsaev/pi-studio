/**
 * ServerFormDialog — add/edit a saved server (Settings → Servers). Modal form chrome per
 * Paseo's add-host modal: muted 14px labels above inputs, validation fires on submit with
 * one inline error, Cancel/submit as equal-width footer buttons. With `server` set the
 * dialog edits that entry; without it, it adds a new one.
 */

import { useId, useRef, useState, type FormEvent } from "react";
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
  if (!open) return null;

  return <ServerFormDialogSession onOpenChange={onOpenChange} server={server} />;
}

function ServerFormDialogSession({
  onOpenChange,
  server,
}: {
  onOpenChange: (open: boolean) => void;
  server?: SavedServer;
}) {
  const addServer = useSavedServersStore((s) => s.addServer);
  const updateServer = useSavedServersStore((s) => s.updateServer);
  const passwordInputId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [password, setPassword] = useState(server?.password ?? "");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<ServerFormError | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function submit() {
    if (!formRef.current) return;

    // Read from the real controls so browser autofill and any delayed React input event
    // cannot make validation disagree with the values visible to the user.
    const formData = new FormData(formRef.current);
    const submittedName = String(formData.get("name") ?? "");
    const submittedUrl = String(formData.get("url") ?? "");
    const submittedPassword = String(formData.get("password") ?? "");

    if (submittedName.trim() === "") {
      setError({ field: "name", message: "Name is required" });
      return;
    }
    if (submittedUrl.trim() === "") {
      setError({ field: "url", message: "Address is required" });
      return;
    }
    const input = {
      name: submittedName,
      url: submittedUrl,
      password: submittedPassword,
    };
    if (server) updateServer(server.id, input);
    else addServer(input);
    onOpenChange(false);
  }

  return (
    <Dialog
      open
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
          <Button type="button" variant="default" className={styles.footerButton} onClick={submit}>
            {server ? "Save" : "Add server"}
          </Button>
        </div>
      }
    >
      <form ref={formRef} className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.helper}>Enter the address of a Pi-Studio daemon.</p>

        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <TextInput
            name="name"
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
            name="url"
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
              name="password"
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
