import React from "react";
import { useApp } from "../context.js";
import { MonIcon } from "./silver.jsx";
import { nameOf } from "../battle/dex.js";

export default function TeamSelection({ pool, value, onChange }) {
  const { t, lang } = useApp();
  const selected = value ?? pool.slice(0, 6).map((_, i) => i);
  const toggle = (i) => onChange(selected.includes(i) ? selected.filter((n) => n !== i) : [...selected, i]);
  return <fieldset className="space-y-2">
    <legend className="label">{t("choose_six_count", { n: selected.length })}</legend>
    <p className="help">{t("choose_six_help")}</p>
    <div className="pick-grid">
      {pool.map((mon, i) => <label key={i} className={`pick ${selected.includes(i) ? "is-on" : ""}`}>
        <input type="checkbox" checked={selected.includes(i)} disabled={!selected.includes(i) && selected.length >= 6} onChange={() => toggle(i)} />
        <MonIcon species={mon.species} size={32} />
        <span className="min-w-0"><b>{mon.name || mon.species}</b><span className="help block">{[mon.item && nameOf("item", mon.item, lang), ...(mon.moves || []).map((m) => nameOf("move", m, lang))].filter(Boolean).join(" · ")}</span></span>
      </label>)}
    </div>
  </fieldset>;
}
