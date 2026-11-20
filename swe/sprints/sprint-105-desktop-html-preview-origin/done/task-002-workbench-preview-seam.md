# Task 002 — Workbench: the HTML viewer uses `host.preview` when the host has one

- **Sprint:** sprint-105-desktop-html-preview-origin
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (features/files, host)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-104/task-003

## Goal
A host can tell the HTML viewer where the previewed document is loaded from, or that scripts cannot run. With no such member the viewer behaves exactly as today.

## Context / why
The fix for the desktop app's blocked preview scripts is a document URL on another origin, which only the shell can provide. The workbench needs an optional seam for it, and the web client must not change.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 3 (`HostPreview`), § Public contract 4 (row "HTML preview"), § HTML preview origin
- `swe/architecture/workbench-host-adapter.md` § Amendment (row `preview`)
- `packages/workbench/src/features/files/HtmlViewer.tsx` (the `srcDoc` memo, the always-mounted frame), `html-sandbox.ts` (`assembleHtmlPreview`, `HTML_SANDBOX_TOKENS`), `html-sandbox.test.ts`
- `packages/workbench/src/host/types.ts`, `src/index.ts` (exported host types), `src/test/test-host.ts`
- `packages/workbench/src/hooks/use-file-download.ts` (the release-on-supersede pattern to follow)
- `packages/workbench/README.md` § The host, `packages/workbench/AGENTS.md` (HTML preview invariants)

## What to build
```ts
type HostPreview =
  | { kind: "origin"; mount(html: string): Promise<{ url: string; release(): void }> }
  | { kind: "inert" };
// WorkbenchHost gains: preview?: HostPreview
```
- **`kind: "origin"`:** the viewer assembles the document as today (including the "block remote resources" tag), mounts it, and loads the frame from the returned `url` instead of `srcdoc`. Same `sandbox` tokens. `release()` is called when a newer document replaces it and when the viewer unmounts. A `mount` that rejects shows the viewer's existing error state.
- **`kind: "inert"`:** the `srcdoc` frame as today, plus one line above it: "Scripts are disabled in the desktop app on this platform." Source view is unaffected.
- **Absent:** no change at all.
- The frame stays mounted across Preview/Source switches, as today.
- The "which mounted document is current, which to release" bookkeeping is a pure module with tests.
- Export the type; add a `preview` option to the test host; update the README and AGENTS host rows.

## Out of scope
- The desktop host's implementation (task-004) and the Rust origin (task-003).
- Any change to the sandbox tokens or to `assembleHtmlPreview`.

## Acceptance criteria
- [ ] Mounting document B while A is mounted releases A exactly once; unmounting releases the current one; a mount that resolves after it was superseded is released at once.
- [ ] `HTML_SANDBOX_TOKENS` is unchanged and its guard test still passes.
- [ ] With a test host of `kind: "origin"`, the document handed to `mount` equals what `assembleHtmlPreview` produced.
- [ ] In the web client (no `preview`), an HTML file with an inline script previews as before and "Block remote resources" works.
- [ ] The package builds; its tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/files packages/workbench/src/host`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`
- Browser: open an HTML file with a script in the web client.

## Notes
- Depends on sprint-104/task-003 only because both edit `host/types.ts`, `src/index.ts` and `test/test-host.ts`.
- The contract does not depend on the spike's outcome: whatever origin the shell uses, the viewer receives a URL.
- No DOM test environment: the release bookkeeping is the unit-tested part; the frame is checked in the browser and in task-005.
