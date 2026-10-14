import React from "react";
import { createRoot } from "react-dom/client";
import "../hoard-theme.css";
import "../index.css";
import "../battle/battle.css";
import "./play.css";
import PlayApp from "./PlayApp.jsx";

function readData() {
  try {
    const raw = document.getElementById("silver-data")?.textContent || "";
    if (!raw || raw.includes(["__SILVER", "DATA__"].join("_"))) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

createRoot(document.getElementById("root")).render(<PlayApp data={readData()} />);
