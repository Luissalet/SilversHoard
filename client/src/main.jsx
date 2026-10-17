import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./hoard-theme.css";
import "./index.css";
import "./battle/battle.css";
import "./app.css";
import { installCopilot } from "./copilot-context.js";
import { installSmoothArt } from "./smooth-art.js";
import PosterArt from "./components/PosterArt.jsx";

const poster = location.hash.split("?")[0] === "#/poster-render" && window.__SILVER_POSTER_DATA__?.schema === 1 ? window.__SILVER_POSTER_DATA__ : null;
if (poster) document.body.classList.add("poster-rendering");
else installCopilot();
installSmoothArt();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {poster ? <PosterArt data={poster} /> : <App />}
  </React.StrictMode>,
);

// PWA: register the service worker so the app can be installed. Only over HTTPS or localhost; never breaks the app.
if (!poster && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  try {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  } catch {
    // installing is optional
  }
}
