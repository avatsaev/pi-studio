/**
 * SavedServersSection — Settings → Servers: list / add / edit / delete saved daemon
 * connections (`stores/saved-servers-store.ts`), plus one-click connect per entry.
 * Form state is local and derived (no store); deletes are a two-step inline confirm
 * rather than a modal.
 */

import { useState } from "react";
import { Check, Pencil, Plus, Server, Trash2, X } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Surface } from "@pi-studio-ui/components/primitives/Surface.js";
import { TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectToServer } from "@pi-studio-ui/lib/connection/connect-to-server.js";
import {
  useSavedServersStore,
  type SavedServer,
} from "@pi-studio-ui/stores/saved-servers-store.js";
import styles from "./SavedServersSection.module.css";

interface DraftFields {
  name: string;
  url: string;
  password: string;
}

const EMPTY_DRAFT: DraftFields = { name: "", url: "", password: "" };

export function SavedServersSection() {
  const servers = useSavedServersStore((s) => s.servers);
  const addServer = useSavedServersStore((s) => s.addServer);
  const updateServer = useSavedServersStore((s) => s.updateServer);
  const removeServer = useSavedServersStore((s) => s.removeServer);
  const connectToServer = useConnectToServer();

  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const draftValid = draft.name.trim() !== "" && draft.url.trim() !== "";
  const editValid = editDraft.name.trim() !== "" && editDraft.url.trim() !== "";

  function submitAdd() {
    if (!draftValid) return;
    addServer(draft);
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(server: SavedServer) {
    setConfirmDeleteId(null);
    setEditingId(server.id);
    setEditDraft({ name: server.name, url: server.url, password: server.password ?? "" });
  }

  function submitEdit() {
    if (!editingId || !editValid) return;
    updateServer(editingId, editDraft);
    setEditingId(null);
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Servers</h2>
      <p className={styles.sectionHint}>
        Saved daemon addresses, stored in this browser. The optional password is kept in plaintext
        in localStorage — leave it empty to be asked at connect time.
      </p>

      {servers.length === 0 ? (
        <p className={styles.empty}>No saved servers yet.</p>
      ) : (
        <ul className={styles.list}>
          {servers.map((server) => (
            <li key={server.id}>
              {editingId === server.id ? (
                <Surface className={styles.editRow}>
                  <TextInput
                    value={editDraft.name}
                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    placeholder="Name"
                    aria-label="Server name"
                  />
                  <TextInput
                    className={styles.grow}
                    value={editDraft.url}
                    onChange={(e) => setEditDraft({ ...editDraft, url: e.target.value })}
                    placeholder="host:port or ws://… / http://…"
                    aria-label="Server address"
                  />
                  <TextInput
                    type="password"
                    value={editDraft.password}
                    onChange={(e) => setEditDraft({ ...editDraft, password: e.target.value })}
                    placeholder="password (optional)"
                    aria-label="Server password"
                  />
                  <Button
                    size="sm"
                    variant="default"
                    iconOnly
                    title="Save"
                    disabled={!editValid}
                    onClick={submitEdit}
                  >
                    <Check size={16} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    iconOnly
                    title="Cancel"
                    onClick={() => setEditingId(null)}
                  >
                    <X size={16} />
                  </Button>
                </Surface>
              ) : (
                <Surface className={styles.row}>
                  <Server size={16} aria-hidden className={styles.rowIcon} />
                  <span className={styles.rowName}>{server.name}</span>
                  <span className={styles.rowUrl}>{server.url}</span>
                  {confirmDeleteId === server.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          removeServer(server.id);
                          setConfirmDeleteId(null);
                        }}
                      >
                        Delete?
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        title="Cancel"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <X size={16} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() =>
                          void connectToServer({ url: server.url, password: server.password })
                        }
                      >
                        Connect
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        title="Edit"
                        onClick={() => startEdit(server)}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        title="Delete"
                        onClick={() => {
                          setEditingId(null);
                          setConfirmDeleteId(server.id);
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </>
                  )}
                </Surface>
              )}
            </li>
          ))}
        </ul>
      )}

      <Surface className={styles.addRow}>
        <TextInput
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Name (e.g. puma-hpc)"
          aria-label="New server name"
        />
        <TextInput
          className={styles.grow}
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          placeholder="host:port or ws://… / http://…"
          aria-label="New server address"
        />
        <TextInput
          type="password"
          value={draft.password}
          onChange={(e) => setDraft({ ...draft, password: e.target.value })}
          placeholder="password (optional)"
          aria-label="New server password"
        />
        <Button
          size="sm"
          variant="default"
          leftIcon={<Plus size={16} />}
          disabled={!draftValid}
          onClick={submitAdd}
        >
          Add
        </Button>
      </Surface>
    </section>
  );
}
