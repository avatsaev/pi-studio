# Task 004 — Settings → Viewers: "PDF Viewer" row

- **Sprint:** sprint-078-pdf-viewer
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/settings)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-003

## Goal

Users can switch the PDF viewer off (and back on) from Settings → Viewers. It is on by default.

## Context / why

Without a control, the `pdfviewer` toggle the registry reads is unreachable. The panel is
deliberately a hardcoded list until a plugin registry exists (its header). The second row turns it
into a small constant table, not a copy-pasted block.

## Scope references

- `swe/features/pdf-file-preview.md` § Public contract › Settings → Viewers
- `packages/web-client/src/features/settings/ViewersPanel.tsx` (+ `.module.css`)

## What to build

- A module-level `VIEWER_ROWS` constant (`id`, `name`, `description`) with Molecule Viewer then
  PDF Viewer, rendered by one row component reusing the existing switch, disabled state and note.
- PDF row copy: name "PDF Viewer"; description "Render PDF files in place instead of offering only
  a download."
- Update the panel header comment (no longer "exactly one").

## Out of scope

- Registry-driven rows, per-viewer config UI.

## Acceptance criteria

- [x] Both rows render; PDF Viewer reads on against a daemon with no `pdfviewer` row.
- [x] Flipping it issues one `viewer_settings_set_request` with `{ pdfviewer: { enabled } }`.
      The next opened PDF follows the new setting, and an open PDF tab is unchanged.
- [x] The setting survives a reload and reaches a second window without a reload.
- [x] Against a daemon without `viewerSettings`: both rows read on, disabled, with one "Requires a
      newer daemon." note.

## Test / verification plan

- Run: `npx vitest run packages/web-client/src/features/settings`.
- Manual: covered end to end by task-005.
