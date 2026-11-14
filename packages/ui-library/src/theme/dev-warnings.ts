/**
 * Development-only diagnostics for `ThemeBoundary`. The decision logic is pure and injectable so it
 * is testable without a DOM; `ThemeBoundary` only wires it to the document and to the environment.
 * Each diagnostic fires at most once per page.
 */

/** Custom property `styles.css` defines on `:root`; absent after mount ⇒ the stylesheet was never imported. */
export const STYLESHEET_SENTINEL_VAR = "--piui-stylesheet";

export const MISSING_STYLESHEET_MESSAGE =
  '[ui-library] styles.css is not loaded, so components render unstyled. Add `import "@av-pi-studio/ui-library/styles.css"` to your app entry.';

export const MULTIPLE_BOUNDARIES_MESSAGE =
  "[ui-library] More than one ThemeBoundary is mounted. Only one per document is supported: each writes the same CSS variables on <html>, so the last write wins.";

export interface DevWarnings {
  /** Warn (once) when the sentinel custom property is empty. `readVar` returns its computed value. */
  checkStylesheet(readVar: (name: string) => string): void;
  /** Count a mounted boundary; warns (once) when a second is live. Returns the unregister function. */
  registerBoundary(): () => void;
}

export function createDevWarnings(warn: (message: string) => void): DevWarnings {
  let stylesheetWarned = false;
  let boundaryWarned = false;
  let liveBoundaries = 0;

  return {
    checkStylesheet(readVar) {
      if (stylesheetWarned) return;
      if (readVar(STYLESHEET_SENTINEL_VAR).trim() !== "") return;
      stylesheetWarned = true;
      warn(MISSING_STYLESHEET_MESSAGE);
    },
    registerBoundary() {
      liveBoundaries += 1;
      if (liveBoundaries > 1 && !boundaryWarned) {
        boundaryWarned = true;
        warn(MULTIPLE_BOUNDARIES_MESSAGE);
      }
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        liveBoundaries -= 1;
      };
    },
  };
}

/**
 * Page-wide instance used by `ThemeBoundary`. `ThemeBoundary` guards every use with an inline
 * `process.env.NODE_ENV` check, which the *consumer's* bundler folds in a production build; with
 * the `@__PURE__` mark the whole module (and its message strings) is then tree-shaken away.
 */
export const devWarnings: DevWarnings = /* @__PURE__ */ createDevWarnings((message) =>
  console.warn(message),
);
