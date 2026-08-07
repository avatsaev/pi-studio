# Task 007 — E2E browser verification + docs sync — Summary

- **Sprint:** sprint-045-inline-image-rendering
- **Completed:** 2026-07-29
- **Status:** done, with an explicit, user-approved scope reduction (see below)

## Scope reduction (explicit, user-approved)

The user instructed, mid-session: **"in the task Task 007, skip the smoke tests, and proceed."**
This task's own § heading calls its 12-step manual browser plan **"the real proof"** — it is not
optional polish, it is this task's core deliverable. Per the user's explicit instruction it was
**not executed** this pass. This is recorded here and in
`clean-room-scope/features/inline-image-rendering.md`'s new "Verification status" note rather than
silently marked done. What follows is everything else task-007 asked for: docs sync, resolving the
scope doc's two `TODO(verify)` items, and the automated (non-browser) verification commands.

**What this means concretely:** the daemon + web-client were running locally during this session
(started in an earlier turn) and basic reachability was confirmed (`curl` 200/expected on both),
but the 12-step agent-turn-through-rendered-`<img>` walkthrough — steps 1-12 in the task file —
was not driven. Anyone relying on this feature working end-to-end in a live browser should run
that 12-step plan before depending on it; the mechanism is unit/integration-tested (see below) but
the full cross-package wire chain has not been empirically exercised this pass.

## What was done

### Docs sync
- **`packages/protocol/AGENTS.md`** — added `inline_image_markdown` to the `CLIENT_CAPS` table row
  (was already partially done in the tasks-004-006 pass; confirmed present, no further edit
  needed beyond what that pass added).
- **`packages/server/AGENTS.md`** — `resolve-path.ts`, `inline-image-instructions.ts`,
  `handleCreate`'s `wsSession` parameter + `effectiveConfig` composition, `Begin`-frame
  `mimeType`, and the create/resume `appendSystemPrompt` agreement were all already documented by
  the tasks-001/004-006 doc-sync passes earlier this session; verified present, no further edit
  needed.
- **`packages/web-client/AGENTS.md`** — the source-layout entries and the task-004/006 render/
  capability-gate prose were already present from the earlier pass. **This task added the one
  piece that was missing**: an explicit "why not TanStack Query" rationale in the inline-image
  invariant bullet (this package uses Query for every other piece of server data), so a future
  contributor doesn't "simplify" the cache onto Query and reintroduce the exact bug it was written
  to avoid (Query's `gcTime`-based retention has no notion of "keep alive because an unmounted
  sibling row still refers to this," and no eviction hook to revoke an object URL at the right
  moment).
- **Root `AGENTS.md`** — checked § Protocol overview; it describes capability flags only at the
  package-responsibility level ("capability flags" in the `protocol/` one-liner), it does not
  enumerate individual flag names anywhere. Nothing to change there, per the task's own "leave
  everything else alone" instruction.
- **`clean-room-scope/features/inline-image-rendering.md`**:
  - Resolved **TODO(verify) #1** (markdown file viewer asset base): **not implemented** in
    sprint-045. Verified directly against the code —
    `MarkdownFileViewer.tsx` calls `<Markdown text={query.data.content} />` with no `assetBase`,
    exactly matching the § Asset base table's existing "none in the initial scope" row. Recorded
    as a real, scoped follow-on (one-line change: pass `dirname(path)`), not a defect.
  - Resolved **TODO(verify) #2** (does the tilde consolidation land with this feature): **yes,
    task-001**, this sprint. `resolve-path.ts`'s `expandHome` replaced six duplicated inline `~`
    checks and closed the specific `file_download_token_request` asymmetry this scope doc calls
    out by name.
  - Added a **"Verification status"** note directly under the § Acceptance Criteria heading
    recording the scope reduction above, so the unchecked boxes are self-explanatory rather than
    looking like an oversight.

