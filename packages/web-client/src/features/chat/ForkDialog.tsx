/**
 * ForkDialog — one dialog, two steps (sprint-072/task-003, visual spec § 05·06·07's "open
 * question 5" decision): a confirm step showing exactly what will be forked from, and a
 * "Fork from…" picker step that swaps into the SAME dialog rather than opening a second one.
 * Mounted once for the whole app (`TabPanelHost`, alongside `TabContextMenu` — the same "one
 * global overlay" precedent), driven entirely by `stores/fork-store.ts`: any open chat pane's row
 * button (task-002) or "⋮" menu (task-003) can open it, and only one instance is ever open.
 *
 * Result handling (task-004, `fork-result.ts`) applies the settled RPC: a cancelled fork toasts
 * and closes; success closes and conditionally prefills the composer; a rejection toasts and
 * returns the dialog to a reusable idle state instead of closing it.
 *
 * Keyboard/assistive tech (task-005, visual spec § 11): initial focus on Cancel in the confirm
 * step (`autoFocus`); Esc is inert while pending (`onEscapeKeyDown` below) and — via the existing
 * global precedence guard in `use-shortcuts.ts` — consumes the keystroke exclusively, so an open
 * toast is never dismissed by the same Esc; the picker's rows are arrow-key navigable
 * (`handlePickerKeyDown`) with the first row focused on open; closing restores focus to the
 * control that opened this whole flow (`triggerElement`, captured by the caller at click-time),
 * or falls back to that session's composer when the row is gone — the COMMON case after a
 * successful fork, since its own `agent_timeline_reset` typically already removed the row by the
 * time this dialog finishes closing.
 */

import { useEffect, useRef } from "react";
import { GitFork } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Dialog, DialogClose } from "@pi-studio-ui/components/primitives/Dialog.js";
import { EmptyState } from "@pi-studio-ui/components/primitives/EmptyState.js";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { useClient } from "@pi-studio-ui/lib/connection/connection-store.js";
import { speak } from "@pi-studio-ui/stores/announcer-store.js";
import { useForkStore } from "@pi-studio-ui/stores/fork-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { nextPickerFocusIndex } from "./fork-picker-nav.js";
import { applyForkError, applyForkSuccess } from "./fork-result.js";
import styles from "./ForkDialog.module.css";

/** § 12 copy deck — shipped verbatim. */
const CONFIRM_BODY_COPY =
  "Later messages leave the agent's context. The original prompt is placed in the composer for editing.";

/** Moves focus between picker rows on ↑/↓ — see `fork-picker-nav.ts` for the pure clamping rule
 * this wraps around live DOM state (`document.activeElement`, the rendered `<button>`s). */
function handlePickerKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex = nextPickerFocusIndex(currentIndex, event.key, buttons.length);
  if (nextIndex >= 0) buttons[nextIndex]?.focus();
}

