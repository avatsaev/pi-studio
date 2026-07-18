/**
 * Appearance store: persisted theme + appearance settings, system dark-mode following.
 * design-system.md § Theme variants, § Behavior (Appearance)
 */

import { type ThemeName, THEME_NAMES } from "./variants.js";
import { type AppearanceSettings, getTheme, applyAppearance, DEFAULT_THEME_NAME } from "./theme.js";
import { type Theme } from "./theme.js";
import { applyThemeToDOM } from "./css-bridge.js";
import { injectBrandAccent } from "@pi-studio-ui/brand/theme-injection.js";
import { resolveAccentColors, type BrandConfig } from "@pi-studio-ui/brand/config.js";

// ---------------------------------------------------------------------------
// KeyValueStore interface (localStorage on web, Electron bridge on desktop)
// ---------------------------------------------------------------------------

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const STORAGE_KEY = "pi-studio-appearance";

// ---------------------------------------------------------------------------
// Appearance state
// ---------------------------------------------------------------------------

export type AppearanceMode = ThemeName | "system";

export interface AppearanceState {
  mode: AppearanceMode;
  settings: AppearanceSettings;
  resolvedTheme: Theme;
}

// ---------------------------------------------------------------------------
// Appearance controller
// ---------------------------------------------------------------------------

export interface AppearanceController {
  getState(): AppearanceState;
  setMode(mode: AppearanceMode): void;
  updateSettings(patch: Partial<AppearanceSettings>): void;
  /** Call to apply current theme to DOM (call on init + changes). */
  apply(): void;
  /** Start system-follow listener; returns cleanup. */
  listen(): () => void;
}

export function createAppearanceController(
  store: KeyValueStore,
  brandConfig?: BrandConfig,
): AppearanceController {
  let state: AppearanceState = loadInitial(store);
  let mediaCleanup: (() => void) | null = null;

  function resolveThemeName(mode: AppearanceMode): ThemeName {
    if (mode === "system") {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      return prefersDark ? "dark" : "light";
    }
    return mode;
  }

  function buildResolved(mode: AppearanceMode, settings: AppearanceSettings): Theme {
    const themeName = resolveThemeName(mode);
    const base = getTheme(themeName);
    let theme = applyAppearance(base, { ...settings, themeName });
    if (brandConfig?.colors) {
      const resolved = resolveAccentColors(brandConfig.colors);
      theme = injectBrandAccent(theme, resolved);
    }
    return theme;
  }

  function persist(): void {
    const serialized = JSON.stringify({ mode: state.mode, settings: state.settings });
    store.set(STORAGE_KEY, serialized);
  }

  function loadInitial(store: KeyValueStore): AppearanceState {
    const raw = store.get(STORAGE_KEY);
    let mode: AppearanceMode = DEFAULT_THEME_NAME;
    let settings: AppearanceSettings = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.mode && (THEME_NAMES.includes(parsed.mode) || parsed.mode === "system")) {
          mode = parsed.mode;
        }
        if (parsed.settings && typeof parsed.settings === "object") {
          settings = parsed.settings;
        }
      } catch {
        // ignore corrupt data
      }
    }
    const resolvedTheme = buildResolved(mode, settings);
    return { mode, settings, resolvedTheme };
  }

  function update(): void {
    state = { ...state, resolvedTheme: buildResolved(state.mode, state.settings) };
    persist();
  }

  const controller: AppearanceController = {
    getState() {
      return state;
    },
    setMode(mode) {
      state = { ...state, mode };
      update();
      controller.apply();
    },
    updateSettings(patch) {
      state = { ...state, settings: { ...state.settings, ...patch } };
      update();
      controller.apply();
    },
    apply() {
      applyThemeToDOM(state.resolvedTheme);
    },
    listen() {
      if (typeof window === "undefined") return () => {};
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        if (state.mode === "system") {
          update();
          controller.apply();
        }
      };
      mq.addEventListener("change", handler);
      mediaCleanup = () => mq.removeEventListener("change", handler);
      return mediaCleanup;
    },
  };

  return controller;
}
