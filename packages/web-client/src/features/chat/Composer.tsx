/**
 * Composer — autosizing textarea + attach/send/stop (POC `initChatPanel`/`send()`,
 * POC_TO_APP_PLAN_UI.md §4.4). Every send goes through `ensureMaterialized` (`stores/
 * materialize.ts`) first: a brand-new session (`agentId: null`) becomes a real, persisted draft
 * via a no-`initialPrompt` `createAgent` call — the daemon persists the record but does NOT spawn
 * a provider process yet (`agent-service.ts` `handleCreate`'s deferred-draft branch); the process
 * spawns lazily on this very send (`spawnOrResumeSession`). `ensureMaterialized` is a no-op once
 * already bound, so this is the single path for both "first message ever" and every follow-up:
 * `client.agent(agentId).send(...)`. Stop → `client.agent(agentId).interrupt()`.
 *
 * Because the agent is bound (materialized) *before* this call, `useAgentStream` (attaches once
 * `agentId` is set) is already subscribed by the time `send`'s turn starts streaming — unlike the
 * old "one RPC does create-agent-and-run-the-first-turn" path, there is no window where the first
 * turn's events arrive on a raw broadcast nobody is listening to, so this file no longer needs a
 * first-turn gate/latch dance for a still-unbound session.
 *
 * OPTIMISTIC ECHO: `send_agent_prompt` blocks server-side until the whole turn finishes, and even
 * the *first* broadcast event only fires once the agent process is booted/warm — for a session
 * materializing on this very send, that means a real process-spawn+handshake before anything
 * appears (see AGENTS.md "First-message latency"). To hide that, `submit` mints a
 * `clientMessageId` and inserts the user's row into the timeline *synchronously*, before the RPC
 * is even issued. The daemon echoes the same id back verbatim as the `user_message` event's
 * `messageId` (`packages/server/src/agent/agent-service.ts` `runTurn`); the reducer
 * (`timeline/reducer.ts` `onUserMessage`) matches it against the pending row and confirms it in
 * place instead of appending a duplicate.
 *
 * MODEL PRESELECT: a brand-new session shows the model it would actually run on (`tab-store.ts`
 * `openNewChat` seeds it via `resolveDefaultModel`) before anything is materialized. Picking a
 * different model (`StatusBar.tsx`'s `handleSelectModel`, moved there from this file since the
 * model picker now lives in the footer, not the composer) or typing the first character here
 * both materialize the draft immediately, pinning whatever model is CURRENTLY displayed into
 * `config.model`/`config.modelProvider` — replayed by the server on first spawn regardless of
 * whether it's the untouched default or an explicit pick (`spawnOrResumeSession`).
 *
 * STEERING: while the agent is running, the primary action becomes **Steer** instead of Send
 * (`send_agent_prompt` is only legal when idle — see AGENTS.md "Steering"). Steer reuses the exact
 * optimistic-echo + reconciliation path above (`clientMessageId` in, same `user_message` echo
 * back), just against `client.agent(id).steer(...)` instead of `.send(...)`, and marks the
 * optimistic row `queued: true` so `UserRow` can show a "queued" badge until a `queue_update`
 * stream event drops the text from its `steering[]` list (`timeline/reducer.ts`'s
 * `onQueueUpdate`). Follow-up (`.followUp(...)`, delivered only after the turn fully stops) is
 * intentionally not surfaced here — SDK/CLI only for now. Steering only makes sense against a
 * live agent — never triggers materialization itself.
 */

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { Navigation, Paperclip, Send, Square } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { TextArea } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { ensureMaterialized } from "@pi-studio-ui/stores/materialize.js";
import { Attachments, readImageFile, type PendingImage } from "./Attachments.js";
import styles from "./Composer.module.css";

const MAX_TEXTAREA_HEIGHT = 160;

export interface ComposerProps {
  sessionId: string;
}