### Grep checks (task's own § Test/verification plan)
- `watchTargetPath` across the repo → **0 hits** (confirmed; the symbol never existed post
  task-002's rename to `resolveWorkspacePath`).
- `homedir\(\), .*slice\(1\)` (a manual/duplicated tilde-expansion anti-pattern) in
  `packages/server/src` → **0 hits**. Every remaining `homedir()` call is either
  `resolve-path.ts`'s own canonical implementation, a test importing it for scratch-file setup, or
  `bootstrap.ts`'s unrelated `resolveHome()` (computes the daemon's own `PI_STUDIO_HOME` default —
  a different concern, not a second file-path tilde-expansion copy).

### Automated verification (repo root)
```
$ npm run build           # clean, all packages, dependency order
$ npm run typecheck       # tsc -b — clean, no errors
$ npm test                # 112 test files, 1007 tests, all passing
$ npm run lint            # 0 errors; ~40 pre-existing warnings (see below), none new
$ npm run fmt:check       # 116 pre-existing unformatted files remain (see below) — NOT clean
```

**`fmt:check` deviation, recorded rather than silently absorbed or ignored:** a full repo-root run
found 119 unformatted files, only 3 of which belonged to this sprint
(`hooks/use-inline-image.ts`, `hooks/use-inline-image.test.ts`, `lib/inline-image-cache.ts` — all
task-003, apparently `oxfmt` was run on a hand-picked file list in that pass rather than the full
tree). Those 3 were fixed in this task (`npx oxfmt <files>`, then re-verified with
`--check`; tests re-run afterward — all 33 web-client/lib+hooks tests still pass, confirming the
reformat was cosmetic-only). The other **116 files are pre-existing, unrelated to sprint-045**
(spot-checked several: `TextInput.tsx`, `Toolbar.tsx`, `FilePanel.tsx`, `rows.module.css` — none
touched by any task in this sprint). Reformatting 116 unrelated files as a side effect of this task
would be exactly the "reformatting unrelated to this sprint" the task's own § Out of scope warns
against (stated for docs, applied here in spirit to code); doing so would also produce a large,
noisy, unreviewable diff. **`npm run fmt:check` does not pass clean at the repo root** — this is a
pre-existing condition this task did not introduce and explicitly did not fix outside its own
scope. Flagging as a legitimate follow-up (e.g. a dedicated "run oxfmt across the whole tree"
task), not something to quietly paper over.

**`lint` warnings** are all pre-existing (spot-checked `agent-service.ts`'s two unused-var
warnings and `pi-adapter.test.ts` before this sprint's changes — present beforehand); 0 errors.

## Acceptance criteria

- [ ] All 12 verification steps — **skipped per explicit user instruction this session**; not
      discharged. See "Scope reduction" above.
- [x] Every checkbox in the scope's § Acceptance Criteria is discharged or explicitly explained —
      explained via the new "Verification status" note (not discharged; see that note for exactly
      which test files cover which mechanism).
- [~] `npm run build`, `npm run typecheck`, `npm test` pass; `npm run lint` passes (0 errors);
      `npm run fmt:check` does **not** pass at the repo root, for reasons unrelated to this sprint
      (116 pre-existing files; the 3 sprint-045 files were fixed).
- [x] The four `AGENTS.md` files and the scope doc are updated, no aspirational claims.
- [x] No `TODO`, stub, or dead re-export shim left behind from tasks 001-006 — `watchTargetPath`
      and the duplicate `~`-expansion pattern both confirmed at 0 hits.

## Follow-ups (out of scope for this task, filed per its own § Out of scope)

1. **Run task-007's 12-step manual browser verification plan for real** before relying on this
   feature — this is the actual outstanding work, not polish.
2. Wire `MarkdownFileViewer.tsx`'s `assetBase` to the viewed file's directory (`dirname(path)`) so
   relative images in viewed markdown files (e.g. repo READMEs) render — desirable, deliberately
   not part of sprint-045's acceptance criteria per the scope doc.
3. A repo-wide `oxfmt` pass to clear the 116 pre-existing unformatted files (unrelated to this
   sprint; separate task).
