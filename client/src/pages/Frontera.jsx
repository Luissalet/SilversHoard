// Between the battles of a HeartGold/SoulSilver Battle Frontier streak (Battle Hall, Battle Arcade, Battle Castle): the Hall's type
// board, the Arcade's roulette and the Castle's services, with the party, the next rival and the streak so far; in doubles and multi
// challenges also the challenge type, the AI partner with its Pokémon and both rival trainers. Mouse, keyboard (arrows, Enter,
// Space) and gamepad (D-pad, A). Each battle is played on the battle screen, which comes back here after a win.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Bar, Busy, ErrorBox, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { usePoll } from "../components/hooks.js";
import { Avatar, MonIcon } from "../components/silver.jsx";
import { L, TYPE_COLORS, nameOf, typeName } from "../battle/dex.js";
import "./frontera.css";

const S = {
  back: ["Instalaciones", "Facilities"],
  not_found: ["No se encuentra esta racha.", "This streak was not found."],
  not_frontier: ["Esta racha no es de la Sala, la Ruleta ni el Castillo Batalla.", "This streak is not at the Battle Hall, Arcade or Castle."],
  streak: ["Racha: {n}", "Streak: {n}"],
  round: ["Ronda {r} · combate {b} de {n}", "Round {r} · battle {b} of {n}"],
  bp: ["{n} PB", "{n} BP"],
  over: ["La racha ha terminado.", "This streak is over."],
  abandoned: ["Abandonaste esta racha.", "You gave up this streak."],
  lost_at: ["Perdiste en el combate {n}.", "Lost at battle {n}."],
  battle_on: ["Hay un combate en curso.", "A battle is on."],
  go_battle: ["Ir al combate", "Go to the battle"],
  ai_plays: ["La IA juega esta racha en segundo plano; la página se actualiza sola.", "The AI plays this streak in the background; this page updates by itself."],
  next_rival: ["Siguiente rival", "Next rival"],
  battle_n: ["Combate {n}", "Battle {n}"],
  brain_next: ["¡Combate contra el As del Frente Batalla!", "A Frontier Brain battle!"],
  party: ["Tu equipo", "Your party"],
  mode_double: ["Dobles", "Doubles"],
  mode_multi: ["Múltiple", "Multi"],
  partner: ["Tu compañero: {name}", "Your partner: {name}"],
  partner_help: ["Juega la posición 2 con la IA ({ai}) y saca sus propios Pokémon; llega curado a cada combate.",
    "Plays slot 2 with the AI ({ai}) and sends out their own Pokémon; comes healed to every battle."],
  multi_hall: ["En múltiple los rivales van a rango 9 y a tu nivel, y cada ronda da 12 PB.", "In multi the rivals are rank 9 and at your level, and each round pays 12 BP."],
  history: ["Combates de la racha", "Battles of the streak"],
  won: ["Ganado", "Won"],
  lost: ["Perdido", "Lost"],
  skipped: ["Saltado", "Skipped"],
  pending: ["Pendiente", "Pending"],
  level: ["Nv. {n}", "Lv. {n}"],
  no_item: ["Sin objeto", "No item"],
  abandon: ["Abandonar", "Give up"],
  // Hall
  hall_title: ["Elige el tipo del siguiente rival", "Pick the next rival's type"],
  hall_help: ["El rival será un Pokémon de ese tipo. Su nivel sale de la fórmula del juego: tu nivel ({lv}), el rango de ese tipo y cuántos tipos llevas con rango. Cada victoria sube un rango el tipo elegido; con rango 10 la casilla se cierra. Flechas o cruceta para moverte, Intro o A para elegir y otra vez para combatir.",
    "The rival will be a Pokémon of that type. Its level comes from the game's formula: your level ({lv}), that type's rank and how many types you have ranked. Each win ranks the chosen type up; at rank 10 the cell closes. Arrows or D-pad to move, Enter or A to select and again to battle."],
  hall_reset: ["Todos los tipos llegaron al rango 10 y vuelven al 9.", "Every type reached rank 10 and went back to 9."],
  hall_matron: ["En este combate te espera la Dama Salón Argenta con un Pokémon a tu nivel. Elige un tipo igualmente: es el que sube de rango si ganas.",
    "Hall Matron Argenta waits in this battle with a Pokémon at your level. Pick a type anyway: it is the one ranked up if you win."],
  rank: ["Rango {n}", "Rank {n}"],
  rank_max: ["Rango 10 · cerrado", "Rank 10 · closed"],
  fight_type: ["Combatir contra tipo {t}", "Battle a {t} type"],
  empty_cell: ["Casilla vacía", "Empty cell"],
  matron_cell: ["??? · Argenta", "??? · Argenta"],
  // Arcade
  arcade_title: ["Ruleta del combate {n}", "Roulette of battle {n}"],
  arcade_help: ["Pulsa para girar y vuelve a pulsar para parar (Espacio, Intro, clic o A); a los 15 segundos se para sola. El evento de la casilla se aplica al siguiente combate.",
    "Press to spin and press again to stop (Space, Enter, click or A); after 15 seconds it stops by itself. The panel's event applies to the next battle."],
  spin: ["Girar la ruleta", "Spin the roulette"],
  stop: ["¡Parar!", "Stop!"],
  odds: ["Probabilidad de cada color por casilla (según tu último combate, {p} puntos):", "Chance of each colour per panel (from your last battle, {p} points):"],
  speed: ["Velocidad {n} de 7", "Speed {n} of 7"],
  random_motion: ["Esta ruleta salta al azar.", "This roulette jumps at random."],
  result: ["Resultado de la ruleta", "Roulette result"],
  lucky: ["¡Suerte! Ningún Pokémon podía sufrirlo: no pasa nada.", "Lucky break! No Pokémon could be affected: nothing happens."],
  affects: ["Afecta a: {who}", "Affects: {who}"],
  next_board: ["Siguiente ruleta", "Next roulette"],
  colour_0: ["Rival", "Rival"], colour_1: ["Tú", "You"], colour_2: ["Campo", "Field"], colour_3: ["Especial", "Special"],
  // Castle
  castle_title: ["Antes del combate {n}", "Before battle {n}"],
  castle_help: ["Los PS y los PP no se recuperan entre combates (los debilitados vuelven con 1 PS y se curan los estados). Gasta Puntos de Castillo (PC) en curar, alquilar objetos, espiar al rival o cambiar su nivel; ganas PC en cada victoria.",
    "HP and PP are not restored between battles (fainted Pokémon come back with 1 HP and statuses are cured). Spend Castle Points (CP) to heal, rent items, scout the rival or change its level; every win earns CP."],
  cp: ["{n} PC", "{n} CP"],
  ranks: ["Rangos", "Ranks"],
  rank_heal: ["Curación", "Healing"], rank_rental: ["Alquiler", "Rental"], rank_info: ["Información", "Information"],
  rank_up: ["Subir ({c} PC)", "Rank up ({c} CP)"],
  heal_hp: ["Restaurar PS", "Restore HP"], heal_pp: ["Restaurar PP", "Restore PP"], heal_all: ["Restaurar todo", "Restore all"],
  rent: ["Alquilar", "Rent"],
  rent_pick: ["Baya u objeto…", "Berry or item…"],
  berries: ["Bayas", "Berries"], items: ["Objetos", "Items"],
  rival_team: ["Equipo del rival", "The rival's team"],
  unknown: ["Desconocido", "Unknown"],
  check: ["Comprobar", "Check"], summary: ["Resumen", "Summary"], moves: ["Movimientos", "Moves"],
  level_up: ["Nivel +5", "Level +5"], level_down: ["Nivel −5", "Level −5"],
  fight: ["Combatir", "Battle"],
  skip: ["Saltar combate (50 PC)", "Skip the battle (50 CP)"],
  cost: ["{c} PC", "{c} CP"],
  cp_won: ["+{n} PC", "+{n} CP"],
  auto_bought: ["La IA compró: {what}", "The AI bought: {what}"],
};
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
const STATUS = { par: ["Paralizado", "Paralysed"], brn: ["Quemado", "Burned"], psn: ["Envenenado", "Poisoned"], tox: ["Envenenado", "Badly poisoned"],
  slp: ["Dormido", "Asleep"], frz: ["Congelado", "Frozen"] };
