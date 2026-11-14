// Shell components (`swe/architecture/workbench-package.md` § Root entry). The full public API is
// settled in sprint 094.
export { Workbench } from "./shell/Workbench.js";
export { WorkbenchBoot } from "./shell/WorkbenchBoot.js";
export { WorkbenchProvider } from "./shell/WorkbenchProvider.js";
export { WorkspaceShell } from "./shell/WorkspaceShell.js";
// TEMPORARY: web-client's main.tsx attaches the resume triggers itself until sprint 093 task-004
// moves them into the browser host.
export { attachResumeTriggers } from "./lib/connection/resume-triggers.js";
