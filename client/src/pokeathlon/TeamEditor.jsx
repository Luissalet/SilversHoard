// The editor of a team of three Pokémon (any of the Pokédex, the stars of each within that Pokémon's own range): used by the setup before a
// course, by the rivals' editors and by the "with friends" screens (the host's room and the friend's join page). It only needs the table of
// species (`rows` / `byId`), the strings `s` and the sprites; `trainers` (optional) offers "from trainer".
import React, { useEffect, useMemo, useRef, useState } from "react";
import { STAT_KEYS } from "./course.js";
import { randomSpec } from "./data.js";
import { STAT_COLORS } from "./strings.js";

const STAR_PATH = "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z";

function Star() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={STAR_PATH} /></svg>;
}

const clampStar = (row, stat, v) => Math.max(row.stars[stat].min, Math.min(row.stars[stat].max, Math.round(v)));
const valueOf = (spec, row, stat) => clampStar(row, stat, spec.stars && spec.stars[stat] !== undefined ? spec.stars[stat] : row.stars[stat].base);

function StarRow({ stat, row, value, onChange, s }) {
  const r = row.stars[stat];
  const tip = s(row.derived ? "stars_range_est" : "stars_range", { min: r.min, max: r.max, base: r.base });
  return (
    <div className="pk-starrow">
      <span className="pk-statname" style={{ color: STAT_COLORS[stat] }}>{s(`stat_${stat}`)}</span>
      <span className="pk-stars" role="radiogroup" aria-label={s(`stat_${stat}`)} title={tip}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}`} disabled={n < r.min || n > r.max}
            className={`pk-star${n <= value ? " on" : ""}${n === r.base ? " base" : ""}`} onClick={() => onChange(n)}><Star /></button>
        ))}
      </span>
    </div>
  );
}

function PokeSearch({ rows, row, onPick, s, sprites, label }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? rows.filter((r) => r.name.toLowerCase().includes(t) || String(r.num) === t) : rows;
    return list.slice(0, 40);
  }, [q, rows]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const pick = (r) => { onPick(r); setQ(""); setOpen(false); };
  return (
    <div className="pk-search" ref={box}>
      <input className="field" value={open ? q : row.name} placeholder={s("search_mon")} aria-label={label} role="combobox" aria-expanded={open}
        onFocus={(e) => { setOpen(true); setQ(""); e.target.select(); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); pick(matches[0]); } if (e.key === "Escape") setOpen(false); }} />
      {open && (
        <ul className="pk-search-list" role="listbox">
          {matches.map((r) => (
            <li key={r.id} role="option" aria-selected={r.id === row.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
                <img src={sprites.fallback(r.name)} alt="" width="28" height="28" loading="lazy" className="pixelated" />
                <span className="trunc">{r.name}</span>
                <span className="help num">#{r.num}</span>
              </button>
            </li>
          ))}
          {!matches.length && <li className="help p-2">{s("no_match")}</li>}
        </ul>
      )}
    </div>
  );
}

function MonSlot({ index, spec, row, rows, onChange, s, sprites }) {
  const total = STAT_KEYS.reduce((a, k) => a + valueOf(spec, row, k), 0);
  const setStar = (stat, n) => onChange({ ...spec, stars: { ...Object.fromEntries(STAT_KEYS.map((k) => [k, valueOf(spec, row, k)])), [stat]: n } });
  return (
    <div className="pk-slot">
      <div className="pk-slot-head">
        <img src={sprites.pokemon(row.name)} alt="" width="56" height="56" className={sprites.pixelated ? "pixelated" : ""}
          onError={(e) => { e.currentTarget.src = sprites.fallback(row.name); }} />
        <div className="min-w-0 grow">
          <PokeSearch rows={rows} row={row} onPick={(r) => onChange({ id: r.id, stars: null })} s={s} sprites={sprites} label={s("slot_n", { n: index + 1 })} />
          <div className="help pk-slot-sub">
            <span className="num">#{row.num}</span>
            {row.derived && <span className="chip chip-amber" title={s("estimated_help")}>{s("estimated")}</span>}
            <span>{s("stars_total", { n: total })}</span>
          </div>
        </div>
      </div>
      {STAT_KEYS.map((k) => <StarRow key={k} stat={k} row={row} value={valueOf(spec, row, k)} onChange={(n) => setStar(k, n)} s={s} />)}
      <div className="pk-slot-actions">
        <button type="button" className="btn btn-sm" onClick={() => onChange({ ...spec, stars: null })}>{s("reset_stars")}</button>
        <button type="button" className="btn btn-sm" onClick={() => {
          const r = rows[Math.floor(Math.random() * rows.length)];
          onChange({ id: r.id, stars: null });
        }}>{s("random_mon")}</button>
      </div>
    </div>
  );
}

export function TeamEditor({ team, rows, byId, onChange, s, sprites, color, title, allowName = true, trainers = [] }) {
  const fromTrainer = (id) => {
    const tr = trainers.find((x) => x.id === id);
    if (!tr) return;
    const found = [];
    for (const sp of tr.species) {
      const r = byId.get(String(sp).toLowerCase().replace(/[^a-z0-9]+/g, "")) || rows.find((x) => x.name === sp);
      if (r && !found.includes(r.id)) found.push(r.id);
      if (found.length === 3) break;
    }
    if (!found.length) return;
    while (found.length < 3) found.push(found[found.length - 1]);
    onChange({ name: tr.name, mons: found.map((fid) => ({ id: fid, stars: null })) });
  };
  return (
    <section className="pk-team" style={{ "--team": color }}>
      <div className="pk-team-head">
        <span className="pk-dot" />
        <h3>{title}</h3>
        {allowName && <input className="field pk-teamname" value={team.name} maxLength={24} aria-label={s("team_name")} onChange={(e) => onChange({ ...team, name: e.target.value })} />}
        <div className="pk-team-tools">
          {trainers.length > 0 && (
            <select className="field" aria-label={s("from_trainer")} value="" onChange={(e) => fromTrainer(e.target.value)}>
              <option value="">{s("from_trainer")}</option>
              {trainers.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-sm" onClick={() => onChange(randomSpec(rows, Math.random, team.name))}>{s("random_team")}</button>
        </div>
      </div>
      <div className="pk-slots">
        {team.mons.map((m, i) => (
          <MonSlot key={i} index={i} spec={m} row={byId.get(m.id)} rows={rows} s={s} sprites={sprites}
            onChange={(next) => onChange({ ...team, mons: team.mons.map((x, j) => (j === i ? next : x)) })} />
        ))}
      </div>
    </section>
  );
}
