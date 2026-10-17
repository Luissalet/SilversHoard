// Why the AI chose: under the arena, the AI seats' decisions of the turn on screen (the options each weighed with the expected
// damage and KOs, the threat it was under, who was faster, the turns the expert played out and the futures the master searched),
// and in a live battle
// what the expert would do now on your side. The notes come from battle_explain; names in the app's language.
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Icon, ICONS, useBusy, useStored } from "./ui.jsx";
import { L, nameOf } from "../battle/dex.js";
import { battleT } from "../battle/strings.js";
import { combinationValues } from "../battle/expert-combinations.js";

const S = {
  title: ["Por qué", "Why"],
  show: ["Ver por qué juega así la IA", "Show why the AI plays like this"],
  hide: ["Ocultar", "Hide"],
  turn: ["Turno {n}", "Turn {n}"],
  none: ["Sin decisiones de la IA en este turno.", "No AI decisions this turn."],
  none_battle: ["Este combate no guarda las decisiones de la IA (es anterior a esta función, o una serie o torneo).",
    "This battle keeps no AI decisions (it is older than this feature, or part of a series or tournament)."],
  chose: ["{mon} ({hp} de vida) eligió {what}", "{mon} ({hp} HP) chose {what}"],
  should: ["{mon} ({hp} de vida): {what}", "{mon} ({hp} HP): {what}"],
  on: ["contra {target}", "on {target}"],
  dmg: ["le quita ~{pct}", "takes ~{pct}"],
  ko: ["y lo debilita", "and knocks it out"],
  acc: ["precisión {pct}", "{pct} accuracy"],
  threat: ["Amenaza: {move} de {foe} le quitaría ~{pct}", "Threat: {foe}'s {move} would take ~{pct}"],
  threat_ko: ["(lo debilitaría)", "(a KO)"],
  faster: ["Más rápido: {list}", "Faster: {list}"],
  also: ["También valoró", "Also weighed"],
  switch_to: ["cambiar a {mon}", "switch to {mon}"],
  sw_detail: ["recibiría ~{take}, quitaría ~{give}", "would take ~{take}, deal ~{give}"],
  sends: ["{who} saca a {mon}", "{who} sends in {mon}"],
  search: ["Futuros explorados: {n} (búsqueda en árbol de Montecarlo). Atención de la búsqueda y victoria estimada:", "Futures searched: {n} (Monte Carlo tree search). Share of the search and estimated win:"],
  hidden: ["sin ver tu equipo", "not seeing your team"],
  fallback: ["La búsqueda no estaba disponible: jugó como la experta.", "The search was not available: it played as the expert."],
  neural_fallback: ["La red neuronal no juega este combate o no estaba en marcha: jugó como la experta.", "The neural network does not play this battle or was not running: it played as the expert."],
  neural: ["Lo eligió la red neuronal ({ms} ms); así lo valoraría la IA experta:", "The neural network chose it ({ms} ms); this is how the expert AI would weigh it:"],
  playouts: ["Turnos simulados (más alto, mejor; entre paréntesis, el peor caso)", "Turns played out (higher is better; worst case in brackets)"],
  level: ["IA {level} · {style}", "{level} AI · {style}"],
  advice: ["¿Qué haría la experta?", "What would the expert do?"],
  advice_title: ["La IA experta en tu lugar", "The expert AI in your place"],
  advice_none: ["Ahora no hay nada que elegir.", "Nothing to choose right now."],
  prev: ["Turno anterior", "Previous turn"],
  next: ["Turno siguiente", "Next turn"],
};
const LEVELS = { random: ["aleatoria", "random"], easy: ["fácil", "easy"], normal: ["normal", "normal"], hard: ["difícil", "hard"], expert: ["experta", "expert"], master: ["maestra", "master"], neural: ["neuronal", "neural"] };
const STYLES = { balanced: ["equilibrada", "balanced"], aggressive: ["agresiva", "aggressive"], defensive: ["defensiva", "defensive"], setup: ["de mejoras", "setup"], stall: ["de desgaste", "stall"] };
const GIMMICKS = { terastallize: ["teracristalización", "Terastallization"], mega: ["megaevolución", "Mega Evolution"], megax: ["megaevolución X", "Mega Evolution X"],
  megay: ["megaevolución Y", "Mega Evolution Y"], ultra: ["ultraexplosión", "Ultra Burst"], dynamax: ["dinamax", "Dynamax"], zmove: ["movimiento Z", "Z-Move"] };
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
const pct = (x) => `${Math.round((x || 0) * 100)} %`;
const keyOf = (n) => `${n.turn}:${n.side}:${n.kind}:${n.choice}`;

