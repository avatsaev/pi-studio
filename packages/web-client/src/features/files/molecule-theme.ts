/**
 * MOLVIEWER_THEME — pi-studio's background/foreground override for `<MolViewer>`'s `theme` prop.
 *
 * `theme` is documented as raw CSS custom properties applied inline to the component's root
 * (`docs/molviewer-core-doc.md` § UI composition) — a completely separate knob from
 * `initialView.backgroundColor` (the WebGL scene's clear color) and `colorScheme` (per-atom
 * coloring). Neither of those is touched here; this only changes chrome DOM elements (sidebar,
 * toolbars, panels, buttons, dropdowns), never the rendered molecule itself.
 *
 * Values are `var(--pi-color-*)` references, not resolved hex — a CSS custom property may hold
 * another `var()` reference and it chains through the cascade like any other value, so
 * molviewer's chrome tracks pi-studio's live theme (light/dark, custom accent) automatically,
 * with no React re-render needed when appearance settings change.
 *
 * Scope is deliberately narrow, per product decision: panel backgrounds, primary text, and —
 * where molviewer exposes an equivalent — the surfaces of its own interactive controls (buttons)
 * and popovers (dropdowns/menus), all mapped onto pi-studio's existing surface/hover/border scale
 * (`Button.module.css`, `Select.module.css`, the `.item[data-highlighted]` hover pattern used
 * across every pi-studio dropdown). Molviewer's semantic/interactive colors that pi-studio has no
 * equivalent for — accent, selection, danger/success/warning, its five-step muted text scale,
 * axis colors — are its own design language and are left untouched.
 *
 * Molviewer's shipped defaults, for reference (`@molviewer/core/dist/style.css`'s `:root` block):
 *   --canvas #0a0c10  --well #0e1116  --recess #0f1217  --chrome #12151b
 *   --control #1e232c  --control-hover #262c37  --control-strong-hover #2b323e
 *   --popover #171b22  --popover-item-hover #232935  --row-hover #161a21
 *   --border-control #333b48  --border-input #2b323e  --border-popover #3b4453
 *   --text-primary #e6e9ef  --text-on-control #dfe5ee
 */
export const MOLVIEWER_THEME: Record<string, string> = {
  // Panel backgrounds (sidebar, toolbars, recessed panels).
  "--canvas": "var(--pi-color-surface0)",
  "--well": "var(--pi-color-surface0)",
  "--recess": "var(--pi-color-surface1)",
  "--chrome": "var(--pi-color-surface1)",
  // Buttons and other controls.
  "--control": "var(--pi-color-surface2)",
  "--control-hover": "var(--pi-color-surfaceHover)",
  "--control-strong-hover": "var(--pi-color-surfaceHover)",
  "--border-control": "var(--pi-color-border)",
  "--border-input": "var(--pi-color-border)",
  // Dropdowns / menus.
  "--popover": "var(--pi-color-surface1)",
  "--popover-item-hover": "var(--pi-color-surfaceHover)",
  "--row-hover": "var(--pi-color-surfaceHover)",
  "--border-popover": "var(--pi-color-border)",
  // Text.
  "--text-primary": "var(--pi-color-foreground)",
  "--text-on-control": "var(--pi-color-foreground)",
};
