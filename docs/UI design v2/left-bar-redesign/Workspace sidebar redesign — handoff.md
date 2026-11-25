# Workspace sidebar redesign — handoff

Nov 25, 2026 · @Shamil Saiev

## Summary

Restyle the left sidebar (workspaces and sessions) so it reads as one quiet tree instead of a stack of bands and cards. This is a **visual-only change**: data, stores, menus, drag and drop, and keyboard behaviour stay as they are.

- **Reference mockup:** `workspace-sidebar-mockup.html` (plain HTML/CSS/JS, no libraries). Open it in a browser and match it. Its CSS custom properties use the same names as the app tokens (`--pi-color-*`), so values map one to one.
- **Scope:** `packages/workbench/src/features/sessions/` only. Nothing in `ui-library` needs to change.
- **Theme:** every colour comes from an existing token. The redesign must look right in all six themes (light, dark, zinc, midnight, claude, ghostty), not just the default dark one.

## Before and after

The main change: workspace headers stop being full-width grey bands, and session rows stop being filled cards. Background colour now marks only hover and selection.

| Element | Current (`SessionList.module.css`) | Target (mockup) |
| --- | --- | --- |
| Panel | Width set by the shell | 248px wide, `surfaceSidebar` background, 1px `border` on the right |
| Section header | "WORKSPACES · 5", 11px bold, letter-spacing 0.1em | 11px semibold, letter-spacing 0.08em, padding 14px 12px 8px. A 24px search button sits on the right (optional, see below) |
| Workspace header | Full-bleed `surface2` band with 1px border top and bottom. Chevron inside a `surface3` tile | Transparent 34px row inside the 6px panel padding, radius 6px. Plain chevron with no tile. Hover fills it with `surface1` |
| Chevron | ChevronRight, rotated 90° when open | Same icon and rotation, 14px, `foregroundMuted` |
| Avatar | 20px | 20px, radius 5px, letter 11px bold, white |
| Workspace name | `xs` (13px), regular | `sm` (14px), weight 500 |
| Count | `4xs` pill on `surface3` | 18px-tall pill, min-width 18px, `surface2`, 11px, `foregroundMuted` |
| Workspace ⋮ | Shown only on hover | Always shown, `foregroundMuted` |
| Session list | Padding 5px 8px 8px, 3px gap | Indented 10px left (from the 6px panel padding), 2px gap. No group frame |
| Session row | Every row filled with `surface0` at 60% | Transparent. Hover fills it with `surface1` |
| Session title | 14px regular, bold only when active | 14px semibold always, `foreground` |
| Session meta | 11px, 9px status dot | 12px, 7px dot, 6px gap, `foregroundMuted` |
| Active session | `accent` at 34% fill, inset ring, 2px left bar, bold `accentForeground` title | `accent` at 14% fill, 1px solid `accent` border, radius 6px. Title stays `foreground`. No left bar |
| Session ⋮ | Hidden until hover, space kept | Always shown, `foregroundMuted` |
| New session | Centred, 12px, hover `surface0` | Left-aligned at row indent, 30px tall, 13px, plus icon 13px, `foregroundMuted` |
| Space between groups | Band borders | 6px spacer after an open group's "New session" row. No dividers |
| Footer | Full-width text button, border-top | 8px padded area with border-top. 32px button, radius 6px, centred "+ Add workspace", 13px |

**Search button:** the mockup has a search icon in the section header. Only add it if a session filter is built at the same time. Otherwise leave it out so the header does not offer a dead control.

## Files to change

Most of the work is in one CSS module. The TSX changes are small: a few class names and removing the active bar.