export function ForkDialog() {
  const dialog = useForkStore((s) => s.dialog);
  const selectFromPicker = useForkStore((s) => s.selectFromPicker);
  const backToPicker = useForkStore((s) => s.backToPicker);
  const setPending = useForkStore((s) => s.setPending);
  const close = useForkStore((s) => s.close);
  const client = useClient();
  const listRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const open = dialog.status !== "closed";
  const pending = dialog.status === "confirm" && dialog.pending;

  // Remembers the last known trigger/agent while the dialog is open (rendered during, not after,
  // the commit that flips `dialog.status` to "closed" — `onCloseAutoFocus` fires once that value
  // is already gone from the store, so it reads these refs instead).
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const lastAgentIdRef = useRef<string | null>(null);
  if (dialog.status !== "closed") {
    lastTriggerRef.current = dialog.triggerElement;
    lastAgentIdRef.current = dialog.agentId;
  }

  // Opened scrolled to the bottom (most recent) since that is where forks happen (§ 07).
  useEffect(() => {
    if (dialog.status === "picker" && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [dialog]);

  // § 11 "initial focus" — Radix's own `onOpenAutoFocus` default always lands on this dialog's
  // first focusable descendant in DOM order, which is `Dialog.tsx`'s own header Close button, not
  // whichever body/footer element a caller marks `autoFocus` (a native-attribute commit does not
  // reliably win a race against Radix's `FocusScope` mount effect — verified against a real
  // Chromium instance, not assumed). Both steps therefore override it explicitly.
  function handlePickerOpenAutoFocus(event: Event): void {
    event.preventDefault();
    listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function handleConfirmOpenAutoFocus(event: Event): void {
    event.preventDefault();
    cancelButtonRef.current?.focus();
  }

  // § 11 "closing returns focus to the invoking control, or a stable fallback when it's gone."
  function handleCloseAutoFocus(event: Event): void {
    const trigger = lastTriggerRef.current;
    if (trigger?.isConnected) {
      event.preventDefault();
      trigger.focus();
      return;
    }
    // The row that opened this is gone (a successful fork's own reset routinely removes it before
    // the dialog finishes closing) — fall back to that session's composer, the natural next stop
    // after a fork (task-004 may have just prefilled it).
    const agentId = lastAgentIdRef.current;
    const session = agentId ? useSessionStore.getState().findByAgentId(agentId) : undefined;
    const fallback = session
      ? document.querySelector<HTMLElement>(`[data-session-id="${session.id}"]`)
      : null;
    if (fallback) {
      event.preventDefault();
      fallback.focus();
    }
    // Otherwise let Radix's own default happen (a harmless no-op onto `document.body`).
  }

  // Reads live store state (not the render-captured `dialog` closure) so two `fork()` calls
  // fired in the same synchronous burst (a fast double-click, before React re-renders the
  // disabled button) still see each other's `pending` flag — `setPending(true)` below is a
  // synchronous zustand write, so the second call's `getState()` read observes it immediately.
  async function handleConfirm() {
    const current = useForkStore.getState().dialog;
    if (current.status !== "confirm" || current.pending || !client) return;
    setPending(true);
    speak("Forking…");
    try {
      const result = await client.agent(current.agentId).fork(current.target.entryId);
      applyForkSuccess(current.agentId, result);
    } catch (error) {
      applyForkError(error);
    }
  }

  if (!open) return null;

  if (dialog.status === "picker") {
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && close()}
        title="Fork from…"
        width={460}
        onCloseAutoFocus={handleCloseAutoFocus}
        onOpenAutoFocus={handlePickerOpenAutoFocus}
      >
        {dialog.messages.length === 0 ? (
          <EmptyState className={styles.pickerEmpty}>
            <Icon icon={GitFork} size="lg" />
            <div>Nothing to fork yet</div>
          </EmptyState>
        ) : (
          <div className={styles.pickerList} ref={listRef} onKeyDown={handlePickerKeyDown}>
            {dialog.messages.map((message, index) => (
              <button
                key={message.entryId}
                type="button"
                className={styles.pickerRow}
                onClick={() => selectFromPicker(message)}
              >
                <span className={styles.pickerOrdinal}>#{index + 1}</span>
                <span className={styles.pickerText}>{message.text}</span>
              </button>
            ))}
          </div>
        )}
      </Dialog>
    );
  }

  // Confirm step.
  const { target, backTo } = dialog;
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !pending && close()}
      title="Fork conversation"
      width={440}
      onInteractOutside={(event) => {
        if (pending) event.preventDefault();
      }}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault();
      }}
      onCloseAutoFocus={handleCloseAutoFocus}
      onOpenAutoFocus={handleConfirmOpenAutoFocus}
      footer={
        <>
          {backTo !== null && (
            <Button
              className={styles.backButton}
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => backToPicker()}
            >
              ‹ Back
            </Button>
          )}
          <DialogClose asChild>
            <Button ref={cancelButtonRef} size="sm" variant="secondary" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" loading={pending} onClick={() => void handleConfirm()}>
            {pending ? "Forking…" : "Fork from here"}
          </Button>
        </>
      }
    >
      <div className={styles.confirmContent}>
        <div className={clsx(styles.preview, pending && styles.previewPending)}>{target.text}</div>
        <div className={styles.copy}>{CONFIRM_BODY_COPY}</div>
      </div>
    </Dialog>
  );
}