const NAMES = { hall: ["Sala Batalla", "Battle Hall"], arcade: ["Ruleta Batalla", "Battle Arcade"], castle: ["Castillo Batalla", "Battle Castle"] };

// the 32 roulette events: short label for the panel, name, and what it does
const EVENTS = [
  ["PS−", "Rival: bajan sus PS", "Rival: lower HP", "Los Pokémon del rival empiezan con un 80 % de sus PS.", "The rival's Pokémon start at about 80% HP."],
  ["VEN", "Rival: envenenados", "Rival: poison", "Los Pokémon del rival empiezan envenenados (no los de tipo Veneno o Acero ni con Inmunidad).", "The rival's Pokémon start poisoned (not Poison or Steel types, nor Immunity)."],
  ["PAR", "Rival: paralizados", "Rival: paralysis", "Los Pokémon del rival empiezan paralizados (no los de tipo Tierra ni con Flexibilidad).", "The rival's Pokémon start paralysed (not Ground types, nor Limber)."],
  ["QUE", "Rival: quemados", "Rival: burn", "Los Pokémon del rival empiezan quemados (no los de tipo Fuego ni con Velo Agua).", "The rival's Pokémon start burned (not Fire types, nor Water Veil)."],
  ["DOR", "Rival: dormido", "Rival: sleep", "Un Pokémon del rival empieza dormido (2-5 turnos).", "One of the rival's Pokémon starts asleep (2-5 turns)."],
  ["CON", "Rival: congelado", "Rival: freeze", "Un Pokémon del rival empieza congelado.", "One of the rival's Pokémon starts frozen."],
  ["BAYA", "Rival: recibe una baya", "Rival: gets a berry", "Los Pokémon del rival llevan la misma baya en este combate.", "The rival's Pokémon hold the same berry in this battle."],
  ["OBJ", "Rival: recibe un objeto", "Rival: gets an item", "Los Pokémon del rival llevan el mismo objeto en este combate.", "The rival's Pokémon hold the same item in this battle."],
  ["+3 Nv", "Rival: suben 3 niveles", "Rival: level up", "Los Pokémon del rival combaten 3 niveles por encima.", "The rival's Pokémon fight 3 levels higher."],
  ["PS−", "Tú: bajan tus PS", "You: lower HP", "Tus Pokémon empiezan con un 80 % de sus PS.", "Your Pokémon start at about 80% HP."],
  ["VEN", "Tú: envenenados", "You: poison", "Tus Pokémon empiezan envenenados (no los de tipo Veneno o Acero ni con Inmunidad).", "Your Pokémon start poisoned (not Poison or Steel types, nor Immunity)."],
  ["PAR", "Tú: paralizados", "You: paralysis", "Tus Pokémon empiezan paralizados (no los de tipo Tierra ni con Flexibilidad).", "Your Pokémon start paralysed (not Ground types, nor Limber)."],
  ["QUE", "Tú: quemados", "You: burn", "Tus Pokémon empiezan quemados (no los de tipo Fuego ni con Velo Agua).", "Your Pokémon start burned (not Fire types, nor Water Veil)."],
  ["DOR", "Tú: dormido", "You: sleep", "Uno de tus Pokémon empieza dormido (2-5 turnos).", "One of your Pokémon starts asleep (2-5 turns)."],
  ["CON", "Tú: congelado", "You: freeze", "Uno de tus Pokémon empieza congelado.", "One of your Pokémon starts frozen."],
  ["BAYA", "Tú: recibes una baya", "You: get a berry", "Tus Pokémon llevan la misma baya; la que no se coman se la quedan.", "Your Pokémon hold the same berry; one not eaten stays held."],
  ["OBJ", "Tú: recibes un objeto", "You: get an item", "Tus Pokémon llevan el mismo objeto; si no lo gastan, se lo quedan.", "Your Pokémon hold the same item; if not used up, it stays held."],
  ["+3 Nv", "Tú: subes 3 niveles", "You: level up", "Tus Pokémon combaten 3 niveles por encima (solo este combate).", "Your Pokémon fight 3 levels higher (this battle only)."],
  ["SOL", "Sol", "Sun", "Sol intenso todo el combate.", "Harsh sunlight for the whole battle."],
  ["LLUV", "Lluvia", "Rain", "Lluvia todo el combate.", "Rain for the whole battle."],
  ["AREN", "Tormenta de arena", "Sandstorm", "Tormenta de arena todo el combate.", "A sandstorm for the whole battle."],
  ["GRAN", "Granizo", "Hail", "Granizo todo el combate.", "Hail for the whole battle."],
  ["NIEB", "Niebla", "Fog", "Niebla todo el combate: la precisión de los movimientos baja a 3/5.", "Fog for the whole battle: move accuracy drops to 3/5."],
  ["E.RAR", "Espacio Raro", "Trick Room", "Espacio Raro durante 5 turnos: los más lentos atacan antes.", "Trick Room for 5 turns: the slower move first."],
  ["RÁP", "Ruleta más rápida", "Faster roulette", "La ruleta irá más rápida desde la siguiente.", "The roulette goes faster from the next one."],
  ["LENT", "Ruleta más lenta", "Slower roulette", "La ruleta irá más lenta desde la siguiente.", "The roulette goes slower from the next one."],
  ["LOCA", "Ruleta loca", "Random roulette", "La siguiente ruleta salta de casilla al azar.", "The next roulette jumps between panels at random."],
  ["CAMB", "Cambio de equipos", "Swap parties", "Combates con el equipo del rival (nivel 50, sin objetos) y la IA con el tuyo.", "You battle with the rival's party (level 50, no items) and the AI with yours."],
  ["+1PB", "+1 PB", "+1 BP", "Ganas 1 Punto de Batalla ahora y se combate igual.", "You get 1 Battle Point now and battle as usual."],
  ["SALT", "Saltar combate", "Skip the battle", "No hay combate: cuenta como victoria.", "No battle: it counts as a win."],
  ["NADA", "Nada", "No event", "No pasa nada.", "Nothing happens."],
  ["+3PB", "+3 PB", "+3 BP", "Ganas 3 Puntos de Batalla ahora y se combate igual.", "You get 3 Battle Points now and battle as usual."],
];
const evName = (id, lang) => (EVENTS[id] ? (lang === "en" ? EVENTS[id][2] : EVENTS[id][1]) : String(id));
const evText = (id, lang) => (EVENTS[id] ? (lang === "en" ? EVENTS[id][4] : EVENTS[id][3]) : "");

