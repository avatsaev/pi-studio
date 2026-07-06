// Browser pane view model (Electron only).
// clean-room-scope/features/feature-panels-ui.md § Browser pane (embedded)

export type BrowserNavState = {
  url: string;
  title: string;
  faviconUrl?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastError?: string;
};

export type BrowserPaneState = {
  browserId: string;
  nav: BrowserNavState;
  isElectron: boolean;
  devToolsOpen: boolean;
  elementSelectorActive: boolean;
};

export const INITIAL_BROWSER_NAV: BrowserNavState = {
  url: "about:blank",
  title: "",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
};

// ─── Platform gating ──────────────────────────────────────────────────────

export type BrowserPaneVariant = "electron" | "unsupported";

export function browserPaneVariant(isElectron: boolean): BrowserPaneVariant {
  return isElectron ? "electron" : "unsupported";
}

export function unsupportedBrowserMessage(): string {
  return "Browser panel is only available in the desktop app. Click below to open the URL in your system browser.";
}

// ─── URL validation ───────────────────────────────────────────────────────

export type UrlValidation = { valid: true; normalized: string } | { valid: false; reason: string };

export function validateBrowserUrl(raw: string): UrlValidation {
  const trimmed = raw.trim();
  if (trimmed === "about:blank") return { valid: true, normalized: "about:blank" };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { valid: true, normalized: parsed.href };
    }
    return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
  } catch {
    // Try adding https:// prefix
    try {
      const parsed = new URL(`https://${trimmed}`);
      return { valid: true, normalized: parsed.href };
    } catch {
      return { valid: false, reason: "Invalid URL" };
    }
  }
}

// ─── Navigation state updates ─────────────────────────────────────────────

export function applyNavigation(state: BrowserNavState, url: string): BrowserNavState {
  return { ...state, url, isLoading: true, lastError: undefined };
}

export function applyNavLoaded(state: BrowserNavState, payload: { url?: string; title?: string; favicon?: string; canGoBack?: boolean; canGoForward?: boolean }): BrowserNavState {
  return {
    ...state,
    url: payload.url ?? state.url,
    title: payload.title ?? state.title,
    faviconUrl: payload.favicon ?? state.faviconUrl,
    isLoading: false,
    canGoBack: payload.canGoBack ?? state.canGoBack,
    canGoForward: payload.canGoForward ?? state.canGoForward,
  };
}

export function applyNavError(state: BrowserNavState, error: string): BrowserNavState {
  return { ...state, isLoading: false, lastError: error };
}

// ─── Descriptor ──────────────────────────────────────────────────────────

export function browserDescriptorLabel(nav: BrowserNavState): string {
  if (nav.title) return nav.title;
  try { return new URL(nav.url).hostname || "Browser"; }
  catch { return "Browser"; }
}

export function browserDescriptorSubtitle(nav: BrowserNavState): string {
  return nav.url;
}

// ─── Element selector capture ────────────────────────────────────────────

export type CapturedElement = {
  tag: string;
  text: string;
  selector: string;
  attributes: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
};

export type ElementCapture = { browserId: string; element: CapturedElement };

// ─── New-tab request validation ───────────────────────────────────────────

export function validateNewTabRequest(url: string): UrlValidation {
  return validateBrowserUrl(url);
}

// ─── Keyboard shortcuts model ─────────────────────────────────────────────

export type BrowserShortcut = { action: "focus-url" | "reload" | "dev-tools"; binding: string };

export const BROWSER_SHORTCUTS: BrowserShortcut[] = [
  { action: "focus-url", binding: "mod+L" },
  { action: "reload", binding: "mod+R" },
  { action: "dev-tools", binding: "F12" },
];
