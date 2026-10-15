// A visual team builder: up to six Pokémon, each with species, nickname, level, item, ability, nature, Tera type, stat points
// (Pokémon Champions' 66 / 32, kept as EVs) or classic EVs and IVs, and four moves picked with a click from what the species learns
// (or typed by hand), with suggestions from the Pokédex of the format's generation, and a damage calculator for the team.
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { TYPE_COLORS, nameOf, typeName } from "../battle/dex.js";
import { Busy, Field, Icon, ICONS, Modal, useBusy, useStored } from "./ui.jsx";
import { MonIcon } from "./silver.jsx";
import DamageCalc from "./DamageCalc.jsx";
import { SP_MAX, SP_TOTAL, calcStat, evFromSp, spFromEv } from "../../../engine/src/points.mjs";

const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];
const STAT_LABEL = { hp: ["PS", "HP"], atk: ["Atq", "Atk"], def: ["Def", "Def"], spa: ["AtE", "SpA"], spd: ["DfE", "SpD"], spe: ["Vel", "Spe"] };
const TYPES = Object.keys(TYPE_COLORS).filter((x) => x !== "???");
const toId = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
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

const CATS = ["Physical", "Special", "Status"];
const CAT_LABEL = { Physical: ["Físico", "Physical"], Special: ["Especial", "Special"], Status: ["Estado", "Status"] };
const catLabel = (c, lang) => (CAT_LABEL[c] ? CAT_LABEL[c][lang === "en" ? 1 : 0] : c);
const norm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Four move slots: a click opens the list of what the species learns; the text field stays for anything typed by hand. */
function MoveSlots({ set, moves, lang, t, id, onChange }) {
  const [open, setOpen] = useState(-1);
  const byName = useMemo(() => new Map(moves.map((m) => [norm(m.name), m])), [moves]);
  const put = (i, name) => { const m = [...set.moves]; m[i] = name; onChange(m); };
  return (
    <div className="space-y-1">
      <div className="tb-moves">
        {[0, 1, 2, 3].map((i) => {
          const name = set.moves[i] || "";
          const info = byName.get(norm(name));
          return (
            <button key={i} type="button" className={`tb-move ${name ? "" : "is-empty"}`} style={{ "--type": TYPE_COLORS[info?.type] || "#777" }}
              onClick={() => setOpen(i)} aria-label={`${t("tb_move")} ${i + 1}: ${name || t("tb_move_pick")}`}>
              {name ? <>
                <b className="trunc">{nameOf("move", info?.name || name, lang)}</b>
                <span className="tb-move-meta">{info ? `${typeName(info.type, lang)} · ${catLabel(info.category, lang)}${info.power ? ` · ${info.power}` : ""}` : t("tb_move_custom")}</span>
              </> : <span className="help">+ {t("tb_move_pick")}</span>}
            </button>
          );
        })}
      </div>
      {open >= 0 && <MovePicker slot={open} set={set} moves={moves} lang={lang} t={t} id={id} onClose={() => setOpen(-1)}
        onPick={(name) => { put(open, name); setOpen(-1); }} />}
    </div>
  );
}

// The Spanish in-game descriptions (moves and abilities) load on demand the first time a picker opens in Spanish.
let descsEs = null;
function useDescsEs(lang) {
  const [data, setData] = useState(descsEs);
  useEffect(() => {
    if (lang === "en" || data) return undefined;
    let live = true;
    import("../battle/descs-es.js").then((m) => { descsEs = m.default; if (live) setData(descsEs); }).catch(() => {});
    return () => { live = false; };
  }, [lang, data]);
  return lang === "en" ? null : data;
}

