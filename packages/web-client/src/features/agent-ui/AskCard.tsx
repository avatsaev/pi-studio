/**
 * AskCard — an extension-UI dialog rendered inline in the chat transcript, through every state in
 * its life (sprint-068/task-005 pending states; task-006 in-flight, resolved-collapsed and
 * non-answerable; task-008 keyboard/focus ownership). A UI request is never a persisted
 * `TimelineRow` — it is composed into the virtualized list at render time (`Timeline.tsx`), never
 * written to `session.timeline.rows` — but it reuses the same `RowShell` gutter/disc/connector
 * language every other timeline row uses (§ 02: "same 20px gutter, disc and connector as a tool
 * card"), so the shell is reused, not reinvented.
 *
 * **No optimistic update.** Submitting fires `respondToUi` and nothing else — the card stays
 * pending (in-flight) until the daemon's `agent_ui_resolved` arrives; there is nothing local to
 * await or resolve here. `submitting`/`submittedAnswer`/`answerable` are read straight off the SDK's
 * `AgentUiPendingEntry` (`agent-ui-state.ts`) — this component decides nothing new, it renders what
 * the store already models (task-006's own scope boundary).
 *
 * **Keyboard/focus ownership (task-008, § 07).** A card claims Enter and Esc only while focus is
 * inside it — enforced by DOM structure, not a global handler: `Composer.tsx`'s Enter-submit is
 * scoped to its own `<textarea onKeyDown>`, a disjoint subtree, so it can never see a keypress
 * whose focus target lives inside a card, and vice versa. The only place ownership has to be
 * *asserted* rather than simply falling out of the DOM is Esc, because `use-shortcuts.ts` attaches
 * a `document`-level listener that would otherwise also see it — every Esc handled here calls
 * `stopPropagation()`. The card border/ring and the hint line's visibility are pure CSS
 * (`.card:focus-within`, `AskCard.module.css`) — no focus/blur listener needed for those; `armed`
 * is the one piece of real state, because the hint's *text* has to change mid-flow.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import { Check, HelpCircle } from "lucide-react";
import { clsx } from "clsx";
import type { AgentUiPendingEntry, AgentUiResolvedEntry } from "@av-pi-studio/client";
import type { AgentUiResponse } from "@av-pi-studio/protocol";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Icon } from "@pi-studio-ui/components/primitives/Icon.js";
import { TextArea, TextInput } from "@pi-studio-ui/components/primitives/TextInput.js";
import { RowShell } from "@pi-studio-ui/features/chat/rows/RowShell.js";
import { isRecovered, type AskEntry } from "./ask-list.js";
import { respondToUi } from "./agent-ui-store.js";
import { deadline } from "./deadline.js";
import { computeHint, pressEscape, submitKeyClaimsShift, type Hint } from "./keyboard.js";
import { outcomeLine } from "./outcome-line.js";
import { optionLayout } from "./option-layout.js";
import { confirmPromptParts, promptLines } from "./prompt-text.js";
import styles from "./AskCard.module.css";

export interface AskCardProps {
  item: AskEntry;
  /** Draw the rail connector below this card. `false` on the timeline's last row. */
  connector: boolean;
  /** § 06 "past four": render a pending card collapsed to its header line. Ignored for a resolved
   *  entry — task-006 already collapses those unconditionally, orthogonally to this flag. */
  collapsed?: boolean;
  /** § 07 "the first pending card in the active session takes focus" — `Timeline.tsx` sets this on
   *  exactly one card (or none): the active session's focused pane's first pending entry. Ignored
   *  for a resolved/collapsed entry, neither of which has anything focusable. */
  autoFocus?: boolean;
}

// How often the deadline bar re-derives its fraction while shown — a display tick only; nothing
// here ends the dialog (`deadline.ts`'s header: only `agent_ui_resolved` ever does).
const DEADLINE_TICK_MS = 250;
// § 03 "grows with content from 3 rows to roughly 14, then scrolls internally".
const EDITOR_MAX_HEIGHT_PX = 320;

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function readStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function AskCard({ item, connector, collapsed = false, autoFocus = false }: AskCardProps) {
  if (item.kind === "resolved") return <ResolvedAskCard entry={item.entry} connector={connector} />;
  if (collapsed) return <CollapsedPendingCard entry={item.entry} connector={connector} />;
  return <PendingAskCard entry={item.entry} connector={connector} autoFocus={autoFocus} />;
}

