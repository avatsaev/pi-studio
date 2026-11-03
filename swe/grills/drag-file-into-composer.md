# Grill — Drag a file/folder from the Files sidebar into the composer

> Status: grilled
> Started: 2026-11-03   Last updated: 2026-11-03   Rounds: 5
> Engineer: avatsaev   Agent: pi

## Raw idea
"i would like to be able to drag and drop a file/folder from the right sidebar into the compose and when it's dropped i would like its relative path to be substituded in the composer at the current cursor position"

## Codebase context
| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Files tree row drag source | `packages/web-client/src/features/files/FileExplorer.tsx` (`handleDragStartRow`), `TreeNode.tsx` | Rows are native draggables. Payload carries `MOVE_MIME` (row move) always, plus `EXTERNAL_DRAG_MIME.path` (absolute path) **for files only** — a directory carries no open payload because there is no directory tab. Root row is not draggable. |
| External drag transport | `features/workspace/external-drag.ts` | One MIME per kind; `dataTransfer.types` alone discriminates mid-drag (values unreadable until `drop`). `ExternalDragKind = "chat" \| "path"`. Timeline `FileLink`/`InlineImage` also emit the `path` kind via `pathDragStartHandler`. |
| Pane drop host | `hooks/use-external-pane-drop.ts`, `features/workspace/TabPanelHost.tsx` | A host-level `onDragOver/onDrop` over the whole pane area hit-tests `[data-pane-drop]` zones by measurement. The composer sits inside a chat pane body, so **today a drop on the composer is a pane drop** (open file tab / split on edges). The composer must win without breaking this. |
| Composer | `features/chat/Composer.tsx` | Plain `<textarea>` (`TextArea`) over a transparent `.highlightLayer` mirror (slash-command chip) — AGENTS.md forbids swapping it for a rich editor. Draft lives in `stores/draft-store.ts` (`drafts[sessionId]`, `setDraft`). Caret read via `el.selectionStart` already (keydown). `readOnly` while compacting. Existing `handlePaste` handles images only. |
| Path helpers | `lib/paths.ts` | `relativeToRoot(path, root)` (returns `path` unchanged if not under root), `resolveWorkspacePath`, `dirOf`. Tree rows hold **absolute** paths. |
| Cwd/workspace | `stores/session-store.ts` (`session.cwd`), `open-chat-tab.ts` | Chat tab's `workspaceCwd = normalizeCwd(session.cwd)`; sidebar browses `activeWorkspaceCwd`. Root invariant 7: `~` in a cwd is daemon-expanded; client must use `server_info.homeDir`. |
| Existing attachments | `Attachments.tsx`, composer `+` button | Images only (base64). No file-path/reference concept in the composer today. |

## Problem & outcome
- **Who:** user composing a prompt to the agent who wants to reference a file/folder in the workspace.
- **Today:** must type or paste the path by hand (no @-mention, no path insertion); dragging a row onto the composer opens a file tab / splits the pane instead.
- **Done means:** dropping a Files-tree row onto the composer inserts its workspace-relative path at the caret.
- **Measured by:** the acceptance criteria below plus manual smoke; no telemetry (confirmed, round 5).

## Goals
- Drop a file or folder row from the Files tree onto the composer; its relative path is inserted at the caret.

## Non-goals
- Drag sources other than the Files tree (Changes tab rows, timeline file links) in v1 — see Deferred (D2).
- Rich/chip rendering of the inserted path; the composer stays a plain textarea (D1).
- Inserting file *contents* or attaching the file; this inserts text only.
- Multi-row drag: the Files tree has a single selection (`useExplorerStore.selected`) and one draggable row at a time.
- OS-file / image drops onto the composer (the `+` button and paste remain the image paths).

## Happy path
1. User drags a row in the Files tree (right sidebar).
2. Hovers anywhere over the composer card — the card takes the accent focus-ring style (reduced-motion safe); the pane's open/split preview does not appear (D4, D12).
3. Drops — the workspace-relative path (folders with trailing `/`, backtick-wrapped only if it contains whitespace/backtick) replaces the textarea's current selection / is inserted at its last caret, with smart spacing: a leading space only if the preceding char is non-whitespace, a trailing space unless the next char is whitespace (D1, D3, D6, D7, D13).
4. Textarea gains focus with the caret just after the inserted text; one Ctrl/Cmd+Z removes exactly the dropped path (D11, D12).

