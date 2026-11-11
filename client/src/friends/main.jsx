import React from "react";
import { createRoot } from "react-dom/client";
import "../hoard-theme.css";
import "../index.css";
import "../battle/battle.css";
import "../play/play.css";
import "../arcade.css";
import "./friends.css";
import { installPortableAssets } from "../portable-assets.js";
import Friends from "./Friends.jsx";

const art = new URL("./art/index.json", location.href);
async function loadArt() {
  try {
    const response = await fetch(art);
    if (!response.ok) throw new Error("art");
    const data = await response.json();
    for (const [key, path] of Object.entries(data.files)) {
      const url = new URL(path, art).href;
      data.files[key] = url;
      data.urls[url] = key;
    }
    installPortableAssets(data);
    return true;
  } catch {
    installPortableAssets({ version: 1, files: {}, urls: {} });
    return false;
  }
}

const root = createRoot(document.getElementById("root"));
root.render(<Friends artReady={loadArt()} />);
