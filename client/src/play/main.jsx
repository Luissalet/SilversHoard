import React from "react";
import { createRoot } from "react-dom/client";
import "../hoard-theme.css";
import "../index.css";
import "../battle/battle.css";
import "./play.css";
import PlayApp from "./PlayApp.jsx";
import RoomApp from "./RoomApp.jsx";
import PkRoomApp from "./PkRoomApp.jsx";
import { installSmoothArt } from "../smooth-art.js";

function readData() {
  try {
    const raw = document.getElementById("silver-data")?.textContent || "";
    if (!raw || raw.includes(["__SILVER", "DATA__"].join("_"))) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const data = readData();
installSmoothArt();
// a live-battle room served by a friend's Silver's Hoard (pvp.py), a Pokéathlon room (pokeathlon_rooms.py), or a playable page with a gym or trainer inside
createRoot(document.getElementById("root")).render(data?.kind === "room" ? <RoomApp data={data} /> : data?.kind === "pkroom" ? <PkRoomApp data={data} /> : <PlayApp data={data} />);