/** Gamepad focus: the D-pad moves between the section's buttons and A presses the focused one. */
function padFocus(root, b) {
  if (!root) return;
  const items = [...root.querySelectorAll("button:not([disabled]), select")];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  if (b === 0) { if (at >= 0) document.activeElement.click(); else items[0].focus(); return; }
  const step = b === 12 || b === 14 ? -1 : b === 13 || b === 15 ? 1 : 0;
  if (step) items[(at + step + items.length) % items.length].focus();
}

/** Gamepad edges (A = 0, B = 1, D-pad 12-15, left stick as D-pad) while `active`. */
function usePad(onButton, active) {
  const cb = useRef(onButton);
  cb.current = onButton;
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.getGamepads) return undefined;
    const prev = {};
    let raf = 0;
    const loop = () => {
      for (const gp of navigator.getGamepads() || []) {
        if (!gp) continue;
        const ax = gp.axes || [];
        const state = { 0: gp.buttons[0]?.pressed, 1: gp.buttons[1]?.pressed, 12: gp.buttons[12]?.pressed || ax[1] < -0.6,
          13: gp.buttons[13]?.pressed || ax[1] > 0.6, 14: gp.buttons[14]?.pressed || ax[0] < -0.6, 15: gp.buttons[15]?.pressed || ax[0] > 0.6 };
        for (const [k, on] of Object.entries(state)) {
          const key = `${gp.index}:${k}`;
          if (on && !prev[key]) cb.current(Number(k));
          prev[key] = !!on;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

function useKeys(onKey, active) {
  const cb = useRef(onKey);
  cb.current = onKey;
  useEffect(() => {
    if (!active) return undefined;
    const h = (e) => {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      // Enter and Space on a focused button or link click it: the page does not act twice
      if ((e.key === "Enter" || e.key === " ") && e.target && /^(BUTTON|A)$/.test(e.target.tagName)) return;
      if (cb.current(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active]);
}

function MonCard({ m, lang, s, castle, children }) {
  const st = m.status && STATUS[m.status];
  return (
    <div className="panel fr-mon">
      <div className="flex items-center gap-2">
        <MonIcon species={m.species} size={44} />
        <div className="min-w-0 flex-1">
          <b className="trunc">{m.species}</b>
          <div className="help trunc">{s("level", { n: m.level })} · {m.item ? nameOf("item", m.item, lang) : s("no_item")}{st ? ` · ${L(st, lang)}` : ""}</div>
        </div>
      </div>
      {castle && (
        <>
          <div className="fr-hp"><Bar value={m.maxhp ? m.hp / m.maxhp : 0} alarm={false} className={m.hp * 2 < m.maxhp ? "fr-hp-low" : ""} /><span className="num">{m.hp}/{m.maxhp}</span></div>
          <div className="fr-pp">
            {(m.moves || []).map((mv, i) => (
              <span key={mv} className={`chip ${m.pp[i] === 0 ? "chip-bad" : ""}`}>{nameOf("move", mv, lang)} <span className="num">{m.pp[i]}/{m.maxpp[i]}</span></span>
            ))}
          </div>
        </>
      )}
      {children}
    </div>
  );
}

function RivalCard({ fv, s, lang }) {
  const r = fv.rival;
  if (!r) return null;
  return (
    <div className={`panel fr-rival ${r.boss ? "is-brain" : ""}`}>
      <Avatar url={r.avatar_url} name={r.name} size={72} />
      {r.pair && <Avatar url={r.pair.avatar_url} name={r.pair.name} size={72} />}
      <div className="min-w-0">
        <span className="label">{s("next_rival")} · {s("battle_n", { n: r.number })}</span>
        <h3 className="trunc">{lang === "en" ? r.name_en || r.name : r.name}</h3>
        {r.type && <div className="help"><span className="b-type" style={{ background: TYPE_COLORS[r.type] }}>{typeName(r.type, lang)}</span> {s("rank", { n: r.rank })} · {s("level", { n: r.level })}</div>}
        {r.boss && <div className="chip chip-accent">{s("brain_next")}</div>}
      </div>
    </div>
  );
}

const CELLS = 20;   // 4 x 5: 17 types, two empty cells and the ??? cell (the Hall Matron's)
function HallBoard({ run, fv, s, lang, onPicked }) {
  const [cursor, setCursor] = useState(() => Math.max(0, fv.cell ?? 0));
  const [selected, setSelected] = useState(-1);
  const [busy, run_] = useBusy();
  const board = fv.board || [];
  const open = (c) => c < 17 && board[c]?.open;
  const pick = (c) => run_("p", async () => onPicked(await api.call("frontier_hall_pick", { id: run.id, cell: String(c) })));
  const press = (c) => { if (!open(c)) return; if (selected === c) pick(c); else setSelected(c); };
  const move = (dx, dy) => setCursor((c) => {
    const col = (c % 4 + dx + 4) % 4;
    const row = (Math.floor(c / 4) + dy + 5) % 5;
    const next = row * 4 + col;
    document.querySelector(`.fr-cell[data-cell="${next}"]`)?.focus();
    return next;
  });
  const onKey = (k) => {
    if (k === "ArrowLeft") move(-1, 0); else if (k === "ArrowRight") move(1, 0); else if (k === "ArrowUp") move(0, -1); else if (k === "ArrowDown") move(0, 1);
    else if (k === "Enter" || k === " ") press(cursor); else if (k === "Escape") setSelected(-1); else return false;
    return true;
  };
  useKeys(onKey, !busy.p);
  usePad((b) => { if (b === 0) press(cursor); else if (b === 1) setSelected(-1); else if (b === 12) move(0, -1); else if (b === 13) move(0, 1); else if (b === 14) move(-1, 0); else if (b === 15) move(1, 0); }, !busy.p);
  const sel = selected >= 0 ? board[selected] : null;
  return (
    <section className="space-y-3" aria-label={s("hall_title")}>
      <h2>{s("hall_title")}</h2>
      <p className="help">{s("hall_help", { lv: fv.level })}</p>
      {fv.reset && <p className="banner banner-info">{s("hall_reset")}</p>}
      {fv.brain_next && <p className="banner banner-info">{s("hall_matron")}</p>}
      <div className="fr-hall" role="grid">
        {Array.from({ length: CELLS }, (_, c) => {
          const cell = c < 17 ? board[c] : null;
          const cls = ["fr-cell", c === cursor ? "is-cursor" : "", c === selected ? "is-on" : "", cell && !cell.open ? "is-closed" : "", !cell ? "is-empty" : ""].join(" ");
          if (!cell) {
            return <div key={c} className={cls} role="gridcell" aria-disabled="true" data-cell={c}>{c === 19 ? <span className="fr-matron">{s("matron_cell")}</span> : <span className="help">{s("empty_cell")}</span>}</div>;
          }
          return (
            <button key={c} type="button" role="gridcell" data-cell={c} className={cls} style={{ "--type": TYPE_COLORS[cell.type] }} disabled={!cell.open || busy.p}
              onClick={() => { setCursor(c); press(c); }} aria-pressed={c === selected}>
              <b>{typeName(cell.type, lang)}</b>
              <span className="fr-pips" aria-label={cell.open ? s("rank", { n: cell.rank }) : s("rank_max")}>
                {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < cell.rank ? "on" : ""} />)}
              </span>
              <span className="help num">{cell.open ? s("rank", { n: cell.rank }) : s("rank_max")}</span>
            </button>
          );
        })}
      </div>
      <Busy busy={busy.p} className="btn btn-primary" disabled={!sel} onClick={() => pick(selected)}>
        {sel ? s("fight_type", { t: typeName(sel.type, lang) }) : s("hall_title")}
      </Busy>
    </section>
  );
}

function panelAt(board, frames) {
  const f = Math.max(0, Math.min(frames, board.stop_frames));
  const steps = Math.floor(f / board.frames_per_step);
  if (board.random_motion && board.jumps?.length) return steps ? board.jumps[steps - 1] : board.start;
  return (board.start + steps) % 16;
}

function ArcadeBoard({ run, fv, s, lang, onStopped }) {
  const board = fv.board || {};
  const [phase, setPhase] = useState("idle");   // idle -> spinning -> stopping
  const [cursor, setCursor] = useState(board.start ?? 0);
  const [busy, run_] = useBusy();
  const t0 = useRef(0);
  const sent = useRef(false);
  useEffect(() => { setPhase("idle"); setCursor(board.start ?? 0); sent.current = false; }, [fv.number, board.start]);
  const stopAt = useCallback((panel) => {
    if (sent.current) return;
    sent.current = true;
    setPhase("stopping");
    setCursor(panel);
    run_("s", async () => onStopped(await api.call("frontier_arcade_stop", { id: run.id, panel })))
      .finally(() => { sent.current = false; setPhase("idle"); });
  }, [run.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== "spinning") return undefined;
    let raf = 0;
    const tick = (now) => {
      const frames = Math.floor(((now - t0.current) * 60) / 1000);
      if (frames >= board.stop_frames) { stopAt(panelAt(board, board.stop_frames)); return; }
      setCursor(panelAt(board, frames));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, board, stopAt]);
  const press = () => {
    if (phase === "idle" && !busy.s) { t0.current = performance.now(); setPhase("spinning"); }
    else if (phase === "spinning") stopAt(cursor);
  };
  useKeys((k) => { if (k === " " || k === "Enter") { press(); return true; } return false; }, true);
  usePad((b) => { if (b === 0) press(); }, true);
  const odds = board.odds || [];
  return (
    <section className="space-y-3" aria-label={s("arcade_title", { n: fv.number })}>
      <h2>{s("arcade_title", { n: fv.number })}</h2>
      <p className="help">{s("arcade_help")}</p>
      <div className="fr-arcade-wrap">
        <div className={`fr-arcade ${phase === "spinning" ? "is-spinning" : ""}`} role="grid" onClick={press}>
          {(board.panels || []).map((e, i) => (
            <div key={i} role="gridcell" className={`fr-panel c${fv.colours?.[i] ?? 3} ${i === cursor ? "is-cursor" : ""}`} title={evName(e, lang)}>
              <b>{EVENTS[e]?.[0] || e}</b>
              <span className="trunc">{evName(e, lang)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2 fr-arcade-side">
          <Busy busy={busy.s} className="btn btn-primary fr-big" onClick={press}>{phase === "spinning" ? s("stop") : s("spin")}</Busy>
          <div className="help">{s("speed", { n: board.speed })}{board.random_motion ? ` · ${s("random_motion")}` : ""}</div>
          <div className="help">{s("odds", { p: fv.bp_gain })}</div>
          <div className="fr-odds">
            {odds.map((p, c) => <span key={c} className={`fr-odd c${c}`}>{s(`colour_${c}`)} <b className="num">{p} %</b></span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function ArcadeResult({ fv, s, lang, current, go }) {
  const ev = fv.event || (fv.phase === "board" && fv.last_event?.skip ? fv.last_event : null);
  if (!ev) return null;
  return (
    <section className={`panel fr-result c${ev.colour}`} aria-live="polite">
      <span className="label">{s("result")}</span>
      <h3>{evName(ev.event, lang)}</h3>
      <p>{ev.lucky ? s("lucky") : evText(ev.event, lang)}</p>
      {ev.give_item && <p className="help">{nameOf("item", ev.give_item.item, lang)}</p>}
      {!ev.lucky && ev.targets?.length ? <p className="help">{s("affects", { who: ev.targets.join(", ") })}</p> : null}
      {current?.battle_id && <button type="button" className="btn btn-primary" onClick={() => go(`#/combate/${current.battle_id}`)}>{s("go_battle")}</button>}
    </section>
  );
}

function CastlePanel({ run, fv, s, lang, refresh, go }) {
  const [busy, run_] = useBusy();
  const [rent, setRent] = useState({});
  const svc = (service, mon = -1, item = "") => run_(`${service}${mon}`, async () => {
    const r = await api.call("frontier_castle", { id: run.id, service, mon, item });
    if (service === "go" || service === "skip") {
      const cur = r.stages?.[r.step];
      if (service === "go" && cur?.battle_id) { go(`#/combate/${cur.battle_id}`); return; }
    }
    refresh(r);
  });
  const cost = (id) => fv.services?.find((x) => x.id === id)?.cost;
  const heal = fv.ranks?.heal || 1;
  const rental = fv.ranks?.rental || 1;
  const info = fv.ranks?.info || 1;
  const root = useRef(null);
  usePad((b) => padFocus(root.current, b), true);
  return (
    <section className="space-y-3" aria-label={s("castle_title", { n: fv.number })} ref={root}>
      <div className="flex flex-wrap items-center gap-3">
        <h2>{s("castle_title", { n: fv.number })}</h2>
        <span className="chip chip-accent fr-cp num">{s("cp", { n: fv.cp })}</span>
      </div>
      <p className="help">{s("castle_help")}</p>
      {fv.last_auto?.length ? <p className="help">{s("auto_bought", { what: fv.last_auto.map((x) => x.service).join(", ") })}</p> : null}
      <div className="panel fr-ranks">
        <span className="label">{s("ranks")}</span>
        {["heal", "rental", "info"].map((k) => (
          <div key={k} className="fr-rank">
            <span>{s(`rank_${k}`)} <b className="num">{fv.ranks?.[k]}/{fv.rank_max?.[k]}</b></span>
            {fv.rank_up?.[k] != null && <Busy busy={busy[`${k}_rank_up-1`]} className="btn btn-sm" disabled={fv.cp < fv.rank_up[k]} onClick={() => svc(`${k}_rank_up`)}>{s("rank_up", { c: fv.rank_up[k] })}</Busy>}
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <span className="label">{s("party")}</span>
          {fv.party.map((m, i) => (
            <MonCard key={i} m={m} lang={lang} s={s} castle>
              <div className="flex flex-wrap gap-1 mt-2">
                <Busy busy={busy[`heal_hp${i}`]} className="btn btn-sm" disabled={m.hp >= m.maxhp || fv.cp < cost("heal_hp")} onClick={() => svc("heal_hp", i)}>{s("heal_hp")} · {s("cost", { c: cost("heal_hp") })}</Busy>
                {heal >= 2 && <Busy busy={busy[`heal_pp${i}`]} className="btn btn-sm" disabled={fv.cp < cost("heal_pp")} onClick={() => svc("heal_pp", i)}>{s("heal_pp")} · {s("cost", { c: cost("heal_pp") })}</Busy>}
                {heal >= 3 && <Busy busy={busy[`heal_all${i}`]} className="btn btn-sm" disabled={fv.cp < cost("heal_all")} onClick={() => svc("heal_all", i)}>{s("heal_all")} · {s("cost", { c: cost("heal_all") })}</Busy>}
              </div>
              {!m.item && (
                <div className="flex flex-wrap gap-1 mt-2 items-center">
                  <select className="field fr-select" value={rent[i] || ""} onChange={(e) => setRent((r) => ({ ...r, [i]: e.target.value }))} aria-label={s("rent_pick")}>
                    <option value="">{s("rent_pick")}</option>
                    <optgroup label={s("berries")}>{(fv.berries || []).map((x) => <option key={x.item} value={`b:${x.item}`}>{nameOf("item", x.item, lang)} · {s("cost", { c: x.cost })}</option>)}</optgroup>
                    {rental >= 2 && <optgroup label={s("items")}>{(fv.items || []).map((x) => <option key={x.item} value={`i:${x.item}`}>{nameOf("item", x.item, lang)} · {s("cost", { c: x.cost })}</option>)}</optgroup>}
                  </select>
                  <Busy busy={busy[`rent${i}`]} className="btn btn-sm" disabled={!rent[i]} onClick={() => run_(`rent${i}`, async () => {
                    const [kind, item] = rent[i].split(/:(.*)/s);
                    refresh(await api.call("frontier_castle", { id: run.id, service: kind === "b" ? "rent_berry" : "rent_item", mon: i, item }));
                    setRent((r) => ({ ...r, [i]: "" }));
                  })}>{s("rent")}</Busy>
                </div>
              )}
            </MonCard>
          ))}
        </div>
        <div className="space-y-2">
          <span className="label">{s("rival_team")}</span>
          {(fv.scout || []).map((x) => (
            <div key={x.index} className="panel fr-mon">
              <div className="flex items-center gap-2">
                {x.species ? <MonIcon species={x.species} size={44} /> : <span className="fr-ball" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <b className="trunc">{x.species || s("unknown")}</b>
                  <div className="help trunc">{s("level", { n: x.level })}{x.item ? ` · ${nameOf("item", x.item, lang)}` : ""}{x.ability ? ` · ${nameOf("ability", x.ability, lang)}` : ""}{x.nature ? ` · ${nameOf("nature", x.nature, lang)}` : ""}</div>
                </div>
              </div>
              {x.stats && <div className="help num mt-1">{Object.entries(x.stats).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" · ")}</div>}
              {x.moves && <div className="flex flex-wrap gap-1 mt-1">{x.moves.map((m) => <span key={m.name} className="chip">{nameOf("move", m.name, lang)} <span className="num">{m.pp}</span></span>)}</div>}
              <div className="flex flex-wrap gap-1 mt-2">
                {!x.seen?.species && <Busy busy={busy[`opp_check${x.index}`]} className="btn btn-sm" disabled={fv.cp < cost("opp_check")} onClick={() => svc("opp_check", x.index)}>{s("check")} · {s("cost", { c: cost("opp_check") })}</Busy>}
                {x.seen?.species && !x.seen?.stats && <Busy busy={busy[`opp_stats${x.index}`]} className="btn btn-sm" disabled={fv.cp < cost("opp_stats")} onClick={() => svc("opp_stats", x.index)}>{s("summary")} · {s("cost", { c: cost("opp_stats") })}</Busy>}
                {x.seen?.species && !x.seen?.moves && info >= 2 && <Busy busy={busy[`opp_moves${x.index}`]} className="btn btn-sm" disabled={fv.cp < cost("opp_moves")} onClick={() => svc("opp_moves", x.index)}>{s("moves")} · {s("cost", { c: cost("opp_moves") })}</Busy>}
                {x.level !== 55 && <Busy busy={busy[`opp_level_up${x.index}`]} className="btn btn-sm" disabled={fv.cp < cost("opp_level_up")} onClick={() => svc("opp_level_up", x.index)}>{s("level_up")} · {s("cost", { c: cost("opp_level_up") })}</Busy>}
                {x.level !== 45 && <Busy busy={busy[`opp_level_down${x.index}`]} className="btn btn-sm" disabled={fv.cp < cost("opp_level_down")} onClick={() => svc("opp_level_down", x.index)}>{s("level_down")} · {s("cost", { c: cost("opp_level_down") })}</Busy>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Busy busy={busy["go-1"]} className="btn btn-primary fr-big" onClick={() => svc("go")}>{s("fight")}</Busy>
        {fv.skip && <Busy busy={busy["skip-1"]} className="btn" disabled={fv.cp < 50} onClick={() => svc("skip")}>{s("skip")}</Busy>}
      </div>
    </section>
  );
}

function History({ run, s, lang }) {
  const stages = run.stages || [];
  if (!stages.length) return null;
  return (
    <section className="space-y-2">
      <span className="label">{s("history")}</span>
      <div className="fr-history">
        {stages.slice(-21).map((st) => (
          <a key={st.number} className={`fr-stage ${st.result === "won" ? "is-won" : st.result === "lost" ? "is-lost" : ""}`} href={st.battle_id ? `#/combate/${st.battle_id}` : undefined}>
            <span className="num fr-stage-n">{st.number}</span>
            <span className="trunc">{lang === "en" ? st.name_en || st.name : st.name}</span>
            <span className="help trunc">
              {st.type ? `${typeName(st.type, lang)} · ` : ""}{st.arcade ? `${evName(st.arcade.event, lang)} · ` : ""}
              {st.after?.cp ? `${s("cp_won", { n: st.after.cp.total })} · ` : ""}{st.after?.bp ? `${s("bp", { n: st.after.bp })} · ` : ""}
              {st.skipped ? s("skipped") : st.result === "won" ? s("won") : st.result === "lost" ? s("lost") : s("pending")}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function PartnerSection({ fv, s, lang, t }) {
  const p = fv.partner;
  return (
    <section className="space-y-2 fr-partner">
      <div className="flex items-center gap-2">
        <Avatar url={p.avatar_url} name={p.name} size={48} />
        <div className="min-w-0">
          <span className="label">{s("partner", { name: lang === "en" ? p.name_en || p.name : p.name })}</span>
          <p className="help">{s("partner_help", { ai: p.ai_level ? t(`lvl_${p.ai_level}`) : "" })}</p>
          {fv.kind === "hall" && <p className="help">{s("multi_hall")}</p>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{(p.party || []).map((m, i) => <MonCard key={i} m={m} lang={lang} s={s} />)}</div>
    </section>
  );
}

export default function Frontera({ param }) {
  const { lang, go, changed, t } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const { data, error, loading, reload, setData } = useLoad(() => api.call("frontier_get", { id: param }), [param]);
  const [busy, run_] = useBusy();
  const fv = data?.frontier;
  const current = data && data.status === "active" ? data.current : null;
  const auto = !!fv?.auto;
  const waiting = data?.status === "active" && (fv?.phase === "battle" || auto);
  usePoll(reload, 2500, !!waiting);
  const refresh = (r) => { changed(); setData(r); };
  const name = useMemo(() => (fv ? L(NAMES[fv.kind] || ["", ""], lang) : ""), [fv, lang]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <div className="flex items-center gap-2"><Spinner /></div>;
  if (!data) return <p className="help">{s("not_found")} <a href="#/instalaciones">{s("back")}</a></p>;
  if (!fv) return <p className="help">{s("not_frontier")} <a href="#/instalaciones">{s("back")}</a></p>;
  const giveUp = () => run_("x", async () => { await api.call("challenge_abandon", { id: data.id }); changed(); reload(); });
  const lostAt = (data.stages || []).find((x) => x.result === "lost");
  return (
    <div className="space-y-4 frontera">
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="trunc">{name}</h1>
          <div className="help flex flex-wrap gap-2">
            <span className="chip">{data.challenger_name}</span>
            <span className="chip chip-accent">{s("streak", { n: data.streak || 0 })}</span>
            <span className="chip">{s("round", { r: fv.round, b: fv.round_battle, n: fv.round_length })}</span>
            <span className="chip">{s("bp", { n: fv.bp })}</span>
            {fv.mode && fv.mode !== "single" && <span className="chip">{s(`mode_${fv.mode}`)}</span>}
            {fv.kind === "castle" && <span className="chip chip-accent">{s("cp", { n: fv.cp })}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.status === "active" && <Busy busy={busy.x} className="btn" onClick={giveUp}>{s("abandon")}</Busy>}
          <a className="btn" href="#/instalaciones">{s("back")}</a>
        </div>
      </div>
      {data.status !== "active" && <p className="banner banner-info">{data.status === "abandoned" ? s("abandoned") : s("over")}{lostAt ? ` ${s("lost_at", { n: lostAt.number })}` : ""}</p>}
      {data.status === "active" && auto && fv.phase === "battle" && <p className="help">{s("ai_plays")}</p>}
      {data.status === "active" && <RivalCard fv={fv} s={s} lang={lang} />}
      {data.status === "active" && fv.kind === "arcade" && <ArcadeResult fv={fv} s={s} lang={lang} current={current} go={go} />}
      {data.status === "active" && fv.phase === "battle" && !(fv.kind === "arcade" && fv.event) && (
        <p className="help">{s("battle_on")} {current?.battle_id && <a className="btn btn-sm btn-primary" href={`#/combate/${current.battle_id}`}>{s("go_battle")}</a>}</p>
      )}
      {data.status === "active" && fv.phase === "type" && (
        <HallBoard run={data} fv={fv} s={s} lang={lang} onPicked={(r) => { changed(); const cur = r.stages[r.step]; if (cur?.battle_id) go(`#/combate/${cur.battle_id}`); else setData(r); }} />
      )}
      {data.status === "active" && fv.phase === "board" && <ArcadeBoard run={data} fv={fv} s={s} lang={lang} onStopped={refresh} />}
      {data.status === "active" && fv.phase === "castle" && <CastlePanel run={data} fv={fv} s={s} lang={lang} refresh={refresh} go={go} />}
      {fv.kind !== "castle" && (
        <section className="space-y-2">
          <span className="label">{s("party")}</span>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{fv.party.map((m, i) => <MonCard key={i} m={m} lang={lang} s={s} />)}</div>
        </section>
      )}
      {fv.partner && <PartnerSection fv={fv} s={s} lang={lang} t={t} />}
      <History run={data} s={s} lang={lang} />
    </div>
  );
}