function MovePicker({ slot, set, moves, lang, t, id, onPick, onClose }) {
  const es = useDescsEs(lang);
  const descOf = (m) => es?.moves?.[m.id] || m.desc;
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState("name");
  const [typed, setTyped] = useState(set.moves[slot] || "");
  const taken = new Set(set.moves.filter((m, j) => m && j !== slot).map(norm));
  const types = [...new Set(moves.map((m) => m.type))].sort();
  const qn = norm(q);
  const list = moves
    .filter((m) => (!type || m.type === type) && (!cat || m.category === cat) && (!qn || norm(m.name).includes(qn) || norm(nameOf("move", m.name, lang)).includes(qn)))
    .sort((a, b) => (sort === "power" ? (b.power || 0) - (a.power || 0) : sort === "type" ? a.type.localeCompare(b.type) : 0)
      || nameOf("move", a.name, lang).localeCompare(nameOf("move", b.name, lang)));
  return (
    <Modal title={t("tb_move_title", { n: slot + 1, name: set.species || "?" })} onClose={onClose} wide
      footer={<>
        {set.moves[slot] && <button type="button" className="btn" onClick={() => onPick("")}>{t("tb_move_clear")}</button>}
        <span className="flex-1" />
        <button type="button" className="btn" onClick={onClose}>{t("cancel")}</button>
      </>}>
      {!set.species ? <p className="help">{t("tb_move_need_species")}</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className="field max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tb_move_search")} aria-label={t("tb_move_search")} />
            <select className="field max-w-[11rem]" value={type} onChange={(e) => setType(e.target.value)} aria-label={t("tb_move_type")}>
              <option value="">{t("tb_move_all_types")}</option>{types.map((x) => <option key={x} value={x}>{typeName(x, lang)}</option>)}
            </select>
            <div className="seg" role="group" aria-label={t("tb_move_cat")}>
              <button type="button" aria-pressed={!cat} onClick={() => setCat("")}>{t("all")}</button>
              {CATS.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{catLabel(c, lang)}</button>)}
            </div>
            <select className="field max-w-[10rem]" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("tb_move_sort")}>
              <option value="name">{t("tb_move_sort_name")}</option><option value="power">{t("tb_move_sort_power")}</option><option value="type">{t("tb_move_sort_type")}</option>
            </select>
            <span className="help">{t("tb_move_count", { n: list.length })}</span>
          </div>
          <div className="tb-move-list" role="listbox" aria-label={t("tb_move_title", { n: slot + 1, name: set.species })}>
            {list.map((m) => {
              const used = taken.has(norm(m.name));
              const on = norm(set.moves[slot]) === norm(m.name);
              return (
                <button key={m.id} type="button" role="option" aria-selected={on} className={`tb-move-row ${on ? "is-on" : ""}`} disabled={used}
                  style={{ "--type": TYPE_COLORS[m.type] || "#777" }} onClick={() => onPick(m.name)} title={descOf(m)}>
                  <span className="b-type" style={{ background: TYPE_COLORS[m.type] }}>{typeName(m.type, lang)}</span>
                  <b className="trunc">{nameOf("move", m.name, lang)}</b>
                  <span className="help">{catLabel(m.category, lang)}</span>
                  <span className="num">{m.power || "—"}</span>
                  <span className="num help">{m.accuracy === true ? "—" : `${m.accuracy}%`}</span>
                  <span className="num help">{m.pp} PP</span>
                  <span className="help trunc tb-move-desc">{used ? t("tb_move_used") : descOf(m)}</span>
                </button>
              );
            })}
            {!list.length && <p className="help">{t("tb_move_none")}</p>}
          </div>
        </>
      )}
      <Field label={t("tb_move_typed")}>
        <div className="flex gap-2">
          <input className="field" list={`${id}-mv-any`} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) onPick(typed.trim()); }} />
          <datalist id={`${id}-mv-any`}>{moves.map((m) => <option key={m.id} value={m.name}>{nameOf("move", m.name, lang)}</option>)}</datalist>
          <button type="button" className="btn" disabled={!typed.trim()} onClick={() => onPick(typed.trim())}>{t("tb_move_use")}</button>
        </div>
      </Field>
    </Modal>
  );
}

