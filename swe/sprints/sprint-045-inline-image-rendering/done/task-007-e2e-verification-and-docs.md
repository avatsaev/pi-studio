# Task 007 — E2E browser verification + docs sync

- **Sprint:** sprint-045-inline-image-rendering
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001..006

## Goal
Prove the whole feature works against a real daemon and a real agent turn in a real browser, then bring
the affected `AGENTS.md` files and the scope doc in line with what shipped.

## Background / why
Every prior task verifies its own slice with unit tests and fakes. Nothing in this sprint has yet
exercised the actual chain: agent emits markdown → timeline finalizes the block → classification →
download token → binary frames → object URL → `<img>`. That chain crosses three packages and two
transport paths, so it gets its own verification task — the same pattern as sprint-043/t005 and
sprint-044/t010.

## Scope references
- `clean-room-scope/features/inline-image-rendering.md` § Acceptance Criteria (the full list — this task
  discharges it end to end)
- Root `AGENTS.md` § Protocol overview (capability flags), § Key invariants
- `packages/web-client/AGENTS.md`, `packages/server/AGENTS.md`, `packages/protocol/AGENTS.md`

## What to build
Nothing new. Verify, then document.

### E2E verification (the real proof)
Run the production daemon (`npm start`) and the web-client, with a workspace containing a real image.

1. **Agent-emitted, relative path.** Ask the agent to reference an existing image with markdown, e.g.
   "reply with exactly `![screenshot](./assets/shot.png)` and nothing else". Confirm the image renders
   inline once the block finalizes, at column width, aspect ratio intact.
2. **Absolute + tilde.** Repeat with `/abs/path/shot.png` and `~/shot.png`. The tilde case is the one
   task-001 unblocked — it would have failed with `not_found` before.
3. **Remote.** `![x](https://…/a.png)` renders with no daemon traffic (check the WS frames in devtools:
   no `file_download_token_request`).
4. **Missing file.** `![gone](nope.png)` shows the text fallback, not a broken-image glyph, and issues
   no retry loop.
5. **Non-image extension.** `![doc](README.md)` shows the text fallback with no download.
6. **Streaming.** Watch a turn stream in: no image request fires until the assistant block finalizes.
7. **Virtualization + cache.** Scroll the image far out of view and back: it reappears immediately and
   devtools shows **no** second download. Reference the same image in two separate turns: one download
   total.
8. **Click-through.** Click a rendered image → a file tab opens on the image viewer.
9. **Instruction, positive.** Create a fresh chat from the browser, then inspect
   `$PI_STUDIO_HOME/agents/<sanitized-cwd>/<agentId>.json` and confirm `config.systemPrompt` carries the
   instruction block. Ask the agent (unprompted about syntax) to show you a screenshot it just took and
   confirm it reaches for markdown image syntax on its own.
10. **Instruction, negative.** Create a chat via `pi-studio run` (CLI, `clientType: "cli"`, no
    capability) and confirm its record has no instruction.
11. **Restart persistence.** With a browser-created agent idle, restart the daemon, send another
    message, and confirm the resumed process still has the instruction (task-005's fix; check the spawn
    argv via `PI_STUDIO_LOG_LEVEL=debug` or the process table).
12. **Reasoning row.** Confirm a relative image path appearing in a thinking block is not fetched.

Record any deviation in the summary rather than quietly adjusting the acceptance criteria.

### Docs sync (required, same change — root `AGENTS.md` rule)
- **`packages/web-client/AGENTS.md`** — source-layout entries for `lib/paths.ts`,
  `lib/inline-image-cache.ts`, `hooks/use-inline-image.ts`, `timeline/image-src.ts`,
  `timeline/InlineImage.tsx`; the `Markdown` component's new `assetBase` prop; the advertised
  `inline_image_markdown` capability; and a note on why inline images use a module-scoped ref-counted
  cache instead of TanStack Query (so nobody "fixes" it later).
- **`packages/server/AGENTS.md`** — `files/resolve-path.ts` as the single `~`-expansion helper (and the
  removal of the six inline copies), `agent/inline-image-instructions.ts`, `handleCreate`'s new session
  parameter, `Begin`-frame `mimeType`, and the create-vs-resume `appendSystemPrompt` agreement.
- **`packages/protocol/AGENTS.md`** — the new `CLIENT_CAPS.inline_image_markdown` entry.
- **Root `AGENTS.md`** — § Protocol overview's capability mention if it enumerates client caps; leave
  everything else alone.
- **`clean-room-scope/features/inline-image-rendering.md`** — resolve its two `TODO(verify)` items with
  what was actually decided (whether `MarkdownFileViewer` got an asset base; that the tilde
  consolidation landed here in task-001), and correct any § that drifted from the implementation.

## Out of scope
- New features or polish discovered during verification — file them as follow-ups in the summary, do not
  implement them here.
- Reformatting doc sections unrelated to this sprint.
- `clean-room-scope/features/timeline-rendering.md` beyond the cross-links already added when the scope
  was written.

## Acceptance criteria
- [ ] All 12 verification steps above pass and are reported with observed results (not just "done").
- [ ] Every checkbox in the scope's § Acceptance Criteria is discharged or explicitly explained.
- [ ] `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`, and `npm run fmt:check` all pass
      at the repo root.
- [ ] The four `AGENTS.md` files and the scope doc are updated in this change, with no aspirational
      claims — only what the code does now.
- [ ] No `TODO`, stub, or dead re-export shim is left behind from tasks 001-006 (in particular: no
      `watchTargetPath` alias, no second `~`-expansion copy).

## Test / verification plan
- Full suite: `npm test` at the root.
- Build: `npm run build` (all packages, dependency order).
- Browser: drive the real UI as described above; capture a screenshot of a rendered inline image for the
  summary.
- Grep checks: `watchTargetPath` → 0 hits; `homedir(), .*slice(1)` in `packages/server/src` → 0 hits.

## Notes
- Step 9's "does the agent reach for it unprompted" is the only subjective check. If the model does not
  take the hint, report the instruction text used and treat rewording as a follow-up rather than
  expanding scope — the mechanism (prompt reaches the process) is what this sprint owns.
- Steps 7 and 11 are the two that no unit test can cover and the two most likely to be quietly broken;
  do not skip them.
