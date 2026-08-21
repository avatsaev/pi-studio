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
  type AppearanceState,
  type KeyValueStore,
} from "./appearance-store.js";
import { type Theme } from "./theme.js";
import { type BrandConfig } from "@pi-studio-ui/brand/config.js";

export interface ThemeBoundaryProps {
  store: KeyValueStore;
  brandConfig?: BrandConfig;
  children: ReactNode;
}

const AppearanceContext = createContext<AppearanceState | null>(null);

/**
 * Synchronously applies theme on first render, then listens for system changes.
 */
export function ThemeBoundary({ store, brandConfig, children }: ThemeBoundaryProps) {
  const controllerRef = useRef<AppearanceController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = createAppearanceController(store, brandConfig);
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

  return <AppearanceContext.Provider value={state}>{children}</AppearanceContext.Provider>;
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
