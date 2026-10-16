// Popular sets of a species (Smogon's, through data.pkmn.cc) with its usage on Showdown's ladder: pick one to fill the team
// member; and a sample team made of the format's most used Pokémon. Fetched when asked for and cached by the app.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Icon, ICONS, Modal, Spinner, useBusy } from "./ui.jsx";
import { L, nameOf, typeName } from "../battle/dex.js";

const S = {
  none: ["No hay sets publicados para esta especie en este formato.", "No published sets for this species in this format."],
  usage: ["Uso en el ranking ({fmt}): {pct}", "Ladder usage ({fmt}): {pct}"],
  items: ["Objetos", "Items"], abilities: ["Habilidades", "Abilities"], moves: ["Movimientos", "Moves"], teammates: ["Compañeros", "Teammates"],
  tera: ["Teratipos", "Tera types"],
  from: ["Sets de {fmt}", "Sets from {fmt}"],
  credit: ["Sets de Smogon y estadísticas de uso de Showdown, vía data.pkmn.cc (se descargan al pedirlos).",
    "Smogon's sets and Showdown's usage statistics, via data.pkmn.cc (downloaded when asked for)."],
  sample: ["Equipo de muestra", "Sample team"],
  sample_confirm: ["Se cambia el equipo por los seis Pokémon más usados del formato con su set más popular.",
    "The team is replaced by the format's six most used Pokémon with their most popular set."],
  sample_none: ["No hay estadísticas de uso para este formato.", "No usage statistics for this format."],
};
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
const pct = (x) => `${Math.round((x || 0) * 1000) / 10} %`;

function useS() {
  const { lang } = useApp();
  return (k, v) => fill(L(S[k], lang), v);
}

/** The fields of a member a set fills (EVs and IVs complete, so nothing of the old spread is left). */
export function setToMember(s) {
  const full = (o, d) => Object.fromEntries(["hp", "atk", "def", "spa", "spd", "spe"].map((k) => [k, o?.[k] ?? d]));
  return { moves: [...s.moves, "", "", "", ""].slice(0, 4), item: s.item || "", ability: s.ability || "", nature: s.nature || "",
    evs: full(s.evs, 0), ivs: full(s.ivs, 31), teraType: s.teraType || "", ...(s.level ? { level: s.level } : {}) };
}

function Usage({ u, fmt }) {
  const { lang } = useApp();
  const s = useS();
  if (!u) return null;
  const list = (rows, kind) => rows.slice(0, 6).map(([n, v]) => `${kind ? nameOf(kind, n, lang) : kind === null ? typeName(n, lang) : n} ${pct(v)}`).join(" · ");
  return (
    <div className="panel space-y-1 text-[12.5px]">
      <b>{s("usage", { fmt, pct: pct(u.usage) })}</b>
      {u.items?.length > 0 && <div><span className="help">{s("items")}:</span> {list(u.items, "item")}</div>}
      {u.abilities?.length > 0 && <div><span className="help">{s("abilities")}:</span> {list(u.abilities, "ability")}</div>}
      {u.moves?.length > 0 && <div><span className="help">{s("moves")}:</span> {list(u.moves, "move")}</div>}
      {u.teraTypes?.length > 0 && <div><span className="help">{s("tera")}:</span> {list(u.teraTypes, null)}</div>}
      {u.teammates?.length > 0 && <div><span className="help">{s("teammates")}:</span> {u.teammates.slice(0, 6).map(([n]) => n).join(" · ")}</div>}
    </div>
  );
}

export default function SmogonSets({ species, format, onApply }) {
  const { lang, t, toastError } = useApp();
  const s = useS();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const show = async () => {
    setOpen(true);
    setData(null);
    try { setData(await api.call("sets_popular", { species, format })); } catch (e) { toastError(e); setOpen(false); }
  };
  return (
    <>
      <button type="button" className="btn btn-sm" disabled={!species?.trim()} onClick={show} title={s("credit")}><Icon d={ICONS.star} size={13} /> {t("smogon_sets_button")}</button>
      {open && (
        <Modal title={t("smogon_sets_title", { species })} onClose={() => setOpen(false)} wide>
          {!data ? <Spinner /> : (
            <div className="space-y-3">
              <p className="help">{t("smogon_sets_help")}</p>
              <Usage u={data.usage} fmt={data.usage_format} />
              {!data.sets.length ? <p className="help">{s("none")}</p> : (
                <>
                  <p className="help">{s("from", { fmt: data.format })}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.sets.map((x) => (
                      <div key={x.name} className="panel space-y-1 smogon-set">
                        <div className="flex items-center gap-2">
                          <b className="flex-1 trunc">{x.name}</b>
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => { onApply(setToMember(x)); setOpen(false); }}>{t("smogon_apply_set")}</button>
                        </div>
                        <div className="help">
                          {[x.item && nameOf("item", x.item, lang), x.ability && nameOf("ability", x.ability, lang), x.nature && nameOf("nature", x.nature, lang),
                            x.teraType && `Tera ${typeName(x.teraType, lang)}`].filter(Boolean).join(" · ")}
                        </div>
                        <ul className="smogon-moves">
                          {x.move_options.map((opts, i) => <li key={i}>{opts.map((m) => nameOf("move", m, lang)).join(" / ")}</li>)}
                        </ul>
                        {Object.keys(x.evs || {}).length > 0 && <div className="help num">EV {Object.entries(x.evs).map(([k, v]) => `${v} ${k}`).join(" / ")}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
              <p className="help">{s("credit")}</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/** "Sample team": the format's six most used Pokémon with their most popular set (after a confirmation when the team has members). */
export function SampleTeam({ format, hasTeam, onTeam }) {
  const { confirm, toastError, notify } = useApp();
  const s = useS();
  const [busy, run] = useBusy();
  const go = () => run("sample", async () => {
    if (hasTeam && !(await confirm({ title: s("sample"), message: s("sample_confirm"), confirmLabel: s("sample") }))) return;
    try {
      const r = await api.call("sample_team", { format });
      if (!r.team?.length) { notify(s("sample_none"), "error"); return; }
      onTeam(r.team.map((m) => ({ species: m.species, name: "", gender: "", shiny: false, ...setToMember(m) })));
    } catch (e) { toastError(e); }
  });
  return <Busy busy={busy.sample} className="btn" onClick={go}><Icon d={ICONS.star} size={14} /> {s("sample")}</Busy>;
}
