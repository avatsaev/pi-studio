import { type WorkbenchHost } from "../host/types.js";
import { WorkbenchBoot } from "./WorkbenchBoot.js";
import { WorkbenchProvider } from "./WorkbenchProvider.js";
import { WorkspaceShell } from "./WorkspaceShell.js";

/** The whole application: providers, the boot sequence and the default three-column shell. */
export function Workbench({ host }: { host?: WorkbenchHost }) {
  return (
    <WorkbenchProvider host={host}>
      <WorkbenchBoot />
      <WorkspaceShell />
    </WorkbenchProvider>
  );
}
