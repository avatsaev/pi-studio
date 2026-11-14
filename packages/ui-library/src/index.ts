// Public surface of @av-pi-studio/ui-library. React-free modules are also published as the
// `/theme`, `/ui`, `/brand` and `/breakpoints` subpaths; `ThemeBoundary` and the hooks below are
// root-only because they pull in React.
import "./sentinel.css";

export * from "./theme/index.js";
export {
  ThemeBoundary,
  useAppearance,
  useAppearanceControls,
  useResolvedTheme,
  type AppearanceControls,
  type ThemeBoundaryProps,
} from "./theme/ThemeBoundary.js";
export * from "./ui/index.js";
export * from "./brand/index.js";
export * from "./breakpoints.js";
export { localStorageKvStore } from "./kv-store.js";
export * from "./primitives/index.js";
export { Announcer } from "./primitives/Announcer.js";
export { ToastViewport } from "./primitives/ToastViewport.js";
export {
  useToastStore,
  MAX_VISIBLE_TOASTS,
  resetToastStoreForTests,
} from "./stores/toast-store.js";
export {
  useAnnouncerStore,
  speak,
  clearWhenIdle,
  ANNOUNCE_CLEAR_DELAY_MS,
  resetAnnouncerStoreForTests,
  type AnnouncementPoliteness,
} from "./stores/announcer-store.js";