## Decisions
| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | Inserted text | Bare workspace-relative path followed by one trailing space; no `@`, no backticks | Literally what was asked; no verified Pi `@` semantics over RPC | 1 |
| D2 | scope | v1 drag sources | Files tree only (files **and** folders) | Smallest change; tree is the stated source | 1 |
| D3 | ux | Caret semantics | Textarea's own last caret/selection (`selectionStart`/`End`), even when blurred; selection is replaced | Simple, predictable; no caret-from-point math over the mirror layer | 1 |
| D4 | ux | Drop zone | Whole composer card; composer pre-empts the pane open/split drop while the pointer is over it | Big forgiving target; no mixed toolbar behaviour | 1 |
| D5 | integration | How the composer receives a row | New third external-drag kind `ref` with its own MIME, set on **every** tree row (files and folders); only the composer reads it | Leaves pane open/split, row-move and timeline links untouched; a folder never previews a bogus split | 2 |
| D6 | ux | Folder text | Trailing slash (`src/features/files/`) | Marks a directory for user and model | 2 |
| D7 | ux | Whitespace / odd characters | Bare by default; wrap in backticks **only** when the path contains whitespace or a backtick | One token for the model; small deliberate exception to D1 | 2 |
| D8 | edge | Path outside the session's workspace root, or root unresolvable | Refuse the drop: insert nothing, show a brief inline notice | Every inserted path is truly relative and never starts with `/`, so the slash menu cannot misfire | 2 |
| D9 | state | Drop while compacting (`readOnly`) | Inert: no hover affordance, nothing inserted, and it does NOT fall through to the pane open/split | Matches paste's compacting no-op; `ref` is never a pane action | 3 |
| D10 | state | Drop while a turn is running (steer mode) | Allowed, identical to idle | Typing is already allowed mid-turn | 3 |
| D11 | ux | Undo | Native undo preserved: insert via the browser's text-insertion path (`execCommand('insertText')`) with a `setRangeText` + draft-store-write fallback; one Ctrl/Cmd+Z removes exactly the dropped path | Controlled textarea rewritten from the store would otherwise lose the undo stack | 3 |
| D12 | ux | Hover feedback + focus | Accent outline on the card while a `ref` drag is over it; no extra label. After drop: focus the textarea, caret just after the inserted text | Reuses the card's existing focus-ring language; keeps typing flow; avoids a new element beside the mirror layer | 3 |
| D13 | ux | Spacing around the insertion | Smart spacing: leading space only if the char before the caret is non-whitespace (none at start of draft/line); trailing space unless the next char is already whitespace. Refines D1's "one trailing space" | Always yields a separate token without doubled spaces | 4 |
| D14 | scope | Non-drag access | Existing tree "Copy Relative Path" + paste is the v1 alternative; no "Insert into composer" menu item. The copy item's output (no trailing `/`, no backtick rule) intentionally differs from the drop text | Avoids a "which composer?" rule across split panes | 4 |
| D15 | rollout | Flag / kill switch | Always on; no capability flag, no `viewer-settings` row | Pure client-side change; rollback = release revert | 4 |
| D16 | ux | slash-menu after a drop | The inserted text flows through the same change handling as typing: the menu state is recomputed from the new draft (`shouldOpenMenu`), so a drop after a partial `/co` becomes `/co src/x ` and the menu closes; the command highlight mirror updates; textarea autosizes | Reuses existing logic; D8 guarantees no inserted path starts with `/` | 4 |
| D17 | ux | refusal notice (D8) | Reuse the composer's existing inline error line (`pickError`, `styles.inlineError`), cleared on the next edit, like `/compact` failures | No new UI element | 4 |
| D18 | ux | drag lifecycle | Hover outline clears on drag-leave (same `relatedTarget` containment guard as the Files tree/pane host), drag-end, drop, and Escape-cancel; only a `ref`-kind drag lights it up | Matches the established guard; chat/path kinds keep their pane behaviour over the composer | 4 |

