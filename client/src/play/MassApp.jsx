import React, { useEffect, useMemo, useState } from "react";
import MassScreen from "../battle/mass/MassScreen.jsx";
import { makeSprites } from "../battle/dex.js";
import { dexNum } from "../../../engine/src/core.mjs";
import { makeT } from "../i18n.js";

export default function MassApp({ data }) {
  const [lang, setLang] = useState("es");
  const [run, setRun] = useState(0);
  const t = useMemo(() => makeT(lang), [lang]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const sprites = useMemo(() => makeSprites({ server: data.sprite_server || "https://play.pokemonshowdown.com/sprites",
    set: data.sprite_set || "gen5ani", dexNum }), [data]);
  const doc = data.battle;
  return (
    <main className="p-wrap">
      <header className="flex flex-wrap items-center gap-3 mb-3">
        <h1 className="flex-1">{doc.title}</h1>
        <button className="btn btn-sm" onClick={() => setLang(lang === "es" ? "en" : "es")}>{lang === "es" ? "English" : "Español"}</button>
        <button className="btn btn-sm" onClick={() => setRun((n) => n + 1)}>{t("mass_share_restart")}</button>
      </header>
      <p className="help mb-3">{t("mass_share_assets")}</p>
      <MassScreen key={run} doc={doc} t={t} sprites={sprites} offline
        onCheck={async (hash) => ({ same: hash === doc.hash })} />
    </main>
  );
}