/** § 06 "still waiting" — a pending entry recovered from a daemon snapshot rather than observed
 *  live carries this chip in its header, so a card older than the message above it doesn't read
 *  as brand new. Shown on both the full and collapsed pending presentations. */
function RecoveredChip() {
  return <span className={styles.recoveredChip}>still waiting</span>;
}

// ─── Collapsed pending (§ 06 "past four") ────────────────────────────────────────────────────────

function CollapsedPendingCard({
  entry,
  connector,
}: {
  entry: AgentUiPendingEntry;
  connector: boolean;
}) {
  return (
    <RowShell
      disc={<Icon icon={HelpCircle} size="xs" color="var(--pi-color-statusWarning)" />}
      discClassName={styles.askDisc}
      connector={connector}
    >
      <div className={clsx(styles.resolvedCard, styles.collapsedPendingCard)}>
        <span className={styles.askBadge}>ASK</span>
        <span className={styles.resolvedMethodName}>{entry.method}</span>
        {isRecovered(entry) && <RecoveredChip />}
      </div>
    </RowShell>
  );
}
/** § 06 "N more waiting" — the clickable row that lifts the past-four limit, rendered by
 *  `Timeline.tsx` right where `layoutAskEntries` places the `{ kind: "more" }` marker (immediately
 *  after the last full pending card). Not itself an `AskCard` variant — it carries no dialog
 *  identity of its own, so it takes its own connector prop directly rather than an `AskEntry`. */
export function AskMoreRow({
  count,
  connector,
  onExpand,
}: {
  count: number;
  connector: boolean;
  onExpand: () => void;
}) {
  return (
    <RowShell
      disc={<Icon icon={HelpCircle} size="xs" color="var(--pi-color-foregroundMuted)" />}
      discClassName={styles.askDiscInert}
      connector={connector}
    >
      <button type="button" className={styles.moreRow} onClick={onExpand}>
        {count} more waiting
      </button>
    </RowShell>
  );
}

// ─── Resolved (collapsed-in-place) ───────────────────────────────────────────────────────────────

function ResolvedAskCard({
  entry,
  connector,
}: {
  entry: AgentUiResolvedEntry;
  connector: boolean;
}) {
  const line = outcomeLine(entry);
  return (
    <RowShell
      disc={<Icon icon={HelpCircle} size="xs" color="var(--pi-color-foregroundMuted)" />}
      discClassName={styles.askDiscInert}
      connector={connector}
    >
      <div className={styles.resolvedCard}>
        <span className={clsx(styles.askBadge, styles.askBadgeNeutral)}>ASK</span>
        <span className={styles.resolvedMethodName}>{entry.method}</span>
        <span className={clsx(styles.outcome, line.tone === "success" && styles.outcomeSuccess)}>
          {line.glyph === "check" && <Check size={11} aria-hidden />}
          <span className={clsx(line.truncate && styles.outcomeText)}>{line.text}</span>
        </span>
      </div>
    </RowShell>
  );
}

// ─── Pending (idle, in-flight, non-answerable) ───────────────────────────────────────────────────

/** Per-control override for the in-flight/non-answerable treatments (§ 05). Idle controls (neither
 *  submitting nor disconnected) get no override — normal Button behavior. Non-answerable forces
 *  every control's own opacity back to 1 via `style`, so the card-level `.cardInert` dimming
 *  (applied once, on the whole card) is the only source of dimming rather than compounding with
 *  each Button's own disabled-opacity. In-flight leaves the non-pressed controls' own disabled
 *  opacity alone (that IS the § 05 "45%" inert look) and only overrides the pressed one back to
 *  full opacity so its spinner and fill read clearly. */
function controlOverride(
  entry: AgentUiPendingEntry,
  isPressed: boolean,
): { disabled?: boolean; loading?: boolean; style?: CSSProperties } {
  if (!entry.answerable) return { disabled: true, style: { opacity: 1 } };
  if (entry.submitting) {
    if (isPressed) return { loading: true, style: { opacity: 1 } };
    return { disabled: true };
  }
  return {};
}