| File | Change |
| --- | --- |
| `features/sessions/SessionList.module.css` | Rewrite `.header`, `.workspaceHeader`, `.workspaceChevron`, `.workspaceCount`, `.workspaceMenuBtn`, `.workspaceSessions`, `.item`, `.item.active`, `.title`, `.meta`, `.metaDot`, `.menuBtn`, `.newSessionRow` and `.footer` as specified below. Delete `.activeBar` and the hover-only opacity rules. |
| `features/sessions/SessionItem.tsx` | Stop rendering `.activeBar` for the active state. Needs input is shown by the pulsing dot and the warning-coloured label, not by a bar. Move the ⋮ button off the title line: title and meta go in a .body column, with the button beside it. |
| `features/sessions/WorkspaceGroupHeader.tsx` | No structural change. The chevron `IconButton` loses its tile through CSS. Keep `aria-label`, `title={cwd}` and the toggle handlers. |
| `features/sessions/SessionList.tsx` | Wrap the footer button in a padded container (`.footerWrap`). Add a 6px spacer (`.groupGap`) after each open group, or set `margin-bottom` on `.workspaceSessions`. Header text stays "Workspaces · N". |
| `features/sessions/session-presentation.ts` | No change. Row state still comes from `sidebarSessionView`. |

All paths are relative to `packages/workbench/src/`. Keep the `var(--pi-…)` rule: CSS modules never hard-code font sizes or colours (`packages/workbench/AGENTS.md`, Invariants).

## Layout spec

All measurements are in CSS px at the default type scale. Font sizes are `--pi-font-size-*` rungs: `3xs` 11, `2xs` 12, `xs` 13, `sm` 14.

1. **Panel**: flex column, width 248px, background `surfaceSidebar`, `border-right: 1px solid border`. The list scrolls, and the footer stays pinned at the bottom.
2. **Section header**: flex row, `justify-content: space-between`, padding 14px 12px 8px. Label "Workspaces · N": `3xs`, weight 600, letter-spacing 0.08em, uppercase, `foregroundMuted`.
3. **List container**: padding 0 6px 8px, flex column, 2px gap.
4. **Workspace header** (a button, or a div with `role="button"` as today): height 34px, padding 0 6px, gap 8px, radius 6px, transparent. Contents in order:
   1. Chevron: 14px icon in a 14px box, `foregroundMuted`, no background. Rotated 90° when open, no animation.
   2. Avatar: 20×20, radius 5px, existing `Avatar` colour, letter `3xs` bold white.
   3. Name: `sm`, weight 500, `foreground`, one line with ellipsis, `flex: 1`.
   4. Attention dot: only when the group is collapsed, as today.
   5. Count pill: min-width 18px, height 18px, padding 0 5px, radius 9999px, `surface2`, `3xs`, `foregroundMuted`, centred.
   6. ⋮ button: 24×24, icon 14px, `foregroundMuted`.
5. **Session group** (`.workspaceSessions`): padding-left 10px, flex column, 2px gap, margin-bottom 6px.
6. **Session row**: flex row, `align-items: center`, gap 8px, padding 7px 8px 7px 10px, radius 6px, `border: 1px solid transparent`, transparent background. Contents:
   1. Text column (`flex: 1; min-width: 0`, 3px gap). Title: `sm`, weight 600, `foreground`, ellipsis. Meta line: `2xs`, `foregroundMuted`, 6px gap, 7px status dot, then the label.
   2. ⋮ button: 24×24, icon 14px, `foregroundMuted`, vertically centred on the whole row.
7. **New session row**: height 30px, padding 0 10px, gap 6px, left-aligned, radius 6px, `xs`, `foregroundMuted`, plus icon 13px.
8. **Collapsed workspace**: only the header shows. Groups follow each other with the 2px list gap.
9. **Footer**: a container with `border-top: 1px solid border` and 8px padding, holding a 100%-wide button. The button is 32px tall, radius 6px, centred, 6px gap, plus icon 14px, label "Add workspace", `xs`, `foregroundMuted`, transparent.

## States

State shows up in three places only: the row background and border, the status dot, and the meta label colour. Keep `StatusDot` and its colour mapping (`ui/status-dot.ts`) as they are. The mockup's dot colours are close to them in the default theme.

