import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RemotePosApp } from "./RemotePosApp";
import "./styles.css";

const RootApp = import.meta.env.VITE_REMOTE_MODE === "true" ? RemotePosApp : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