/** § 07 hint line — key-chip tokens for the normal state, plain warning text once armed. Visibility
 *  is pure CSS (`.card:focus-within ~ .hint`); this only decides *what* it says. */
function HintLine({ hint }: { hint: Hint }) {
  if (hint.kind === "warning") return <p className={styles.hint}>{hint.text}</p>;
  return (
    <p className={styles.hint}>
      {hint.segments.map((segment, i) => (
        <Fragment key={segment.label}>
          {i > 0 && <span className={styles.hintSep}>·</span>}
          <span className={styles.hintKey}>{segment.key}</span>
          {segment.label}
        </Fragment>
      ))}
    </p>
  );
}

function PendingAskCard({
  entry,
  connector,
  autoFocus = false,
}: {
  entry: AgentUiPendingEntry;
  connector: boolean;
  autoFocus?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const bar = deadline(entry, now);
  // § 07 two-step Esc — the only real state this task adds. Everything else (border/ring/hint
  // visibility) is `:focus-within` in CSS; this exists because the hint's *text* has to change.
  const [armed, setArmed] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // "The field for input/editor, the primary button for select/confirm" (§ 07 initial focus) and
  // "the card's dismissing control (Cancel / No / Block)" (§ 07 arm) — generic `HTMLElement` refs
  // filled in by whichever per-method body owns that control, via an inline callback ref (a plain
  // `RefObject<HTMLElement>` doesn't structurally satisfy `Button`'s/`TextInput`'s own narrower
  // `Ref<HTMLButtonElement>`/`Ref<HTMLInputElement>` types, but a callback ref does). Some kinds —
  // `input`, and `select` with options — have no dismissing control at all; `dismissRef.current`
  // simply stays `null` for those, and arming just changes the hint without moving focus.
  const primaryRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!bar.show) return;
    const id = setInterval(() => setNow(Date.now()), DEADLINE_TICK_MS);
    return () => clearInterval(id);
  }, [entry.requestId, entry.timeoutMs, bar.show]);

  // § 07 initial focus. Never steals focus from a text field the user is already typing in
  // (the composer, or — defensively — any other editable surface) even though `Timeline.tsx`
  // only ever sets `autoFocus` on the active session's focused pane, because a card can newly
  // become "first pending" (an earlier one resolved) while the user is mid-sentence elsewhere.
  useEffect(() => {
    if (!autoFocus || !entry.answerable) return;
    const active = document.activeElement;
    const editingElsewhere =
      active instanceof HTMLElement &&
      (active.tagName === "TEXTAREA" || active.tagName === "INPUT") &&
      !cardRef.current?.contains(active);
    if (!editingElsewhere) primaryRef.current?.focus();
  }, [autoFocus, entry.answerable]);

  function submit(response: AgentUiResponse): void {
    void respondToUi(entry.requestId, response);
  }

  // § 07 "After dismissal... the outcome is the same answer [as a clicked one]" — the second Esc
  // therefore clicks the dismissing control itself rather than resolving with a card-invented
  // payload: `confirm`'s "No" sends `{ confirmed: false }` (outcome `declined`), `editor`'s/
  // `unrecognised`'s/empty-`select`'s "Cancel" sends `{ cancelled: true }` — whichever it is, this
  // reuses that exact click handler (`HTMLElement.click()` fires a genuine, React-visible click),
  // so it also gets that control's own in-flight-spinner `pressed` state for free. A kind with no
  // dismissing control at all (`input`, `select` with options) has nothing to click — those fall
  // back to submitting a bare cancellation directly.
  //
  // § 07 "Esc pressed anywhere else closes whatever else is topmost and leaves the card untouched"
  // — that's simply not calling this handler; it only ever runs while focus is inside the card.
  function handleKeyDown(ev: ReactKeyboardEvent<HTMLDivElement>): void {
    if (ev.key !== "Escape" || !entry.answerable) return;
    ev.preventDefault();
    ev.stopPropagation();
    const result = pressEscape(armed);
    setArmed(result.armed);
    if (!result.resolve) {
      dismissRef.current?.focus();
      return;
    }
    if (dismissRef.current) dismissRef.current.click();
    else submit({ cancelled: true });
  }

  // § 07 "Moving focus off an armed card disarms it".
  function handleBlur(ev: ReactFocusEvent<HTMLDivElement>): void {
    if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setArmed(false);
  }

  return (
    <RowShell
      disc={
        <Icon
          icon={HelpCircle}
          size="xs"
          color={
            entry.answerable ? "var(--pi-color-statusWarning)" : "var(--pi-color-foregroundMuted)"
          }
        />
      }
      discClassName={entry.answerable ? styles.askDisc : styles.askDiscInert}
      connector={connector}
    >
      <div
        ref={cardRef}
        className={clsx(styles.card, !entry.answerable && styles.cardInert)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      >
        {bar.show && (
          <div
            className={clsx(styles.deadlineBar, bar.approximate && styles.deadlineApproximate)}
            style={{ width: `${bar.fraction * 100}%` }}
          />
        )}
        <div className={styles.header}>
          <span className={clsx(styles.askBadge, !entry.answerable && styles.askBadgeNeutral)}>
            ASK
          </span>
          <span className={styles.methodName}>{entry.method}</span>
          {isRecovered(entry) && <RecoveredChip />}
        </div>
        <AskCardBody
          entry={entry}
          onSubmit={submit}
          primaryRef={primaryRef}
          dismissRef={dismissRef}
        />
      </div>
      <HintLine hint={computeHint(entry.method, armed)} />
      {!entry.answerable && (
        <p className={styles.reconnectingNote}>
          <span className={styles.reconnectingDot} />
          Reconnecting — you can answer again in a moment
        </p>
      )}
    </RowShell>
  );
}

