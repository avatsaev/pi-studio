import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Font faces before the reset, then this page's own rules: the order the browser shell uses
// (`packages/web-client/src/main.tsx`).
import "@av-pi-studio/workbench/fonts.css";
import "@av-pi-studio/ui-library/reset.css";
import "./global.css";
import { useToastStore } from "@av-pi-studio/ui-library";
import { createBrowserHost, Workbench, type WorkbenchHost } from "@av-pi-studio/workbench";
// Only the application bundle can build the pdf.js worker. Same `pdfjs-dist` range as the
// workbench's (`pdfjs-range.test.ts` pins that).
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

import { BootError } from "./BootError.js";
import { errorReason, noticeText, runBoot, type FileResetNotice } from "./host/boot.js";
import { createDesktopHost } from "./host/desktop-host.js";
import { tauriIpc, tauriPresent } from "./host/ipc.js";
import { selectHostKind } from "./host/select.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
const reactRoot = createRoot(root);

const pdf = {
  createWorker: () => new PdfWorker({ name: "pdfjs" }),
  // Emitted by `pdfjsAssetsPlugin` (vite.config.ts).
  assetBaseUrl: `${import.meta.env.BASE_URL}pdfjs/`,
};

function mount(host: WorkbenchHost, notices: FileResetNotice[]): void {
  reactRoot.render(
    <StrictMode>
      <Workbench host={host} />
    </StrictMode>,
  );
  for (const notice of notices) useToastStore.getState().show(noticeText(notice), { durationMs: 10000 });
}

// Chosen once: the Tauri webview boots the desktop host; the snapshot tool and a plain browser
// keep the browser host.
async function start(): Promise<void> {
  if (selectHostKind(tauriPresent()) === "browser") {
    mount(
      createBrowserHost({
        app: { title: "Pi Studio", version: __APP_VERSION__, platform: "desktop" },
        pdf,
      }),
      [],
    );
    return;
  }
  try {
    const snapshot = await runBoot((command) => tauriIpc.invoke(command));
    mount(createDesktopHost(snapshot, tauriIpc, pdf), snapshot.notices);
  } catch (error) {
    reactRoot.render(<BootError reason={errorReason(error)} onRetry={() => void start()} />);
  }
}

void start();
