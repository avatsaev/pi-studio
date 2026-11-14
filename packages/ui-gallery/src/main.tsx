import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Announcer, ThemeBoundary, ToastViewport } from "@av-pi-studio/ui-library";
// Library CSS first, so this app's own rules win at equal specificity.
import "@av-pi-studio/ui-library/reset.css";
import "@av-pi-studio/ui-library/styles.css";
import { App } from "./App.js";
import "./gallery.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeBoundary storageKey="pi-ui-gallery-appearance">
      <App />
      <ToastViewport />
      <Announcer />
    </ThemeBoundary>
  </StrictMode>,
);