interface AskCardBodyProps {
  entry: AgentUiPendingEntry;
  onSubmit: (response: AgentUiResponse) => void;
  /** § 07 "focus lands on the field for input/editor, on the primary button for select/confirm". */
  primaryRef: RefObject<HTMLElement | null>;
  /** § 07 "the card's dismissing control (Cancel / No / Block)" — `null` for a kind that has none
   *  (`input`, and `select` with options): arming then just changes the hint in place. */
  dismissRef: RefObject<HTMLElement | null>;
}

function AskCardBody({ entry, onSubmit, primaryRef, dismissRef }: AskCardBodyProps) {
  const { method, payload } = entry;

  if (method === "select")
    return (
      <SelectBody
        entry={entry}
        payload={payload}
        onSubmit={onSubmit}
        primaryRef={primaryRef}
        dismissRef={dismissRef}
      />
    );
  if (method === "confirm")
    return (
      <ConfirmBody
        entry={entry}
        payload={payload}
        onSubmit={onSubmit}
        primaryRef={primaryRef}
        dismissRef={dismissRef}
      />
    );
  if (method === "input")
    return (
      <InputBody entry={entry} payload={payload} onSubmit={onSubmit} primaryRef={primaryRef} />
    );
  if (method === "editor")
    return (
      <EditorBody
        entry={entry}
        payload={payload}
        onSubmit={onSubmit}
        primaryRef={primaryRef}
        dismissRef={dismissRef}
      />
    );
  return (
    <UnrecognisedBody
      entry={entry}
      method={method}
      payload={payload}
      onSubmit={onSubmit}
      primaryRef={primaryRef}
      dismissRef={dismissRef}
    />
  );
}

function Title({ text }: { text: string }) {
  return <div className={styles.title}>{promptLines(text).join("\n")}</div>;
}

