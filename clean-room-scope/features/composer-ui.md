# Composer UI — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [workspace-ui.md](workspace-ui.md), [timeline-rendering.md](timeline-rendering.md),
> [agent-sessions.md](agent-sessions.md), [agent-providers.md](agent-providers.md),
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md)

> **Render stack:** Pi-Studio implements this UI on a **React 19 + Vite DOM** stack (web + Electron
> only), not React Native. The composer input is a DOM `<textarea>`/contenteditable; voice uses the Web
> Audio API + `MediaRecorder`. Behavior/contracts below are medium-independent; for concrete libraries
> see [../architecture/design-system.md](../architecture/design-system.md) § UI technology stack and
> [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md) § Platform rules.

## Purpose

Defines the message composer surface: its layout/regions, the submit/queue decision logic and optimistic
UI, the slash-command & file-mention autocomplete, the provider/model/mode/feature controls, attachments
(images + GitHub + workspace), dictation (speech-to-text), the realtime voice agent, and the composer
keyboard shortcuts. The composer is embedded inside the agent/draft panel (see
[workspace-ui.md](workspace-ui.md) § Composer integration) and is also used by the new-workspace screen
(see [app-navigation-screens.md](app-navigation-screens.md)).

## Public Contract

### Region map (top→bottom)
1. **Attachment lightbox** (full-screen image viewer, opened from an image pill).
2. **Input area** (centered, max-width 820, min-height 75): a **queue track** (pending queued messages), a
   **send-error** line, and the bordered **input surface** with an anchored **autocomplete popover** and a
   GitHub picker anchored to the attach button.
3. **Footer** (optional caller node + an inline context-window meter on compact).

The bordered input surface (`surface1`, soft accent border, large radius) is a column:
1. **Attachment tray** (pills, inside the border, above the text).
2. **Text input** (auto-resizing multiline) + web scrollbar overlay + a web focus hint.
3. **Button row**: left group = attach (`+`) button + agent controls (provider/model/mode/thinking/
   features); right group = context-window meter slot (desktop) → voice/dictation button → realtime-voice
   toggle + cancel/stop → send button.
4. **Overlay layer** (absolute, fades in over the faded input): the dictation overlay or the realtime-voice
   overlay; while visible the text input is non-editable.