function useTexts(lang) {
  return useMemo(() => {
    const s = (k, v) => fill(L(S[k], lang), v);
    const mon = (x) => nameOf("species", x, lang);
    const move = (x) => nameOf("moves", x, lang);
    const option = (o) => {
      if (!o) return "?";
      if (o.kind === "switch") {
        const base = s("switch_to", { mon: mon(o.species) });
        return o.take != null ? `${base} (${s("sw_detail", { take: pct(o.take), give: pct(o.give) })})` : base;
      }
      let text = move(o.name || o.choice);
      if (o.gimmick) text += ` + ${L(GIMMICKS[o.gimmick] || [o.gimmick, o.gimmick], lang)}`;
      return text;
    };
    const effect = (o) => {
      if (!o || o.kind === "switch" || o.dmg == null) return "";
      return [o.target ? s("on", { target: mon(o.target) }) : "", s("dmg", { pct: pct(o.dmg) }), o.ko ? s("ko") : "",
        o.acc != null && o.acc < 1 ? `(${s("acc", { pct: pct(o.acc) })})` : ""].filter(Boolean).join(" ");
    };
    const label = (p, slots) => String(p.choice).split(",").map((c, i) => {
      const slot = slots.find((x) => x.slot === i) || slots[i];
      const o = (slot?.options || []).find((x) => x.choice === c.trim());
      if (o) return option(o);
      return (p.name || p.species) && !String(p.choice).includes(",") ? option(p) : p.label || c;
    }).join(" + ");
    return { s, mon, move, option, effect, label };
  }, [lang]);
}

