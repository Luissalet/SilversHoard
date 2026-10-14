// A visual team builder: up to six Pokémon, each with species, nickname, level, item, ability, nature, Tera type, EVs and four
// moves, with suggestions from the Pokédex of the format's generation (moves filtered to what the species can learn).
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { TYPE_COLORS, nameOf, typeName } from "../battle/dex.js";
import { Busy, Field, Icon, ICONS, useBusy } from "./ui.jsx";
import { MonIcon } from "./silver.jsx";

const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];
const STAT_LABEL = { hp: ["PS", "HP"], atk: ["Atq", "Atk"], def: ["Def", "Def"], spa: ["AtE", "SpA"], spd: ["DfE", "SpD"], spe: ["Vel", "Spe"] };
const TYPES = Object.keys(TYPE_COLORS).filter((x) => x !== "???");
const empty = () => ({ name: "", species: "", item: "", ability: "", moves: ["", "", "", ""], nature: "", gender: "", level: 100, teraType: "",
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } });

const cache = new Map();
function useDex(kind, gen, species = "") {
  const key = `${kind}:${gen}:${species}`;
  const [list, setList] = useState(cache.get(key) || []);
  useEffect(() => {
    if (cache.has(key)) { setList(cache.get(key)); return; }
    if (kind === "moves" && !species) { setList([]); return; }
    api.call("dex_search", { kind, gen, species, limit: 1000 }).then((r) => { cache.set(key, r.results); setList(r.results); }).catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

function SetEditor({ set, index, gen, onChange, onRemove, lang, t }) {
  const species = useDex("species", gen);
  const items = useDex("items", gen);
  const natures = useDex("natures", gen);
  const moves = useDex("moves", gen, set.species);
  const sp = species.find((s) => s.name.toLowerCase() === (set.species || "").toLowerCase());
  const ev = Object.values(set.evs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const upd = (k, v) => onChange({ ...set, [k]: v });
  const id = `set-${index}`;
  return (
    <div className="tb-set">
      <div className="tb-head">
        <MonIcon species={set.species || "unknown"} size={64} />
        <div className="min-w-0 flex-1 grid gap-2 sm:grid-cols-2">
          <Field label={t("tb_species")}>
            <input className="field" list={`${id}-sp`} value={set.species} onChange={(e) => upd("species", e.target.value)} placeholder="Garchomp" />
            <datalist id={`${id}-sp`}>{species.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          </Field>
          <Field label={t("tb_nickname")}><input className="field" value={set.name} onChange={(e) => upd("name", e.target.value)} maxLength={18} /></Field>
        </div>
        <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={onRemove} aria-label={t("remove")}><Icon d={ICONS.trash} size={14} /></button>
      </div>
      {sp && <div className="flex flex-wrap items-center gap-1">{sp.types.map((x) => <span key={x} className="b-type" style={{ background: TYPE_COLORS[x] }}>{typeName(x, lang)}</span>)}
        <span className="help num">{STATS.map((k) => `${lang === "en" ? STAT_LABEL[k][1] : STAT_LABEL[k][0]} ${sp.base_stats[k]}`).join(" · ")}</span></div>}
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label={t("lv")}><input className="field" type="number" min={1} max={100} value={set.level} onChange={(e) => upd("level", Number(e.target.value) || 100)} /></Field>
        <Field label={t("tb_item")}>
          <input className="field" list={`${id}-it`} value={set.item} onChange={(e) => upd("item", e.target.value)} />
          <datalist id={`${id}-it`}>{items.map((x) => <option key={x.id} value={x.name}>{nameOf("item", x.name, lang)}</option>)}</datalist>
        </Field>
        <Field label={t("tb_ability")}>
          <select className="field" value={set.ability} onChange={(e) => upd("ability", e.target.value)}>
            <option value="">—</option>
            {(sp?.abilities || []).map((a) => <option key={a} value={a}>{nameOf("ability", a, lang)}</option>)}
            {set.ability && !(sp?.abilities || []).includes(set.ability) && <option value={set.ability}>{set.ability}</option>}
          </select>
        </Field>
        <Field label={t("tb_nature")}>
          <select className="field" value={set.nature} onChange={(e) => upd("nature", e.target.value)}>
            <option value="">—</option>
            {natures.map((n) => <option key={n.id} value={n.name}>{nameOf("nature", n.name, lang)}{n.plus ? ` (+${n.plus} −${n.minus})` : ""}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Field key={i} label={`${t("tb_move")} ${i + 1}`}>
            <input className="field" list={`${id}-mv`} value={set.moves[i] || ""} onChange={(e) => { const m = [...set.moves]; m[i] = e.target.value; upd("moves", m); }} />
          </Field>
        ))}
        <datalist id={`${id}-mv`}>{moves.map((m) => <option key={m.id} value={m.name}>{`${nameOf("move", m.name, lang)} · ${typeName(m.type, lang)}${m.power ? ` · ${m.power}` : ""}`}</option>)}</datalist>
      </div>
      <details className="tb-more">
        <summary className="help">{t("tb_more", { ev })}</summary>
        <div className="grid gap-2 sm:grid-cols-6 mt-2">
          {STATS.map((k) => (
            <Field key={k} label={`EV ${lang === "en" ? STAT_LABEL[k][1] : STAT_LABEL[k][0]}`}>
              <input className="field" type="number" min={0} max={252} step={4} value={set.evs?.[k] ?? 0} onChange={(e) => upd("evs", { ...set.evs, [k]: Math.max(0, Math.min(252, Number(e.target.value) || 0)) })} />
            </Field>
          ))}
          {STATS.map((k) => (
            <Field key={`iv${k}`} label={`IV ${lang === "en" ? STAT_LABEL[k][1] : STAT_LABEL[k][0]}`}>
              <input className="field" type="number" min={0} max={31} value={set.ivs?.[k] ?? 31} onChange={(e) => upd("ivs", { ...set.ivs, [k]: Math.max(0, Math.min(31, Number(e.target.value) || 0)) })} />
            </Field>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3 mt-2">
          <Field label={t("tera_type")}>
            <select className="field" value={set.teraType || ""} onChange={(e) => upd("teraType", e.target.value)}>
              <option value="">—</option>{TYPES.map((x) => <option key={x} value={x}>{typeName(x, lang)}</option>)}
            </select>
          </Field>
          <Field label={t("tb_gender")}>
            <select className="field" value={set.gender || ""} onChange={(e) => upd("gender", e.target.value)}>
              <option value="">—</option><option value="M">♂</option><option value="F">♀</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={!!set.shiny} onChange={(e) => upd("shiny", e.target.checked)} /> {t("tb_shiny")}</label>
        </div>
        {ev > 510 && <div className="banner banner-warn mt-2">{t("tb_ev_over", { ev })}</div>}
      </details>
    </div>
  );
}

/** props: team (sets), format, onSave(sets) */
export default function TeamBuilder({ team, format, onSave, onCancel }) {
  const { t, lang } = useApp();
  const gen = Number(String(format || "gen9").match(/gen(\d)/)?.[1] || 9);
  const [sets, setSets] = useState(() => (team && team.length ? team.map((s) => ({ ...empty(), ...s, moves: [...(s.moves || []), "", "", "", ""].slice(0, 4) })) : [empty()]));
  const [busy, run] = useBusy();
  const clean = useMemo(() => sets.filter((s) => s.species.trim()).map((s) => ({ ...s, moves: s.moves.map((m) => m.trim()).filter(Boolean) })), [sets]);
  return (
    <div className="space-y-3">
      {sets.map((s, i) => (
        <SetEditor key={i} index={i} set={s} gen={gen} lang={lang} t={t} onChange={(v) => setSets((x) => x.map((y, j) => (j === i ? v : y)))}
          onRemove={() => setSets((x) => x.filter((_, j) => j !== i))} />
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={sets.length >= 6} onClick={() => setSets((x) => [...x, empty()])}><Icon d={ICONS.plus} size={14} /> {t("tb_add")}</button>
        <span className="flex-1" />
        {onCancel && <button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button>}
        <Busy busy={busy.s} className="btn btn-primary" disabled={!clean.length || clean.some((s) => !s.moves.length)} onClick={() => run("s", () => onSave(clean))}>{t("save")}</Busy>
      </div>
      {clean.some((s) => !s.moves.length) && <p className="help">{t("tb_needs_moves")}</p>}
    </div>
  );
}
