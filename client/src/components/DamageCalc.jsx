// Damage calculator for the team builder: one of the team's Pokémon against a rival (any Pokémon, or one from a saved trainer),
// with stat boosts, Tera, weather, terrain, screens and the rival's HP. The numbers come from the engine (damage_calc tool): the
// game's own formula of the format's generation over the 16 damage rolls.
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { L, TYPE_COLORS, nameOf, typeName } from "../battle/dex.js";
import { Busy, ErrorBox, Field, useBusy } from "./ui.jsx";
import { MonIcon, useTrainers } from "./silver.jsx";

const S = {
  title: ["Calculadora de daño", "Damage calculator"],
  attacker: ["Atacante", "Attacker"],
  rival: ["Rival", "Defender"],
  source_mon: ["Un Pokémon", "Any Pokémon"],
  source_trainer: ["De un entrenador", "From a trainer"],
  species: ["Pokémon", "Pokémon"],
  level: ["Nivel", "Level"],
  item: ["Objeto", "Item"],
  bulk: ["Reparto de EV", "EV spread"],
  bulk_none: ["Sin EV", "No EVs"],
  bulk_hp: ["252 PS", "252 HP"],
  bulk_def: ["252 PS / 252 Def", "252 HP / 252 Def"],
  bulk_spd: ["252 PS / 252 DfE", "252 HP / 252 SpD"],
  trainer: ["Entrenador", "Trainer"],
  pokemon: ["Pokémon", "Pokémon"],
  atk_boost: ["Mejoras de ataque", "Attack boosts"],
  def_boost: ["Mejoras de defensa", "Defense boosts"],
  tera_atk: ["Atacante teracristalizado", "Attacker Terastallized"],
  tera_def: ["Rival teracristalizado", "Defender Terastallized"],
  mega_atk: ["Atacante megaevolucionado", "Attacker Mega Evolved"],
  mega_def: ["Rival megaevolucionado", "Defender Mega Evolved"],
  weather: ["Tiempo", "Weather"],
  terrain: ["Campo", "Terrain"],
  screens: ["Pantallas del rival", "Defender's screens"],
  hp_left: ["PS del rival (%)", "Defender's HP (%)"],
  calc: ["Calcular", "Calculate"],
  move: ["Movimiento", "Move"],
  damage: ["Daño", "Damage"],
  hp: ["PS", "HP"],
  ko: ["KO", "KO"],
  crit: ["Crítico", "Crit"],
  immune: ["No le afecta", "No effect"],
  status_move: ["Movimiento de estado", "Status move"],
  ohko_sure: ["KO seguro de un golpe", "Guaranteed OHKO"],
  ohko_chance: ["{p} % de KO de un golpe", "{p}% chance to OHKO"],
  ko_n: ["KO en {n} golpes", "{n}HKO"],
  ko_range: ["KO en {n}–{m} golpes", "{n}HKO to {m}HKO"],
  no_ko: ["No llega a debilitar", "Never knocks out"],
  needs_team: ["Añade un Pokémon con movimientos para calcular.", "Add a Pokémon with moves to calculate."],
  needs_rival: ["Elige el rival.", "Pick the defender."],
  stats: ["{a} contra {d}: {hp} PS", "{a} against {d}: {hp} HP"],
};
const WEATHERS = [["auto", ["Según las habilidades", "From abilities"]], ["", ["Ninguno", "None"]], ["sun", ["Sol", "Sun"]], ["rain", ["Lluvia", "Rain"]], ["sand", ["Tormenta de arena", "Sandstorm"]],
  ["snow", ["Nieve", "Snow"]], ["hail", ["Granizo", "Hail"]]];
const TERRAINS = [["auto", ["Según las habilidades", "From abilities"]], ["", ["Ninguno", "None"]], ["electric", ["Eléctrico", "Electric"]], ["grassy", ["Hierba", "Grassy"]],
  ["psychic", ["Psíquico", "Psychic"]], ["misty", ["Niebla", "Misty"]]];
const SCREENS = [["reflect", ["Reflejo", "Reflect"]], ["lightscreen", ["Pantalla de Luz", "Light Screen"]], ["auroraveil", ["Velo Aurora", "Aurora Veil"]]];
const BULK = {
  none: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  hp: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  def: { hp: 252, atk: 0, def: 252, spa: 0, spd: 0, spe: 0 },
  spd: { hp: 252, atk: 0, def: 0, spa: 0, spd: 252, spe: 0 },
};
const STAGES = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

/** Whether a set holds a Mega Stone (the engine checks the species too). */
const canMega = (set) => /ite( [XY])?$/i.test(String(set?.item || "").trim()) && !/^eviolite$/i.test(String(set?.item || "").trim());

const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