function Note({ note, names, lang, advice, pair }) {
  const { s, mon, option, effect, label } = useTexts(lang);
  if (note.kind === "switch_in") {
    return <div className="ai-note">{(note.slots || []).map((sl) => <p key={sl.slot}>{s("sends", { who: names[note.side] || note.side, mon: mon(sl.mon) })}</p>)}</div>;
  }
  if (note.kind !== "turn") return null;
  return (
    <div className="ai-note">
      <div className="ai-note-head">
        <b>{advice ? s("advice_title") : names[note.side] || note.side}</b>
        {!advice && <span className="chip">{s("level", { level: L(LEVELS[note.level] || [note.level, note.level], lang), style: L(STYLES[note.style] || [note.style, note.style], lang) })}</span>}
        {!advice && note.hidden && <span className="chip">{s("hidden")}</span>}
      </div>
      {pair && !advice && <p><strong>{battleT(lang)("expert_pair", combinationValues(pair, names, (move) => nameOf("moves", move, lang)))}</strong></p>}
      {(note.slots || []).map((sl) => {
        const p = sl.picked || {};
        const what = [option(p), effect(p)].filter(Boolean).join(" ");
        const alts = (sl.options || []).filter((o) => o.choice !== p.choice).slice(0, 3);
        return (
          <div key={sl.slot} className="ai-note-slot">
            <p><b>{s(advice ? "should" : "chose", { mon: mon(sl.mon), hp: pct(sl.hp), what })}</b></p>
            {sl.threat?.frac > 0 && <p className="help">{s("threat", { move: nameOf("moves", sl.threat.move, lang), foe: mon(sl.threat.foe), pct: pct(sl.threat.frac) })} {sl.threat.ko ? s("threat_ko") : ""}</p>}
            {sl.faster?.length > 0 && <p className="help">{s("faster", { list: sl.faster.map(mon).join(", ") })}</p>}
            {alts.length > 0 && (
              <p className="help">{s("also")}: {alts.map((o) => [option(o), effect(o)].filter(Boolean).join(" ")).join(" · ")}</p>
            )}
          </div>
        );
      })}
      {note.search?.options?.length > 0 && (
        <div className="ai-note-playouts">
          <span className="help">{s("search", { n: (note.search.iterations || 0).toLocaleString(lang === "es" ? "es-ES" : "en-GB") })}</span>
          <table className="tbl ai-playouts"><tbody>
            {note.search.options.slice(0, 3).map((po, i) => (
              <tr key={i} className={po.choice === note.choice ? "is-on" : ""}>
                <td>{po.name || po.species ? option(po) : po.label || po.choice}</td>
                <td className="r num">{pct(po.share)}</td>
                <td className="r num help">{pct(po.win)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {note.fallback && note.level === "master" && !advice && <p className="help">{s("fallback")}</p>}
      {note.fallback && note.level === "neural" && !advice && <p className="help">{s("neural_fallback")}</p>}
      {note.neural && !advice && <p className="help">{s("neural", { ms: note.neural.ms })}</p>}
      {(note.playouts || []).length > 1 && (
        <div className="ai-note-playouts">
          <span className="help">{s("playouts")}</span>
          <table className="tbl ai-playouts"><tbody>
            {note.playouts.slice(0, 3).map((po, i) => (
              <tr key={i} className={po.choice === note.choice ? "is-on" : ""}>
                <td>{label(po, note.slots || [])}</td>
                <td className="r num">{po.mean >= 0 ? "+" : ""}{po.mean.toFixed(2)}</td>
                <td className="r num help">({po.worst >= 0 ? "+" : ""}{po.worst.toFixed(2)})</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

export default function AiNotes({ battle, turn, live, requestSide, combinations = [] }) {
  const { lang, toastError } = useApp();
  const { s } = useTexts(lang);
  const [open, setOpen] = useStored("silver-ai-notes", false);
  const [notes, setNotes] = useState([]);
  const [shown, setShown] = useState(null);       // a turn picked with the arrows; null follows the battle
  const [advice, setAdvice] = useState(null);
  const [busy, run] = useBusy();
  const count = battle.ai_notes_count || 0;
  const names = { p1: battle.p1?.name, p2: battle.p2?.name };

  useEffect(() => { setNotes([]); setShown(null); setAdvice(null); }, [battle.id]);
  useEffect(() => {
    if (!open || !count) return;
    const last = notes.length ? Math.max(...notes.map((n) => n.turn || 0)) : 0;
    api.call("battle_explain", last ? { id: battle.id, from_turn: last, advice: false } : { id: battle.id, limit: 800, advice: false })
      .then((r) => setNotes((old) => {
        const seen = new Set(old.map(keyOf));
        return [...old, ...(r.notes || []).filter((n) => !seen.has(keyOf(n)))];
      }))
      .catch(() => {});
  }, [battle.id, count, open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAdvice(null); }, [battle.turn]);

  // in a live battle the AI has already chosen for the turn waiting on you: show the turn just played, never the next one
  const followed = live ? Math.max(0, (turn || 0) - 1) : (turn || 0);
  const at = shown ?? followed;
  const forTurn = notes.filter((n) => n.turn === at && n.kind !== "preview");
  const turns = [...new Set(notes.map((n) => n.turn))].sort((a, b) => a - b);
  const step = (dir) => {
    const list = turns.filter((x) => (dir < 0 ? x < at : x > at) && (!live || x <= followed));
    if (list.length) setShown(dir < 0 ? list[list.length - 1] : list[0]);
  };
  const ask = () => run("advice", async () => {
    try {
      const r = await api.call("battle_explain", { id: battle.id, side: requestSide, limit: 1, advice: true });
      setAdvice(r.advice?.[requestSide] || { none: true });
    } catch (e) { toastError(e); }
  });

  if (battle.mode === "realtime" || !battle.log_length) return null;
  return (
    <section className="panel ai-notes">
      <div className="flex flex-wrap items-center gap-2">
        <Icon d={ICONS.info || ICONS.help} size={16} />
        <b>{s("title")}</b>
        {open && turns.length > 0 && (
          <span className="flex items-center gap-1">
            <button type="button" className="btn btn-sm" aria-label={s("prev")} onClick={() => step(-1)}>‹</button>
            <span className="chip num">{s("turn", { n: at })}</span>
            <button type="button" className="btn btn-sm" aria-label={s("next")} onClick={() => step(1)}>›</button>
            {shown != null && <button type="button" className="btn btn-sm" onClick={() => setShown(null)}>↺</button>}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {open && live && requestSide && <Busy busy={busy.advice} className="btn btn-sm" onClick={ask}>{s("advice")}</Busy>}
          <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? s("hide") : s("show")}</button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 mt-2">
          {advice && (advice.none ? <p className="help">{s("advice_none")}</p> : <Note note={advice} names={names} lang={lang} advice />)}
          {!count ? <p className="help">{s("none_battle")}</p>
            : forTurn.length ? forTurn.map((n) => <Note key={keyOf(n)} note={n} names={names} lang={lang}
                pair={!n.partner && combinations.find((pair) => pair.turn === n.turn && pair.side === n.side)} />)
              : <p className="help">{s("none")}</p>}
        </div>
      )}
    </section>
  );
}
