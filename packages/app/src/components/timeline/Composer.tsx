/**
 * Composer — message input surface with autocomplete, attachments, submit/queue.
 * composer-ui.md
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Send, X, Paperclip, GitPullRequest } from "lucide-react";
import { clsx } from "clsx";
import styles from "./Composer.module.css";
import { Button } from "../primitives/index.js";
import {
  resolveSubmitDecision,
  type SubmitInput,
  type SubmitDecision,
  type ComposerProcessingState,
} from "../../composer/submit.js";
import {
  detectActiveToken,
  applyCommandInsertion,
  applyFileInsertion,
  type SlashCommandOption,
  type FileOption,
} from "../../composer/autocomplete.js";
import {
  mergeSlashCommands,
  fuzzyMatchFiles,
  type FileMentionEntry,
  type ModeOption,
} from "../../composer/autocomplete-sources.js";
import type { DraftAttachmentMeta } from "../../composer/draft-store.js";
import {
  extractImageFiles,
  extractImagesFromItems,
  fileToStoredImage,
  newImageStorageKey,
  detectGitHubUrlsInText,
  gitHubRefToAttachment,
  attachmentPillKind,
  attachmentLabel,
  attachmentId,
  openLightbox,
  closeLightbox,
  INITIAL_LIGHTBOX,
  type AttachmentBytesStore,
  type StoredImage,
} from "../../composer/attachments.js";
import { sharedAttachmentStore } from "../../hooks/use-composer.js";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ComposerProps {
  /** Whether the agent is currently running. */
  agentRunning: boolean;
  /** Current processing state. */
  processingState?: ComposerProcessingState;
  /** Called on submit. */
  onSubmit: (text: string, attachments: DraftAttachmentMeta[]) => void;
  /** Called to queue when agent is busy. */
  onQueue?: (text: string) => void;
  /** Persistent draft text (initial value). */
  initialDraft?: string;
  /** Persistent draft attachments (initial value). */
  initialAttachments?: DraftAttachmentMeta[];
  /** Called when draft changes (for persistence). */
  onDraftChange?: (text: string) => void;
  /** Called when the attachment set changes (for persistence). */
  onAttachmentsChange?: (attachments: DraftAttachmentMeta[]) => void;
  /** Provider usage label (footer). */
  providerUsageLabel?: string;
  /** Usage breakdown rows (shown in a popover when the label is clicked). */
  usageBreakdown?: { label: string; value: string }[];
  /** Image bytes store (defaults to the shared IndexedDB-backed store). */
  attachmentStore?: AttachmentBytesStore;
  /** Provider-advertised slash commands (merged with client commands). */
  providerCommands?: SlashCommandOption[];
  /** Workspace file entries for `@` mentions. */
  fileEntries?: FileMentionEntry[];
  /** Recently opened file paths (shown for an empty `@` query). */
  recentFiles?: string[];
  /** True in a draft (no agent yet) — only provider commands list. */
  isDraft?: boolean;
  /** Available agent modes (mode chip). */
  modes?: ModeOption[];
  /** Currently selected mode id. */
  currentModeId?: string;
  /** Called when the mode chip changes. */
  onModeChange?: (modeId: string) => void;
}

