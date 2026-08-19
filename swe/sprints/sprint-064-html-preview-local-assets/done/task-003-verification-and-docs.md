# Task 003 — Fixture verification + docs sync

- **Sprint:** sprint-064-html-preview-local-assets
- **Status:** done
- **Type:** docs + test
- **Area:** web-client / docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal
Prove the inlining path end-to-end against a real multi-file fixture in a real browser, record the
measured security behavior, and bring the living docs in line with what shipped.

## Context / why
Everything in this sprint that matters is observable only in a browser: whether a styled report
actually renders, whether a hostile ref really triggers no RPC, whether inlined `data:` scripts still
run under the blocking CSP. Unit tests cover the pure halves; this task is the evidence for the
composed behavior — and it is also where the confinement gate stops being a claim in a task file and
becomes a documented, verified invariant.

## Scope references
- `swe/features/html-file-preview.md` § Local asset inlining, § Error handling & edge cases,
  § TODO(verify)
- `packages/web-client/AGENTS.md` § Source layout, § Invariants (the "HTML preview sandbox" invariant
  added in sprint-063/task-004)
- `swe/features/feature-panels-ui.md` § file preview
- `swe/sprints/PLAN.md`

## What to build
- A throwaway fixture set (not committed to the package; created under a scratch workspace for the
  verification run): `report.html` + `style.css` (with a `url()` background) + `app.js` +
  `img/logo.png`, a CDN-script variant, and a hostile variant referencing `../../../.ssh/id_rsa`,
  an absolute `/etc/passwd`, and the `%2F`-encoded spelling `..%2F..%2F..%2F.ssh%2Fid_rsa`.
- `packages/web-client/AGENTS.md`: source-layout entries for `html-assets.ts` and the asset loader;
  extend the "HTML preview sandbox" invariant with the inlining rules — `data:` only (never object
  URLs), workspace-root confinement as a hard gate with the exfiltration reasoning stated (including
  the decode-before-normalize order, the segment-aware root check, and the home-narrowing rule for
  workspace-less tabs), the caps, the document-only watch (assets refresh on Reload), and the known
  limitations (`@import` chains, inline `<style>` refs, nested iframes, entities matched as
  authored).
- `swe/features/html-file-preview.md`: resolve the `TODO(verify)` items with the measured answers
  (the blocking CSP's per-directive `data:` allowances; Firefox parity if checked), and correct any
  deviation the implementation forced.
- `swe/features/feature-panels-ui.md`: file-preview section notes that HTML previews inline local
  assets, with the confinement rule named.
- `swe/sprints/PLAN.md`: reflect the shipped sprint if anything diverged.

## Out of scope
- New product behavior of any kind; if verification finds a defect, fix it in task-002 (reopen it)
  rather than patching here.
- Committing fixture files into the repo.

## Acceptance criteria
- [ ] Recorded in the summary, from a real browser session: the multi-file fixture renders styled +
      scripted + imaged with a `url()` background; every asset is a `data:` URI (no `blob:`); the
      hostile fixture — including the `%2F`-encoded spelling — produces zero download RPCs for the
      out-of-workspace refs and lists them as skipped; the CDN variant runs by default and is
      blocked under "Block remote resources" while inlined `data:` assets (stylesheet **and**
      script) keep working; opening the fixture from a workspace-less (home-rooted) tab inlines
      only same-directory assets.
- [ ] The sandbox probe re-checked after inlining: `parent.document` and `localStorage` still throw,
      `location.origin === "null"`.
- [ ] At least three theme variants (including `light`) and one split-pane layout checked for the
      viewer chrome/skipped-note.
- [ ] `swe/features/html-file-preview.md` has no unresolved `TODO(verify)` that this sprint could
      answer.
- [ ] Full gates from a clean tree: `npm run clean && npm run build`, `npm run typecheck`,
      `npm test`, `npm run lint`, `npx oxfmt --check <changed files>` — all green (pre-existing
      unrelated `fmt` failures recorded, not reformatted).

## Test / verification plan
- `npm run clean && npm run build && npm run typecheck && npm test && npm run lint`.
- `npx oxfmt --check` on changed files only.
- Browser matrix exactly as enumerated in the acceptance criteria, each observation written into
  `task-003-verification-and-docs-summary.md` with what was seen, not what was expected.

## Notes
For the "zero download RPCs" evidence, the daemon's log at `PI_STUDIO_LOG_LEVEL=debug` is the simplest
independent witness; the loader's own unit test asserts the same property with a counting fake, so a
mismatch between the two is itself a finding worth recording.