function SelectBody({
  entry,
  payload,
  onSubmit,
  primaryRef,
  dismissRef,
}: {
  entry: AgentUiPendingEntry;
  payload: Record<string, unknown>;
  onSubmit: (response: AgentUiResponse) => void;
  primaryRef: RefObject<HTMLElement | null>;
  dismissRef: RefObject<HTMLElement | null>;
}) {
  const title = readString(payload, "title") ?? "";
  const options = readStringArray(payload, "options");
  // Local UI state only — identifies which option this client clicked, for the in-flight spinner.
  // The SDK's own `submittedAnswer.value` (§ 05, `agent-ui-state.ts`) would ambiguously match
  // duplicate labels (§ 12 permits them); the option's index never does.
  const [pressedIndex, setPressedIndex] = useState<number | null>(null);

  if (options.length === 0) {
    // § 12 "SELECT WITH AN EMPTY OPTIONS ARRAY" — same shape as the unrecognised-method card: the
    // user can't answer, but the extension is blocked until they dismiss it. Cancel is both the
    // § 07 initial-focus target and the dismissing control — the only control there is.
    const cancel = controlOverride(entry, pressedIndex === 0);
    return (
      <>
        <Title text={title} />
        <p className={styles.emptyOptionsNote}>The extension offered no options.</p>
        <div className={styles.controls}>
          <Button
            ref={(el) => {
              primaryRef.current = el;
              dismissRef.current = el;
            }}
            size="xs"
            variant="secondary"
            onClick={() => {
              setPressedIndex(0);
              onSubmit({ cancelled: true });
            }}
            {...cancel}
          >
            Cancel
          </Button>
        </div>
      </>
    );
  }

  const layout = optionLayout(options);
  return (
    <>
      <Title text={title} />
      <div
        className={clsx(
          styles.controls,
          layout.mode === "stack" && styles.controlsStack,
          layout.scrolls && styles.controlsScroll,
        )}
      >
        {options.map((option, i) => (
          // Duplicate labels are legal and never deduped/ordinal'd (§ 12) — index-only key.
          // No dismissing control exists for a populated select (§ 07's "N/A" case) — only the
          // first option takes the § 07 initial-focus ref.
          <Button
            key={i}
            ref={
              i === 0
                ? (el) => {
                    primaryRef.current = el;
                  }
                : undefined
            }
            size="xs"
            variant="secondary"
            className={styles.optionButton}
            onClick={() => {
              setPressedIndex(i);
              onSubmit({ value: option });
            }}
            {...controlOverride(entry, pressedIndex === i)}
          >
            {option}
          </Button>
        ))}
      </div>
    </>
  );
}

function ConfirmBody({
  entry,
  payload,
  onSubmit,
  primaryRef,
  dismissRef,
}: {
  entry: AgentUiPendingEntry;
  payload: Record<string, unknown>;
  onSubmit: (response: AgentUiResponse) => void;
  primaryRef: RefObject<HTMLElement | null>;
  dismissRef: RefObject<HTMLElement | null>;
}) {
  const title = readString(payload, "title") ?? "";
  const message = readString(payload, "message");
  const parts = confirmPromptParts(title, message);
  const [pressed, setPressed] = useState<"yes" | "no" | null>(null);

  return (
    <>
      <div className={clsx(styles.title, parts.message && styles.titleEmphasised)}>
        {parts.title.join("\n")}
      </div>
      {parts.message && <div className={styles.message}>{parts.message.join("\n")}</div>}
      <div className={styles.controls}>
        <Button
          ref={(el) => {
            primaryRef.current = el;
          }}
          size="xs"
          variant="default"
          onClick={() => {
            setPressed("yes");
            onSubmit({ confirmed: true });
          }}
          {...controlOverride(entry, pressed === "yes")}
        >
          Yes
        </Button>
        <Button
          ref={(el) => {
            dismissRef.current = el;
          }}
          size="xs"
          variant="secondary"
          onClick={() => {
            setPressed("no");
            onSubmit({ confirmed: false });
          }}
          {...controlOverride(entry, pressed === "no")}
        >
          No
        </Button>
      </div>
    </>
  );
}

function InputBody({
  entry,
  payload,
  onSubmit,
  primaryRef,
}: {
  entry: AgentUiPendingEntry;
  payload: Record<string, unknown>;
  onSubmit: (response: AgentUiResponse) => void;
  primaryRef: RefObject<HTMLElement | null>;
}) {
  const title = readString(payload, "title") ?? "";
  const placeholder = readString(payload, "placeholder");
  const [value, setValue] = useState("");
  // `input` has exactly one submit control, and the SDK deliberately never retains its answer
  // (`agent-ui-state.ts`'s `answerFromResponse`) — `submitting` alone identifies it as pressed.
  const submit = controlOverride(entry, entry.submitting === true);
  const busy = submit.disabled === true || submit.loading === true;

  return (
    <>
      <Title text={title} />
      <div className={styles.controls}>
        <TextInput
          ref={(el) => {
            primaryRef.current = el;
          }}
          className={styles.field}
          value={value}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
          // § 07 "Enter submits the focused card's primary action" — a bare `<input>` (no `<form>`)
          // does nothing on Enter by itself, unlike a focused `<button>`, so this is the one field
          // that needs an explicit key handler for the *submit* half (Esc is handled at the card).
          onKeyDown={(e) => {
            if (e.key !== "Enter" || busy) return;
            e.preventDefault();
            e.stopPropagation();
            onSubmit({ value });
          }}
        />
        <Button size="xs" variant="default" onClick={() => onSubmit({ value })} {...submit}>
          Submit
        </Button>
      </div>
    </>
  );
}

