import { useEffect } from "react";
import { type WorkbenchHost } from "../host/types.js";
import { warnOnce } from "./context.js";
import { WorkbenchBoot } from "./WorkbenchBoot.js";
import { WorkbenchProvider } from "./WorkbenchProvider.js";
import { WorkspaceShell } from "./WorkspaceShell.js";

/** Mounted `Workbench` instances. The application's state is module-level, so one per document. */
let mounted = 0;

/** The whole application: providers, the boot sequence and the default three-column shell. */
export function Workbench({ host }: { host?: WorkbenchHost }) {
  useEffect(() => {
    mounted += 1;
    if (mounted > 1) {
      warnOnce(
        "workbench",
        "More than one <Workbench> is mounted in this document; they share all state. Mount one.",
      );
    }
    return () => {
      mounted -= 1;
    };
  }, []);

  return (
    <WorkbenchProvider host={host}>
      <WorkbenchBoot />
      <WorkspaceShell />
    </WorkbenchProvider>
  );
}
