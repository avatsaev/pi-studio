/**
 * Composer — a bordered card holding an autosizing textarea with a **bottom toolbar** beneath it
 * (attach / slash-commands on the left, model picker + send/steer/stop on the right), replacing
 * the old single-row "textarea flanked by loose buttons" layout. Send/stop semantics are
 * unchanged (POC `initChatPanel`/`send()`,
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
 * MODEL & MATERIALIZATION: a chat materializes the instant its tab is created
 * (`tab-store.ts` `openNewChat` calls `ensureMaterialized`, which also resolves and pins the
 * default model into the record if none was set yet) — long before this composer even mounts, in
 * the common case. `submit`'s own `ensureMaterialized` call below is the retry path: it only does
 * real work when the eager materialize failed or never ran (opened while disconnected). Picking a
 * different model (`handleSelectModel` below, moved here from `StatusBar.tsx` with the toolbar)
 * updates the already-materialized
 * record's `config.model`/`config.modelProvider` directly — replayed by the server on first spawn
 * regardless of whether it's the resolved default or an explicit pick (`spawnOrResumeSession`).
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

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { clsx } from "clsx";
import { ArrowUp, ChevronDown, Navigation, Plus, Slash, Square } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { TextArea } from "@pi-studio-ui/components/primitives/TextInput.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { randomId } from "@pi-studio-ui/lib/random-id.js";
import { useDraftStore } from "@pi-studio-ui/stores/draft-store.js";
import { ensureMaterialized } from "@pi-studio-ui/stores/materialize.js";
import { useSessionStore } from "@pi-studio-ui/stores/session-store.js";
import { useIsTabVisible, tabIds } from "@pi-studio-ui/stores/tab-store.js";
import { useAgentCommands } from "@pi-studio-ui/hooks/use-agent-commands.js";
import { filterOptions } from "@pi-studio-ui/ui/combobox.js";
import { Attachments, readImageFile, type PendingImage } from "./Attachments.js";
import { isComposerBusy } from "./composer-busy.js";
import { CommandMenu } from "./CommandMenu.js";
import { ModelMenu } from "./ModelMenu.js";
import {
  applyCommand,
  commandOptions,
  knownCommandSpan,
  moveHighlight,
  parseSlashToken,
  shouldOpenMenu,
} from "./slash-commands.js";
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Composer({ sessionId }: ComposerProps) {
  const client = useConnectionStore((s) => s.client);
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const addOptimisticUserMessage = useSessionStore((s) => s.addOptimisticUserMessage);
  const markUserMessageFailed = useSessionStore((s) => s.markUserMessageFailed);
  const setCwd = useSessionStore((s) => s.setCwd);
  const setModel = useSessionStore((s) => s.setModel);

  // Draft text is lifted into `draft-store.ts` (sprint-069/task-007), not local state — a
  // `set_editor_text` extension effect must be able to write a session's draft even while this
  // component is unmounted (no chat tab open for that session yet), and this same slot is what a
  // freshly-mounted composer for that session reads as its initial text.
  const text = useDraftStore((s) => s.drafts[sessionId] ?? "");
  const setDraftText = useDraftStore((s) => s.setDraft);
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // `set_editor_text` visual feedback (sprint-069/task-007, § 11). `visible` mirrors
  // `agent-ui-store.ts`'s own `isTabVisible(tabIds.chat(sessionId))` check at effect-application
  // time; here it additionally drives WHEN a queued feedback is shown/consumed as this composer's
  // own on-screen state changes.
  const visible = useIsTabVisible(tabIds.chat(sessionId));
  const pendingFeedback = useDraftStore((s) => s.pendingFeedback[sessionId]);
  const [note, setNote] = useState<string | null>(null);
  const [flashing, setFlashing] = useState(false);
  const noteTimeoutRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);

  // Consumes this session's queued feedback the instant it is both PENDING and VISIBLE — either
  // condition can arrive first (an effect while already visible; becoming visible with a feedback
  // already queued from a background replacement), and either transition must re-check. Never
  // gated on `text` itself: ordinary typing changes `drafts[sessionId]` too and must not re-fire
  // this.
  useEffect(() => {
    if (!visible || pendingFeedback === undefined) return;
    const feedback = useDraftStore.getState().consumeFeedback(sessionId);
    if (!feedback) return;
    setNote(feedback.copy === "filled" ? "Your message was filled in" : "Your draft was replaced");
    if (noteTimeoutRef.current !== null) window.clearTimeout(noteTimeoutRef.current);
    noteTimeoutRef.current = window.setTimeout(() => setNote(null), 4000);
    // Caret at the end of the new text (§ 11) — never calls `.focus()`, so this never steals focus
    // from a pending-question card (sprint-068/task-008) or a composer the user is typing in.
    const el = textareaRef.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
    if (feedback.flash) {
      setFlashing(true);
      if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = window.setTimeout(
        () => setFlashing(false),
        prefersReducedMotion() ? 1000 : 400,
      );
    }
  }, [visible, pendingFeedback, sessionId]);

  useEffect(() => {
    return () => {
      if (noteTimeoutRef.current !== null) window.clearTimeout(noteTimeoutRef.current);
      if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  const running = session?.status === "running";
  const busy = isComposerBusy(running, sending, steering);
  const canSubmit = Boolean(client) && !busy && (text.trim().length > 0 || images.length > 0);

  // Read-through cached exactly like `use-provider-models.ts` (see the hook's own docstring):
  // reopening the `/` menu — including the auto-open that fires on every `/` keystroke — shows
  // the cached rows immediately instead of a spinner every time.
  const { data: commands = [], isLoading, isError, error } = useAgentCommands(sessionId, menuOpen);
  const { options, hiddenExtensionCount } = commandOptions(commands, { running });
  const token = parseSlashToken(text);
  const filtered = token ? filterOptions(options, token.name) : options;
  const commandNames = commands.map((c) => c.name);
  // The span to highlight in the textarea — only a token Pi will actually recognize as a command.
  const span = knownCommandSpan(text, commandNames);

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
    const next = ev.target.value;
    setDraftText(sessionId, next);
    autoResize(ev.target);
    // `/` at the very start opens the menu and keeps it open while the name is still being typed;
    // the first space (or any non-slash draft) closes it. Never reopens for a `/` mid-text — Pi
    // only recognizes a command at index 0 (`agent-session.js` `text.startsWith("/")`).
    const shouldOpen = shouldOpenMenu(next);
    if (shouldOpen !== menuOpen) setMenuOpen(shouldOpen);
    if (shouldOpen) setHighlight(0);
  }

  function handleKeyDown(ev: KeyboardEvent<HTMLTextAreaElement>): void {
    // A single Backspace deletes the WHOLE recognized command token, like a chip/mention, instead
    // of forcing the user to peck through it one character at a time. Scoped to `!menuOpen` (the
    // command has already been accepted/typed in full and the menu closed) so it never fights
    // the ArrowDown/Enter accept flow below while the user is still actively narrowing a match.
    if (!menuOpen && span && ev.key === "Backspace") {
      const el = ev.currentTarget;
      const caret = el.selectionStart;
      if (caret !== null && caret === el.selectionEnd) {
        // Also swallow the single trailing space `applyCommand` appends, so the draft goes
        // straight back to empty (or to whatever args followed) in one keystroke, not two.
        const deletableEnd = span.end + (text[span.end] === " " ? 1 : 0);
        if (caret > 0 && caret <= deletableEnd) {
          ev.preventDefault();
          const next = text.slice(deletableEnd);
          setDraftText(sessionId, next);
          el.setSelectionRange(0, 0);
          autoResize(el);
          return;
        }
      }
    }
    if (menuOpen && filtered.length > 0) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        setHighlight((i) => moveHighlight(i, ev.key === "ArrowDown" ? 1 : -1, filtered.length));
        return;
      }
      // Enter and Tab both accept the preselected command — they complete the token, they do NOT
      // send. The user still has to press Enter again to submit, so a command can take arguments.
      if ((ev.key === "Enter" && !ev.shiftKey) || ev.key === "Tab") {
        ev.preventDefault();
        const name = filtered[highlight]?.value;
        if (name) applySelectedCommand(name);
        return;
      }
    }
    if (menuOpen && ev.key === "Escape") {
      ev.preventDefault();
      setMenuOpen(false);
      return;
    }
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void submit(running ? "steer" : "send");
    }
  }

  function applySelectedCommand(name: string): void {
    const next = applyCommand(text, name);
    setDraftText(sessionId, next);
    setMenuOpen(false);
    setHighlight(0);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(next.length, next.length);
      autoResize(el);
    }
  }

  async function submit(mode: "send" | "steer"): Promise<void> {
    if (!client || !session) return;
    if (mode === "steer" ? steering : sending) return;
    // Steering only makes sense against a live agent — a running session always has one.
    if (mode === "steer" && !session.agentId) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;

    setDraftText(sessionId, "");
    // A bare Enter (or the Send/Steer button) can fire while the menu is still open — e.g. the
    // draft is a command-like token with no filter match yet (`filtered.length === 0`), so the
    // accept branch in `handleKeyDown` never ran. Close it here too, not just in `applyCommand`'s
    // trailing-space path, so a send never leaves the menu stuck open over an empty draft.
    setMenuOpen(false);
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
    const clientMessageId = randomId();
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
        // Retry path (see file header "MODEL & MATERIALIZATION") for a session whose eager
        // materialize (`tab-store.ts` `openNewChat`) never ran or failed — a no-op once already
        // bound. `useAgentStream` attaches the instant `agentId` is bound, before this turn's
        // first event can possibly arrive (see file header), so `send` needs no separate
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

  /**
   * `modelProvider` is the model's OWN underlying LLM provider (e.g. `"anthropic"`) — REQUIRED by
   * `client.agent(id).setModel(provider, modelId)`'s `provider` argument. Never hardcode the
   * pi-studio provider id ("pi") here; Pi has no model registered under a provider literally
   * named "pi" (sprint-043's "Model not found: pi/<modelId>" bug).
   *
   * Single path regardless of whether the session is already materialized: `ensureMaterialized`
   * is a no-op once bound (the common case now that `tab-store.ts` `openNewChat` materializes
   * eagerly) and otherwise awaits whatever in-flight materialize is already running — the
   * `setModel` optimistic pick two lines up already updated the entry that materialize reads
   * `config.model`/`config.modelProvider` from, so there is no dropped-pick race even when this
   * fires while the eager materialize is still in flight.
   */
  function handleSelectModel(modelId: string, modelProvider?: string): void {
    setModel(sessionId, modelId, modelProvider); // optimistic display pick either way
    if (!client || !modelProvider) return;
    void (async () => {
      const agentId = await ensureMaterialized(client, sessionId);
      await client.agent(agentId).setModel(modelProvider, modelId);
    })().catch(() => {
      // Same swallow-and-let-the-stream-be-the-source-of-truth convention as `submit`'s catch —
      // a rejected `agent_set_model_request` has no dedicated UI surface today.
    });
  }

  return (
    <div className={styles.composer}>
      <div className={clsx(styles.card, flashing && styles.flash)}>
        <div className={styles.textareaWrap}>
          <div className={styles.highlightLayer} aria-hidden>
            {span ? (
              <>
                <mark className={styles.commandMark}>{text.slice(0, span.end)}</mark>
                {text.slice(span.end)}
              </>
            ) : (
              text
            )}
          </div>
          <TextArea
            ref={textareaRef}
            className={styles.textarea}
            rows={1}
            value={text}
            placeholder={
              running
                ? "Steer the running turn…  ⏎ steer · ⇧⏎ newline"
                : "Ask anything…  ⏎ send · ⇧⏎ newline · / commands"
            }
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
        </div>
        <Attachments images={images} onRemove={handleRemoveImage} />
        <div className={styles.toolbar}>
          <Button
            className={styles.toolBtn}
            variant="ghost"
            size="sm"
            iconOnly
            title="Attach image"
            aria-label="Attach image"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus size={16} />
          </Button>
          <CommandMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            options={filtered}
            highlightedIndex={highlight}
            onSelect={applySelectedCommand}
            isLoading={isLoading}
            isError={isError}
            errorMessage={error instanceof Error ? error.message : undefined}
            hiddenExtensionCount={hiddenExtensionCount}
            renderTrigger={() => (
              <Button
                className={styles.toolBtn}
                variant="ghost"
                size="sm"
                iconOnly
                title="Slash commands"
                aria-label="Slash commands"
              >
                <Slash size={16} />
              </Button>
            )}
          />
          <div className={styles.toolbarRight}>
            <ModelMenu
              currentModel={session?.model}
              currentModelProvider={session?.modelProvider}
              provider="pi"
              onSelect={handleSelectModel}
              renderTrigger={(currentModel, currentModelName) => {
                // A separate id span only earns its place when the name actually differs from the
                // id — a provider reporting no display name would otherwise render "id (id)".
                const showId = currentModelName !== undefined && currentModelName !== currentModel;
                return (
                  <button
                    type="button"
                    className={styles.modelBtn}
                    disabled={!client}
                    title={
                      currentModel
                        ? `Model: ${currentModelName ?? currentModel}${showId ? ` (${currentModel})` : ""}`
                        : "Select model"
                    }
                  >
                    <span className={styles.modelLabel}>
                      {currentModelName ?? currentModel ?? "Model"}
                    </span>
                    {showId && <span className={styles.modelId}>({currentModel})</span>}
                    <ChevronDown size={13} className={styles.modelChevron} aria-hidden="true" />
                  </button>
                );
              }}
            />
            {running && (
              <Button
                className={styles.roundBtn}
                variant="destructive"
                size="sm"
                iconOnly
                title="Stop the running turn"
                aria-label="Stop"
                onClick={handleStop}
              >
                <Square size={14} />
              </Button>
            )}
            <Button
              className={styles.roundBtn}
              size="sm"
              iconOnly
              disabled={!canSubmit}
              title={running ? "Steer the running turn" : "Send"}
              aria-label={running ? "Steer" : "Send"}
              onClick={() => void submit(running ? "steer" : "send")}
            >
              {running ? <Navigation size={16} /> : <ArrowUp size={18} />}
            </Button>
          </div>
        </div>
      </div>
      {note !== null && <div className={styles.note}>{note}</div>}
      <input
        ref={fileInputRef}
        className={styles.hiddenFileInput}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInputChange}
      />
    </div>
  );
}
