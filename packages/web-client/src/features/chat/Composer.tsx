/**
 * Composer — autosizing textarea + attach/send/stop (POC `initChatPanel`/`send()`,
 * POC_TO_APP_PLAN_UI.md §4.4). Send routing: no `agentId` yet → `client.createAgent(...)` then
 * `sessionStore.bindAgent` on success (the race-free binding point `useAgentStream` reacts to);
 * else → `client.agent(agentId).send(...)`. Stop → `client.agent(agentId).interrupt()`.
 *
 * OPTIMISTIC ECHO: `create_agent_request`/`send_agent_prompt` block server-side until the whole
 * turn finishes, and even the *first* broadcast event for that turn (the canonical `user_message`)
 * only fires once the agent process is booted/warm — for a brand-new session that means a real
 * process-spawn+handshake before anything appears (see AGENTS.md "First-message latency"). To hide
 * that, `submit` mints a `clientMessageId` and inserts the user's row into the timeline
 * *synchronously*, before the RPC is even issued. The daemon echoes the same id back verbatim as
 * the `user_message` event's `messageId` (`packages/server/src/agent/agent-service.ts` `runTurn`);
 * the reducer (`timeline/reducer.ts` `onUserMessage`) matches it against the pending row and
 * confirms it in place instead of appending a duplicate.
 *
 * A brand-new agent has no live subscription yet when the first turn's events start arriving —
 * `useAgentStream` only attaches once `bindAgent` sets `agentId`, which happens *after*
 * `createAgent()` resolves. So for the first turn `submit` subscribes to the raw broadcast
 * directly and applies each `agent_stream` event *as it arrives*, latching the new agent's id
 * from *its own* `user_message` echo (`messageId === clientMessageId`) — never from "the first
 * such event", since another session's agent can be mid-turn on the same socket concurrently and
 * its frames would otherwise be misattributed here (agent_update frames are top-level and never
 * reach `onSessionMessage`; agent_stream frames are session-wrapped and do). That includes the
 * `user_message` event that reconciles the optimistic row above.
 * `bindAgent` is deferred until the RPC resolves so `useAgentStream` attaches only for follow-up
 * turns and never re-applies the first turn (the reducer is not event-id-idempotent).
 *
 * STEERING: while the agent is running, the primary action becomes **Steer** instead of Send
 * (`send_agent_prompt` is only legal when idle — see AGENTS.md "Steering"). Steer reuses the exact
 * optimistic-echo + reconciliation path above (`clientMessageId` in, same `user_message` echo
 * back), just against `client.agent(id).steer(...)` instead of `.send(...)`, and marks the
 * optimistic row `queued: true` so `UserRow` can show a "queued" badge until a `queue_update`
 * stream event drops the text from its `steering[]` list (`timeline/reducer.ts`'s
 * `onQueueUpdate`). Follow-up (`.followUp(...)`, delivered only after the turn fully stops) is
 * intentionally not surfaced here — SDK/CLI only for now.
 */

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigation, Paperclip, Send, Square } from "lucide-react";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { TextArea } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { applyAgentStreamEvent, createFirstTurnGate } from "@pi-studio-ui/hooks/agent-stream-events.js";
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

interface AgentStreamMessage {
  type: "agent_stream";
  agentId: string;
  event: AgentStreamEvent;
}

function isAgentStreamMessage(msg: unknown): msg is AgentStreamMessage {
  if (typeof msg !== "object" || msg === null) return false;
  if (!("type" in msg) || msg.type !== "agent_stream") return false;
  return "agentId" in msg && typeof msg.agentId === "string" && "event" in msg;
}

/** `steer_agent_response`'s `{ ok: false }` — no live turn, or the provider lacks steering. */
function isOkFalse(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

export function Composer({ sessionId }: ComposerProps) {
  const client = useConnectionStore((s) => s.client);
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const bindAgent = useSessionStore((s) => s.bindAgent);
  const addOptimisticUserMessage = useSessionStore((s) => s.addOptimisticUserMessage);
  const markUserMessageFailed = useSessionStore((s) => s.markUserMessageFailed);
  const setCwd = useSessionStore((s) => s.setCwd);
  const queryClient = useQueryClient();

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
    setText(ev.target.value);
    autoResize(ev.target);
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
    // Steering only makes sense against a live agent — a running session always has one; bail
    // rather than fall through to the create-agent path below (that path is send-only).
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
        // Fire-and-forget injection into the live turn — never touches `bindAgent` or the
        // first-turn broadcast gate below (those exist only for the no-agent-yet create path).
        const result = await client.agent(session.agentId!).steer(prompt, { clientMessageId, images: rpcImages });
        if (isOkFalse(result)) markUserMessageFailed(sessionId, clientMessageId);
      } else if (!session.agentId) {
        const cwd = session.cwd || "~";
        setCwd(sessionId, cwd);
        // The daemon runs the entire first turn *before* `createAgent()` resolves, broadcasting
        // every `agent_stream` event for it in the meantime (agent-service.ts `runTurn`). If we
        // waited for the RPC to learn our agentId the timeline would stay empty (and show no
        // running indicator) until the whole turn finished — the reported bug. Instead we watch
        // the live broadcast during the call and apply events as they arrive.
        //
        // We latch the agent id from *our own* canonical `user_message` echo (`messageId ===
        // clientMessageId`), never from "the first `agent_stream` frame we happen to observe":
        // another session's agent can be mid-turn on this same socket right now, so the first
        // frame to arrive after we subscribe may belong to THAT agent, not ours. Latching onto it
        // would misattribute its events into this session's timeline and then silently drop this
        // turn's real events (mismatched agentId) once they start arriving. `agent_update` frames
        // are broadcast bare/top-level and never reach `onSessionMessage` (only `session`-wrapped
        // frames do), but every `agent_stream` frame IS session-wrapped, including the
        // `user_message` echo — so this key is always observable here.
        //
        // `bindAgent` is deferred until *after* the RPC resolves: binding attaches
        // `useAgentStream`, and since the reducer isn't event-id-idempotent, a mid-turn attach
        // would double every remaining row. Binding post-resolve means this handler is the sole
        // applier for the first turn and `useAgentStream` only ever sees follow-up turns.
        const isOwnTurnEvent = createFirstTurnGate(clientMessageId);
        const unsubscribeLive = client.connection.onSessionMessage((msg) => {
          if (!isAgentStreamMessage(msg) || !isOwnTurnEvent(msg)) return;
          applyAgentStreamEvent({ sessionId, event: msg.event, client, queryClient });
        });

        let result: { agentId: string };
        try {
          result = await client.createAgent({
            config: { provider: "pi", cwd },
            initialPrompt: prompt,
            clientMessageId,
            images: rpcImages,
            labels: {},
          });
        } finally {
          unsubscribeLive();
        }

        bindAgent(sessionId, result.agentId);
      } else {
        await client.agent(session.agentId).send(prompt, { clientMessageId, images: rpcImages });
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
          <Button size="sm" disabled={!canSubmit} onClick={() => void submit("send")} leftIcon={<Send size={14} />}>
            Send
          </Button>
        )}
        {running && (
          <Button size="sm" variant="destructive" onClick={handleStop} leftIcon={<Square size={14} />}>
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
