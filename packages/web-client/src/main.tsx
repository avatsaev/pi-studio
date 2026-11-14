import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Font faces before the reset/token sheet, so the bundled terminal face is registered as early as
// the browser parses CSS at all (the workbench's fonts.css explains what ships and why).
import "@av-pi-studio/workbench/fonts.css";
import "@av-pi-studio/ui-library/reset.css";
import "./global.css";
import { attachResumeTriggers, Workbench } from "@av-pi-studio/workbench";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <Workbench />
  </StrictMode>,
);

// Module scope, not a React effect: this file renders under <StrictMode>, whose dev-mode
// double-invoked effects would attach two listener sets. Module scope also matches the
// listener's true lifetime — the document, not any component (sprint-050 connection-resilience).
attachResumeTriggers();
