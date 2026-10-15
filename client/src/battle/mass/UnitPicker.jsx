// Choosing the Pokémon a person plays in a mass battle (the app's battle page and the friends' playable page): every unit of the
// spec, by team, filtered by name or team as you type. The index is the unit's place in the battle, team after team, the same
// order the engine builds them in (mass.mjs).
import React, { useMemo, useState } from "react";

const SHOWN = 120;

export function massUnits(spec) {
  const out = [];
  (spec?.teams || []).forEach((tm, ti) => {
    (tm.units || []).forEach((u) => {
      const set = u.set || u;
      out.push({ i: out.length, team: ti, team_name: spec.mode === "ffa" ? "" : tm.name || "", color: tm.color || "", species: set.species,
        name: set.name || set.species, boss: !!u.boss, level: set.level || 0 });
    });
  });
  return out;
}

export default function UnitPicker({ spec, t, onPick, onCancel = null }) {
  const [q, setQ] = useState("");
  const units = useMemo(() => massUnits(spec), [spec]);
  const needle = q.trim().toLowerCase();
  const found = needle ? units.filter((u) => `${u.name} ${u.species} ${u.team_name}`.toLowerCase().includes(needle)) : units;
  return (
    <div className="mass-picker space-y-2">
      <p className="help">{t("mass_play_help")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-[320px]" autoFocus value={q} placeholder={t("mass_pick_search")} onChange={(e) => setQ(e.target.value)} />
        {onCancel && <button type="button" className="btn btn-sm" onClick={onCancel}>{t("mass_back")}</button>}
      </div>
      <div className="mass-pick-grid">
        {found.slice(0, SHOWN).map((u) => (
          <button key={u.i} type="button" className={`mass-pick ${u.boss ? "is-boss" : ""}`} style={u.color ? { borderColor: u.color } : null} onClick={() => onPick(u.i)}>
            <b>{u.name}</b>
            <span className="help">{u.team_name || (u.name !== u.species ? u.species : "")}{u.boss ? " ★" : ""}</span>
          </button>
        ))}
      </div>
      {found.length > SHOWN && <p className="help">{t("mass_pick_more", { n: found.length - SHOWN })}</p>}
    </div>
  );
}
