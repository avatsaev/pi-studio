import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./tokens.css";
import "./app.css";
import { App } from "./App";
import { connect } from "./lib/backend";

const target = document.getElementById("app");
if (target) {
  const backend = connect();
  createRoot(target).render(
    <StrictMode>
      <App backend={backend} />
    </StrictMode>,
  );
}
