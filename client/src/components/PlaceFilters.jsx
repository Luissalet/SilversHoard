// Filters for what comes from the games (gyms, leagues): where it comes from, its region and its game. The options come from the
// list itself (the server gives each one of the games its `region` and `game_id`, and their names in both languages).
import React from "react";
import { useApp } from "../context.js";
import { loc } from "../loc.js";

/** The regions and games of a list, named in the reader's language, in the list's order (the games' order). */
export function placeOptions(list, lang) {
  const regions = new Map();
  const games = new Map();
  for (const x of list) {
    if (x.region && !regions.has(x.region)) regions.set(x.region, loc(x, lang, "region") || x.region);
    if (x.game_id && !games.has(x.game_id)) games.set(x.game_id, { label: loc(x, lang, "game") || x.game_id, region: x.region });
  }
  return { regions: [...regions], games: [...games] };
}

export const matchesPlace = (x, region, game) => (!region || x.region === region) && (!game || x.game_id === game);

export default function PlaceFilters({ list, region, setRegion, game, setGame, origin = "", setOrigin = null, origins = null }) {
  const { t, lang } = useApp();
  const { regions, games } = placeOptions(list, lang);
  return (
    <div className="trainer-filters">
      {origins && (
        <label><span className="label">{t("origin")}</span>
          <select className="field" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="">{t("all")}</option>{origins.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      )}
      <label><span className="label">{t("trainer_region")}</span>
        <select className="field" value={region} onChange={(e) => { setRegion(e.target.value); if (games.find(([id]) => id === game)?.[1].region !== e.target.value) setGame(""); }}>
          <option value="">{t("trainer_all_regions")}</option>{regions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label><span className="label">{t("chars_game")}</span>
        <select className="field" value={game} onChange={(e) => setGame(e.target.value)}>
          <option value="">{t("chars_all_games")}</option>
          {games.filter(([, g]) => !region || g.region === region).map(([v, g]) => <option key={v} value={v}>{g.label}</option>)}
        </select>
      </label>
    </div>
  );
}