Buttons are 28×28 circular; icon size md on web / lg on native. Min text height 46 (web) / 30 (native);
max = `max(160, floor(windowHeight*0.5))`. Placeholder: long form on desktop ("Message the agent, tag
@files, or use /commands and /skills"), short on compact.

## Behavior & Algorithms

### Sendable content & the submit decision
Content is sendable when trimmed text is non-empty OR there is ≥1 attachment OR there is external content.
The submit decision returns one of:
- **noop** — nothing to send, or no send transport (`canSubmit` false).
- **queued** — agent running and not force-send: enqueue per-agent; clear input unless "preserve-and-lock".
- **submitted** — clear input immediately (optimistic), clear send error, set processing, await send, then
  clear the draft as "sent".
- **failed** — on throw, restore text + attachments, show the send error, clear processing.

`submitBehavior`: `clear` (default) or `preserve-and-lock` (keep input filled and dim the composer while a
caller-owned loading state is true).

### Create vs continue (who sends)
The composer prefers an injected `onSubmitMessage` (caller-managed: create-agent / draft / new-workspace
flows). Otherwise it uses the internal send path which: separates images vs review/GitHub attachments,
generates a message id, appends an **optimistic user message** to the stream head immediately, encodes
images, and sends to the daemon. `canSubmit` is true if either a caller submit or the internal send exists
(caller-managed submits stay valid even when disconnected — the caller owns the failure mode). Caller-managed
flows must do their own optimistic UI.

### Queue (agent running)
Default action interrupts or queues per the user's "default send behavior" setting. Queued messages are
stored per-agent `{ id, text, attachments }` and listed in the queue track with **Edit** (remove +
reload into the composer) and **Send now** (remove + submit immediately; the daemon atomically interrupts
the active run; on failure re-insert at the **front** + show error). On desktop, `Cmd/Ctrl+Enter` performs
the *opposite* of the default (interrupt↔queue).

### Text input
Controlled multiline that auto-grows (native content-size; web height-mirror) between min/max with scroll
past max. Cursor/selection is tracked to detect the active `/command` or `@file` token. Non-editable while
dictating / in voice mode / disabled. Web-only: a focus hint when the pane is focused but the empty input
isn't; auto-focus (web, desktop breakpoint) via focus-with-retries. Native never programmatically focuses.

### Slash-command & file-mention autocomplete
A single popover with two modes:
- **Command mode** detects a `/token` (line-leading "start" vs mid-text "inline" `/skill`). Lists merge
  client slash commands (root only) with provider commands (debounced query, ranked/filtered); inline shows
  only provider commands. In a draft (no agent yet) only provider commands list. Each option: `/name`,
  description, argument hint.
- **File mode** detects an `@token`; debounced (~180ms) directory suggestions from the daemon
  (`{ cwd, query, limit, includeFiles, includeDirectories }`); options `{ path, kind }`. File mode wins
  when both could match.
- **Selection:** an immediate client command (and no attachments) invokes it directly instead of inserting
  text; otherwise replace the active token with `/name ` or the chosen relative path, then refocus.
- **Keyboard:** the popover consumes arrows/enter/escape first (preventing the default submit); escape on a
  leading command clears the input.
- **Client slash commands:** `/exit` (aliases quit, q → archive current agent) and `/clear` (alias new →
  archive + start fresh draft), both immediate, only when there are no attachments and the text is exactly
  `/word`. Running one clears the draft + input + attachments and invokes the caller's slash handler.

### Provider / model / mode / feature controls
Two variants share one inner control: **live-agent** controls (read state from the session store + provider
snapshot; persist changes to preferences AND the daemon — set model / thinking / feature / mode; daemon
failures toast) and **draft** controls (fully prop-controlled).
| Control | Desktop | Compact |
|---------|---------|---------|
| Provider | badge → searchable combobox | (draft form only) |
| Model | combined model selector (favorites, per-provider rows, retry, loading) | selector with provider-icon + short model label |
| Thinking | brain-icon badge → levels combobox | brain-icon button → "Thinking" sheet |
| Features | inline per-feature toggle/select | single button → "Features" sheet |
| Mode | mode chip in the **toolbar** | mode control in the **footer** |
Feature icons map known ids to icons; active toggles tint by color. The mode chip shows the mode icon (from
the provider manifest) + label + chevron, opens a searchable combobox, and hides when no modes exist. See
[agent-providers.md](agent-providers.md).

### Create-agent preferences
Per-project, remembered defaults for **creating** a new agent (new-workspace screen and any fresh draft),
so a returning user doesn't have to re-pick provider/model/mode every time:
```ts
interface FormPreferences {
  provider?: string;
  providerPreferences?: Record<string, {
    model?: string;
    mode?: string;
    thinkingByModel?: Record<string, string>;   // remembers thinking level per model
    featureValues?: Record<string, unknown>;
  }>;
  favoriteModels?: { provider: string; modelId: string }[];  // pinned to the top of the model selector
  isolation?: "local" | "worktree";              // default workspace isolation for new agents
}
```
- Scoped per project (keyed by project key), stored client-side, and merged with (never overriding) an
  explicit per-request override (e.g. a pinned quick-launch profile — see
  [workspace-ui.md](workspace-ui.md) § Pinned quick-launch targets).
- `favoriteModels` surface as starred/pinned rows at the top of the combined model selector (see
  § Provider / model / mode / feature controls) regardless of provider grouping.
- Selecting a different provider/model/mode/thinking/feature value while creating an agent updates the
  matching `providerPreferences[provider]` entry so the next new agent for that project remembers it.

### Attachments
- **Types:** `image`, `github_issue`, `github_pr`, `browser_element`, `review`. Image metadata storage is
  platform-specific (web IndexedDB object-store key / desktop or native file path); bytes live in platform
  stores, metadata travels in drafts/messages. Workspace attachments (review, browser element) are merged
  with user attachments.
- **Add menu:** the `+` button opens a dropdown (desktop) or a bottom sheet (compact, with an iOS post-close
  delay): **Add image** (pick → persist → metadata) and **Add issue or PR** (GitHub picker).
- **Tray pills:** image (32×32 thumbnail; tap → lightbox; × removes), GitHub (`#n title` + PR/issue icon;
  tap → external URL), workspace (review/browser). Disabled when the composer is locked.
- **Open/remove:** image → lightbox; workspace → workspace opener; GitHub → external URL. Remove deletes
  image bytes and notifies GitHub auto-attach so it won't re-add.
- **Paste & drop:** web-only paste listener collects clipboard image files → attachments (disabled while
  disconnected/dictating/voice). The composer exposes its add-images function so an outer drop zone can
  inject images.
- **GitHub picker:** a searchable combobox (kept open on select) feeding a GitHub search query (enabled when
  open + connected + cwd present); toggling adds/removes. URLs typed in the message can auto-attach based on
  the checkout remote.

### Dictation (speech-to-text)
The mic button (left of the right group) controls dictation. Icon states: idle → mic; recording → square
(white on a red button); voice-muted → mic-off. Press: in voice mode → toggle mute; while dictating →
cancel; else → start. A **dictation overlay** replaces the input while recording/processing/failed, showing
volume + duration + status, with actions Cancel / Accept (insert transcript) / Accept & send (insert +
submit, interrupting a running agent), and on failure Retry (replay buffered audio) / Discard. Transcript
application: append to current text (with a space); if auto-send and default behavior is queue + running →
queue, else submit (force-send when running).

Streaming protocol: start → ordered base64 PCM chunks (bounded per flush) → finish (returns final text), or
cancel; buffers while disconnected and replays on reconnect with generation guards (avoid duplicate/out-of-
order chunks). Readiness gate: connected AND host directory ready AND not disabled AND the daemon advertises
the capability (else pressing toasts the reason).

### Realtime voice agent
Optional. Start with the audio-lines button (shown when not already in voice mode and the agent is idle;
cannot start while running). While in voice mode a **realtime-voice overlay** replaces the input (mute
state, switching spinner, stop button) and the mic button becomes a mute toggle. Runtime phases:
`disabled → starting → listening → submitting → waiting → playing → stopping`, with smoothed volume,
speaking flag, a "thinking" cue tone during waiting, ordered assistant-audio playback with acks, server
speech-detection barge-in (interrupt/clear playback), and keep-awake during voice. Stopping mid-turn
cancels the run.

### Keyboard shortcuts (composer-relevant)
`mod` = Cmd (mac) / Ctrl (else).
| Action | Binding | When | Effect |
|--------|---------|------|--------|
| Focus message input | `mod+L` | not command center | Focus the textarea |
| Send | `Enter` | input focused | Default send |
| Queue | `mod+Enter` | input focused | Alternate (queue/interrupt) action |
| Interrupt agent | `Escape` | not command center/terminal | Cancel running agent (or cancel dictation) |
| Toggle voice | `mod+Shift+D` | not command center/terminal | Start/stop realtime voice |
| Toggle dictation | `mod+D` | not command center/terminal | Toggle dictation (confirm+send if recording) |
| Mute/unmute voice | `Space` | not editing | Toggle realtime mute |

**Enter/newline (web, non-compact):** Enter submits, Shift+Enter newlines, `mod+Enter` queues when running;
IME composition is ignored; autocomplete consumes keys first. On compact web and native, Enter inserts a
newline (submit via button); iOS hardware keyboards submit on Enter. The composer registers a keyboard
handler gated on pane focus with higher priority when the input is focused (so the focused composer wins
among panes). No message-history (up/down recall) shortcut. `TODO(verify)`.

## Data & Persistence
- **Draft store:** per draft key `{ text, attachments }` with a lifecycle (`active`/`abandoned`/`sent`),
  hydrated on key change and autosaved on change (empty drafts cleared). See
  [persistence.md](../architecture/persistence.md) (`pi-studio-drafts` v2 + web attachment-bytes store).
- Per-agent queued messages live in the session store.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Send throws | Restore text + attachments; show send error (cleared on next edit) |
| Send-now (queued) fails | Re-insert at the front of the queue + show error |
| Agent running on submit | Queue or interrupt per the default behavior setting |
| Dictation/voice unavailable | Toast the capability reason; don't start |
| Reconnect mid-dictation | Restart the stream and replay buffered PCM (guarded) |
| Disconnected, caller-managed submit | Still allowed; the caller owns failure |

## Dependencies
- Pinned library versions: see [../architecture/design-system.md](../architecture/design-system.md) § UI technology stack.
- Internal: session store, provider snapshot, draft store, attachment stores, autocomplete + directory
  suggestions, GitHub search, dictation/voice runtimes, keyboard system, design system, per-project
  create-agent preferences store, pinned quick-launch targets.
- External: a multiline text input, audio capture (web Audio / native), clipboard (web paste).

## Acceptance Criteria
- [ ] Submitting sends a prompt; the optimistic user message renders before the round-trip and is later
      deduped by message id.
- [ ] When the agent is running, submit queues or interrupts per the setting; queued messages can be edited
      or sent-now (re-inserted at front on failure).
- [ ] The autocomplete popover lists `/commands` (client + provider) and `@files`, inserts the selection,
      and consumes arrow/enter/escape.
- [ ] Provider/model/mode/feature changes persist to preferences and the daemon (toast on daemon failure).
- [ ] Images attach via pick / paste / drop and round-trip through the platform attachment store; GitHub and
      workspace attachments attach and send.
- [ ] Dictation transcribes (with reconnect replay) and inserts/sends; realtime voice runs its phase machine
      with barge-in.
- [ ] Composer keyboard shortcuts behave per platform (Enter submits on desktop web; newline on compact/
      native).
- [ ] Creating a new agent for a project prefills provider/model/mode/thinking/features from that
      project's remembered create-agent preferences, and updates them when the user picks differently.
- [ ] Favorite models render pinned at the top of the model selector regardless of provider grouping.

## TODO(verify)
- [ ] Whether message-history recall exists anywhere.
- [ ] Exact outer drop-zone implementation (the composer only exposes add-images).
- [ ] Use of the `submitting` voice phase.
- [ ] Exact merge precedence between create-agent preferences and a pinned quick-launch profile when both
      apply.
