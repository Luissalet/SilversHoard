// Battle Factory streak: pick three of the six rental Pokémon at the start of each round, and after each win swap one of yours for one
// of the beaten rival's (or keep the team). The battle starts as soon as the team is set.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { MonIcon } from "../components/silver.jsx";
import { L, TYPE_COLORS, nameOf, typeName } from "../battle/dex.js";

const S = {
  pick_title: ["Elige {n} Pokémon de alquiler", "Pick {n} rental Pokémon"],
  pick_help: ["Se combaten en el orden en que los eliges. Tras cada victoria podrás cambiar uno por uno del rival; cada siete combates llegan seis nuevos.",
    "They fight in the order you pick them. After each win you can swap one for one of the rival's; every seven battles six new ones arrive."],
  swap_title: ["¿Cambias un Pokémon?", "Swap a Pokémon?"],
  swap_help: ["Elige uno tuyo para dar y uno del rival vencido para quedártelo, o sigue con el mismo equipo.",
    "Pick one of yours to give and one of the beaten rival's to keep, or go on with the same team."],
  yours: ["Tu equipo", "Your team"],
  theirs: ["Equipo del rival vencido", "The beaten rival's team"],
  start: ["Combatir", "Battle"],
  swap: ["Cambiar y combatir", "Swap and battle"],
  keep: ["Seguir igual", "Keep the team"],
  streak: ["Racha: {n}", "Streak: {n}"],
  battle_on: ["Hay un combate en curso.", "A battle is on."],
  open_battle: ["Ir al combate", "Go to the battle"],
  over: ["Esta racha ha terminado.", "This streak is over."],
  back: ["Instalaciones", "Facilities"],
  not_found: ["No se encuentra esta racha.", "This streak was not found."],
};
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

function SetCard({ set, lang, selected, order, onClick, disabled }) {
  return (
    <button type="button" className={`panel rental ${selected ? "is-on" : ""}`} onClick={onClick} disabled={disabled} aria-pressed={!!selected}>
      <div className="flex items-center gap-2">
        <MonIcon species={set.species} size={48} />
        <div className="min-w-0 text-left">
          <b className="trunc">{nameOf("species", set.species, lang)}</b>
          <div className="help trunc">{[set.item && nameOf("item", set.item, lang), set.ability && nameOf("ability", set.ability, lang)].filter(Boolean).join(" · ")}</div>
        </div>
        {order ? <span className="chip chip-accent ml-auto">{order}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1 mt-1">
        {(set.moves || []).map((m) => <span key={m} className="chip">{nameOf("move", m, lang)}</span>)}
      </div>
      {set.teraType && <div className="help mt-1"><span className="b-type" style={{ background: TYPE_COLORS[set.teraType] }}>{typeName(set.teraType, lang)}</span></div>}
    </button>
  );
}

export default function Fabrica({ param }) {
  const { lang, go, changed } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const { data, error, loading, reload } = useLoad(() => api.call("challenges_list", { kind: "facility" }).then((r) => r.challenges.find((x) => x.id === param) || null), [param]);
  const [picks, setPicks] = useState([]);
  const [give, setGive] = useState(-1);
  const [take, setTake] = useState(-1);
  const [busy, run] = useBusy();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <div className="flex items-center gap-2"><Spinner /></div>;
  if (!data) return <p className="help">{s("not_found")} <a href="#/instalaciones">{s("back")}</a></p>;
  const fac = data.factory || {};
  const size = fac.size || 3;
  const goBattle = (r) => { changed(); const cur = r.stages[r.stages.length - 1]; go(cur?.battle_id ? `#/combate/${cur.battle_id}` : "#/instalaciones"); };
  const pick = () => run("p", async () => goBattle(await api.call("factory_pick", { id: data.id, picks })));
  const swap = (keep) => run(keep ? "k" : "w", async () => goBattle(await api.call("factory_swap", { id: data.id, give: keep ? -1 : give, take: keep ? -1 : take })));
  const toggle = (i) => setPicks((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < size ? [...p, i] : p));
  const current = data.current;
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="trunc">{data.target_name}</h1>
          <div className="help flex flex-wrap gap-2"><span className="chip">{data.challenger_name}</span><span className="chip chip-accent">{s("streak", { n: data.streak || 0 })}</span></div>
        </div>
        <a className="btn" href="#/instalaciones">{s("back")}</a>
      </div>
      {data.status !== "active" && <p className="help">{s("over")}</p>}
      {data.status === "active" && fac.phase === "pick" && (
        <div className="space-y-3">
          <h3>{s("pick_title", { n: size })}</h3>
          <p className="help">{s("pick_help")}</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {fac.rentals.map((set, i) => <SetCard key={i} set={set} lang={lang} selected={picks.includes(i)} order={picks.indexOf(i) + 1 || 0} onClick={() => toggle(i)} />)}
          </div>
          <Busy busy={busy.p} className="btn btn-primary" disabled={picks.length !== size} onClick={pick}>{s("start")}</Busy>
        </div>
      )}
      {data.status === "active" && fac.phase === "swap" && (
        <div className="space-y-3">
          <h3>{s("swap_title")}</h3>
          <p className="help">{s("swap_help")}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2"><span className="label">{s("yours")}</span>
              {fac.team.map((set, i) => <SetCard key={i} set={set} lang={lang} selected={give === i} onClick={() => setGive(give === i ? -1 : i)} />)}
            </div>
            <div className="space-y-2"><span className="label">{s("theirs")}</span>
              {fac.offer.map((set, i) => <SetCard key={i} set={set} lang={lang} selected={take === i} onClick={() => setTake(take === i ? -1 : i)} />)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Busy busy={busy.w} className="btn btn-primary" disabled={give < 0 || take < 0} onClick={() => swap(false)}>{s("swap")}</Busy>
            <Busy busy={busy.k} className="btn" onClick={() => swap(true)}>{s("keep")}</Busy>
          </div>
        </div>
      )}
      {data.status === "active" && fac.phase === "battle" && (
        <p className="help">{s("battle_on")} {current?.battle_id && <a className="btn btn-sm" href={`#/combate/${current.battle_id}`}>{s("open_battle")}</a>}</p>
      )}
    </div>
  );
}