## Data & state
- No new persisted state and no protocol/daemon change: a client-side drag payload plus a `draft-store` write (`drafts[sessionId]`).
- New drag kind `ref` in `external-drag.ts` (`ExternalDragKind`, `EXTERNAL_DRAG_MIME`): carries the row's absolute path (D5) and must also convey whether the row is a directory so the composer can add the trailing `/` (D6) — encoding left to plan (see Open questions).
- Relative path = `relativeToRoot(absolutePath, root)` where `root` is the composer session's workspace root, `~`-expanded with `server_info.homeDir` (root invariant 7). Not under root / unresolvable → refuse (D8).

## Integration points
| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `FileExplorer.handleDragStartRow` | Sets the new `ref` payload on every row, folders included (D5) | writes | Existing `MOVE_MIME` / `path` payloads and `effectAllowed` must keep working; `effectAllowed` must cover the composer's drop effect |
| `use-external-pane-drop.ts` / `TabPanelHost` | Composer drop must pre-empt the pane drop | reads | Host handler currently owns the whole pane area |
| `Composer.tsx` + `draft-store.ts` | Insert at caret, restore caret, autosize | writes | Highlight mirror, slash-menu state, `readOnly` while compacting |
| `lib/paths.ts` | Absolute → relative | reads | Out-of-workspace paths; `~` roots |

## Edge cases & failure modes
| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | Path contains whitespace or a backtick | Wrap in backticks | D7 |
| inputs | Dropped row is a directory | Trailing `/` | D6 |
| identity & access | n/a — local-first single user; no new data crosses a trust boundary (path text only) | | |
| state | Path not under the session's workspace root / root unresolvable | Refuse with inline notice | D8 |
| state | Textarea has a selection | Selection is replaced | D3 |
| state | Composer compacting (`readOnly`) | Inert drop, no affordance, no pane fall-through | D9 |
| state | Turn running | Insert as when idle | D10 |
| state | Ctrl/Cmd+Z after drop | Removes exactly the dropped path | D11 |
| inputs | Caret touching a word / selection spanning text / empty draft | Smart spacing; selection replaced; no leading space on empty draft | D13, D3 |
| inputs | Very long path | Inserted verbatim; textarea autosizes up to its existing max height then scrolls | — |
| inputs | Duplicate drop of the same row | Inserts again — each drop is an independent edit | — |
| state | Slash menu open (draft like `/co`) | Menu recomputed from new draft (closes once whitespace is inserted) | D16 |
| state | Other drag kinds (`chat`, `path`) released over the composer | Unchanged: still a pane open/split | D4, D18 |
| timing | Drag cancelled / pointer leaves the card | Affordance cleared; nothing inserted | D18 |
| timing | `homeDir` not yet known when session cwd is `~` | Root unresolvable → refuse | D8 |
| timing | `set_editor_text` effect replaces the draft right after a drop | Last write wins; not coordinated (n/a — extension-driven, rare) | — |
| scale | one vs thousands | n/a — one path string per drop, no pagination | |
| dependencies | external service down / contract drift | n/a — no daemon or network call; no protocol change | D15 |
| data lifecycle | existing drafts / migration / retention | n/a — drafts are in-memory only (`draft-store.ts` has no persistence); no migration | |
| observability & ops | logging / flag / rollback | n/a — no logging of path text; no flag; rollback = revert | D15 |

## Non-functional constraints
| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | One string insertion per drop; no I/O, no RPC. `dragover` handler must stay cheap (a `types` check + a class toggle, state set only on change) |
| Security & authorization | None new. Path text is derived from the tree's own rows; no file contents are read or sent by the drop itself. Existing daemon file authz is unchanged |
| Privacy | The relative path becomes part of the prompt sent to the model *only when the user sends it* — same as typing it. Do not log path text |
| Backward compatibility | Client-only; no wire/protocol/daemon change, works against any daemon version. Existing `MOVE_MIME` and `path` payloads and pane drops unchanged |
| Rollout / feature flag | Always on (D15) |
| Observability | None (no path text in logs) |
| Rollback | Revert the release; nothing persisted |

## Deferred
- Drag from Changes tab rows (needs a new drag source in `ChangesPanel`) — D2.
- Drag from timeline `FileLink`/`InlineImage` into the composer (already emit the path payload; out-of-workspace paths unresolved) — D2.
- "Insert into composer" tree context-menu action as a keyboard/menu alternative to dragging (needs a "which composer?" rule across split panes) — D14.
- Aligning the context menu's "Copy Relative Path" output with the drop text (trailing `/`, backtick rule) — D14.

