// Platform gating constants and helpers.
// design-system.md § Platform gating, § Styling-engine rules

// ---------------------------------------------------------------------------
// Platform constants
// In a Metro/RN bundle each of these resolves at build time via platform
// extension files (.web.ts / .native.ts / .electron.ts). In the Node test
// environment all evaluate to false (no platform); that is correct behaviour
// for unit tests that should not rely on platform identity.
// ---------------------------------------------------------------------------

/** True when running inside a web browser (DOM available). */
export const isWeb: boolean =
  typeof globalThis !== "undefined" &&
  typeof (globalThis as Record<string, unknown>)["document"] !== "undefined";

/** True on a native (iOS/Android) React Native runtime. */
export const isNative: boolean =
  !isWeb &&
  typeof (globalThis as Record<string, unknown>)["__fbBatchedBridge"] !== "undefined";

// Cache slot for the Electron check.
let _isElectronCache: boolean | null = null;

/**
 * True when running inside the Electron renderer.
 * Cached after the first call.
 * Checks:
 *   1. Build-time flag VITE_TARGET === "electron" (set in vite.config.ts define).
 *   2. Runtime marker set by Electron preload script (`window.__piStudioElectron`).
 *   3. Legacy marker (`window.__PI_STUDIO_ELECTRON__`).
 */
export function getIsElectron(): boolean {
  if (_isElectronCache !== null) return _isElectronCache;

  // Build-time flag (dead-code-eliminated by Vite in the web build)
  if (
    typeof import.meta !== "undefined" &&
    (import.meta as unknown as Record<string, Record<string, unknown>>).env?.VITE_TARGET === "electron"
  ) {
    _isElectronCache = true;
    return true;
  }

  // Runtime markers from preload
  _isElectronCache =
    isWeb &&
    (typeof (globalThis as Record<string, unknown>)["__piStudioElectron"] !== "undefined" ||
     (globalThis as Record<string, unknown>)["__PI_STUDIO_ELECTRON__"] === true);
  return _isElectronCache;
}

/** Reset the cached Electron flag — used in tests only. */
export function _resetElectronCache(): void {
  _isElectronCache = null;
}

/**
 * Guard helper for Electron-only dynamic imports. Throws on web.
 * Usage pattern (callers provide their own dynamic import for Vite analysis):
 *   if (getIsElectron()) {
 *     const mod = await import("./browser-pane.electron");
 *   }
 * This function is an alternative that throws for non-Electron contexts:
 *   await assertElectronContext("browser-pane");
 */
export function assertElectronContext(moduleName: string): void {
  if (!getIsElectron()) {
    throw new Error(
      `Cannot load Electron module "${moduleName}" — not running in Electron.`,
    );
  }
}

/**
 * True only on web — the drag-and-drop pane-split layout is web-only.
 * design-system.md: `supportsDesktopPaneSplits()` is true only on web.
 */
export function supportsDesktopPaneSplits(): boolean {
  return isWeb;
}

// ---------------------------------------------------------------------------
// Styling-engine rules documentation (non-code — preserved as constants for
// linting/tooling to reference and for in-code documentation value).
// ---------------------------------------------------------------------------

/**
 * Styling-engine rules summary (Unistyles v3 target).
 * See design-system.md § Styling-engine rules.
 *
 * 1. Default: `create((theme) => ({ ... }))` theme-function styles.
 * 2. Static palette constants for theme-invariant values.
 * 3. `withUnistyles` theme-prop binder for non-style props (icon colors, etc.)
 * 4. Discouraged: all-subscribing theme hook (re-renders whole subtree).
 * 5. Inline-geometry seam: high-churn positions bypass the CSS registry.
 *
 * Gotchas:
 * - Never apply a theme-function style to an Animated/Reanimated view.
 * - Scroll view content-container styles are not theme-tracked.
 * - Bottom-sheet header: repaint via prop binder or inline.
 */
export const STYLING_ENGINE_RULES = "see design-system.md § Styling-engine rules" as const;
