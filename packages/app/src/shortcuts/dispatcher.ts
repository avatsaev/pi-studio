// Focus-scope resolver + combo normalizer + dispatcher lookup.
// features/keyboard-shortcuts.md § Focus-scope resolution, § Dispatch

import type { KeyboardFocusScope, ShortcutActionId, ShortcutBinding } from "./registry.js";

// ---------------------------------------------------------------------------
// Platform detection (shortcut-level, not full platform/gating)
// ---------------------------------------------------------------------------

export type ShortcutPlatform = "mac" | "non-mac";

/** Returns the shortcut platform based on the user-agent or an injected override. */
export function getShortcutPlatform(userAgent?: string): ShortcutPlatform {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /Mac|iPhone|iPad|iPod/.test(ua) ? "mac" : "non-mac";
}

// ---------------------------------------------------------------------------
// Focus-scope resolution
// ---------------------------------------------------------------------------

export type FocusScopeInput = {
  /**
   * The element that received the keyboard event (or null).
   * In tests, pass a plain object with optional `dataset` / `className` / `tagName`.
   */
  target: FocusTarget | null;
  commandCenterOpen: boolean;
};

export type FocusTarget = {
  tagName?: string;
  className?: string;
  dataset?: Record<string, string | undefined>;
  /** Walk up via parentElement for scope detection. */
  parentElement?: FocusTarget | null;
};

/**
 * Classify a keyboard event's target into a `KeyboardFocusScope`.
 *
 * Algorithm (keyboard-shortcuts.md § Focus-scope resolution):
 * 1. Collect candidates: [target, target.parentElement, …] (up to 10 levels).
 * 2. Any candidate inside a terminal surface → "terminal".
 * 3. commandCenterOpen + candidate inside command-center → "command-center".
 * 4. Candidate is a text input/textarea → "message-input".
 * 5. commandCenterOpen and no candidate → "command-center".
 * 6. Default → "other".
 */
export function resolveKeyboardFocusScope(input: FocusScopeInput): KeyboardFocusScope {
  const { target, commandCenterOpen } = input;
  if (!target) return commandCenterOpen ? "command-center" : "other";

  const candidates: FocusTarget[] = [];
  let cur: FocusTarget | null | undefined = target;
  let depth = 0;
  while (cur && depth < 10) {
    candidates.push(cur);
    cur = cur.parentElement;
    depth++;
  }

  for (const c of candidates) {
    if (isTerminalElement(c)) return "terminal";
  }

  for (const c of candidates) {
    if (commandCenterOpen && isCommandCenterElement(c)) return "command-center";
  }

  for (const c of candidates) {
    if (isTextInputElement(c)) return "message-input";
  }

  return commandCenterOpen ? "command-center" : "other";
}

function isTerminalElement(el: FocusTarget): boolean {
  return (
    el.dataset?.["testid"] === "terminal-surface" ||
    (typeof el.className === "string" && el.className.includes("xterm"))
  );
}

function isCommandCenterElement(el: FocusTarget): boolean {
  return (
    el.dataset?.["testid"] === "command-center" ||
    el.dataset?.["testid"] === "command-center-input"
  );
}

function isTextInputElement(el: FocusTarget): boolean {
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea";
}

// ---------------------------------------------------------------------------
// Combo normalizer
// ---------------------------------------------------------------------------

/** Normalize a raw key combo string to a canonical lowercase form. */
export function normalizeCombo(combo: string): string {
  return combo.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Binding lookup
// ---------------------------------------------------------------------------

export type OverrideMap = Readonly<Record<string, string>>;

/**
 * Look up a ShortcutBinding for a given normalized combo.
 * Overrides fully replace a binding's platform combo when present.
 *
 * @param combo     - Normalized combo string from the keyboard event.
 * @param scope     - Resolved focus scope.
 * @param platform  - "mac" | "non-mac".
 * @param bindings  - The full binding registry.
 * @param overrides - Per-binding-id override map from the overrides store.
 */
export function lookupBinding(
  combo: string,
  scope: KeyboardFocusScope,
  platform: ShortcutPlatform,
  bindings: readonly ShortcutBinding[],
  overrides: OverrideMap = {},
): ShortcutBinding | null {
  const norm = normalizeCombo(combo);

  for (const binding of bindings) {
    // Terminal scope: suppress all bindings flagged as suppressInTerminal.
    if (scope === "terminal" && (binding.suppressInTerminal ?? true)) continue;

    // Resolve effective combo: override takes precedence over both platform variants.
    const override = overrides[binding.id];
    const effectiveCombo = override
      ? normalizeCombo(override)
      : normalizeCombo(platform === "mac" ? binding.mac : binding.nonMac);

    if (effectiveCombo === norm) return binding;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dispatch result (the dispatcher itself calls the action; callers decide)
// ---------------------------------------------------------------------------

export type DispatchResult =
  | { matched: true; action: ShortcutActionId; bindingId: string }
  | { matched: false };

export function dispatchShortcut(
  combo: string,
  scope: KeyboardFocusScope,
  platform: ShortcutPlatform,
  bindings: readonly ShortcutBinding[],
  overrides: OverrideMap = {},
): DispatchResult {
  const binding = lookupBinding(combo, scope, platform, bindings, overrides);
  if (!binding) return { matched: false };
  return { matched: true, action: binding.action, bindingId: binding.id };
}