## Open questions — TODO(verify)
- [ ] How the composer learns "is a directory" at drop time (needed for D6) — e.g. carry it in the `ref` payload value. Non-blocking implementation detail — owner: implementer (plan).
- [ ] Spike: `execCommand('insertText')` inside a native `drop` handler on the controlled `TextArea` — needs the textarea focused with the selection set first, and must fire React's `onChange`; verify Chrome, Firefox, Safari, with the documented fallback (D11) — owner: implementer (plan).

## Acceptance criteria
(Observable and testable; `scope` carries these into the sub-spec, `plan` into tasks.)
- [ ] Given a file row in the Files tree and a composer with text, when I drop the row onto any part of the composer card, then its workspace-relative path is inserted at the textarea's last caret with smart spacing (D1, D3, D13), the textarea is focused with the caret after the inserted text, and no file tab opens and no pane splits (D4, D12).
- [ ] Given a folder row, when dropped, then the inserted text ends with `/` (D6); given a path containing whitespace or a backtick, then it is wrapped in backticks, and no other path is (D7).
- [ ] Given a selection in the textarea, when I drop a row, then the selection is replaced (D3); given an empty draft, then there is no leading space (D13).
- [ ] After a drop, one Ctrl/Cmd+Z removes exactly the dropped text and nothing typed earlier (D11).
- [ ] Given a partial slash command `/co` with the menu open, when I drop a row, then the draft becomes `/co <path> ` and the menu closes (D16).
- [ ] Given the composer is compacting, when I hover/drop a row, then no outline shows, nothing is inserted, and no tab opens or pane splits (D9).
- [ ] Given a turn is running, when I drop a row, then it inserts exactly as when idle (D10).
- [ ] Given a path not under the session's workspace root (or an unresolvable `~` root), when dropped, then the draft is unchanged and the inline notice shows until the next edit (D8, D17).
- [ ] The composer outline appears only for tree-row drags, and clears on leave, drag-end, drop, and Escape (D12, D18).
- [ ] Regression: dropping a file row on a pane body outside the composer still opens/splits as before; a chat row or a timeline file link released over the composer still behaves as a pane drop (D4); row-to-row move and OS-file upload in the Files tree still work (D5).
- [ ] No daemon, protocol, or capability-flag change is required; works against any daemon version (D15).

## Round log
| Round | Theme | Summary |
|-------|-------|---------|
| 1 | problem/scope/happy path | Settled insert format (D1), sources (D2), caret (D3), drop zone (D4). Problem & outcome merged into scope: the idea was already concrete. |
| 2 | data / integration / edge cases (part 1) | New `ref` drag kind on every row (D5), folder trailing slash (D6), backtick-wrap on whitespace (D7), refuse outside root (D8). Undo question carried to round 3. |
| 3 | edge cases (part 2) | Compacting inert (D9), running allowed (D10), native undo preserved (D11), accent outline + focus after drop (D12). Multi-row drag and OS-file drops added to Non-goals. |
| 4 | edge cases (part 3) / non-functional | Smart spacing (D13), copy+paste as the non-drag path (D14), always on (D15). Agent-proposed D16–D18 put to the engineer in round 5. Checklist and NFR table filled. |
| 5 | acceptance / sign-off | Engineer confirmed D16–D18, the success measure (no telemetry), and the 11 acceptance criteria. Status → grilled. |

## Handoff to scope
| Spec file to produce | Fed by brief sections |
|----------------------|-----------------------|
| `features/composer-path-drop.md` *(project layout: `swe/features/`)* — **written** | Goals, Non-goals, Happy path, Decisions D1–D18, Edge cases, Acceptance criteria |
| *(folded into the feature spec's § Public contract 1–4)* — the `ref` kind, `FileExplorer` drag start, pane-drop host precedence | Data & state, Integration points, Non-functional constraints |

Pointers for `plan`: the two open implementation questions (directory flag encoding; `execCommand('insertText')` spike across Chrome/Firefox/Safari) each want an early task. Package AGENTS.md updates owed: `packages/web-client/AGENTS.md` (new drag kind, composer drop invariants).
