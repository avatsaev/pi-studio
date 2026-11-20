import { type HostPreview } from "@av-pi-studio/workbench";

import { type Ipc } from "./ipc.js";

/** The `preview` member: `origin` mounts documents through Rust, `inert` sends nothing. */
export function createDesktopPreview(
  kind: "origin" | "inert",
  ipc: Ipc,
  log: (message: string, error: unknown) => void,
): HostPreview {
  if (kind === "inert") return { kind: "inert" };
  return {
    kind: "origin",
    async mount(html) {
      const answer = await ipc.invoke("preview_mount", { html });
      const url = (answer as { url?: unknown } | null)?.url;
      if (typeof url !== "string") throw new Error("The app host answered preview_mount with an unexpected shape.");
      let released = false;
      return {
        url,
        release() {
          if (released) return;
          released = true;
          ipc.invoke("preview_release", { url }).catch((error: unknown) => log("preview_release failed", error));
        },
      };
    },
  };
}
