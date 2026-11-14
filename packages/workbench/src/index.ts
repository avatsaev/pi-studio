// Shell components (`swe/architecture/workbench-package.md` § Root entry). The full public API is
// settled in sprint 094.
export { Workbench } from "./shell/Workbench.js";
export { WorkbenchBoot } from "./shell/WorkbenchBoot.js";
export { WorkbenchProvider } from "./shell/WorkbenchProvider.js";
export { WorkspaceShell } from "./shell/WorkspaceShell.js";
// Host adapter (`swe/architecture/workbench-host-adapter.md`).
export { createBrowserHost, type BrowserHostOptions } from "./host/browser-host.js";
export { type AppIdentity, type HostPdf, type WorkbenchHost } from "./host/types.js";
