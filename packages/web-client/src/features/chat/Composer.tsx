/**
 * Composer — autosizing textarea + attach/send/stop (POC `initChatPanel`/`send()`,
 * POC_TO_APP_PLAN_UI.md §4.4). Send routing: no `agentId` yet → `client.createAgent(...)` then
 * `sessionStore.bindAgent` on success (the race-free binding point `useAgentStream` reacts to);
 * else → `client.agent(agentId).send(...)`. Stop → `client.agent(agentId).interrupt()`.
 *
 * IMPORTANT: `create_agent_request` (and `send_agent_prompt`) block server-side until the whole
 * turn finishes, broadcasting every `agent_stream` event for that turn *before* the RPC resolves.
 * A brand-new agent has no live subscription yet at that point — `useAgentStream` only attaches
 * once `bindAgent` sets `agentId`, which happens *after* `createAgent()` resolves. So for the
 * first turn `handleSend` subscribes to the raw broadcast directly and applies each `agent_stream`
 * event *as it arrives*, latching the new agent's id from the first such event (agent_update
 * frames are top-level and never reach `onSessionMessage`; agent_stream frames are session-wrapped
 * and do). So the user message and streamed response appear live instead of all at once when the
 * RPC returns.
 * `bindAgent` is deferred until the RPC resolves so `useAgentStream` attaches only for follow-up
 * turns and never re-applies the first turn (the reducer is not event-id-idempotent).
 */

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Square } from "lucide-react";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { Button } from "../../components/primitives/Button.js";
import { TextArea } from "../../components/primitives/TextInput.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useSessionStore } from "../../stores/session-store.js";
import { applyAgentStreamEvent } from "../../hooks/agent-stream-events.js";
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

export function Composer({ sessionId }: ComposerProps) {
  const client = useConnectionStore((s) => s.client);
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const bindAgent = useSessionStore((s) => s.bindAgent);
  const addUserMessage = useSessionStore((s) => s.addUserMessage);
  const setCwd = useSessionStore((s) => s.setCwd);
  const queryClient = useQueryClient();

  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const running = session?.status === "running";
  const canSend = Boolean(client) && !sending && (text.trim().length > 0 || images.length > 0);

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
      void handleSend();
    }
  }

  async function handleSend(): Promise<void> {
    if (!client || !session || sending) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;

    setText("");
    if (textareaRef.current) autoResize(textareaRef.current);
    const sentImages = images;
    setImages([]);

    // No optimistic local echo: the daemon canonically emits exactly one `user_message`
    // stream event per prompt (packages/server/src/agent/agent-service.ts), broadcast to this
    // session's timeline subscription — the reducer renders it from there. Echoing locally too
    // would double the row; unlike the POC (whose `handleAgentStream` switch has no
    // `user_message` case and so never rendered the server's broadcast), this store renders
    // every event kind uniformly, so the server is the single source of truth here.
    addUserMessage(sessionId);
    const prompt = trimmed || "Describe this image";
    const rpcImages =
      sentImages.length > 0
        ? sentImages.map((img) => ({ mimeType: img.mimeType, data: img.data }))
        : undefined;

    setSending(true);
    try {
      if (!session.agentId) {
        const cwd = session.cwd || "~";
        setCwd(sessionId, cwd);
        // The daemon runs the entire first turn *before* `createAgent()` resolves, broadcasting
        // every `agent_stream` event for it in the meantime (agent-service.ts `runTurn`). If we
        // waited for the RPC to learn our agentId the timeline would stay empty (and show no
        // running indicator) until the whole turn finished — the reported bug. Instead we watch
        // the live broadcast during the call and apply events as they arrive.
        //
        // We latch the agent id from the *first `agent_stream` event* we see, not from
        // `agent_update{status:"initializing"}`: `agent_update` is broadcast as a bare top-level
        // frame that the client's frame router drops (only `session`-wrapped frames reach
        // `onSessionMessage`), whereas every `agent_stream` frame IS `session`-wrapped and carries
        // its `agentId`. The daemon creates exactly one agent per `createAgent`, so the first
        // stream event on this socket after we subscribe belongs to our new agent.
        //
        // `bindAgent` is deferred until *after* the RPC resolves: binding attaches
        // `useAgentStream`, and since the reducer isn't event-id-idempotent, a mid-turn attach
        // would double every remaining row. Binding post-resolve means this handler is the sole
        // applier for the first turn and `useAgentStream` only ever sees follow-up turns.
        let liveAgentId: string | null = null;
        const unsubscribeLive = client.connection.onSessionMessage((msg) => {
          if (!isAgentStreamMessage(msg)) return;
          if (liveAgentId === null) liveAgentId = msg.agentId;
          if (msg.agentId !== liveAgentId) return;
          applyAgentStreamEvent({ sessionId, event: msg.event, client, queryClient });
        });

        let result: { agentId: string };
        try {
          result = await client.createAgent({
            config: { provider: "pi", cwd },
            initialPrompt: prompt,
            images: rpcImages,
            labels: {},
          });
        } finally {
          unsubscribeLive();
        }

        bindAgent(sessionId, result.agentId);
      } else {
        await client.agent(session.agentId).send(prompt, { images: rpcImages });
      }
    } catch {
      // RPC failures surface via agent_stream `error`/`turn_failed` events (POC swallows the
      // rejection the same way; the stream is the source of truth for user-visible failure).
    } finally {
      setSending(false);
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
          placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
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
        <Button size="sm" disabled={!canSend} onClick={() => void handleSend()} leftIcon={<Send size={14} />}>
          Send
        </Button>
        {running && (
          <Button size="sm" variant="destructive" onClick={handleStop} leftIcon={<Square size={14} />}>
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
