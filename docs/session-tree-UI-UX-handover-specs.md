# Session Tree Navigation — UI/UX Designer Handover

> Audience: UI/UX designer producing mockups. Self-contained — no codebase reading required.
> Engineering spec (for reference): `swe/features/session-tree-navigation.md`
> Companion feature already designed: `docs/fork-conversation-UI-UX-handover-specs.md` — read it
> first; this feature reuses its dialog/toast/confirm patterns and shares its visual vocabulary.
> Status: scoped. Ships in two phases (see § 2). Contact: engineering via this repo.

---

## 1. What the feature is (one paragraph)

Every conversation with the AI agent is stored as a **tree**, not a list. Each time a user rewinds
and tries a different prompt, the old path stays on disk as an abandoned branch and a new branch
grows from that point. This feature gives that tree a face: a **tree view** showing every branch
ever taken (with the current path highlighted), and — in Phase 2 — the ability to **click any
point in the tree and jump there**: the conversation rewinds/continues from that node, optionally
attaching an AI-written summary of the branch being abandoned so its context isn't lost.

**User mental model:** "show me the map of everywhere this conversation has been, and let me jump
to any point on it."

**How it differs from Fork** (the companion feature): Fork cuts a new, separate conversation from
an earlier message. Tree navigation moves around **inside the same conversation**, keeping all
alternatives together — and it can jump to *any* kind of entry (user message, assistant reply,
tool run), not just the user's own messages.

---

## 2. Two phases — design both, they ship separately

- **Phase 1 — look, don't touch.** The tree view renders read-only: browse the structure, see the
  active path, see labels. The only action is "Fork from here" on the user's own messages (reuses
  the already-designed fork confirm flow verbatim).
- **Phase 2 — jump.** Clicking a node navigates there, with a confirm step and an optional
  "summarize the abandoned branch" choice. Gated on an upstream engine change, so mockups should
  treat Phase 1 as a complete, shippable state — not a stripped Phase 2.

An older server may support Phase 1 but not Phase 2: the tree renders, jump actions simply don't
exist. Design the read-only state as first-class, not as everything-disabled.

---

## 3. Entry point

- **"Session tree…"** item in the conversation's existing **"⋮" overflow menu** (same menu that
  will hold "Fork from…").
- Opens the tree surface. The engineering default is a **dialog**, but this is explicitly open
  (§ 8 Q1): a tree wants width and height; a large modal, a slide-over side panel, or a full pane
  tab (the app already has a pane/tab system for files, git, terminal) are all acceptable
  proposals. Pick one and argue it.
- The tree is fetched fresh every time it opens (it can be stale seconds later if another window
  navigates); there is no live-updating requirement.

---

## 4. The tree surface — the core design problem

This is the one genuinely **novel surface** in the app: nothing existing to clone. Prior art: the
agent's terminal UI renders it as an indented ASCII tree —

