import React from "react";
import { createRoot } from "react-dom/client";
import "../hoard-theme.css";
import "../index.css";
import "../battle/battle.css";
import "../play/play.css";
import "../arcade.css";
import "./friends.css";
import Friends from "./Friends.jsx";
import { loadWebArt } from "./web-art.js";

createRoot(document.getElementById("root")).render(<Friends artReady={loadWebArt()} />);
