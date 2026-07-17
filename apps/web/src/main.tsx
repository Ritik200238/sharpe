import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted fonts (CSP-friendly — no external requests).
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/views.css";

import { App } from "./App";
import { store } from "./store/store";

store.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
