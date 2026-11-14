import { WorkbenchBoot } from "./WorkbenchBoot.js";
import { WorkbenchProvider } from "./WorkbenchProvider.js";
import { WorkspaceShell } from "./WorkspaceShell.js";

/** The whole application: providers, the boot sequence and the default three-column shell. */
export function Workbench() {
  return (
    <WorkbenchProvider>
      <WorkbenchBoot />
      <WorkspaceShell />
    </WorkbenchProvider>
  );
}