| State | Row | Dot | Meta label |
| --- | --- | --- | --- |
| Idle | Transparent | `foregroundMuted` (mockup `#71717a`) | "idle", `foregroundMuted` |
| Running / queued | Transparent | `accent` (from StatusDot) | "running", `foregroundMuted` |
| Needs input | Transparent. No left bar, no wash | `statusWarning`, keeps the existing `pulse` | "needs input", `statusWarning` |
| Failed | Transparent. Remove the `destructive` 10% wash | `statusDanger` | Label + reason, `destructive` (`.metaFailed`) |
| Empty (never used) | Transparent | None | Italic title, meta at 50% opacity (unchanged) |
| Hover | `surface1` fill | — | — |
| Active | `accent` mixed at 14% with transparent, `border-color: accent` | Unchanged | Unchanged. Title stays `foreground` |
| Active + needs input | Active fill and border | Pulsing warning dot | Warning label |
| Keyboard focus | `outline: 2px solid accentBright`, offset -2px, on rows and buttons | — | — |
| Disconnected | List replaced by "Not connected", centred, `sm`, `foregroundMuted`, margin-top 24px. Footer disabled at 50% opacity | — | — |

- **Workspace header hover:** `surface1` fill. Use the same fill whether the group is open or collapsed.
- **Collapsed workspace with attention:** the existing `workspaceAttentionDot` sits right before the count pill. Keep its pulse and `aria-label`.
- **Zinc theme:** there `accent` is near-white (`#e4e4e7`). The 14% fill and 1px border still read as a selection, but check it by eye. The active title must not switch to `accentForeground`, which is dark in zinc.
- **Light theme:** the same rules apply. `surface1` (`#fafafa`) is the hover on a `surfaceSidebar` (`#f4f4f5`) panel. If it is too faint, use `surfaceSidebarHover` (`#e9e9ec`) for hover in light only.

## Tokens and reference CSS

The mockup declares the default dark theme's values under the app's own variable names. Use the `var()` names, never the hex values.

| Mockup variable | Default dark | Used for |
| --- | --- | --- |
| `--pi-color-surfaceSidebar` | `#141716` | Panel background |
| `--pi-color-surface1` | `#1E2120` | Row hover |
| `--pi-color-surface2` | `#272A29` | Count pill |
| `--pi-color-border` | `#252B2A` | Panel edge, footer divider |
| `--pi-color-foreground` | `#fafafa` | Names and titles |
| `--pi-color-foregroundMuted` | `#A1A5A4` | Header, meta, icons, buttons |
| `--pi-color-accent` | `#2e5cb8` | Active fill (14%) and border |
| `--pi-color-accentBright` | `#a2b4d7` | Focus ring |
| `--pi-color-statusWarning` | `#f59e0b` | Needs-input dot and label |
| `--pi-color-destructive` | `#c64f43` | Failed label |

The heights that are not on the spacing scale (34, 30, 24, 18 and 7px) stay literal px, as `.activeBar`'s `2px` does today. Everything else uses existing `--pi-spacing-*`, `--pi-radius-*` and `--pi-font-*` vars. Reference rules for the module:

```css
.header { display: flex; align-items: center; justify-content: space-between;
  padding: var(--pi-spacing-14) var(--pi-spacing-12) var(--pi-spacing-8); flex-shrink: 0; }
.header h3 { margin: 0; font-size: var(--pi-font-size-3xs); font-weight: var(--pi-font-weight-semibold);
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--pi-color-foregroundMuted); }
.list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column;
  gap: var(--pi-spacing-2); padding: 0 var(--pi-spacing-6) var(--pi-spacing-8); }

.workspaceHeader { display: flex; align-items: center; gap: var(--pi-spacing-8); height: 34px;
  padding: 0 var(--pi-spacing-6); border-radius: var(--pi-radius-md); cursor: pointer;
  font-size: var(--pi-font-size-sm); color: var(--pi-color-foreground); background: transparent; }
.workspaceHeader:hover { background: var(--pi-color-surface1); }
.workspaceChevron, .workspaceHeader .workspaceChevron:hover { background: none; color: var(--pi-color-foregroundMuted); }
.workspaceLabel { flex: 1 1 auto; min-width: 0; font-weight: var(--pi-font-weight-medium);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspaceCount { flex-shrink: 0; min-width: 18px; height: 18px; box-sizing: border-box;
  padding: 0 var(--pi-spacing-5); border-radius: var(--pi-radius-full); background: var(--pi-color-surface2);
  color: var(--pi-color-foregroundMuted); font-size: var(--pi-font-size-3xs);
  display: inline-flex; align-items: center; justify-content: center; }
.workspaceMenuBtn, .menuBtn { flex-shrink: 0; color: var(--pi-color-foregroundMuted); }

.workspaceSessions { display: flex; flex-direction: column; gap: var(--pi-spacing-2);
  padding-left: var(--pi-spacing-10); margin-bottom: var(--pi-spacing-6); }
.item { position: relative; display: flex; align-items: center; gap: var(--pi-spacing-8);
  padding: var(--pi-spacing-7) var(--pi-spacing-8) var(--pi-spacing-7) var(--pi-spacing-10);
  border: var(--pi-border-width-1) solid transparent; border-radius: var(--pi-radius-md);
  background: transparent; cursor: pointer; }
.item:hover { background: var(--pi-color-surface1); }
.item.active { background: color-mix(in srgb, var(--pi-color-accent) 14%, transparent);
  border-color: var(--pi-color-accent); }
.item:focus-visible { outline: 2px solid var(--pi-color-accentBright); outline-offset: -2px; }
.body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: var(--pi-spacing-3); }
.titleLabel { font-size: var(--pi-font-size-sm); font-weight: var(--pi-font-weight-semibold);
  color: var(--pi-color-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; align-items: center; gap: var(--pi-spacing-6);
  font-size: var(--pi-font-size-2xs); color: var(--pi-color-foregroundMuted); overflow: hidden; }
.metaDot { --status-dot-size: 7px; --status-dot-border-width: 0px; }

.newSessionRow { display: flex; align-items: center; justify-content: flex-start; gap: var(--pi-spacing-6);
  height: 30px; padding: 0 var(--pi-spacing-10); border: none; border-radius: var(--pi-radius-md);
  background: none; font-size: var(--pi-font-size-xs); color: var(--pi-color-foregroundMuted); cursor: pointer; }
.newSessionRow:hover { background: var(--pi-color-surface1); color: var(--pi-color-foreground); }

.footerWrap { flex-shrink: 0; padding: var(--pi-spacing-8);
  border-top: var(--pi-border-width-1) solid var(--pi-color-border); }
.footer { width: 100%; height: 32px; display: flex; align-items: center; justify-content: center;
  gap: var(--pi-spacing-6); border: none; border-radius: var(--pi-radius-md); background: none;
  font-size: var(--pi-font-size-xs); color: var(--pi-color-foregroundMuted); cursor: pointer; }
.footer:hover { background: var(--pi-color-surface1); color: var(--pi-color-foreground); }
```

The session row's `.title` wrapper becomes `.body` (title, then meta) beside the ⋮ button, so the button sits in the row's middle instead of on the title line. That is the one markup change in `SessionItem.tsx` besides removing `.activeBar`. `Every var used here exists in the theme's CSS bridge`.

## Behaviour to keep, and acceptance checks

None of this behaviour changes. Each item is an existing feature that a restyle can break by accident.

- Clicking a workspace header (or its chevron) toggles collapse. Opening a session still needs a click on its row.
- The ⋮ buttons call `stopPropagation` and open `WorkspaceContextMenu` or `SessionContextMenu` at the button's corner. Right-clicking a row opens the same menu at the cursor.
- Only rows in the workspace that is in view can be dragged (`draggable`, `EXTERNAL_DRAG_MIME.chat`).
- `tabIndex={-1}` on rows stays, so closing the rename dialog can return focus.
- `title={cwd}` on the workspace header stays as the full-path tooltip.
- "New session" and "Add workspace" are disabled while disconnected, with their current `title` text.
- The needs-input pulse respects `prefers-reduced-motion` as it does today.

Acceptance checks:

- [ ] Side by side with `workspace-sidebar-mockup.html` at 100% zoom in the dark theme, sizes, spacing and colours match within 1px.
- [ ] No `.activeBar` element in the DOM, and no hard-coded colour or font-size literals in `SessionList.module.css`.
- [ ] Active, needs input, active + needs input, failed and empty rows all match the States table.
- [ ] Checked by eye in all six themes. Zinc and light need the closest look.
- [ ] Long workspace names and session titles truncate with an ellipsis without moving the ⋮ button or the count.
- [ ] Keyboard focus is visible on headers, rows, ⋮ buttons, New session and Add workspace.
- [ ] Existing tests in `features/sessions/` still pass. Update snapshot tests only where markup changed on purpose.
