import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Font faces before the reset, then this page's own rules: the order the browser shell uses
// (`packages/web-client/src/main.tsx`).
import "@av-pi-studio/workbench/fonts.css";
import "@av-pi-studio/ui-library/reset.css";
import "./global.css";
import { createBrowserHost, Workbench } from "@av-pi-studio/workbench";
// Only the application bundle can build the pdf.js worker. Same `pdfjs-dist` range as the
// workbench's (`pdfjs-range.test.ts` pins that).
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// The browser host for now: the webview's own WebSocket, storage, clipboard and dialogs.
const host = createBrowserHost({
  app: { title: "Pi Studio", version: __APP_VERSION__, platform: "desktop" },
  pdf: {
    createWorker: () => new PdfWorker({ name: "pdfjs" }),
    // Emitted by `pdfjsAssetsPlugin` (vite.config.ts).
    assetBaseUrl: `${import.meta.env.BASE_URL}pdfjs/`,
  },
});

createRoot(root).render(
  <StrictMode>
    <Workbench host={host} />
  </StrictMode>,
);
