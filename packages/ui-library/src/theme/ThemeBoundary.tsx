/**
 * ThemeBoundary — applies theme CSS variables before first paint, and publishes the resolved
 * `AppearanceState` through React context so components that cannot consume CSS variables (an
 * emulator configured through JavaScript) can follow the theme, mono font, and font-size setting.
 * Wraps the app so no flash of wrong theme occurs.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createAppearanceController,
  type AppearanceController,
  type AppearanceMode,
  type AppearanceState,
  type KeyValueStore,
} from "./appearance-store.js";
import { devWarnings } from "./dev-warnings.js";
import { type AppearanceSettings, type Theme } from "./theme.js";
import { type BrandConfig } from "../brand/config.js";
import { localStorageKvStore } from "../kv-store.js";

export interface ThemeBoundaryProps {
  /** Where appearance is persisted. Defaults to `localStorage` (`localStorageKvStore`). */
  store?: KeyValueStore;
  /** Key the appearance JSON lives under. Defaults to `pi-studio-appearance`. */
  storageKey?: string;
  brandConfig?: BrandConfig;
  children: ReactNode;
}

const AppearanceContext = createContext<AppearanceState | null>(null);
const ControlsContext = createContext<AppearanceControls | null>(null);

/** Write side of the appearance controller, for settings UIs and theme switchers. */
export interface AppearanceControls {
  setMode(mode: AppearanceMode): void;
  updateSettings(patch: Partial<AppearanceSettings>): void;
}

/**
 * Synchronously applies theme on first render, then listens for system changes.
 */
export function ThemeBoundary({
  store = localStorageKvStore,
  storageKey,
  brandConfig,
  children,
}: ThemeBoundaryProps) {
  const controllerRef = useRef<AppearanceController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = createAppearanceController(store, brandConfig, { storageKey });
    // Apply synchronously before first paint
    controllerRef.current.apply();
  }
  const controller = controllerRef.current;

  // Re-renders whenever setMode/updateSettings/system-follow change the resolved theme, so the
  // context value below changes identity and consumers re-render.
  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  useEffect(() => {
    const cleanup = controller.listen();
    return cleanup;
  }, [controller]);

  useEffect(() => {
    // Left as a bare `process.env.NODE_ENV` in the published bundle so the consumer's bundler
    // decides (and removes this branch, plus dev-warnings.ts, from its production build).
    if (process.env.NODE_ENV === "production") return undefined;
    devWarnings.checkStylesheet((name) =>
      getComputedStyle(document.documentElement).getPropertyValue(name),
    );
    return devWarnings.registerBoundary();
  }, []);

  return (
    <ControlsContext.Provider value={controller}>
      <AppearanceContext.Provider value={state}>{children}</AppearanceContext.Provider>
    </ControlsContext.Provider>
  );
}

/** Read the current appearance state (mode, settings, resolved theme). Must be under `ThemeBoundary`. */
export function useAppearance(): AppearanceState {
  const state = useContext(AppearanceContext);
  if (!state) {
    throw new Error("useAppearance must be used within a ThemeBoundary");
  }
  return state;
}

/** Read the resolved `Theme` (colors, fontSize, fontFamily, ...). Must be under `ThemeBoundary`. */
export function useResolvedTheme(): Theme {
  return useAppearance().resolvedTheme;
}

/**
 * Change the theme (`setMode`) or appearance settings (`updateSettings`); the new value is applied
 * to the document and persisted. The returned object is stable for the life of the boundary.
 * Must be under `ThemeBoundary`.
 */
export function useAppearanceControls(): AppearanceControls {
  const controls = useContext(ControlsContext);
  if (!controls) {
    throw new Error("useAppearanceControls must be used within a ThemeBoundary");
  }
  return controls;
}
