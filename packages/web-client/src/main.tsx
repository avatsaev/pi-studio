import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Font faces before the reset/token sheet, so the bundled terminal face is registered as early as
// the browser parses CSS at all (the workbench's fonts.css explains what ships and why).
import "@av-pi-studio/workbench/fonts.css";
import "@av-pi-studio/ui-library/reset.css";
import "./global.css";
import { createBrowserHost, Workbench } from "@av-pi-studio/workbench";
// The pdf.js worker must be built by the application bundle (a prebuilt library cannot carry a
// `?worker` import). Same `pdfjs-dist` range as the workbench's; a test pins that.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const host = createBrowserHost({
  app: { title: __BRAND_TITLE__, version: __APP_VERSION__ },
  pdf: {
    createWorker: () => new PdfWorker({ name: "pdfjs" }),
    // Served/emitted by `pdfjsAssetsPlugin` (vite.config.ts) under the app base.
    assetBaseUrl: `${import.meta.env.BASE_URL}pdfjs/`,
  },
});

createRoot(root).render(
  <StrictMode>
    <Workbench host={host} />
  </StrictMode>,
);