function autoResize(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

/** `steer_agent_response`'s `{ ok: false }` — no live turn, or the provider lacks steering. */
function isOkFalse(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

export function Composer({ sessionId }: ComposerProps) {
  const client = useConnectionStore((s) => s.client);
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const addOptimisticUserMessage = useSessionStore((s) => s.addOptimisticUserMessage);
  const markUserMessageFailed = useSessionStore((s) => s.markUserMessageFailed);
  const setCwd = useSessionStore((s) => s.setCwd);

  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  // Two independent busy flags: `sending` guards Send/create-agent, whose RPC blocks
  // server-side for the *entire* turn (`runTurn` doesn't resolve until the turn ends — see
  // AGENTS.md "Steering"); `steering` guards the separate, fire-and-forget steer RPC. Sharing
  // one flag would leave the Steer button disabled for the whole turn, since the original
  // send's promise stays pending throughout it.
  const [sending, setSending] = useState(false);
  const [steering, setSteering] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const running = session?.status === "running";
  const busy = running ? steering : sending;
  const canSubmit = Boolean(client) && !busy && (text.trim().length > 0 || images.length > 0);

  async function addImageFile(file: File): Promise<void> {
    if (!file.type.startsWith("image/")) return;
    try {
      const image = await readImageFile(file);
      setImages((prev) => [...prev, image]);
    } catch {
      // Best-effort attachment read — ignore unreadable files (POC has no error UI here either).
    }
  }

  function handleFileInputChange(ev: ChangeEvent<HTMLInputElement>): void {
    for (const file of ev.target.files ?? []) void addImageFile(file);
    ev.target.value = "";
  }

  function handlePaste(ev: ClipboardEvent<HTMLTextAreaElement>): void {
    for (const item of ev.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        ev.preventDefault();
        const file = item.getAsFile();
        if (file) void addImageFile(file);
      }
    }
  }

  function handleRemoveImage(index: number): void {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function handleTextareaChange(ev: ChangeEvent<HTMLTextAreaElement>): void {
    const wasEmpty = text.length === 0;
    setText(ev.target.value);
    autoResize(ev.target);
    // First keystroke on a still-client-only draft materializes it — pins whatever model is
    // currently displayed (the preselected default, or an earlier explicit pick) into the record.
    if (wasEmpty && ev.target.value.length > 0 && client && session && !session.agentId) {
      void ensureMaterialized(client, sessionId).catch(() => {
        // Best-effort: if this fails, `submit`'s own `ensureMaterialized` call retries on send.
      });
    }
  }

  function handleKeyDown(ev: KeyboardEvent<HTMLTextAreaElement>): void {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void submit(running ? "steer" : "send");
    }
  }

  async function submit(mode: "send" | "steer"): Promise<void> {
    if (!client || !session) return;
    if (mode === "steer" ? steering : sending) return;
    // Steering only makes sense against a live agent — a running session always has one.
    if (mode === "steer" && !session.agentId) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;

    setText("");
    if (textareaRef.current) autoResize(textareaRef.current);
    const sentImages = images;
    setImages([]);

    const prompt = trimmed || "Describe this image";
    const rpcImages =
      sentImages.length > 0
        ? sentImages.map((img) => ({ mimeType: img.mimeType, data: img.data }))
        : undefined;

    // Optimistic echo: render the user's row synchronously instead of waiting for the daemon's
    // `user_message` broadcast (see file header). `clientMessageId` is round-tripped through the
    // RPC below and echoed back verbatim as the broadcast event's `messageId`, which is how the
    // reducer reconciles this row instead of appending a duplicate once the server confirms it.
    // Steered rows are additionally marked `queued: true` (cleared by a later `queue_update`).
    const clientMessageId = crypto.randomUUID();
    addOptimisticUserMessage(sessionId, clientMessageId, prompt, rpcImages, mode === "steer");

    const setBusy = mode === "steer" ? setSteering : setSending;
    setBusy(true);
    try {
      if (mode === "steer") {
        // Fire-and-forget injection into the live turn — never touches materialization, which
        // only applies to the send-only, no-agent-yet path below.
        const result = await client
          .agent(session.agentId!)
          .steer(prompt, { clientMessageId, images: rpcImages });
        if (isOkFalse(result)) markUserMessageFailed(sessionId, clientMessageId);
      } else {
        if (!session.agentId) setCwd(sessionId, session.cwd || "~");
        // Materializes the still-client-only draft if `handleTextareaChange`/`handleSelectModel`
        // haven't already (e.g. text arrived by some path other than the tracked keystroke) — a
        // no-op once bound. `useAgentStream` attaches the instant `agentId` is bound, before this
        // turn's first event can possibly arrive (see file header), so `send` needs no separate
        // first-turn broadcast path the way a combined create-and-run RPC used to.
        const agentId = await ensureMaterialized(client, sessionId);
        await client.agent(agentId).send(prompt, { clientMessageId, images: rpcImages });
      }
    } catch {
      // RPC rejection before any `user_message` broadcast arrived (e.g. dropped connection) —
      // the optimistic row would otherwise stay pending forever with no feedback. If the server
      // *did* manage to broadcast `user_message` first (the row is already reconciled), this is
      // a no-op — `markUserMessageFailed` only touches a still-pending row. Turn-level failures
      // that occur after that point still surface via `agent_stream` `error`/`turn_failed`
      // events (POC swallows the RPC rejection the same way; the stream is the source of truth
      // for those).
      markUserMessageFailed(sessionId, clientMessageId);
    } finally {
      setBusy(false);
    }
  }

  function handleStop(): void {
    if (!session?.agentId) return;
    void client?.agent(session.agentId).interrupt();
  }

  return (
    <div className={styles.composer}>
      <div className={styles.inputArea}>
        <TextArea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          value={text}
          placeholder={
            running
              ? "Steer the running turn… (Enter to steer, Shift+Enter for newline)"
              : "Ask anything… (Enter to send, Shift+Enter for newline)"
          }
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <Attachments images={images} onRemove={handleRemoveImage} />
      </div>
      <Button
        className={styles.attachBtn}
        variant="ghost"
        size="md"
        iconOnly
        title="Attach image"
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip size={16} />
      </Button>
      <input
        ref={fileInputRef}
        className={styles.hiddenFileInput}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInputChange}
      />
      <div className={styles.actions}>
        {running ? (
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => void submit("steer")}
            leftIcon={<Navigation size={14} />}
          >
            Steer
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => void submit("send")}
            leftIcon={<Send size={14} />}
          >
            Send
          </Button>
        )}
        {running && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleStop}
            leftIcon={<Square size={14} />}
          >
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
