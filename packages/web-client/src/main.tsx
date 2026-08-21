import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Font faces before the reset/token sheet, so the bundled terminal face is registered as early as
// the browser parses CSS at all (theme/fonts.css explains what ships and why).
import "./theme/fonts.css";
import "./global.css";
import { App } from "./app.js";
import { attachResumeTriggers } from "./lib/connection/resume-triggers.js";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Module scope, not a React effect: this file renders under <StrictMode>, whose dev-mode
// double-invoked effects would attach two listener sets. Module scope also matches the
// listener's true lifetime — the document, not any component (sprint-050 connection-resilience).
attachResumeTriggers();
