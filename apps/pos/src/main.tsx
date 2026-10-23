import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { KdsApp } from "./KdsApp";
import { RemotePosApp } from "./RemotePosApp";
import "./styles.css";

const queryMode = new URLSearchParams(window.location.search).get("mode");
const isKds = import.meta.env.VITE_APP_MODE === "kds" || queryMode === "kds" ||
  /^\/kds\/?$/.test(window.location.pathname);
const RootApp = isKds
  ? KdsApp
  : import.meta.env.VITE_REMOTE_MODE === "true"
    ? RemotePosApp
    : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  });
}
