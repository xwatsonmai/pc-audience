import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import Overlay from "./Overlay";
import "./styles.css";

window.addEventListener("error", (event) => {
  console.error(`Renderer error: ${event.message}`);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(`Renderer unhandled rejection: ${String(event.reason)}`);
});

const root = createRoot(document.getElementById("root") as HTMLElement);
const isOverlay = window.location.hash.includes("overlay");

if (isOverlay) {
  document.documentElement.classList.add("overlay-html");
  document.body.classList.add("overlay-body");
}

root.render(
  <React.StrictMode>
    <ErrorBoundary>{isOverlay ? <Overlay /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
