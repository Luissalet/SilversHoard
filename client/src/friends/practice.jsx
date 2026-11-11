import React from "react";
import { createRoot } from "react-dom/client";
import "../hoard-theme.css";
import "../index.css";
import "../battle/battle.css";
import "../play/play.css";
import "../arcade.css";
import { importTeam } from "../../../engine/src/core.mjs";
import { installSmoothArt } from "../smooth-art.js";
import PlayApp from "../play/PlayApp.jsx";
import { friendsText, initialWebLang } from "./strings.js";
import { loadWebArt } from "./web-art.js";

const lang = initialWebLang();
const t = (key) => friendsText(lang, key);
const team = importTeam(`Pikachu
Ability: Static
- Thunderbolt
- Quick Attack
- Thunder Wave
- Protect

Bulbasaur
Ability: Overgrow
- Energy Ball
- Sludge Bomb
- Leech Seed
- Protect

Eevee
Ability: Adaptability
- Swift
- Bite
- Quick Attack
- Protect`);

const practice = {
  kind: "trainer", mode: "turns", sprite_set: "gen5",
  payload: { trainer: {
    source_id: "silver-web-practice", name: t("practice"), team, format: "gen9customgame",
    level_rules: { level: 50 }, ai: { level: "normal", style: "balanced" },
  } },
};

loadWebArt().then(() => {
  installSmoothArt();
  createRoot(document.getElementById("root")).render(<>
    <nav className="p-wrap"><a className="btn btn-sm self-start" href={`../?lang=${lang}`}>{t("home")}</a></nav>
    <PlayApp data={practice} />
  </>);
});