/** Pokémon Champions' stat points: 66 per Pokémon, 32 at most in one stat, each one stat point more at level 50. Kept as EVs. */
function StatPoints({ set, sp, natures, lang, t, onChange }) {
  const pts = Object.fromEntries(STATS.map((k) => [k, spFromEv(set.evs?.[k])]));
  const total = STATS.reduce((a, k) => a + pts[k], 0);
  const nat = natures.find((n) => n.name === set.nature);
  const level = Number(set.level) || 100;
  const put = (k, v) => {
    const room = SP_TOTAL - (total - pts[k]);
    const next = Math.max(0, Math.min(SP_MAX, room, Math.floor(Number(v) || 0)));
    onChange(Object.fromEntries(STATS.map((x) => [x, evFromSp(x === k ? next : pts[x])])));
  };
  const oddIvs = STATS.some((k) => (set.ivs?.[k] ?? 31) !== 31);
  return (
    <div className="space-y-2 mt-2">
      <div className="tb-sp">
        {STATS.map((k) => {
          const mult = nat?.plus === k ? 1.1 : nat?.minus === k ? 0.9 : 1;
          const base = sp?.base_stats?.[k];
          const value = base ? calcStat(k, base, { level, ev: evFromSp(pts[k]), iv: set.ivs?.[k] ?? 31, nature: mult }) : null;
          return (
            <div key={k} className="tb-sp-row">
              <span className={`tb-sp-label ${mult > 1 ? "is-up" : mult < 1 ? "is-down" : ""}`}>{lang === "en" ? STAT_LABEL[k][1] : STAT_LABEL[k][0]}</span>
              <span className="help num">{base ?? "—"}</span>
              <button type="button" className="btn btn-sm btn-icon" onClick={() => put(k, pts[k] - 1)} disabled={!pts[k]} aria-label={t("tb_sp_less", { stat: k })}>−</button>
              <input className="field num tb-sp-input" type="number" min={0} max={SP_MAX} value={pts[k]} onChange={(e) => put(k, e.target.value)} aria-label={t("tb_sp_of", { stat: k })} />
              <button type="button" className="btn btn-sm btn-icon" onClick={() => put(k, pts[k] + 1)} disabled={pts[k] >= SP_MAX || total >= SP_TOTAL} aria-label={t("tb_sp_more", { stat: k })}>+</button>
              <span className="tb-sp-bar"><span style={{ width: `${(pts[k] / SP_MAX) * 100}%` }} /></span>
              <b className="num tb-sp-value" title={t("tb_sp_value", { level })}>{value ?? "—"}</b>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${total > SP_TOTAL ? "chip-bad" : ""}`}>{t("tb_sp_left", { n: SP_TOTAL - total, total: SP_TOTAL })}</span>
        <span className="help">{t("tb_sp_help", { level })}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(Object.fromEntries(STATS.map((x) => [x, 0])))} disabled={!total}>{t("tb_sp_reset")}</button>
      </div>
      {oddIvs && <p className="help">{t("tb_sp_ivs")}</p>}
    </div>
  );
}

function SetEditor({ set, index, gen, onChange, onRemove, lang, t, evMode, setEvMode }) {
  const es = useDescsEs(lang);
  const species = useDex("species", gen);
  const items = useDex("items", gen);
  const natures = useDex("natures", gen);
  const moves = useDex("moves", gen, set.species);
  const sp = species.find((s) => s.name.toLowerCase() === (set.species || "").toLowerCase());
  const ev = Object.values(set.evs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const spTotal = STATS.reduce((a, k) => a + spFromEv(set.evs?.[k]), 0);
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
          {set.ability && es?.abilities?.[toId(set.ability)] && <p className="help tb-ability-desc">{es.abilities[toId(set.ability)]}</p>}
        </Field>
        <Field label={t("tb_nature")}>
          <select className="field" value={set.nature} onChange={(e) => upd("nature", e.target.value)}>
            <option value="">—</option>
            {natures.map((n) => <option key={n.id} value={n.name}>{nameOf("nature", n.name, lang)}{n.plus ? ` (+${n.plus} −${n.minus})` : ""}</option>)}
          </select>
        </Field>
      </div>
      <MoveSlots set={set} moves={moves} lang={lang} t={t} id={id} onChange={(m) => upd("moves", m)} />
      <details className="tb-more">
        <summary className="help">{evMode === "sp" ? t("tb_more_sp", { sp: spTotal, max: SP_TOTAL }) : t("tb_more", { ev })}</summary>
        <div className="seg mt-2" role="group" aria-label={t("tb_ev_mode")}>
          <button type="button" aria-pressed={evMode === "sp"} onClick={() => setEvMode("sp")}>{t("tb_ev_sp")}</button>
          <button type="button" aria-pressed={evMode === "ev"} onClick={() => setEvMode("ev")}>{t("tb_ev_classic")}</button>
        </div>
        {evMode === "sp" ? <StatPoints set={set} sp={sp} natures={natures} lang={lang} t={t} onChange={(evs) => upd("evs", evs)} /> : (
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
        )}
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
        {evMode === "ev" && ev > 510 && <div className="banner banner-warn mt-2">{t("tb_ev_over", { ev })}</div>}
      </details>
    </div>
  );
}

/** props: team (sets), format, onSave(sets) */
export default function TeamBuilder({ team, format, onSave, onCancel }) {
  const { t, lang } = useApp();
  const [evMode, setEvMode] = useStored("silver-ev-mode", "sp");
  const gen = Number(String(format || "gen9").match(/gen(\d)/)?.[1] || 9);
  const [sets, setSets] = useState(() => (team && team.length ? team.map((s) => ({ ...empty(), ...s, moves: [...(s.moves || []), "", "", "", ""].slice(0, 4) })) : [empty()]));
  const [busy, run] = useBusy();
  const clean = useMemo(() => sets.filter((s) => s.species.trim()).map((s) => ({ ...s, moves: s.moves.map((m) => m.trim()).filter(Boolean) })), [sets]);
  return (
    <div className="space-y-3">
      {sets.map((s, i) => (
        <SetEditor key={i} index={i} set={s} gen={gen} lang={lang} t={t} evMode={evMode} setEvMode={setEvMode} onChange={(v) => setSets((x) => x.map((y, j) => (j === i ? v : y)))}
          onRemove={() => setSets((x) => x.filter((_, j) => j !== i))} />
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={sets.length >= 6} onClick={() => setSets((x) => [...x, empty()])}><Icon d={ICONS.plus} size={14} /> {t("tb_add")}</button>
        <span className="flex-1" />
        {onCancel && <button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button>}
        <Busy busy={busy.s} className="btn btn-primary" disabled={!clean.length || clean.some((s) => !s.moves.length)} onClick={() => run("s", () => onSave(clean))}>{t("save")}</Busy>
      </div>
      {clean.some((s) => !s.moves.length) && <p className="help">{t("tb_needs_moves")}</p>}
      <DamageCalc sets={clean} format={format} lang={lang} gen={gen} />
    </div>
  );
}