/** What a row's KO column says. */
export function koLabel(m, lang) {
  const s = (k, v) => fill(L(S[k], lang), v);
  if (m.category === "Status") return s("status_move");
  if (m.immune) return s("immune");
  if (!m.max) return s("no_ko");
  if (m.ohko_rolls >= 16) return s("ohko_sure");
  if (m.ohko_rolls > 0) return s("ohko_chance", { p: Math.round((m.ohko_rolls / 16) * 100) });
  const n = m.ko?.hits;
  const sure = m.ko?.hits_sure;
  if (!n) return s("no_ko");
  return !sure || sure === n ? s("ko_n", { n }) : s("ko_range", { n, m: sure });
}

/** props: sets (the team being edited), format, lang, gen */
export default function DamageCalc({ sets, format, lang, gen }) {
  const s = (k, v) => fill(L(S[k], lang), v);
  const trainers = useTrainers([]);
  const team = useMemo(() => (sets || []).filter((x) => x.species && (x.moves || []).some(Boolean)), [sets]);
  const [atkIndex, setAtkIndex] = useState(0);
  const [source, setSource] = useState("mon");
  const [rival, setRival] = useState({ species: "", level: 100, item: "", bulk: "none" });
  const [trainerId, setTrainerId] = useState("");
  const [trainerMon, setTrainerMon] = useState(0);
  const [field, setField] = useState({ atk: 0, def: 0, teraAtk: false, teraDef: false, weather: "auto", terrain: "auto", screens: [], hp: 100, megaAtk: false, megaDef: false });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [speciesList, setSpeciesList] = useState([]);
  const [busy, run] = useBusy();
  useEffect(() => {
    api.call("dex_search", { kind: "species", gen, limit: 1000 }).then((r) => setSpeciesList(r.results)).catch(() => {});
  }, [gen]);
  useEffect(() => { if (atkIndex >= team.length) setAtkIndex(0); }, [team.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const attacker = team[atkIndex];
  const trainer = trainers.find((x) => x.id === trainerId);
  const defender = source === "trainer"
    ? trainer?.team?.[trainerMon] || null
    : rival.species.trim() ? { species: rival.species.trim(), level: Number(rival.level) || 100, item: rival.item.trim(), evs: BULK[rival.bulk] } : null;
  const upd = (k, v) => setField((f) => ({ ...f, [k]: v }));
  const calc = () => run("c", async () => {
    setError(null);
    try {
      const both = (n) => (n ? { atk: n, spa: n } : undefined);
      const bothDef = (n) => (n ? { def: n, spd: n } : undefined);
      const r = await api.call("damage_calc", {
        attacker: { ...attacker, moves: attacker.moves.filter(Boolean) }, defender, format,
        attacker_boosts: both(field.atk), defender_boosts: bothDef(field.def),
        attacker_tera: field.teraAtk ? "yes" : "", defender_tera: field.teraDef ? "yes" : "",
        weather: field.weather === "auto" ? undefined : field.weather, terrain: field.terrain === "auto" ? undefined : field.terrain, screens: field.screens,
        attacker_mega: field.megaAtk && canMega(attacker), defender_mega: field.megaDef && canMega(defender), defender_hp: field.hp < 100 ? field.hp : undefined,
      });
      setResult(r);
    } catch (e) {
      setResult(null);
      setError(e);
    }
  });
  return (
    <details className="tb-more dcalc">
      <summary className="help">{s("title")}</summary>
      {!team.length ? <p className="help mt-2">{s("needs_team")}</p> : body()}
    </details>
  );

  function body() {
    return (
    <div className="space-y-3 mt-2">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <div className="help">{s("attacker")}</div>
          <div className="flex flex-wrap gap-1">
            {team.map((x, i) => (
              <button key={i} type="button" className={`btn btn-sm ${i === atkIndex ? "btn-primary" : ""}`} onClick={() => setAtkIndex(i)} aria-pressed={i === atkIndex}>
                <MonIcon species={x.species} size={28} /> {x.name || x.species}
              </button>
            ))}
          </div>
          <div className="grid gap-2 grid-cols-2">
            <Field label={s("atk_boost")}>
              <select className="field" value={field.atk} onChange={(e) => upd("atk", Number(e.target.value))}>
                {STAGES.map((n) => <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>)}
              </select>
            </Field>
            {gen >= 9 && <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={field.teraAtk} onChange={(e) => upd("teraAtk", e.target.checked)} /> {s("tera_atk")}</label>}
            {gen >= 6 && canMega(attacker) && <label className="flex items-center gap-2"><input type="checkbox" checked={field.megaAtk} onChange={(e) => upd("megaAtk", e.target.checked)} /> {s("mega_atk")}</label>}
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="help">{s("rival")}</span>
            <label className="flex items-center gap-1"><input type="radio" name="dc-src" checked={source === "mon"} onChange={() => setSource("mon")} /> {s("source_mon")}</label>
            <label className="flex items-center gap-1"><input type="radio" name="dc-src" checked={source === "trainer"} onChange={() => setSource("trainer")} /> {s("source_trainer")}</label>
          </div>
          {source === "mon" ? (
            <div className="grid gap-2 grid-cols-2">
              <Field label={s("species")}>
                <input className="field" list="dc-species" value={rival.species} onChange={(e) => setRival({ ...rival, species: e.target.value })} placeholder="Garchomp" />
                <datalist id="dc-species">{speciesList.map((x) => <option key={x.id} value={x.name} />)}</datalist>
              </Field>
              <Field label={s("level")}><input className="field" type="number" min={1} max={100} value={rival.level} onChange={(e) => setRival({ ...rival, level: e.target.value })} /></Field>
              <Field label={s("item")}><input className="field" value={rival.item} onChange={(e) => setRival({ ...rival, item: e.target.value })} /></Field>
              <Field label={s("bulk")}>
                <select className="field" value={rival.bulk} onChange={(e) => setRival({ ...rival, bulk: e.target.value })}>
                  {["none", "hp", "def", "spd"].map((k) => <option key={k} value={k}>{s(`bulk_${k}`)}</option>)}
                </select>
              </Field>
            </div>
          ) : (
            <div className="grid gap-2 grid-cols-2">
              <Field label={s("trainer")}>
                <select className="field" value={trainerId} onChange={(e) => { setTrainerId(e.target.value); setTrainerMon(0); }}>
                  <option value="">—</option>
                  {trainers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
              <Field label={s("pokemon")}>
                <select className="field" value={trainerMon} onChange={(e) => setTrainerMon(Number(e.target.value))} disabled={!trainer}>
                  {(trainer?.team || []).map((x, i) => <option key={i} value={i}>{x.name || x.species}</option>)}
                </select>
              </Field>
            </div>
          )}
          <div className="grid gap-2 grid-cols-2">
            <Field label={s("def_boost")}>
              <select className="field" value={field.def} onChange={(e) => upd("def", Number(e.target.value))}>
                {STAGES.map((n) => <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>)}
              </select>
            </Field>
            <Field label={s("hp_left")}><input className="field" type="number" min={1} max={100} value={field.hp} onChange={(e) => upd("hp", Math.max(1, Math.min(100, Number(e.target.value) || 100)))} /></Field>
            {gen >= 9 && <label className="flex items-center gap-2"><input type="checkbox" checked={field.teraDef} onChange={(e) => upd("teraDef", e.target.checked)} /> {s("tera_def")}</label>}
            {gen >= 6 && canMega(defender) && <label className="flex items-center gap-2"><input type="checkbox" checked={field.megaDef} onChange={(e) => upd("megaDef", e.target.checked)} /> {s("mega_def")}</label>}
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={s("weather")}>
          <select className="field" value={field.weather} onChange={(e) => upd("weather", e.target.value)}>{WEATHERS.map(([k, n]) => <option key={k} value={k}>{L(n, lang)}</option>)}</select>
        </Field>
        {gen >= 6 && <Field label={s("terrain")}>
          <select className="field" value={field.terrain} onChange={(e) => upd("terrain", e.target.value)}>{TERRAINS.map(([k, n]) => <option key={k} value={k}>{L(n, lang)}</option>)}</select>
        </Field>}
        <Field label={s("screens")}>
          <div className="flex flex-wrap gap-2 pt-1">
            {SCREENS.map(([k, n]) => (
              <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={field.screens.includes(k)}
                onChange={(e) => upd("screens", e.target.checked ? [...field.screens, k] : field.screens.filter((x) => x !== k))} /> {L(n, lang)}</label>
            ))}
          </div>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Busy busy={busy.c} className="btn btn-primary" disabled={!attacker || !defender} onClick={calc}>{s("calc")}</Busy>
        {!defender && <span className="help">{s("needs_rival")}</span>}
      </div>
      {error && <ErrorBox error={error} />}
      {result && (
        <div className="space-y-1">
          <p className="help">{s("stats", { a: nameOf("species", result.attacker.species, lang), d: nameOf("species", result.defender.species, lang), hp: `${result.defender_hp}/${result.defender.maxhp}` })}</p>
          <div className="overflow-x-auto">
            <table className="tbl w-full">
              <thead><tr><th>{s("move")}</th><th className="r">{s("damage")}</th><th className="r">{s("hp")}</th><th className="r">{s("crit")}</th><th>{s("ko")}</th></tr></thead>
              <tbody>
                {result.moves.filter((m) => !m.error).map((m) => (
                  <tr key={m.id}>
                    <td><span className="b-type" style={{ background: TYPE_COLORS[m.type] }}>{typeName(m.type, lang)}</span> {nameOf("move", m.move, lang)}</td>
                    <td className="r num">{m.category === "Status" || m.immune ? "—" : `${m.min_pct}–${m.max_pct} %`}</td>
                    <td className="r num">{m.category === "Status" || m.immune ? "—" : `${m.min}–${m.max}`}</td>
                    <td className="r num">{m.category === "Status" || m.immune ? "—" : `${Math.round((1000 * m.crit_max) / result.defender.maxhp) / 10} %`}</td>
                    <td>{koLabel(m, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
    );
  }
}