```text
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ user: "Let's try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ user: "That worked..."   ← active leaf
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

— i.e., a vertical outline where branch points fan out as siblings. Mockups may keep that outline
metaphor or propose something better; requirements below are the invariants, not the layout.

### What every node row must show

| Element | Notes |
|---|---|
| **Kind icon** | Entry types: user message, assistant message, tool run, compaction, **branch summary** (AI-written note left behind by a navigation), model/thinking change, other. Users mostly care about user vs. assistant vs. "machinery" — the icon set can group the long tail |
| **Preview text** | Server-truncated to ~200 chars; clamp further to 1–2 lines in the row. Always real selectable text |
| **Timestamp** | Secondary; the app's dimmed-meta-line treatment fits |
| **Label chip** | Some nodes carry a user-set label (named checkpoints, set from the terminal UI). Display-only — no label editing in this feature |
| **Active-path + leaf marking** | The path from root to the current position must be unmistakable at a glance (the single most important visual job of this screen); the **leaf** (current position) gets an additional distinct marker |

### Structural cases to cover in mockups

- **Linear session (no branches)** — the most common case for web-only users, especially in
  Phase 1. Must look intentional, not broken: a single chain, no branch furniture noise.
- **Branchy session** — 2–4 branch points, nested; show how siblings at a fork point read.
- **Deep/large tree** — hundreds of nodes. The list scrolls (may be virtualized); consider initial
  scroll position at the active leaf. Fold/collapse of branches is optional (§ 8 Q3).
- **"Detached" group** — rare data-corruption case produces orphaned fragments; render them in a
  dimmed group at the bottom labeled "detached", visually quarantined from the main tree.

### Filter control

A compact control (segmented control / dropdown) cycling five view filters, mirroring the terminal
UI: **Default · No tools · User only · Labeled only · All**. Pure view filtering, resets each time
the tree opens (no persistence). "User only" is the headline mode — the tree collapses to just the
user's prompts, which is how most people will actually orient.

---

## 5. Phase 2 — the jump flow

### Node click → confirm step

The confirmation copy **differs by node type** (this mirrors exact engine semantics — don't merge
the two):

| Clicked node | Confirm dialog says | After success |
|---|---|---|
| A **user message** | "Rewind to before this message. Its text is placed in the composer for editing." + full preview of the message | Transcript truncates to before it; composer pre-filled (only if the composer was empty), focused |
| **Anything else** (assistant reply, tool run, …) | "Continue the conversation from this point." + preview | Transcript truncates to end at that node; composer untouched |
| The **root (first) user message** | Same as user message, plus the conversation becomes empty | Empty transcript; original first prompt in the composer |

Same non-negotiable safety property as fork: **the confirm step always shows the preview of the
exact node being jumped to.**

### Summary choice (part of the same confirm step)

When jumping abandons work, the user picks what happens to the abandoned branch — a three-option
radio group, default first:

1. **No summary** — just jump.
2. **Summarize the abandoned branch** — the AI writes a short recap and pins it at the
   destination, so context isn't lost.
3. **Summarize with instructions…** — reveals a one-line/textarea input for custom focus (e.g.,
   "keep the API decisions").

Design note: options 2–3 trigger an **AI call that can take tens of seconds**. The in-flight state
needs real presence: progress copy on the confirm button or a dedicated "Summarizing abandoned
branch…" state. No cancel affordance in MVP (engine limitation) — do not mock one.

### States to cover (Phase 2)

| State | Behavior |
|---|---|
| In-flight (no summary) | Fast; spinner on confirm button, dialog locked |
| In-flight (summarizing) | Long; explicit "summarizing…" treatment, dialog locked, no outside-click dismiss |
| Success | Dialog closes; transcript refreshes; composer per table above; **other open windows/devices refresh silently** (same convergence behavior as fork — same § open question about a subtle cue) |
| Clicked the node you're already on | Treated as success, nothing changes — fine to just close |
| Declined by an agent extension | Toast: "An extension declined the navigation." Nothing changes |
| Summary failed / aborted | Toast; **the jump did not happen** (engine guarantees nothing moved); dialog returns to idle for retry |
| Stale tree (someone else navigated meanwhile) | Toast + the tree refreshes in place; user re-picks |
| Agent busy (turn running) | Jump interactions disabled tree-wide; browsing still allowed. A visible hint ("agent is working — navigation disabled") beats silently-dead rows |

### Phase 1 actions (for completeness)

Only user-message nodes **on the active path** get a "Fork from here" action (context/hover action
on the row) → hands off to the already-designed fork confirm dialog. All other nodes: no actions,
browse only.

---

## 6. Components to reuse

| Need | Existing component |
|---|---|
| The surface shell | `Dialog` primitive (or `Panel` if you propose side-panel/pane — both exist) |
| Confirm + summary step | Same dialog-step pattern as the fork handover |
| Filter control | `Select` or a segmented variant of existing menu primitives |
| Row hover actions | `IconButton` xs (20px reserved-box hover-reveal) |
| Errors/notices | App-wide toast host |
| Empty/linear states | `EmptyState` primitive where applicable |

New visual vocabulary this feature is allowed to introduce (nothing existing covers it): the tree
connector/indentation system, branch-point treatment, active-path highlight, leaf marker, node-kind
icon set, label chip. Keep them consistent with the app's rail-and-disc timeline aesthetic (20px
rail, 18px discs, connector lines) — the transcript already draws vertical connector lines, and
rhyming with that will make the tree feel native.

---

## 7. Accessibility

- Full keyboard model: arrow-key traversal of visible nodes, Enter to select, Escape to close
  (except while in-flight). The terminal UI's model (↑/↓ rows, fold/unfold) is a reasonable
  reference, not a requirement.
- Tree semantics for screen readers (`role="tree"`/`treeitem`, `aria-expanded` if folding ships,
  `aria-current` on the leaf).
- Active-path highlighting may not rely on color alone (weight/marker/connector treatment too).
- Previews and summary text remain real text; the long "summarizing…" wait announces via the
  existing `aria-live` region.

---

## 8. Open design questions (your call — mock options where useful)

1. **Surface: modal dialog vs. slide-over panel vs. pane tab.** Trees want space; panes already
   exist in this app and would let the tree sit beside the transcript. Engineering has no
   preference; pick and justify.
2. **Compact/touch (< 500 px):** how does an indented tree degrade? Flattened list with
   breadcrumbs? Horizontal pan? This is the hardest layout question.
3. **Folding:** ship branch collapse/expand in v1, or rely on filters + scrolling? (Engineering
   cost of folding is low; it's purely a UX-complexity call.)
4. **Where the "you are here" orientation lives:** initial scroll to leaf, a mini-map, a "jump to
   current" button — pick the cheapest thing that keeps a 300-node tree navigable.
5. **Branch-summary node treatment:** these AI-written recap nodes are new content the user
   created via this very feature — should they read as quiet machinery or as first-class
   milestones?
6. **Convergence cue in other windows** (shared question with fork — answer once for both).

---

## 9. Out of scope — do not design

- Editing or removing labels (display-only; no engine API).
- Any file-restore implication — jumps affect **conversation memory only**; copy must never
  suggest files are reverted.
- Live-updating tree while open; cross-conversation trees (links between forked session files).
- Summary configuration/settings screens; cancel-during-summarization (engine limitation).
- Drag-to-rearrange or any tree mutation besides navigation.

---

## 10. Quick reference — existing visual vocabulary

(Shared with the fork handover; repeated here for standalone use.)

- Transcript: centered column, max 820 px; compact threshold 500 px container width.
- User messages: right-aligned accent-tinted bubbles (`color-mix(accent 20%, surface1)` fill,
  radius-lg); assistant output: left-flowing plain text on a 20 px rail with 18 px discs and
  vertical connector lines.
- Meta lines: dimmed 55%-opacity timestamps that brighten on row hover.
- Running turn: indeterminate 2 px accent bar at the top of the chat panel — the same signal that
  disables jump actions here.
- Toasts: app-wide bottom-anchored transient host. Dialogs: standard focus-trapped `Dialog`
  primitive with inline close.
