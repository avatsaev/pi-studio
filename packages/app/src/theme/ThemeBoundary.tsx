/**
 * ThemeBoundary — applies theme CSS variables before first paint.
 * Wraps the app so no flash of wrong theme occurs.
 */

import { useEffect, useRef, type ReactNode } from "react";
import {
  createAppearanceController,
  type AppearanceController,
  type KeyValueStore,
} from "./appearance-store.js";
import { type BrandConfig } from "../brand/config.js";

export interface ThemeBoundaryProps {
  store: KeyValueStore;
  brandConfig?: BrandConfig;
  children: ReactNode;
}

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

  useEffect(() => {
    const cleanup = controllerRef.current!.listen();
    return cleanup;
  }, []);

  return <>{children}</>;
}
