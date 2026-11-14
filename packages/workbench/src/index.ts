/**
 * `@av-pi-studio/workbench` — the supported API (`swe/architecture/workbench-package.md` § Public
 * contract). Everything not exported here is private and may change without notice.
 */

// Components.
export { Workbench } from "./shell/Workbench.js";
export { WorkbenchProvider, type WorkbenchProviderProps } from "./shell/WorkbenchProvider.js";
export { WorkbenchBoot } from "./shell/WorkbenchBoot.js";
export { WorkspaceShell } from "./shell/WorkspaceShell.js";
export {
  ConnectionBar,
  OpenWorkspaceDialog,
  PaneArea,
  RightSidebar,
  SessionList,
  SettingsDialog,
  type SettingsDialogProps,
  StatusBar,
} from "./shell/regions.js";

// Hooks for a custom shell.
export {
  type SidebarLayout,
  useConnection,
  useSettingsDialog,
  useShellLayout,
  type WorkbenchConnection,
} from "./shell/hooks.js";
export { type ConnectOptions } from "./lib/connection/connection-store.js";

// Host adapter (`swe/architecture/workbench-host-adapter.md`).
export { createBrowserHost, type BrowserHostOptions } from "./host/browser-host.js";
export type {
  AgentDeepLinkSource,
  AppIdentity,
  ConnectIntent,
  ConnectTarget,
  HostClipboard,
  HostConnection,
  HostDialogs,
  HostFiles,
  HostLaunch,
  HostLinks,
  HostPdf,
  HostTimers,
  UploadSource,
  ViewableFile,
  WorkbenchHost,
} from "./host/types.js";