export function Composer({
  agentRunning,
  processingState = "idle",
  onSubmit,
  onQueue,
  initialDraft = "",
  initialAttachments = [],
  onDraftChange,
  onAttachmentsChange,
  providerUsageLabel,
  usageBreakdown = [],
  attachmentStore = sharedAttachmentStore,
  providerCommands = [],
  fileEntries = [],
  recentFiles = [],
  isDraft = false,
  modes = [],
  currentModeId,
  onModeChange,
}: ComposerProps) {
  const [text, setText] = useState(initialDraft);
  const [attachments, setAttachments] = useState<DraftAttachmentMeta[]>(initialAttachments);
  const [acIndex, setAcIndex] = useState(0);
  const [lightbox, setLightbox] = useState(INITIAL_LIGHTBOX);
  const [usageOpen, setUsageOpen] = useState(false);
  const [lightboxData, setLightboxData] = useState<StoredImage | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seenGitHubUrls = useRef<Set<string>>(new Set());

  const locked = processingState === "locked";

  const updateAttachments = useCallback(
    (next: DraftAttachmentMeta[]) => {
      setAttachments(next);
      onAttachmentsChange?.(next);
    },
    [onAttachmentsChange],
  );

  // Auto-grow
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [text]);

  // Autocomplete — command mode merges client + provider commands; file mode
  // fuzzy-matches the workspace tree (empty query → recent files).
  const cursorPos = textareaRef.current?.selectionStart ?? text.length;
  const activeToken = useMemo(() => detectActiveToken(text, cursorPos), [text, cursorPos]);
  const commandOptions = useMemo<SlashCommandOption[]>(() => {
    if (activeToken.mode !== "command") return [];
    return mergeSlashCommands({
      providerCommands,
      isDraft,
      inline: !activeToken.isLineLead,
      query: activeToken.token,
    });
  }, [activeToken, providerCommands, isDraft]);
  const fileOptions = useMemo<FileOption[]>(() => {
    if (activeToken.mode !== "file") return [];
    return fuzzyMatchFiles(fileEntries, activeToken.token, { limit: 10, recentPaths: recentFiles });
  }, [activeToken, fileEntries, recentFiles]);
  const acMode = activeToken.mode;
  const acCount = acMode === "command" ? commandOptions.length : acMode === "file" ? fileOptions.length : 0;

  const submitDecision = useMemo((): SubmitDecision => {
    const input: SubmitInput = {
      text: text.trim(),
      attachments,
      agentRunning,
      forceSubmit: false,
      canSubmit: processingState === "idle",
    };
    return resolveSubmitDecision(input);
  }, [text, attachments, agentRunning, processingState]);

  // Store image files as attachments (persist bytes + add pill).
  const addImageFiles = useCallback(
    async (files: File[]) => {
      const additions: DraftAttachmentMeta[] = [];
      for (const file of files) {
        const storageKey = newImageStorageKey();
        try {
          const stored = await fileToStoredImage(file);
          await attachmentStore.put(storageKey, stored);
          additions.push({ kind: "image", storageKey, mimeType: stored.mimeType, name: file.name });
        } catch {
          /* ignore unreadable file */
        }
      }
      if (additions.length > 0) {
        updateAttachments([...attachments, ...additions]);
      }
    },
    [attachmentStore, attachments, updateAttachments],
  );

  // Auto-attach GitHub issue/PR URLs typed into the message.
  const maybeAttachGitHub = useCallback(
    (value: string) => {
      const refs = detectGitHubUrlsInText(value);
      const fresh = refs.filter((r) => !seenGitHubUrls.current.has(r.url));
      if (fresh.length === 0) return;
      for (const r of fresh) seenGitHubUrls.current.add(r.url);
      const existing = new Set(
        attachments
          .filter((a) => a.kind === "github_issue" || a.kind === "github_pr")
          .map((a) => (a as { url?: string }).url),
      );
      const pills = fresh
        .filter((r) => !existing.has(r.url))
        .map((r) => gitHubRefToAttachment(r, `${r.owner}/${r.repo}`));
      if (pills.length > 0) updateAttachments([...attachments, ...pills]);
    },
    [attachments, updateAttachments],
  );

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (submitDecision === "queued") {
      onQueue?.(trimmed);
    } else if (submitDecision === "submitted") {
      onSubmit(trimmed, attachments);
    } else {
      return;
    }
    setText("");
    updateAttachments([]);
    seenGitHubUrls.current.clear();
    onDraftChange?.("");
  }, [text, attachments, submitDecision, onSubmit, onQueue, onDraftChange, updateAttachments]);

  const applySelection = useCallback(
    (index: number) => {
      if (acMode === "command") {
        const opt = commandOptions[index];
        if (opt) {
          const result = applyCommandInsertion(text, activeToken, opt);
          setText(result.text);
          onDraftChange?.(result.text);
        }
      } else if (acMode === "file") {
        const opt = fileOptions[index];
        if (opt) {
          const result = applyFileInsertion(text, activeToken, opt);
          setText(result.text);
          onDraftChange?.(result.text);
        }
      }
    },
    [acMode, commandOptions, fileOptions, activeToken, text, onDraftChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (acCount > 0) {
        if (e.key === "ArrowDown") { e.preventDefault(); setAcIndex((i) => (i + 1) % acCount); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setAcIndex((i) => (i - 1 + acCount) % acCount); return; }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          applySelection(acIndex);
          return;
        }
        if (e.key === "Escape") { setAcIndex(0); return; }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [acCount, acIndex, applySelection, handleSubmit],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onDraftChange?.(e.target.value);
    maybeAttachGitHub(e.target.value);
    setAcIndex(0);
  };

  const handleAttach = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void addImageFiles(extractImageFiles(e.target.files));
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (locked) return;
    const imgs = extractImagesFromItems(e.clipboardData?.items);
    if (imgs.length > 0) {
      e.preventDefault();
      void addImageFiles(imgs);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (locked) return;
    const imgs = extractImageFiles(e.dataTransfer?.files);
    if (imgs.length > 0) {
      e.preventDefault();
      void addImageFiles(imgs);
    }
  };

  const removeAttachmentAt = useCallback(
    (index: number) => {
      const att = attachments[index];
      if (att?.kind === "image") {
        void attachmentStore.delete(att.storageKey);
      }
      if (att?.kind === "github_issue" || att?.kind === "github_pr") {
        seenGitHubUrls.current.delete(att.url);
      }
      updateAttachments(attachments.filter((_, i) => i !== index));
    },
    [attachments, attachmentStore, updateAttachments],
  );

  const showLightbox = useCallback(
    async (att: DraftAttachmentMeta) => {
      if (att.kind !== "image") return;
      const data = await attachmentStore.get(att.storageKey);
      setLightboxData(data);
      setLightbox(openLightbox(att.storageKey, att.name));
    },
    [attachmentStore],
  );

  const dismissLightbox = useCallback(() => {
    setLightbox(closeLightbox());
    setLightboxData(undefined);
  }, []);

  useEffect(() => {
    if (!lightbox.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissLightbox();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox.open, dismissLightbox]);

  return (
    <div className={styles.container} style={{ position: "relative" }} onPaste={handlePaste} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {/* Autocomplete */}
      {acMode === "command" && commandOptions.length > 0 && (
        <div className={styles.autocomplete}>
          {commandOptions.map((opt, i) => (
            <div
              key={opt.name}
              className={clsx(styles.acOption, i === acIndex && styles.acOptionHighlighted)}
              onMouseDown={(e) => { e.preventDefault(); applySelection(i); }}
            >
              /{opt.name} — {opt.description}
            </div>
          ))}
        </div>
      )}
      {acMode === "file" && fileOptions.length > 0 && (
        <div className={styles.autocomplete}>
          {fileOptions.map((opt, i) => (
            <div
              key={opt.path}
              className={clsx(styles.acOption, i === acIndex && styles.acOptionHighlighted)}
              onMouseDown={(e) => { e.preventDefault(); applySelection(i); }}
            >
              {opt.label}{opt.kind === "directory" ? "/" : ""} — {opt.path}
            </div>
          ))}
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className={styles.attachments}>
          {attachments.map((att, i) => {
            const pillKind = attachmentPillKind(att);
            return (
              <span
                key={attachmentId(att, i)}
                className={styles.attachPill}
                onClick={() => (pillKind === "image" ? void showLightbox(att) : undefined)}
                style={{ cursor: pillKind === "image" ? "pointer" : "default" }}
              >
                {pillKind === "github" && <GitPullRequest size={11} />}
                {attachmentLabel(att)}
                <X
                  size={10}
                  className={styles.attachRemove}
                  onClick={(e) => { e.stopPropagation(); removeAttachmentAt(i); }}
                />
              </span>
            );
          })}
        </div>
      )}

      {/* Input row */}
      <div className={styles.inputRow}>
        <button className={styles.sendBtn} onClick={handleAttach} aria-label="Attach file" disabled={locked} style={{ background: "none", border: "none", color: "var(--pi-color-foregroundMuted)", cursor: "pointer" }}>
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          className={styles.textArea}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={agentRunning ? "Queue a message…" : "Send a message…"}
          rows={1}
          disabled={locked}
        />
        <Button
          size="sm"
          iconOnly
          onClick={handleSubmit}
          disabled={submitDecision === "noop" || submitDecision === "failed"}
          aria-label={agentRunning ? "Queue" : "Send"}
        >
          <Send size={14} />
        </Button>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <span>
          {modes.length > 0 && (
            <select
              aria-label="Agent mode"
              value={currentModeId ?? modes[0]?.id}
              onChange={(e) => onModeChange?.(e.target.value)}
              style={{ background: "none", border: "none", color: "var(--pi-color-foregroundMuted)", cursor: "pointer", font: "inherit" }}
            >
              {modes.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          )}
          {agentRunning && <span className={styles.queueIndicator}>Agent running • queued</span>}
        </span>
        {providerUsageLabel && (
          <span style={{ position: "relative" }}>
            <button
              type="button"
              aria-label="Usage breakdown"
              onClick={() => setUsageOpen((v) => !v)}
              style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: usageBreakdown.length > 0 ? "pointer" : "default", padding: 0 }}
            >
              {providerUsageLabel}
            </button>
            {usageOpen && usageBreakdown.length > 0 && (
              <div
                role="dialog"
                aria-label="Usage breakdown"
                style={{
                  position: "absolute", bottom: "100%", right: 0, marginBottom: 6,
                  minWidth: 180, padding: 8, borderRadius: 8, zIndex: 20,
                  background: "var(--pi-color-surface, #1e1e1e)",
                  border: "1px solid var(--pi-color-border, #333)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                }}
              >
                {usageBreakdown.map((row) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "2px 0" }}>
                    <span style={{ opacity: 0.7 }}>{row.label}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </span>
        )}
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />

      {/* Lightbox */}
      {lightbox.open && (
        <div
          role="dialog"
          aria-label={lightbox.label ?? "Attachment preview"}
          onClick={dismissLightbox}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.72)",
          }}
        >
          {lightboxData ? (
            <img
              src={`data:${lightboxData.mimeType};base64,${lightboxData.data}`}
              alt={lightbox.label ?? "attachment"}
              style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8 }}
            />
          ) : (
            <span style={{ color: "#fff" }}>Preview unavailable</span>
          )}
        </div>
      )}
    </div>
  );
}
