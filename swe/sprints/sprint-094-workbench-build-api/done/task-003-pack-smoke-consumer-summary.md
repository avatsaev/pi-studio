# Task 003 — Packed-tarball smoke: a consumer outside the workspace — Summary

- **Sprint:** sprints/sprint-094-workbench-build-api
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
`packages/workbench/scripts/pack-smoke.sh`: packs protocol, relay, client, ui-library and workbench; creates a scratch Vite + React + TS app in `$TMPDIR` with two pages — `index.html` (the README quickstart `main.tsx` and `vite.config.ts`, extracted verbatim from `<!-- smoke:… -->` markers in `packages/workbench/README.md`, written now; task-004 completes the README) and `custom.html` (`WorkbenchProvider` + `WorkbenchBoot` + `SessionList` + `PaneArea` + a connect button on `useConnection()`); installs the tarballs with the repo's pinned Vite/plugin-react/pdfjs-dist ranges; asserts with PASS/FAIL lines. Heavy-library check uses a chunk report written by a scratch Vite plugin: no `mermaid`, `pdfjs-dist`, `@molviewer`, shiki language module in any entry chunk or its static imports, and at least one in a lazy chunk. `KEEP_DIR=1` keeps the directory; otherwise an EXIT trap removes it.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/scripts/pack-smoke.sh` | created |
| `packages/workbench/README.md` | created (quickstart with smoke markers; rest in task-004) |

## How it satisfies the scope
`workbench-package.md` § Acceptance criteria (packed tarball, custom shell); spike smoke form.

Two checks were refined against real output:
- The pdf.js `?worker` *wrapper* module is eager by design (the quickstart constructs the worker host); the worker code is a separate file — excluded from the heavy-library rule.
- The consumer's own Vite inlines KaTeX_Size3 (under its 4 KiB `assetsInlineLimit`), as web-client's build does; the inlined-font assertion covers the workbench's own (Cascadia) faces.
A dev-warning-stripping check was dropped: `warnOnce` messages are call arguments, so the strings ship even though they never print in production.

## Build & test results
```
$ bash packages/workbench/scripts/pack-smoke.sh
PASS: packed protocol, relay, client, ui-library, workbench
PASS: npm install of the tarballs
PASS: types resolve with skipLibCheck: false (both entries)
PASS: vite build (both entries)
PASS: mermaid, shiki languages, pdf.js and the molecule viewer are lazy
PASS: workbench fonts emitted as files, none inlined
PASS: pdf.js data emitted by the ./vite plugin
PASS: deep imports rejected by exports
PASS: workbench classes are piwb- prefixed; app classes are not
ALL PASS        (exit 0; scratch directory removed)

Run-time (KEEP_DIR=1, `vite preview` :5395, dev daemon :6790 with one seeded mock agent):
- whole app: /?host=127.0.0.1:6790&connect=1 -> bar shows "My Pi-Studio v1.0.0", connected; opened the agent, sent "hello from the packed workbench" -> "echo: hello from the packed workbench"; no page/console errors.
- custom shell: /custom.html?host=127.0.0.1:6790 -> Connect -> status "open"; SessionList listed the agent; PaneArea chat; sent "hello from the custom shell" -> echoed; no page/console errors.
```

## Acceptance criteria
- [x] The script prints only PASS lines and exits 0.
- [x] Run-time check passes for both entries (recorded above).
- [x] Cleans up unless KEEP_DIR=1 (0 leftover directories after a plain run).
- [x] `docs/desktop-client-handoff.md`: nothing it states changed; the API section is rewritten in sprint 095 task-002.

## Follow-ups / TODO(verify)
- None.