function EditorBody({
  entry,
  payload,
  onSubmit,
  primaryRef,
  dismissRef,
}: {
  entry: AgentUiPendingEntry;
  payload: Record<string, unknown>;
  onSubmit: (response: AgentUiResponse) => void;
  primaryRef: RefObject<HTMLElement | null>;
  dismissRef: RefObject<HTMLElement | null>;
}) {
  const title = readString(payload, "title") ?? "";
  const prefill = readString(payload, "prefill") ?? "";
  const [value, setValue] = useState(prefill);
  // Editor has two controls (Submit/Cancel) that both resolve through the same `submitting` flag
  // with no SDK field distinguishing which was clicked (`answerFromResponse` never retains an
  // editor answer) — local state is the only way to put the spinner on the one actually pressed.
  const [pressed, setPressed] = useState<"submit" | "cancel" | null>(null);

  return (
    <>
      <Title text={title} />
      <TextArea
        ref={(el) => {
          primaryRef.current = el;
        }}
        className={styles.editorField}
        rows={3}
        value={value}
        disabled={!entry.answerable || entry.submitting}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          setValue(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, EDITOR_MAX_HEIGHT_PX)}px`;
        }}
        // § 07 "In the editor's multi-line field Enter inserts a newline and the hint reads
        // `⇧↵ submit` instead of `↵ submit`" — bare Enter is left alone (the textarea's own
        // default), only the modifier chord is intercepted.
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey !== submitKeyClaimsShift(entry.method)) return;
          e.preventDefault();
          e.stopPropagation();
          setPressed("submit");
          onSubmit({ value });
        }}
      />
      <div className={styles.controls}>
        <Button
          size="xs"
          variant="default"
          onClick={() => {
            setPressed("submit");
            onSubmit({ value });
          }}
          {...controlOverride(entry, pressed === "submit")}
        >
          Submit
        </Button>
        <Button
          ref={(el) => {
            dismissRef.current = el;
          }}
          size="xs"
          variant="secondary"
          onClick={() => {
            setPressed("cancel");
            onSubmit({ cancelled: true });
          }}
          {...controlOverride(entry, pressed === "cancel")}
        >
          Cancel
        </Button>
      </div>
    </>
  );
}

function UnrecognisedBody({
  entry,
  method,
  payload,
  onSubmit,
  primaryRef,
  dismissRef,
}: {
  entry: AgentUiPendingEntry;
  method: string;
  payload: Record<string, unknown>;
  onSubmit: (response: AgentUiResponse) => void;
  primaryRef: RefObject<HTMLElement | null>;
  dismissRef: RefObject<HTMLElement | null>;
}) {
  const raw = { method, ...payload };
  // Single Cancel control — `submitting` alone identifies it as pressed, same reasoning as `input`.
  // It is both the § 07 initial-focus target and the dismissing control, same as empty-`select`.
  const cancel = controlOverride(entry, entry.submitting === true);
  return (
    <>
      <p className={styles.title}>
        This extension asked something this version of Pi-Studio can't display.
      </p>
      <pre className={styles.rawPayload}>{JSON.stringify(raw, null, 2)}</pre>
      <div className={styles.controls}>
        <Button
          ref={(el) => {
            primaryRef.current = el;
            dismissRef.current = el;
          }}
          size="xs"
          variant="secondary"
          onClick={() => onSubmit({ cancelled: true })}
          {...cancel}
        >
          Cancel
        </Button>
      </div>
    </>
  );
}
