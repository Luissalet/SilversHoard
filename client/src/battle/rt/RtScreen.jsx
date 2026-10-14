// The real-time battle screen (Legends: Z-A rules). The battle runs here, in the browser, with the same engine files the app uses
// to check results: a person's seat reads the keyboard or a gamepad every tick, AI seats think by themselves. Live battles save
// their inputs every few seconds (a reload picks up where it was) and send them at the end; the app replays them to store the
// result. Finished and watched battles replay from the seed and the inputs, with play, pause, speed and restart.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RtBattle, fastForward, inputFrame, TPS } from "../../../../engine/src/realtime/sim.mjs";
import { L, STATUS_COLORS, STATUS_NAMES, STAT_SHORT, TYPE_COLORS, nameOf, typeName } from "../dex.js";
import { ArenaRenderer } from "./render.js";
import { makeInputs } from "./input.js";
import { rtT } from "./strings.js";
import "./rt.css";

const SAVE_EVERY_TICKS = 5 * TPS;
const HUD_MS = 100;

function fmtTime(s) {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

/** One line of the log for an event, in Spanish or English. */
function logLine(e, b, lang, tr) {
  const side = (i) => b.sides[i];
  const monName = (i, slot) => side(i)?.mons[slot ?? side(i).active]?.name || "?";
  const who = (i) => (lang === "en" ? `${side(i).name}'s ${monName(i)}` : `${monName(i)} de ${side(i).name}`);
  const mv = (name) => nameOf("move", name, lang);
  const sec = (e.t / TPS).toFixed(1);
  const es = lang !== "en";
  switch (e.k) {
    case "switch": return { sec, k: "switch", text: es ? `${side(e.s).name} saca a ${monName(e.s, e.slot)}` : `${side(e.s).name} sent out ${monName(e.s, e.slot)}` };
    case "windup": return { sec, k: "move", text: es ? `${who(e.s)} usa ${mv(e.name)}` : `${who(e.s)} used ${mv(e.name)}` };
    case "hit": {
      const extra = [e.crit ? tr("rt_crit") : "", e.eff > 1 ? tr("rt_super") : e.eff < 1 && e.eff > 0 ? tr("rt_weak") : ""].filter(Boolean).join(" ");
      return { sec, k: e.eff > 1 || e.crit ? "big" : "dmg", text: `${who(e.s)} −${Math.max(1, Math.round((e.dmg / Math.max(1, e.maxhp)) * 100))}% ${extra}`.trim() };
    }
    case "miss": return { sec, k: "minor", text: es ? `${who(1 - e.s)} esquiva el ataque` : `${who(1 - e.s)} dodged` };
    case "fizzle": return { sec, k: "minor", text: es ? `${mv(b.dex.moves.get(e.move).name)} de ${monName(e.s)} no alcanza a nadie` : `${who(e.s)}'s ${mv(b.dex.moves.get(e.move).name)} hit nothing` };
    case "protected": return { sec, k: "minor", text: es ? `${who(e.s)} se protege` : `${who(e.s)} protected itself` };
    case "immune": return { sec, k: "minor", text: es ? `No afecta a ${monName(e.s)}` : `It doesn't affect ${monName(e.s)}` };
    case "status": return { sec, k: "effect", text: `${who(e.s)}: ${L(STATUS_NAMES[e.status] || [e.status, e.status], lang)}` };
    case "boost": return e.same ? null : { sec, k: "minor", text: `${who(e.s)}: ${L(STAT_SHORT[e.stat] || [e.stat, e.stat], lang)} ${e.stage > 0 ? "↑" : e.stage < 0 ? "↓" : "="}` };
    case "faint": return { sec, k: "faint", text: es ? `¡${monName(e.s, e.slot)} de ${side(e.s).name} se debilita!` : `${side(e.s).name}'s ${monName(e.s, e.slot)} fainted!` };
    case "recall": return { sec, k: "switch", text: es ? `${side(e.s).name} retira a ${monName(e.s, e.slot)} (${e.left} cambios)` : `${side(e.s).name} withdrew ${monName(e.s, e.slot)} (${e.left} switches)` };
    case "flinch": return { sec, k: "minor", text: es ? `¡${monName(e.s)} retrocede y pierde el ataque!` : `${monName(e.s)} flinched and lost its move!` };
    case "weather": return { sec, k: "info", text: es ? `Cambia el tiempo (${e.secs} s)` : `The weather changed (${e.secs} s)` };
    case "terrain": return { sec, k: "info", text: es ? `Cambia el campo (${e.secs} s)` : `The terrain changed (${e.secs} s)` };
    case "hazard": return { sec, k: "info", text: `${nameOf("move", { stealthrock: "Stealth Rock", spikes: "Spikes", toxicspikes: "Toxic Spikes", stickyweb: "Sticky Web" }[e.id] || e.id, lang)} → ${side(e.s).name}` };
    case "heal": return e.amount >= 1 ? { sec, k: "minor", text: `${who(e.s)} +${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}%` } : null;
    case "chip": return { sec, k: "minor", text: `${who(e.s)} −${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}% (${e.source})` };
    case "forfeit": return { sec, k: "big", text: es ? `${side(e.s).name} se rinde` : `${side(e.s).name} forfeited` };
    case "end": return { sec, k: "big", text: e.winner === 0 || e.winner === 1 ? tr("rt_winner", { name: side(e.winner).name }) : tr("rt_tie") };
    default: return null;
  }
}

function HpBar({ mon }) {
  const frac = mon?.maxhp ? mon.hp / mon.maxhp : 0;
  return (
    <div className="rt-hp" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
      <span style={{ width: `${frac * 100}%`, background: frac > 0.5 ? "var(--hp-ok)" : frac > 0.2 ? "var(--hp-mid)" : "var(--hp-low)" }} />
    </div>
  );
}

function SideBar({ side, align, lang, tr, avatarUrl }) {
  const mon = side.mons[side.active];
  const boosts = Object.entries(mon?.boosts || {}).filter(([, v]) => v);
  return (
    <div className={`rt-sidebar ${align}`}>
      {avatarUrl ? <img className="rt-avatar" src={avatarUrl} alt="" /> : null}
      <div className="min-w-0 flex-1">
        <div className="rt-name trunc">{side.name}</div>
        <div className="rt-party" aria-label={tr("rt_party")}>
          {side.mons.map((m, i) => <span key={i} className={`rt-ball ${m.fainted ? "is-out" : ""} ${i === side.active ? "is-on" : ""}`} title={`${m.name} ${m.hp}/${m.maxhp}`} />)}
          <span className="rt-switches" title={tr("rt_switches_help")}>{"⇄".repeat(side.switches_left)}<span className="rt-switches-off">{"⇄".repeat(Math.max(0, 3 - side.switches_left))}</span></span>
        </div>
        {mon && (
          <div className="rt-mon">
            <b className="trunc">{mon.name}</b> <span className="help">Nv.{mon.level}</span>
            {mon.status && <span className="rt-status" style={{ background: STATUS_COLORS[mon.status] }}>{L(STATUS_NAMES[mon.status], lang)}</span>}
            {side.confused && <span className="rt-tag">{tr("rt_confused")}</span>}
            {side.trapped && <span className="rt-tag">{tr("rt_trapped")}</span>}
            {side.taunt && <span className="rt-tag">{tr("rt_taunted")}</span>}
            {side.sub && <span className="rt-tag">{tr("rt_sub")}</span>}
            {boosts.map(([k, v]) => <span key={k} className={`rt-tag ${v > 0 ? "up" : "down"}`}>{L(STAT_SHORT[k], lang)} {v > 0 ? "↑" : "↓"}</span>)}
            <HpBar mon={mon} />
            <span className="rt-hp-num num">{mon.hp}/{mon.maxhp}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MoveButton({ m, i, lang, tr, onUse, keyHint, disabled }) {
  const ready = m.cd <= 0 && !m.blocked;
  const frac = m.total ? Math.min(1, m.cd / m.total) : 0;
  const color = TYPE_COLORS[m.type] || "#888";
  const blocked = m.blocked ? tr(`rt_blocked_${m.blocked}`) : "";
  const title = [nameOf("move", m.name, lang), `${typeName(m.type, lang)} · ${m.category}${m.power ? ` · ${m.power}` : ""}`,
    tr("rt_base_cd", { n: m.cooldown, src: tr(m.za ? "rt_src_za" : "rt_src_derived") }), tr("rt_windup", { n: (m.windup / TPS).toFixed(2) }),
    m.no_effect ? tr("rt_no_effect") : "", blocked].filter(Boolean).join("\n");
  return (
    <button type="button" className={`rt-move ${ready ? "is-ready" : ""}`} style={{ "--type": color, "--cd": frac }} disabled={disabled}
      onClick={() => onUse(i)} title={title} aria-label={`${nameOf("move", m.name, lang)}${ready ? "" : `, ${Math.ceil(m.cd)} s`}`}>
      <span className="rt-move-sweep" aria-hidden="true" />
      <span className="rt-move-key">{keyHint}</span>
      <span className="rt-move-name trunc">{nameOf("move", m.name, lang)}</span>
      <span className="rt-move-meta">{typeName(m.type, lang)} · {m.total ? `${m.total.toFixed(1)} s` : ""}</span>
      {!ready && m.cd > 0 && <span className="rt-move-cd num">{m.cd.toFixed(1)}</span>}
      {blocked && <span className="rt-move-block">{blocked}</span>}
    </button>
  );
}

function Pad({ side, si, lang, tr, input, partyOpen, onUse, onRoll, onSwitch, onParty, keys, sprites }) {
  const mon = side.mons[side.active];
  const showParty = partyOpen || side.need;
  return (
    <div className="rt-pad">
      {side.need && <div className="rt-need">{tr("rt_choose_next")}</div>}
      {!side.need && mon && !mon.fainted && (
        <div className="rt-moves">
          {mon.moves.map((m, i) => <MoveButton key={i} m={m} i={i} lang={lang} tr={tr} keyHint={keys.moves[i]} onUse={(j) => onUse(si, j)} />)}
        </div>
      )}
      <div className="rt-pad-row">
        <button type="button" className="btn btn-sm" onClick={() => onRoll(si)} disabled={side.roll_ready > 0 || side.need}>
          {tr("rt_roll")} <span className="rt-key">{keys.roll}</span>{side.roll_ready > 0 ? ` ${side.roll_ready.toFixed(1)}` : ""}
        </button>
        <button type="button" className={`btn btn-sm ${showParty ? "btn-primary" : ""}`} onClick={() => onParty(si)} disabled={side.need}>
          {tr("rt_party_open")}
        </button>
        <span className="help">{tr("rt_switches", { n: side.switches_left })}</span>
      </div>
      {showParty && (
        <div className="rt-party-list">
          {side.mons.map((m, i) => (
            <button key={i} type="button" className="rt-party-btn" disabled={m.fainted || i === side.active || (!side.need && side.switches_left <= 0)}
              onClick={() => onSwitch(si, i)} title={`${m.name} ${m.hp}/${m.maxhp}`}>
              <img src={sprites.pokemon(m.species, { spriteid: m.sprite_id })} alt="" className={sprites.pixelated ? "pixelated" : ""} onError={(ev) => { ev.currentTarget.style.visibility = "hidden"; }} />
              <span className="trunc">{m.name}</span>
              <span className="rt-key">{keys.slots[i]}</span>
              <HpBar mon={m} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const KEY_HINTS = {
  solo: { moves: ["1", "2", "3", "4"], roll: "␣", slots: ["1", "2", "3", "4", "5", "6"] },
  p1: { moves: ["1", "2", "3", "4"], roll: "␣", slots: ["1", "2", "3", "4", "5", "6"] },
  p2: { moves: ["U", "I", "O", "P"], roll: "↵", slots: ["U", "I", "O", "P", "[", "]"] },
};

/**
 * battle: the app's battle (battle_get) with `rt` {spec, inputs, tick, human}. onFinish(inputs, tick, forfeitSide) -> Promise of
 * the stored battle. seats: {p1, p2} with avatarUrl. base: prefix of the app's routes ("" in the app).
 */
export default function RtScreen({ battle, lang = "es", sprites, seats, onFinish, onSave, onAgain, base = "" }) {
  const tr = useMemo(() => rtT(lang), [lang]);
  const spec = battle.rt.spec;
  const humans = battle.rt.human || [false, false];
  const live = battle.status === "live";
  const people = humans.filter(Boolean).length;
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const sim = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [progress, setProgress] = useState([0, 0]);
  const [hud, setHud] = useState(null);
  const [log, setLog] = useState([]);
  const [party, setParty] = useState([false, false]);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [sure, setSure] = useState(-1);
  const logRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const schemes = people === 2 ? ["p1", "p2"] : ["solo", "solo"];

  const texts = useMemo(() => ({
    move: (n) => nameOf("move", n, lang), crit: tr("rt_crit"), super: tr("rt_super"), weak: tr("rt_weak"), dodged: tr("rt_dodged"),
    blocked: tr("rt_blocked"), immune: tr("rt_immune"), flinch: tr("rt_flinch"), status: (s) => L(STATUS_NAMES[s] || [s, s], lang),
    statusColor: (s) => STATUS_COLORS[s] || "#fff", stat: (k) => L(STAT_SHORT[k] || [k, k], lang),
  }), [lang, tr]);

  // build the battle, catch up a live one, load the sprites
  const build = useCallback((untilTick = 0) => {
    const b = new RtBattle(spec);
    const recorded = battle.rt.inputs || [];
    const state = { b, inputs: makeInputs(humans), held: new Set(), acc: 0, last: 0, logIndex: 0, saveAt: 0, savedLen: 0, replay: null };
    if (live) {
      if (recorded.length || battle.rt.tick) {
        fastForward(b, recorded, battle.rt.tick || 0);
        b.inputLog = recorded.slice();
      }
    } else {
      const byTick = new Map();
      for (const row of recorded) { if (!byTick.has(row[0])) byTick.set(row[0], []); byTick.get(row[0]).push(row); }
      state.replay = { byTick, held: [null, null] };
      if (untilTick) {
        while (!b.ended && b.t < untilTick) b.step(inputFrame(b, byTick.get(b.t + 1) || [], state.replay.held));
      }
    }
    state.inputs.forEach((inp, i) => { if (inp) inp.onParty = (open) => setParty((p) => { const n = [...p]; n[i] = open; return n; }); });
    return state;
  }, [spec, battle.rt, live]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    let state;
    try {
      state = build();
    } catch (e) {
      setError(e);
      return undefined;
    }
    sim.current = state;
    // for checks from the browser console (and the app's QA): the running battle and the classes that rebuild it
    window.__silverRt = { RtBattle, fastForward, inputFrame, get battle() { return sim.current?.b; } };
    const view = state.b.view();
    const renderer = new ArenaRenderer(canvasRef.current, {
      sides: view.sides.map((s, i) => ({ name: s.name, mons: s.mons, avatarUrl: seats?.[s.id]?.avatarUrl || "" })), sprites, base, texts,
    });
    renderer.eventIndex = state.b.events.length;
    state.renderer = renderer;
    state.logIndex = 0;
    setHud(view);
    setLog(state.b.events.map((e) => logLine(e, state.b, lang, tr)).filter(Boolean).slice(-200));
    state.logIndex = state.b.events.length;
    renderer.preload((n, total) => !cancelled && setProgress([n, total])).then(() => {
      if (cancelled) return;
      setPhase(live ? (state.b.ended ? "ended" : "ready") : "playing");
    });
    return () => { cancelled = true; };
  }, [battle.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the log follows the battle unless it was scrolled up to read
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [log]);

  // canvas size follows its box
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let pending = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => sim.current?.renderer?.resize(el.clientWidth));
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(pending); ro.disconnect(); };
  }, []);

  const finish = useCallback(async (forfeitSide = "") => {
    const st = sim.current;
    if (!st || !live || st.finishing) return;
    st.finishing = true;
    if (forfeitSide && !st.b.ended) st.b.forfeit(forfeitSide);
    setPhase("saving");
    try {
      const stored = await onFinish(st.b.inputLog, st.b.t, forfeitSide);
      setResult(stored);
      setPhase("ended");
    } catch (e) {
      setError(e);
      setPhase("ended");
    }
  }, [live, onFinish]);

  // the loop: fixed 30 ticks per second, drawing every frame
  useEffect(() => {
    let raf = 0;
    let lastHud = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const st = sim.current;
      if (!st?.renderer) return;
      const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0;
      st.last = now;
      const running = phaseRef.current === "running" || phaseRef.current === "playing";
      if (running && !st.b.ended) {
        st.acc += dt * (live ? 1 : speed);
        let n = 0;
        while (st.acc >= 1 / TPS && n++ < 12 && !st.b.ended) {
          st.acc -= 1 / TPS;
          if (live) {
            const input = {};
            st.b.sides.forEach((side, i) => { if (st.inputs[i]) input[side.id] = st.inputs[i].take(st.held, side.mons.length); });
            st.b.step(input);
          } else {
            st.b.step(inputFrame(st.b, st.replay.byTick.get(st.b.t + 1) || [], st.replay.held));
          }
        }
        if (live && st.b.t - st.saveAt >= SAVE_EVERY_TICKS && st.b.inputLog.length !== st.savedLen) {
          st.saveAt = st.b.t;
          st.savedLen = st.b.inputLog.length;
          onSave?.(st.b.inputLog.slice(), st.b.t);
        }
        if (st.b.ended) {
          if (live) finish();
          else setPhase("done");
        }
      }
      st.renderer.draw(st.b, running ? dt : 0);
      if (now - lastHud > HUD_MS) {
        lastHud = now;
        setHud(st.b.view());
        if (st.logIndex < st.b.events.length) {
          const fresh = st.b.events.slice(st.logIndex).map((e) => logLine(e, st.b, lang, tr)).filter(Boolean);
          st.logIndex = st.b.events.length;
          if (fresh.length) setLog((l) => [...l, ...fresh].slice(-200));
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [live, speed, finish, onSave, lang, tr]);

  // keyboard
  useEffect(() => {
    if (!live) return undefined;
    const down = (e) => {
      const st = sim.current;
      if (!st || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;
      if (e.code === "Escape" && !st.inputs.some((x) => x?.partyOpen)) {
        if (phaseRef.current === "running") setPhase("paused");
        else if (phaseRef.current === "paused") setPhase("running");
        e.preventDefault();
        return;
      }
      if (phaseRef.current !== "running") return;
      st.held.add(e.code);
      let used = false;
      for (const inp of st.inputs) if (inp && !e.repeat) used = inp.key(e.code, true) || used;
      if (used || ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Backspace"].includes(e.code)) e.preventDefault();
    };
    const up = (e) => sim.current?.held.delete(e.code);
    const blur = () => { sim.current?.held.clear(); if (phaseRef.current === "running") setPhase("paused"); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const vis = () => { if (document.hidden) blur(); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [live]);

  const queue = (si, patch) => {
    const inp = sim.current?.inputs[si];
    if (inp && phaseRef.current === "running") Object.assign(inp.queue, patch);
  };
  const onUse = (si, i) => queue(si, { use: i });
  const onRoll = (si) => queue(si, { dodge: true });
  const onSwitch = (si, i) => { queue(si, { sw: i }); const inp = sim.current?.inputs[si]; if (inp) { inp.partyOpen = false; setParty((p) => { const n = [...p]; n[si] = false; return n; }); } };
  const onParty = (si) => { const inp = sim.current?.inputs[si]; if (inp) { inp.partyOpen = !inp.partyOpen; setParty((p) => { const n = [...p]; n[si] = inp.partyOpen; return n; }); } };

  const restart = () => {
    const st = build(0);
    st.renderer = sim.current.renderer;
    st.renderer.eventIndex = 0;
    st.renderer.floats = [];
    st.renderer.effects = [];
    st.renderer.lastActive = [-1, -1];
    sim.current = st;
    setLog([]);
    setPhase("playing");
  };

  if (error && phase !== "ended") return <div className="banner banner-danger">{String(error.message || error)}</div>;
  const view = hud;
  const ended = phase === "ended" || phase === "done";
  const winnerIdx = view?.winner;
  const mySide = humans.findIndex(Boolean);
  const stored = result || (battle.status === "ended" ? battle : null);

  return (
    <div className="b-wrap rt-wrap">
      <div className="b-main">
        {view && (
          <div className="rt-top">
            <SideBar side={view.sides[0]} align="left" lang={lang} tr={tr} avatarUrl={seats?.p1?.avatarUrl} />
            <div className="rt-clock">
              <div className="rt-time num" aria-label={tr("rt_time")}>{fmtTime(view.time_limit - view.seconds)}</div>
              {view.weather && <span className="chip">{nameOf("move", { sunnyday: "Sunny Day", raindance: "Rain Dance", sandstorm: "Sandstorm", snow: "Snowscape", hail: "Hail" }[view.weather.id] || view.weather.id, lang)} {Math.ceil(view.weather.left)} s</span>}
              {view.terrain && <span className="chip">{nameOf("move", { electricterrain: "Electric Terrain", grassyterrain: "Grassy Terrain", psychicterrain: "Psychic Terrain", mistyterrain: "Misty Terrain" }[view.terrain.id] || view.terrain.id, lang)} {Math.ceil(view.terrain.left)} s</span>}
            </div>
            <SideBar side={view.sides[1]} align="right" lang={lang} tr={tr} avatarUrl={seats?.p2?.avatarUrl} />
          </div>
        )}
        <div className="rt-stage" ref={wrapRef}>
          <canvas ref={canvasRef} className="rt-canvas" />
          {phase === "loading" && (
            <div className="rt-overlay"><div className="rt-card"><b>{tr("rt_loading")}</b><div className="help">{tr("rt_loading_sprites", { n: progress[0], total: progress[1] || "…" })}</div></div></div>
          )}
          {phase === "ready" && (
            <div className="rt-overlay">
              <div className="rt-card">
                <b className="rt-big">{tr("rt_ready")}</b>
                <dl className="rt-controls">
                  {people === 2 ? (<><dd>{tr("rt_keys_p1")}</dd><dd>{tr("rt_keys_p2")}</dd></>) : (
                    <>
                      <dt>{tr("rt_ctrl_move")}</dt><dd>{tr("rt_keys_move")}</dd>
                      <dt>{tr("rt_ctrl_moves")}</dt><dd>{tr("rt_keys_moves")}</dd>
                      <dt>{tr("rt_ctrl_roll")}</dt><dd>{tr("rt_keys_roll")}</dd>
                      <dt>{tr("rt_ctrl_switch")}</dt><dd>{tr("rt_keys_switch")}</dd>
                      <dt>{tr("rt_ctrl_pause")}</dt><dd>{tr("rt_keys_pause")}</dd>
                    </>
                  )}
                </dl>
                <button type="button" className="btn btn-primary" autoFocus onClick={() => setPhase("running")}>{tr("rt_start")}</button>
              </div>
            </div>
          )}
          {phase === "paused" && (
            <div className="rt-overlay">
              <div className="rt-card">
                <b className="rt-big">{tr("rt_paused")}</b>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn btn-primary" autoFocus onClick={() => { setSure(-1); setPhase("running"); }}>{tr("rt_resume")}</button>
                  {humans.map((h, i) => h && (
                    <button key={i} type="button" className="btn btn-danger"
                      onClick={() => (sure === i ? finish(i === 0 ? "p1" : "p2") : setSure(i))}>
                      {sure === i ? tr("rt_forfeit_sure") : tr("rt_forfeit")}{people === 2 ? ` · ${view?.sides[i].name}` : ""}
                    </button>
                  ))}
                </div>
                {sure >= 0 && <div className="help">{tr("rt_forfeit_confirm")}</div>}
              </div>
            </div>
          )}
          {phase === "saving" && <div className="rt-overlay"><div className="rt-card"><b>{tr("rt_saving")}</b></div></div>}
          {ended && view && (
            <div className="rt-overlay is-end">
              <div className="rt-card">
                <b className="rt-big">
                  {winnerIdx === 0 || winnerIdx === 1 ? (people === 1 && live ? (winnerIdx === mySide ? tr("rt_win") : tr("rt_lose")) : tr("rt_winner", { name: view.sides[winnerIdx].name })) : tr("rt_tie")}
                </b>
                <div className="help">{tr(`rt_reason_${view.reason || "ko"}`)} · {fmtTime(view.seconds)}</div>
                {error && <div className="banner banner-danger">{String(error.message || error)}</div>}
                <div className="rt-score">
                  {view.sides.map((s, i) => (
                    <div key={i}><b className="trunc">{s.name}</b><span className="num">{s.mons.filter((m) => !m.fainted).length}/{s.mons.length}</span></div>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn" onClick={restart}>{tr("rt_replay")}</button>
                  {onAgain && <button type="button" className="btn btn-primary" onClick={onAgain}>{tr("rt_again")}</button>}
                  {stored == null && live ? null : <button type="button" className="btn" onClick={() => setPhase("closed")}>{tr("rt_close")}</button>}
                </div>
              </div>
            </div>
          )}
        </div>
        {!live && view && (
          <div className="b-replay">
            <button type="button" className="btn btn-sm" onClick={restart} title={tr("rt_restart")} aria-label={tr("rt_restart")}>⏮</button>
            <button type="button" className="btn btn-sm" onClick={() => setPhase((p) => (p === "playing" ? "replay-paused" : "playing"))}
              aria-label={phase === "playing" ? "Pausa" : "Play"}>{phase === "playing" ? "⏸" : "▶"}</button>
            <div className="rt-progress"><span style={{ width: `${Math.min(100, (view.seconds / Math.max(1, (battle.summary?.seconds || view.time_limit))) * 100)}%` }} /></div>
            <span className="help num">{fmtTime(view.seconds)}</span>
            <div className="seg" role="group" aria-label={tr("rt_speed")}>
              {[0.5, 1, 2, 4].map((v) => <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)}>{String(v).replace(".", ",")}×</button>)}
            </div>
          </div>
        )}
        {live && view && (
          <div className={`rt-pads ${people === 2 ? "two" : ""}`}>
            {view.sides.map((s, i) => humans[i] && (
              <Pad key={i} side={s} si={i} lang={lang} tr={tr} partyOpen={party[i]} onUse={onUse} onRoll={onRoll} onSwitch={onSwitch} onParty={onParty}
                keys={KEY_HINTS[schemes[i]]} sprites={sprites} />
            ))}
          </div>
        )}
        <div className="help rt-credit">{tr("rt_sprites_note")}</div>
      </div>
      <div className="b-log rt-log" aria-live="off" ref={logRef}>
        {log.slice(-120).map((l, i) => (
          <div key={i} className={`b-log-line k-${l.k}`}><span className="rt-sec num">{l.sec}</span> {l.text}</div>
        ))}
      </div>
    </div>
  );
}
