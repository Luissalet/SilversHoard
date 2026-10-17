// The real-time battle screen (Legends: Z-A rules). The battle runs here, in the browser, with the same engine files the app uses
// to check results: a person's seat reads the keyboard or a gamepad every tick, AI seats think by themselves. Live battles save
// their inputs every few seconds (a reload picks up where it was) and send them at the end; the app replays them to store the
// result. Finished and watched battles replay from the seed and the inputs, with play, pause, speed and restart.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RtBattle, fastForward, inputFrame, TPS, ULT_SLOT } from "../../../../engine/src/realtime/sim.mjs";
import { L, STATUS_COLORS, STATUS_NAMES, STAT_SHORT, TYPE_COLORS, nameOf, typeName } from "../dex.js";
import { ArenaRenderer } from "./render.js";
import SoundButton from "../SoundControl.jsx";
import AbilityBanner from "../AbilityBanner.jsx";
import {realtimeAbility} from "../../../../engine/src/ability-events.mjs";
import { appCryUrl } from "../sfx.js";
import { battleEnd, battleRole, battleType, genOfFormat, music, pickTrack } from "../../audio.js";
import { CONTROL_LAYOUTS, makeInputs } from "./input.js";
import { rtT } from "./strings.js";
import { NetLink, battleHash, packFrame, unpackFrame } from "./netplay.js";
import "./rt.css";

const SAVE_EVERY_TICKS = 5 * TPS;
const HUD_MS = 100;

function fmtTime(s) {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

const SOURCES = {
  sandstorm: ["tormenta de arena", "sandstorm"], hail: ["granizo", "hail"], recoil: ["retroceso", "recoil"], trap: ["atrapado", "trapped"],
  brn: ["quemadura", "burn"], psn: ["veneno", "poison"], tox: ["veneno grave", "bad poison"], curse: ["maldición", "curse"],
};

/** What hurt a Pokémon, in words: a weather, a status, or the move, ability or item of that id. */
function sourceName(id, b, lang) {
  if (SOURCES[id]) return L(SOURCES[id], lang);
  for (const [kind, table] of [["move", b.dex.moves], ["item", b.dex.items], ["ability", b.dex.abilities]]) {
    const e = table.get(id);
    if (e?.exists) return nameOf(kind, e.name, lang);
  }
  return id;
}

/** One line of the log for an event, in Spanish or English. */
function logLine(e, b, lang, tr) {
  const side = (i) => b.sides[i];
  // in doubles an event says its slot (e.u): the Pokémon is the one in that slot
  const activeOf = (i, u) => (b.doubles ? side(i)?.units[u || 0]?.active : side(i)?.active);
  const monName = (i, slot, u = e.u) => side(i)?.mons[slot ?? activeOf(i, u)]?.name || "?";
  const who = (i, u = e.u) => (lang === "en" ? `${side(i).name}'s ${monName(i, undefined, u)}` : `${monName(i, undefined, u)} de ${side(i).name}`);
  const dodger = () => { const t = b.doubles ? b.foe(side(e.s).units[e.u || 0]) : null; return t ? who(t.index, t.pos) : who(1 - e.s, 0); };
  const mv = (name) => (name === "Ultimate" ? tr("rt_ult") : nameOf("move", name, lang));
  const sec = (e.t / TPS).toFixed(1);
  const es = lang !== "en";
  switch (e.k) {
    case "ability": return {sec,k:"ability",text:`${e.pokemon || monName(e.s)}: ${nameOf("ability",b.dex.abilities.get(e.id).name,lang)}`};
    case "switch": return { sec, k: "switch", text: es ? `${side(e.s).name} saca a ${monName(e.s, e.slot)}` : `${side(e.s).name} sent out ${monName(e.s, e.slot)}` };
    case "windup": return { sec, k: "move", text: es ? `${who(e.s)} usa ${mv(e.name)}` : `${who(e.s)} used ${mv(e.name)}` };
    case "hit": {
      const extra = [e.crit ? tr("rt_crit") : "", e.eff > 1 ? tr("rt_super") : e.eff < 1 && e.eff > 0 ? tr("rt_weak") : ""].filter(Boolean).join(" ");
      return { sec, k: e.eff > 1 || e.crit ? "big" : "dmg", text: `${who(e.s)} −${Math.max(1, Math.round((e.dmg / Math.max(1, e.maxhp)) * 100))}% ${extra}`.trim() };
    }
    case "miss": return { sec, k: "minor", text: e.fog ? (es ? "El ataque falla en la niebla" : "The attack missed in the fog") : es ? `${dodger()} esquiva el ataque` : `${dodger()} dodged` };
    case "helping": return { sec, k: "effect", text: es ? `${who(e.s)} se prepara para ayudar a su compañero` : `${who(e.s)} is ready to help its partner` };
    case "follow": return { sec, k: "effect", text: es ? `¡${who(e.s)} atrae todas las miradas!` : `${who(e.s)} became the centre of attention!` };
    case "fizzle": return e.rock
      ? { sec, k: "minor", text: es ? `${mv(b.dex.moves.get(e.move).name)} de ${monName(e.s)} choca contra una roca` : `${who(e.s)}'s ${mv(b.dex.moves.get(e.move).name)} hit a rock` }
      : { sec, k: "minor", text: es ? `${mv(b.dex.moves.get(e.move).name)} de ${monName(e.s)} no alcanza a nadie` : `${who(e.s)}'s ${mv(b.dex.moves.get(e.move).name)} hit nothing` };
    case "protected": return e.pierced
      ? { sec, k: "effect", text: es ? `¡El ataque Plus atraviesa la protección de ${monName(e.s)}!` : `The Plus attack pierces ${who(e.s)}'s protection!` }
      : { sec, k: "minor", text: es ? `${who(e.s)} se protege` : `${who(e.s)} protected itself` };
    case "plus": return { sec, k: "effect", text: es ? `${who(e.s)}: ¡${mv(e.name)} Plus!` : `${who(e.s)}: ${mv(e.name)} Plus!` };
    case "mega": return { sec, k: "big", text: es ? `¡${e.from} de ${side(e.s).name} megaevoluciona!` : `${side(e.s).name}'s ${e.from} Mega Evolved!` };
    case "phase": return { sec, k: "big", text: e.line ? `${side(e.s).name}: «${e.line}»` : (es ? `¡${side(e.s).name} cambia de táctica!` : `${side(e.s).name} changes tactics!`) };
    case "ultimate": return { sec, k: "big", text: es ? `¡${who(e.s)} usa un especial de Silver de tipo ${typeName(e.type, lang)}!` : `${who(e.s)} uses a ${e.type}-type Silver special!` };
    case "dummy_reset": return { sec, k: "big", text: es ? `${who(e.s)} cae y se levanta con todos sus PS` : `${who(e.s)} goes down and stands up again at full HP` };
    case "mega_end": return { sec, k: "info", text: es ? `${monName(e.s, e.slot)} vuelve a su forma` : `${monName(e.s, e.slot)} went back to its usual forme` };
    case "immune": return { sec, k: "minor", text: es ? `No afecta a ${monName(e.s)}` : `It doesn't affect ${monName(e.s)}` };
    case "status": return { sec, k: "effect", text: `${who(e.s)}: ${L(STATUS_NAMES[e.status] || [e.status, e.status], lang)}` };
    case "boost": return e.same ? null : { sec, k: "minor", text: `${who(e.s)}: ${L(STAT_SHORT[e.stat] || [e.stat, e.stat], lang)} ${e.stage > 0 ? "↑" : e.stage < 0 ? "↓" : "="}` };
    case "faint": return { sec, k: "faint", text: es ? `¡${monName(e.s, e.slot)} de ${side(e.s).name} se debilita!` : `${side(e.s).name}'s ${monName(e.s, e.slot)} fainted!` };
    case "recall": return { sec, k: "switch", text: es ? `${side(e.s).name} retira a ${monName(e.s, e.slot)} (${e.left} cambios)` : `${side(e.s).name} withdrew ${monName(e.s, e.slot)} (${e.left} switches)` };
    case "flinch": return { sec, k: "minor", text: es ? `¡${monName(e.s)} retrocede y pierde el ataque!` : `${monName(e.s)} flinched and lost its move!` };
    case "weather": return { sec, k: "info", text: es ? `Cambia el tiempo (${e.secs} s)` : `The weather changed (${e.secs} s)` };
    case "terrain": return { sec, k: "info", text: es ? `Cambia el campo (${e.secs} s)` : `The terrain changed (${e.secs} s)` };
    case "trickroom": return { sec, k: "info", text: es ? `Espacio Raro durante ${e.secs} s: los lentos van más rápido` : `Trick Room for ${e.secs} s: the slow go faster` };
    case "trickroom_end": return { sec, k: "info", text: es ? "Se acabó el Espacio Raro" : "Trick Room ended" };
    case "fog": return { sec, k: "info", text: es ? "Hay niebla: 2 de cada 5 golpes fallan" : "Fog: 2 hits in 5 miss" };
    case "fog_end": return { sec, k: "info", text: es ? "Se ha disipado la niebla" : "The fog lifted" };
    case "hazard": return { sec, k: "info", text: `${nameOf("move", { stealthrock: "Stealth Rock", spikes: "Spikes", toxicspikes: "Toxic Spikes", stickyweb: "Sticky Web" }[e.id] || e.id, lang)} → ${side(e.s).name}` };
    case "heal": return e.amount >= 1 ? { sec, k: "minor", text: `${who(e.s)} +${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}%` } : null;
    case "chip": return { sec, k: "minor", text: `${who(e.s)} −${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}% (${sourceName(e.source, b, lang)})` };
    case "forfeit": return { sec, k: "big", text: es ? `${side(e.s).name} se rinde` : `${side(e.s).name} forfeited` };
    case "end": return { sec, k: "big", text: e.winner === 0 || e.winner === 1 ? tr("rt_winner", { name: side(e.winner).name }) : tr("rt_tie") };
    default: return null;
  }
}

function HpBar({ mon }) {
  const frac = mon?.maxhp ? Math.max(0, mon.hp) / mon.maxhp : 0;
  // the white chunk is the HP just lost: it stays a moment and then drains after the bar (CSS transition)
  return (
    <div className="rt-hp" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
      <i className="rt-hp-lag" style={{ width: `${frac * 100}%` }} />
      <span style={{ width: `${frac * 100}%`, background: frac > 0.5 ? "var(--hp-ok)" : frac > 0.2 ? "var(--hp-mid)" : "var(--hp-low)" }} />
    </div>
  );
}

/** The Pokémon's face (SpriteCollab portrait) by its name in the bars; grey once it has fainted. */
function MonFace({ mon, sprites, offline }) {
  if (!mon || !sprites || offline) return null;
  return <MonFaceImage key={`${mon.species}:${sprites.server}`} mon={mon} sprites={sprites} />;
}

function MonFaceImage({ mon, sprites }) {
  const [step, setStep] = useState(0);
  const src = step === 0 ? sprites.portrait?.(mon.species, "Normal", { num: mon.num || 0 }) || sprites.fallback(mon.species) : sprites.fallback(mon.species);
  const className = `rt-face ${mon.fainted || mon.hp <= 0 ? "is-out" : ""}`;
  if (step > 1 || !src) return <span className={className} aria-label={mon.species}>{mon.species.slice(0, 2)}</span>;
  return <img key={`${step}:${src}`} className={className} src={src} alt="" onError={() => setStep((s) => s + 1)} />;
}

/** The trainer's Mega Power gauge: three segments; all three for Mega Evolution (and, in rules versions 2-3, one pays for a Plus move). */
function Gauge({ side, tr }) {
  const segs = [0, 1, 2].map((i) => Math.max(0, Math.min(1, (side.gauge || 0) - i)));
  return (
    <div className={`rt-gauge ${side.mega ? "is-mega" : ""}`} title={tr(side.plus_moves === false ? "rt_gauge_help_v4" : "rt_gauge_help")} role="meter" aria-label={tr("rt_gauge")}
      aria-valuemin={0} aria-valuemax={3} aria-valuenow={Math.round((side.gauge || 0) * 10) / 10}>
      {segs.map((f, i) => <span key={i} className={`rt-gauge-seg ${f >= 1 ? "is-full" : ""}`}><i style={{ width: `${f * 100}%` }} /></span>)}
      {side.mega && <b className="rt-gauge-tag">MEGA</b>}
    </div>
  );
}

/** Doubles: the two Pokémon on a trainer's side of the field, each with its slot letter, HP and state. */
function DoublesMons({ side, lang, tr, human }) {
  return (
    <div className="rt-duo">
      {side.units.map((u) => {
        const mon = u.vacant ? null : side.mons[u.active];
        const mine = human && u.pos === side.ctl;
        return (
          <div key={u.pos} className={`rt-mon rt-duo-mon ${mine ? "is-ctl" : ""}`} title={mine ? tr("rt_you_control") : human ? tr("rt_partner_ai") : ""}>
            <span className="rt-slot">{u.pos ? "b" : "a"}</span>
            {mon ? (
              <>
                <b className="trunc">{mon.name}</b>
                {mine && <span className="rt-tag rt-tag-ctl">{tr("rt_you_control")}</span>}
                {mon.is_mega && <span className="rt-tag rt-tag-mega">{tr("rt_mega_on")}</span>}
                {mon.status && <span className="rt-status" style={{ background: STATUS_COLORS[mon.status] }}>{L(STATUS_NAMES[mon.status], lang)}</span>}
                {u.follow && <span className="rt-tag">{tr("rt_follow_float")}</span>}
                {u.helped && <span className="rt-tag up">×1,5</span>}
                <HpBar mon={mon} />
                <span className="rt-hp-num num">{mon.fainted ? 0 : mon.hp}/{mon.maxhp}</span>
              </>
            ) : <span className="help">{tr("rt_empty_slot")}</span>}
          </div>
        );
      })}
    </div>
  );
}

function SideBar({ side, align, lang, tr, avatarUrl, gauge, human = false, sprites = null, offline = false }) {
  const mon = side.mons[side.active];
  const boosts = Object.entries(mon?.boosts || {}).filter(([, v]) => v);
  const onField = (m, i) => (side.units ? m.field >= 0 : i === side.active);
  return (
    <div className={`rt-sidebar ${align}`}>
      {avatarUrl ? <img className="rt-avatar" src={avatarUrl} alt="" /> : null}
      <div className="min-w-0 flex-1">
        <div className="rt-name trunc">{side.name}</div>
        <div className="rt-party" aria-label={tr("rt_party")}>
          {side.mons.map((m, i) => <span key={i} className={`rt-ball ${m.fainted ? "is-out" : ""} ${onField(m, i) ? "is-on" : ""}`} title={`${m.name} ${m.hp}/${m.maxhp}`} />)}
          <span className="rt-switches" title={tr("rt_switches_help")}>{"⇄".repeat(side.switches_left)}<span className="rt-switches-off">{"⇄".repeat(Math.max(0, 3 - side.switches_left))}</span></span>
        </div>
        {gauge && <Gauge side={side} tr={tr} />}
        {side.units && <DoublesMons side={side} lang={lang} tr={tr} human={human} />}
        {!side.units && mon && (
          <div className="rt-mon">
            <MonFace mon={mon} sprites={sprites} offline={offline} />
            <b className="trunc">{mon.name}</b> <span className="help">{tr("rt_lv")}{mon.level}</span>
            {mon.is_mega && <span className="rt-tag rt-tag-mega">{tr("rt_mega_on")}</span>}
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

function MoveButton({ m, i, lang, tr, onUse, keyHint, disabled, pos = "", plus = false }) {
  const ready = m.cd <= 0 && !m.blocked;
  const frac = m.total ? Math.min(1, m.cd / m.total) : 0;
  const color = TYPE_COLORS[m.type] || "#888";
  const blocked = m.blocked ? tr(`rt_blocked_${m.blocked}`) : "";
  const title = [nameOf("move", m.name, lang), `${typeName(m.type, lang)} · ${m.category}${m.power ? ` · ${m.power}` : ""}`,
    tr("rt_base_cd", { n: m.cooldown, src: tr(m.za ? "rt_src_za" : "rt_src_derived") }), tr("rt_windup", { n: (m.windup / TPS).toFixed(2) }),
    m.no_effect ? tr("rt_no_effect") : "", blocked].filter(Boolean).join("\n");
  return (
    <button type="button" className={`rt-move ${ready ? "is-ready" : ""} ${pos ? `rt-pos-${pos}` : ""} ${plus ? "is-plus" : ""}`} style={{ "--type": color, "--cd": frac }} disabled={disabled}
      onClick={() => onUse(i)} title={title} aria-label={`${nameOf("move", m.name, lang)}${ready ? "" : `, ${Math.ceil(m.cd)} s`}`}>
      <span className="rt-move-sweep" aria-hidden="true" />
      <span className="rt-move-key">{keyHint}</span>
      <span className="rt-move-name trunc">{nameOf("move", m.name, lang)}</span>
      <span className="rt-move-meta">{typeName(m.type, lang)} · {m.total ? `${m.total.toFixed(1)} s` : ""}{m.pp_left != null ? ` · ${tr("rt_pp", { n: m.pp_left, m: m.pp_max })}` : ""}</span>
      {!ready && m.cd > 0 && <span className="rt-move-cd num">{m.cd.toFixed(1)}</span>}
      {blocked && <span className="rt-move-block">{blocked}</span>}
    </button>
  );
}

// The four moves sit in a diamond like the X A B Y buttons of Legends: Z-A (slot 0 top, 1 right, 2 bottom, 3 left).
const DIAMOND = ["top", "right", "bottom", "left"];

/** The ultimate gauge (rules version 5): it fills with damage dealt and taken and with knockouts; full, the key unleashes it. */
function UltGauge({ side, tr, keyHint, onUlt }) {
  const f = Math.max(0, Math.min(1, side.ult || 0));
  return (
    <div className={`rt-ult ${side.ult_ready ? "is-ready" : ""}`}>
      <div className="rt-ult-bar" role="meter" aria-label={tr("rt_ult")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} title={tr("rt_ult_help")}>
        <i style={{ width: `${f * 100}%` }} />
      </div>
      <button type="button" className="btn btn-sm rt-ult-btn" disabled={!side.ult_ready} onClick={onUlt} title={tr("rt_ult_help")}>
        {tr("rt_ult")} <span className="rt-key">{keyHint}</span>
      </button>
    </div>
  );
}

function Pad({ side, si, lang, tr, partyOpen, cursor, focus, plus, gauge, special, onUse, onRoll, onSwitch, onParty, onPlus, onMega, onUlt, onSwap, onTarget, keys, sprites, foes }) {
  const mon = side.mons[side.active];
  // doubles: a slot waiting for a Pokémon (the switch goes there; the controlled one first)
  const waiting = side.units ? side.units.find((u) => u.pos === side.ctl && u.need) || side.units.find((u) => u.need) : null;
  const need = side.units ? !!waiting : side.need;
  const showParty = partyOpen || need;
  const plusMoves = side.plus_moves !== false;
  const plusOn = gauge && plusMoves && (plus || (side.mega && mon?.is_mega));
  const onField = (m, i) => (side.units ? m.field >= 0 : i === side.active);
  const locked = side.units && foes ? foes.units[side.units[side.ctl]?.aim ?? 0] : null;
  const lockedMon = locked && !locked.vacant ? foes.mons[locked.active] : null;
  return (
    <div className={`rt-pad ${focus ? "is-focus" : ""}`}>
      {need && <div className="rt-need">{waiting ? tr("rt_choose_next_slot", { slot: waiting.pos ? "b" : "a" }) : tr("rt_choose_next")}</div>}
      {side.units && (
        <div className="rt-duo-bar">
          <span className="help">{tr("rt_you_control")}</span> <b>{mon && !mon.fainted ? mon.name : "—"}</b> <span className="rt-slot">{side.ctl ? "b" : "a"}</span>
          {side.partner ? <span className="help">{tr("rt_multi_partner")}</span>
            : <button type="button" className="btn btn-sm" onClick={() => onSwap(si)}>{tr("rt_swap")} <span className="rt-key">{keys.swap}</span></button>}
          <span className="help">{tr("rt_locked_foe")}</span> <b>{lockedMon ? lockedMon.name : "—"}</b>{locked && <span className="rt-slot is-foe">{locked.pos ? "b" : "a"}</span>}
          <button type="button" className="btn btn-sm" onClick={() => onTarget(si)}>{tr("rt_next_target")} <span className="rt-key">{keys.target}</span></button>
        </div>
      )}
      <div className="rt-pad-main">
        <div className="rt-party-strip" role="group" aria-label={tr("rt_party")}>
          {side.mons.map((m, i) => (
            <button key={i} type="button" className={`rt-party-btn ${onField(m, i) ? "is-active" : ""} ${showParty && i === cursor ? "is-cursor" : ""}`}
              disabled={m.fainted || onField(m, i) || (!need && side.switches_left <= 0) || (side.partner && side.owners?.[i] === 1)} onClick={() => onSwitch(si, i)}
              title={`${m.name} ${m.hp}/${m.maxhp}${side.partner && side.owners?.[i] === 1 ? ` · ${tr("rt_partner_ai")}` : ""}`}>
              <img src={sprites.pokemon(m.species, { spriteid: m.sprite_id })} alt="" className={sprites.pixelated ? "pixelated" : ""} onError={(ev) => { ev.currentTarget.style.visibility = "hidden"; }} />
              <span className="rt-key">{keys.slots[i]}</span>
              {side.units && m.field >= 0 && <span className={`rt-slot rt-party-slot ${m.field === side.ctl ? "is-ctl" : ""}`}>{m.field ? "b" : "a"}</span>}
              <HpBar mon={m} />
            </button>
          ))}
          <div className="rt-party-help">
            <span>{tr("rt_switches", { n: side.switches_left })}</span>
            <span className="help">{keys.party}</span>
          </div>
        </div>
        {!side.need && mon && !mon.fainted && !(side.units && side.units[side.ctl]?.vacant) && (
          <div className={`rt-diamond ${plusOn ? "is-plus" : ""}`}>
            {mon.moves.map((m, i) => <MoveButton key={i} m={m} i={i} lang={lang} tr={tr} pos={DIAMOND[i]} keyHint={keys.moves[i]} plus={plusOn} onUse={(j) => onUse(si, j)} />)}
            <div className="rt-diamond-hub" aria-hidden="true">
              {!(side.mega && mon?.is_mega) && <span className="rt-key">{plusOn ? keys.plus : keys.focus}</span>}
              <span className="rt-hub-label">{side.mega && mon?.is_mega ? tr("rt_mega_on") : plusOn ? tr("rt_plus_armed") : focus ? tr("rt_focus_on") : tr("rt_focus")}</span>
            </div>
          </div>
        )}
        <div className="rt-pad-side">
          <button type="button" className="btn btn-sm" onClick={() => onRoll(si)} disabled={side.roll_ready > 0 || need}>
            {tr("rt_roll")} <span className="rt-key">{keys.roll}</span>{side.roll_ready > 0 ? ` ${side.roll_ready.toFixed(1)}` : ""}
          </button>
          <button type="button" className={`btn btn-sm ${showParty ? "btn-primary" : ""}`} onClick={() => onParty(si)} disabled={need}>
            {tr("rt_party_open")}
          </button>
          {gauge && (
            <>
              <Gauge side={side} tr={tr} />
              {plusMoves && (
                <button type="button" className={`btn btn-sm rt-plus-btn ${plusOn ? "is-on" : ""}`} aria-pressed={!!plusOn} title={tr("rt_plus_help")}
                  disabled={need || (side.mega && mon?.is_mega) || !side.plus_ready} onClick={() => onPlus(si)}>
                  {tr("rt_plus")} <span className="rt-key">{keys.plus}</span>
                </button>
              )}
              {side.ult !== undefined && <UltGauge side={side} tr={tr} keyHint={keys.plus} onUlt={() => onUlt(si)} />}
              {special === false && <span className="help">{tr("rt_special_off")}</span>}
              {(side.units ? side.units.some((u) => !u.vacant && side.mons[u.active]?.mega_info) : mon?.mega_info) && !side.mega_used && (
                <button type="button" className={`btn btn-sm rt-mega-btn ${side.can_mega ? "is-ready" : ""}`} title={tr(plusMoves ? "rt_mega_help" : "rt_mega_help_v4")} disabled={!side.can_mega}
                  onClick={() => onMega(si)}>
                  {tr("rt_mega")} <span className="rt-key">{keys.mega}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const KEY_HINTS = {
  solo: { moves: ["I", "L", "K", "J"], roll: "␣", focus: "⇧", plus: "F", mega: "M", party: "Q · E · R", slots: ["1", "2", "3", "4", "5", "6"], swap: "Tab · C", target: "X" },
  p1: { moves: ["1", "2", "3", "4"], roll: "␣", focus: "⇧", plus: "F", mega: "G", party: "Q · E · R", slots: ["1", "2", "3", "4", "5", "6"], swap: "C", target: "X" },
  p2: { moves: ["U", "I", "O", "P"], roll: "↵", focus: "⇧", plus: "K", mega: "L", party: "[ · ] · \\", slots: ["U", "I", "O", "P", "[", "]"], swap: "Ñ", target: "´" },
  pad: { moves: ["X", "A", "B", "Y"], roll: "Y", focus: "ZL", plus: "ZL + +", mega: "R", party: "◀ ▶ ▲", slots: ["", "", "", "", "", ""], swap: "L", target: "R3" },
  simple: { moves: ["A", "B", "X", "Y"], roll: "RB", focus: "", plus: "−", mega: "L", party: "◀ ▶ ▲", slots: ["", "", "", "", "", ""], swap: "L3", target: "R3" },
};

const LAYOUT_KEY = "silver-rt-controls";
function readLayout() {
  try { const v = localStorage.getItem(LAYOUT_KEY); return CONTROL_LAYOUTS.includes(v) ? v : "za"; } catch { return "za"; }
}

function hasPad() {
  try { return typeof navigator !== "undefined" && !!navigator.getGamepads && [...navigator.getGamepads()].some(Boolean); } catch { return false; }
}

/**
 * battle: the app's battle (battle_get) with `rt` {spec, inputs, tick, human}. onFinish(inputs, tick, forfeitSide) -> Promise of
 * the stored battle. seats: {p1, p2} with avatarUrl. base: prefix of the app's routes ("" in the app).
 * offline: the friends' playable page, with no app behind it: no walking sprites, cries or music are asked for. onContinue /
 * continueLabel: a button on the end card that takes the page on (the next battle, the result code).
 * video: the replay recorded as a clip (Video.jsx): {playing, speed, onProgress(fraction), onDone()}; it waits paused until
 * `playing`, then plays at `speed` and reports how far it is and when it has ended.
 */
/** Training: what you have done to the dummy so far (damage per second overall and over the last 5 s, per move, K.O.s). */
export function trainingStats(b) {
  const now = b.t;
  const names = new Map();
  const moves = new Map();
  let total = 0, recent = 0, hits = 0, crits = 0, resets = 0;
  for (const e of b.events) {
    if (e.k === "use" && e.s === 0) {
      names.set(e.move, e.name);
      const m = moves.get(e.move) || { dmg: 0, hits: 0, uses: 0 };
      m.uses += 1;
      moves.set(e.move, m);
    } else if (e.k === "hit" && e.s === 1 && e.from === 0) {
      total += e.dmg;
      hits += 1;
      if (e.crit) crits += 1;
      if (now - e.t <= 5 * TPS) recent += e.dmg;
      const m = moves.get(e.move) || { dmg: 0, hits: 0, uses: 0 };
      m.dmg += e.dmg;
      m.hits += 1;
      moves.set(e.move, m);
    } else if (e.k === "dummy_reset" && e.s === 1) resets += 1;
  }
  const dummy = b.sides[1]?.mons?.[b.sides[1].active];
  const secs = Math.max(1, now / TPS);
  return { total, dps: total / secs, recent: recent / Math.min(5, secs), hits, crits, resets, maxhp: dummy?.maxhp || 1, seconds: now / TPS,
    moves: [...moves.entries()].map(([id, m]) => ({ id, name: names.get(id) || id, ...m })).sort((a, b2) => b2.dmg - a.dmg) };
}

function TrainingPanel({ stats, tr, lang }) {
  const pct = (x) => `${Math.round((x / stats.maxhp) * 100)}%`;
  return (
    <div className="rt-training" aria-live="off">
      <div className="rt-training-head"><b>{tr("rt_training")}</b> <span className="help">{tr("rt_training_kos", { n: stats.resets })}</span></div>
      <div className="rt-training-nums">
        <div><span className="help">{tr("rt_dps")}</span><b className="num">{stats.dps.toFixed(1)}</b><span className="help">{pct(stats.dps)}/s</span></div>
        <div><span className="help">{tr("rt_dps_recent")}</span><b className="num">{stats.recent.toFixed(1)}</b><span className="help">{pct(stats.recent)}/s</span></div>
        <div><span className="help">{tr("rt_damage_total")}</span><b className="num">{stats.total}</b><span className="help">{tr("rt_hits_n", { n: stats.hits, c: stats.crits })}</span></div>
      </div>
      {stats.moves.length > 0 && (
        <table className="rt-training-moves">
          <tbody>
            {stats.moves.map((m) => (
              <tr key={m.id}><td className="trunc">{nameOf("move", m.name, lang)}</td><td className="num">{m.dmg}</td><td className="num help">{m.hits}/{m.uses}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function RtScreen({ battle, lang = "es", sprites, seats, onFinish, onSave, onAgain, base = "", offline = false, onContinue = null, continueLabel = "", video = null, musicSource = "showdown", net = null, endActions = null }) {
  const tr = useMemo(() => rtT(lang), [lang]);
  const spec = battle.rt.spec;
  // net (a live battle with a friend on another computer): {url, seat, peerName}; this screen plays only its own seat, the other
  // arrives through the room (netplay.js)
  const humans = net ? [net.seat === 0, net.seat === 1] : battle.rt.human || [false, false];
  const watching = !!net && net.seat === 2;   // a spectator: both players' inputs come through the room
  const live = battle.status === "live";
  const people = humans.filter(Boolean).length;
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const sim = useRef(null);
  // the trainers' names as the screen shows them (the seats', in the reader's language) instead of the ones saved in the spec
  const seatsRef = useRef(seats);
  seatsRef.current = seats;
  const nameSides = (b) => { for (const s of b?.sides || []) { const n = seatsRef.current?.[s.id]?.name; if (n) s.name = n; } };
  useEffect(() => nameSides(sim.current?.b), [seats?.p1?.name, seats?.p2?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const [phase, setPhase] = useState("loading");
  const [progress, setProgress] = useState([0, 0]);
  const [credits, setCredits] = useState([]);
  const [importedCredits, setImportedCredits] = useState([]);
  const [hud, setHud] = useState(null);
  const [abilities, setAbilities] = useState([]);
  const [abilityEpoch, setAbilityEpoch] = useState(0);
  const [log, setLog] = useState([]);
  const [training, setTraining] = useState(null);
  const [party, setParty] = useState([false, false]);
  const [cursor, setCursor] = useState([0, 0]);
  const [focus, setFocus] = useState([false, false]);
  const [plus, setPlus] = useState([false, false]);
  const [layout, setLayoutState] = useState(readLayout);
  const [pad, setPad] = useState(hasPad);
  const setLayout = (v) => {
    setLayoutState(v);
    try { localStorage.setItem(LAYOUT_KEY, v); } catch { /* private window: the choice lasts this battle */ }
    sim.current?.inputs.forEach((inp) => { if (inp) inp.layout = v; });
  };
  const [speed, setSpeed] = useState(video?.speed || 1);
  const videoRef = useRef(video);
  videoRef.current = video;
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [sure, setSure] = useState(-1);
  const [netState, setNetState] = useState({ peer: false, status: "connecting", stalled: false, desync: 0, menu: false });
  const logRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const schemes = people === 2 ? ["p1", "p2"] : ["solo", "solo"];

  const texts = useMemo(() => ({
    lang,
    move: (n) => (n === "Ultimate" ? tr("rt_ult") : nameOf("move", n, lang)), ultimate: tr("rt_ult_cut"), crit: tr("rt_crit"), super: tr("rt_super"), weak: tr("rt_weak"), dodged: tr("rt_dodged"),
    blocked: tr("rt_blocked"), immune: tr("rt_immune"), flinch: tr("rt_flinch"), status: (s) => L(STATUS_NAMES[s] || [s, s], lang),
    statusColor: (s) => STATUS_COLORS[s] || "#fff", stat: (k) => L(STAT_SHORT[k] || [k, k], lang),
    show: { go: (v) => tr("rt_show_go", v), back: (v) => tr("rt_show_back", v), fainted: (v) => tr("rt_show_fainted", v), last: (v) => tr("rt_show_last", v),
      combo: (v) => tr("rt_show_combo", v), clash: tr("rt_show_clash"), ko: tr("rt_show_ko"), time: tr("rt_show_time"), fight: tr("rt_show_fight"),
      whoWins: tr("rt_show_who"), wins: (v) => tr("rt_show_wins", v), tie: tr("rt_show_tie") },
    mega: tr("rt_mega_float"), dummyReset: tr("rt_dummy_reset"), phase: tr("rt_phase"), megaEnd: tr("rt_mega_end_float"), plus: tr("rt_plus"), helping: tr("rt_helping_float"), follow: tr("rt_follow_float"),
  }), [lang, tr]);

  // build the battle, catch up a live one, load the sprites
  const build = useCallback((untilTick = 0) => {
    const b = new RtBattle(spec);
    nameSides(b);
    const recorded = battle.rt.inputs || [];
    const state = { b, inputs: makeInputs(humans, readLayout()), held: new Set(), acc: 0, last: 0, logIndex: 0, saveAt: 0, savedLen: 0, replay: null, plusScan: 0 };
    for (const inp of state.inputs) if (inp) inp.ultMode = b.version >= 5; // disabled specials ignore this input; never arm a legacy Plus move
    if (live && net) {
      state.net = new NetLink({ url: net.url, seat: net.seat, delay: net.delay || 4, on: (k, v) => netEvent.current(k, v) });
      state.hashAt = 0;
    } else if (live) {
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
    state.inputs.forEach((inp, i) => {
      if (!inp) return;
      // rules version 4 has no Plus moves: F / ZL + + / − do nothing
      if (!b.plusMoves) inp.setPlus = () => {};
      if (b.doubles) {
        // doubles: pick up the controlled slot and the locked foe where a reloaded battle left them
        inp.doubles = true;
        const tr0 = b.sides[i];
        inp.ctl = tr0.ctl || 0;
        inp.tgt = tr0.tgt || 0;
        inp.effCtl = b.leadOf(tr0).pos;
      }
      inp.onParty = (open, at) => {
        setParty((p) => { const n = [...p]; n[i] = open; return n; });
        setCursor((c) => { const n = [...c]; n[i] = at ?? 0; return n; });
      };
      inp.onPause = net ? () => setNetState((n) => ({ ...n, menu: !n.menu })) : () => setPhase((ph) => (ph === "running" ? "paused" : ph === "paused" ? "running" : ph));
      inp.onPlus = (armed) => setPlus((p) => { const n = [...p]; n[i] = armed; return n; });
    });
    state.plusScan = b.events.length;
    state.abilityIndex = b.t ? b.events.length : 0;
    state.abilitySeen = new Set();
    state.abilitySlots = new Map();
    return state;
  }, [spec, battle.rt, live]); // eslint-disable-line react-hooks/exhaustive-deps

  // what the room says (the other person came or went, gave up, a mismatch): read through a ref so the link keeps one handler
  const netEvent = useRef(() => {});
  netEvent.current = (k, v) => {
    if (k === "peer") setNetState((n) => ({ ...n, peer: v }));
    else if (k === "status") setNetState((n) => ({ ...n, status: v }));
    else if (k === "desync") setNetState((n) => ({ ...n, desync: v }));
    else if (k === "ff" && sim.current && !sim.current.b.ended) finishRef.current?.(v);
  };
  const finishRef = useRef(null);
  useEffect(() => () => sim.current?.net?.close(), []);

  // Pokémon Champions formats come from mods the engine registers (champions.mjs); the screen loads them only for those battles
  const champions = /^gen\d+champions/.test(String(spec.format || ""));
  const [modsReady, setModsReady] = useState(!champions);
  useEffect(() => {
    if (!champions) return;
    import("../../../../engine/src/champions.mjs").then(() => setModsReady(true)).catch((e) => setError(e));
  }, [champions]);

  useEffect(() => {
    if (!modsReady) return undefined;
    let cancelled = false;
    let state;
    try {
      state = build();
    } catch (e) {
      setError(e);
      videoRef.current?.onError?.(e);
      return undefined;
    }
    sim.current = state;
    setAbilities([]); setAbilityEpoch(old=>old+1);
    state.net?.connect();
    // for checks from the browser console (and the app's QA): the running battle and the classes that rebuild it
    window.__silverRt = { RtBattle, fastForward, inputFrame, get battle() { return sim.current?.b; } };
    const view = state.b.view();
    const renderer = new ArenaRenderer(canvasRef.current, {
      sides: view.sides.map((s, i) => ({ name: s.name, mons: s.mons, avatarUrl: seats?.[s.id]?.avatarUrl || "", dialogue: seats?.[s.id]?.dialogue || {} })), sprites, base, texts, rocks: view.rocks, offline,
      humans: live ? humans : [false, false],
    });
    renderer.eventIndex = state.b.events.length;
    renderer.audio.cryUrl = offline ? null : (species) => appCryUrl(species, base);
    state.renderer = renderer;
    state.logIndex = 0;
    setHud(view);
    setLog(state.b.events.map((e) => logLine(e, state.b, lang, tr)).filter(Boolean).slice(-200));
    state.logIndex = state.b.events.length;
    renderer.preload((n, total) => !cancelled && setProgress([n, total])).then(() => {
      if (cancelled) return;
      setCredits([...renderer.credits].slice(0, 12));
      setImportedCredits([...renderer.importedCredits.values()]);
      if (videoRef.current && state.b.t === 0 && !state.b.ended && !state.b.training) {
        state.introChecked = true;
        renderer.show.startIntro(state.b, {prepared: true});
        renderer.draw(state.b, 0, 0);
      }
      setPhase(live ? (state.b.ended ? "ended" : "ready") : videoRef.current && !videoRef.current.playing ? "replay-paused" : "playing");
      videoRef.current?.onReady?.();
    }).catch((e) => { if (!cancelled) { setError(e); videoRef.current?.onError?.(e); } });
    return () => { cancelled = true; };
  }, [battle.id, modsReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (forfeitSide && st.net && !watching && forfeitSide === (net.seat === 0 ? "p1" : "p2")) st.net.send({ k: "ff" });
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
  }, [live, onFinish]); // eslint-disable-line react-hooks/exhaustive-deps
  finishRef.current = finish;

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
      // the show's intro (VS screen, Poké Balls, "Fight!") plays once when a battle starts from its first tick; the battle waits for it
      if (running && !st.introChecked) {
        st.introChecked = true;
        if (st.b.t === 0 && !st.b.ended && !st.net && !st.b.training) st.renderer.show.startIntro(st.b);
      }
      const intro = running && st.renderer.show.holding;
      // hit-stop: after a big blow the battle holds still for a moment (the screen only, the battle's clock and replays are untouched)
      const held = running && st.renderer.hitstop > 0;
      if (held) st.renderer.hitstop = Math.max(0, st.renderer.hitstop - dt * (live ? 1 : speed));
      if (running && !st.b.ended && !held && !intro) {
        st.acc += dt * (live ? 1 : speed);
        let n = 0;
        while (st.acc >= 1 / TPS && n++ < 12 && !st.b.ended) {
          st.acc -= 1 / TPS;
          if (live && st.net) {
            // lockstep: read this person's input `delay` ticks ahead, run the next tick once the other person's input for it is in
            const nl = st.net;
            const me = net.seat;
            while (!watching && nl.local.length < st.b.t + 1 + nl.delay) {
              const q = st.inputs[me].take(st.held, st.b.sides[me].mons.length);
              nl.push(packFrame(q));
              const f = st.inputs.map((x) => !!x?.focus);
              if (st.renderer) st.renderer.focus = f;
              if (f[me] !== st.lastFocus?.[me]) { st.lastFocus = f; setFocus(f); }
            }
            if (!nl.ready(st.b.t + 1)) {
              st.acc = Math.min(st.acc, 2 / TPS);
              if (!st.stalledSince) st.stalledSince = now;
              break;
            }
            if (st.stalledSince) { st.stalledSince = 0; if (st.stallShown) { st.stallShown = false; setNetState((x) => ({ ...x, stalled: false })); } }
            const [f1, f2] = nl.frame(st.b.t + 1);
            st.b.step({ [st.b.sides[0].id]: unpackFrame(f1), [st.b.sides[1].id]: unpackFrame(f2) });
            for (; st.plusScan < st.b.events.length; st.plusScan++) {
              const e = st.b.events[st.plusScan];
              if ((e.k === "plus" || e.k === "mega") && st.inputs[e.s]?.plusArmed) st.inputs[e.s].setPlus(false);
            }
            if (st.b.doubles && st.inputs[me]) st.inputs[me].effCtl = st.b.leadOf(st.b.sides[me]).pos;
            if (!watching && st.b.t - st.hashAt >= 60) { st.hashAt = st.b.t; nl.send({ k: "hash", t: st.b.t, h: battleHash(st.b) }); }
            // a screen that reloaded runs the ticks it missed without waiting for the clock
            if (nl.ready(st.b.t + 1 + 2 * nl.delay)) st.acc += 1 / TPS;
          } else if (live) {
            const input = {};
            st.b.sides.forEach((side, i) => { if (st.inputs[i]) input[side.id] = st.inputs[i].take(st.held, side.mons.length); });
            const f = st.inputs.map((x) => !!x?.focus);
            if (st.renderer) st.renderer.focus = f;
            if (f[0] !== st.lastFocus?.[0] || f[1] !== st.lastFocus?.[1]) { st.lastFocus = f; setFocus(f); }
            st.b.step(input);
            // an armed Plus lasts until the battle uses it (or there is no full segment for it)
            for (; st.plusScan < st.b.events.length; st.plusScan++) {
              const e = st.b.events[st.plusScan];
              if ((e.k === "plus" || e.k === "mega") && st.inputs[e.s]?.plusArmed) st.inputs[e.s].setPlus(false);
            }
            st.inputs.forEach((inp, i) => { if (inp?.plusArmed && !st.b.plusReady(st.b.sides[i])) inp.setPlus(false); });
            if (st.b.doubles) st.inputs.forEach((inp, i) => { if (inp) inp.effCtl = st.b.leadOf(st.b.sides[i]).pos; });
          } else {
            st.b.step(inputFrame(st.b, st.replay.byTick.get(st.b.t + 1) || [], st.replay.held));
          }
        }
        if (st.stalledSince && !st.stallShown && now - st.stalledSince > 600) { st.stallShown = true; setNetState((x) => ({ ...x, stalled: true })); }
        if (live && st.b.t - st.saveAt >= SAVE_EVERY_TICKS && st.b.inputLog.length !== st.savedLen) {
          st.saveAt = st.b.t;
          st.savedLen = st.b.inputLog.length;
          onSave?.(st.b.inputLog.slice(), st.b.t);
        }
      }
      // the end: the show's K.O. and the winner's banner play before the result (none with the show off, or after a forfeit)
      if (running && st.b.ended && !st.finishing && !st.endShown) {
        if (st.endAt == null) st.endAt = now + 1000 * (st.b.view().reason === "forfeit" ? 0 : st.renderer.show.ending(st.b));
        if (now >= st.endAt) {
          st.endShown = true;
          if (live) finish();
          else setPhase("done");
        }
      }
      st.renderer.draw(st.b, running ? (held ? dt * 0.1 : dt) : 0, running ? dt : 0);
      if (now - lastHud > HUD_MS) {
        lastHud = now;
        setHud(st.b.view());
        if (running && st.abilityIndex < st.b.events.length) {
          const fresh = [];
          for (;st.abilityIndex < st.b.events.length;st.abilityIndex++) {
            const e = st.b.events[st.abilityIndex], unit=`${e.s}:${e.u || 0}`;
            if (e.k === "switch") st.abilitySlots.set(unit,e.slot);
            const a = realtimeAbility(e,st.b,st.abilitySlots.get(unit));
            if (!a) continue;
            const key=`${a.tick}:${a.side}:${a.slot}:${a.pokemon}:${a.ability}`;
            if (!st.abilitySeen.has(key)) fresh.push({...a,id:st.abilityIndex});
            st.abilitySeen.add(key);
          }
          if (fresh.length) setAbilities(old=>[...old,...fresh]);
        }
        if (st.b.training) setTraining(trainingStats(st.b));
        if (videoRef.current?.onProgress) videoRef.current.onProgress(st.b.t / Math.max(1, battle.rt.tick || (battle.summary?.seconds || 0) * TPS || st.b.t));
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
        if (st.net) { if (!watching) setNetState((n) => ({ ...n, menu: !n.menu })); e.preventDefault(); return; }
        if (phaseRef.current === "running") setPhase("paused");
        else if (phaseRef.current === "paused") setPhase("running");
        e.preventDefault();
        return;
      }
      if (phaseRef.current !== "running") return;
      st.held.add(e.code);
      let used = false;
      st.inputs.forEach((inp, i) => { if (inp && !e.repeat) used = inp.key(e.code, true, undefined, st.b.sides[i]?.mons.length || 6) || used; });
      if (used || ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Backspace"].includes(e.code)) e.preventDefault();
    };
    const up = (e) => sim.current?.held.delete(e.code);
    const blur = () => { sim.current?.held.clear(); if (phaseRef.current === "running" && !sim.current?.net) setPhase("paused"); };
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

  // a gamepad plugged in later changes the hints (and the seat picks it up on its next read)
  useEffect(() => {
    const on = (e) => {
      setPad(hasPad());
      const st = sim.current;
      if (e.type === "gamepadconnected" && st) st.inputs.forEach((inp) => { if (inp && inp.pad < 0 && inp.scheme === "solo") inp.pad = e.gamepad.index; });
    };
    window.addEventListener("gamepadconnected", on);
    window.addEventListener("gamepaddisconnected", on);
    return () => { window.removeEventListener("gamepadconnected", on); window.removeEventListener("gamepaddisconnected", on); };
  }, []);

  const queue = (si, patch) => {
    const inp = sim.current?.inputs[si];
    if (inp && phaseRef.current === "running") Object.assign(inp.queue, patch);
  };
  const onUse = (si, i) => queue(si, { use: i });
  const onRoll = (si) => queue(si, { dodge: true });
  const onPlus = (si) => { const inp = sim.current?.inputs[si]; if (inp && phaseRef.current === "running") inp.setPlus(!inp.plusArmed); };
  const onMega = (si) => queue(si, { mega: true });
  const onUlt = (si) => queue(si, { use: ULT_SLOT });
  const onSwitch = (si, i) => { queue(si, { sw: i }); const inp = sim.current?.inputs[si]; if (inp) { inp.partyOpen = false; setParty((p) => { const n = [...p]; n[si] = false; return n; }); } };
  const onSwap = (si) => { const inp = sim.current?.inputs[si]; if (inp && phaseRef.current === "running") inp.swap(); };
  const onTarget = (si) => { const inp = sim.current?.inputs[si]; if (inp && phaseRef.current === "running") inp.cycleTarget(); };
  const onParty = (si) => { const inp = sim.current?.inputs[si]; if (inp) { inp.partyOpen = !inp.partyOpen; setParty((p) => { const n = [...p]; n[si] = inp.partyOpen; return n; }); } };

  const restart = () => {
    const st = build(0);
    st.renderer = sim.current.renderer;
    st.renderer.resetReplay(st.b);
    sim.current = st;
    setAbilities([]); setAbilityEpoch(old=>old+1);
    setLog([]);
    setHud(st.b.view());
    setResult(null);
    setPhase("playing");
  };

  // sound: replays at 4x skip the small effects; the music plays while the fight is on and gives way to a cue at the end
  useEffect(() => { if (sim.current?.renderer) sim.current.renderer.audio.speed = live ? 1 : speed; }, [speed, live, phase]);
  const musicUrl = `${base}/api/music/${pickTrack(battle.id, musicSource === "pokerogue" ? genOfFormat(battle.format) : 0, { source: musicSource, role: battleRole(battle), type: battleType(battle) })}`;
  useEffect(() => {
    if (!offline && ["running", "playing", "paused", "replay-paused"].includes(phase)) music.play(musicUrl);
  }, [phase, musicUrl, offline]);
  useEffect(() => () => music.stop({ fade: 0.8 }), []);
  // recording a clip: start when the recorder is ready, say when the replay is over
  useEffect(() => { if (video?.playing) setPhase((p) => (p === "replay-paused" ? "playing" : p)); }, [video?.playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (phase === "done") videoRef.current?.onDone?.(); }, [phase]);
  useEffect(() => {
    if (phase !== "ended" && phase !== "done") return;
    const w = sim.current?.b?.view().winner;
    const mine = humans.findIndex(Boolean);
    battleEnd(w === 0 || w === 1 ? (people === 1 ? w === mine : true) : null);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <SideBar side={view.sides[0]} align="left" lang={lang} tr={tr} avatarUrl={seats?.p1?.avatarUrl} gauge={view.version >= 2} human={live && humans[0]} sprites={sprites} offline={offline} />
            <div className="rt-clock">
              <div className="rt-time num" aria-label={tr("rt_time")}>{fmtTime(view.time_limit - view.seconds)}</div>
              {view.doubles && <span className="chip">{tr("rt_doubles")}</span>}
              {view.weather && <span className="chip">{nameOf("move", { sunnyday: "Sunny Day", raindance: "Rain Dance", sandstorm: "Sandstorm", snow: "Snowscape", hail: "Hail" }[view.weather.id] || view.weather.id, lang)} {Math.ceil(view.weather.left)} s</span>}
              {view.trick_room > 0 && <span className="chip">{tr("rt_trick_room", { n: Math.ceil(view.trick_room) })}</span>}
              {view.fog && <span className="chip">{tr("rt_fog")}</span>}
              {view.terrain && <span className="chip">{nameOf("move", { electricterrain: "Electric Terrain", grassyterrain: "Grassy Terrain", psychicterrain: "Psychic Terrain", mistyterrain: "Misty Terrain" }[view.terrain.id] || view.terrain.id, lang)} {Math.ceil(view.terrain.left)} s</span>}
            </div>
            <SideBar side={view.sides[1]} align="right" lang={lang} tr={tr} avatarUrl={seats?.p2?.avatarUrl} gauge={view.version >= 2} human={live && humans[1]} sprites={sprites} offline={offline} />
          </div>
        )}
        <div className="rt-stage" ref={wrapRef}>
          <AbilityBanner notices={abilities} lang={lang} resetKey={abilityEpoch}/>
          <canvas ref={canvasRef} className="rt-canvas" />
          <SoundButton lang={lang} />
          {phase === "loading" && (
            <div className="rt-overlay"><div className="rt-card"><b>{tr("rt_loading")}</b><div className="help">{tr("rt_loading_sprites", { n: progress[0], total: progress[1] || "…" })}</div></div></div>
          )}
          {phase === "ready" && (
            <div className="rt-overlay">
              <div className="rt-card">
                <b className="rt-big">{tr("rt_ready")}</b>
                <dl className="rt-controls">
                  {view?.doubles && <dd className="rt-doubles-note">{tr("rt_doubles_note")}</dd>}
                  {people === 2 ? (<><dd>{tr(view?.plus_moves === false ? "rt_keys_p1_v4" : "rt_keys_p1")}</dd><dd>{tr(view?.plus_moves === false ? "rt_keys_p2_v4" : "rt_keys_p2")}</dd>{view?.doubles && <dd>{tr("rt_keys_doubles_two")}</dd>}</>) : (
                    <>
                      <dt>{tr("rt_ctrl_move")}</dt><dd>{tr("rt_keys_move")}</dd>
                      <dt>{tr("rt_ctrl_focus")}</dt><dd>{tr(layout === "simple" ? "rt_keys_focus_simple" : "rt_keys_focus")}</dd>
                      <dt>{tr("rt_ctrl_moves")}</dt><dd>{tr(layout === "simple" ? "rt_keys_moves_simple" : "rt_keys_moves")}</dd>
                      <dt>{tr("rt_ctrl_roll")}</dt><dd>{tr(layout === "simple" ? "rt_keys_roll_simple" : "rt_keys_roll")}</dd>
                      <dt>{tr("rt_ctrl_switch")}</dt><dd>{tr("rt_keys_switch")}</dd>
                      {view?.doubles && (
                        <>
                          <dt>{tr("rt_ctrl_swap")}</dt><dd>{tr("rt_keys_swap")}</dd>
                          <dt>{tr("rt_ctrl_target")}</dt><dd>{tr("rt_keys_target")}</dd>
                        </>
                      )}
                      {view?.version >= 2 && (
                        <>
                          {view.plus_moves !== false && <><dt>{tr("rt_ctrl_plus")}</dt><dd>{tr(layout === "simple" ? "rt_keys_plus_simple" : "rt_keys_plus")}</dd></>}
                          <dt>{tr("rt_ctrl_mega")}</dt><dd>{tr(layout === "simple" ? "rt_keys_mega_simple" : "rt_keys_mega")}</dd>
                        </>
                      )}
                      <dt>{tr("rt_ctrl_pause")}</dt><dd>{tr(layout === "simple" ? "rt_keys_pause_simple" : "rt_keys_pause")}</dd>
                    </>
                  )}
                </dl>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="help">{tr("rt_controls_layout")}{pad ? "" : ` (${tr("rt_no_pad")})`}</span>
                  <div className="seg" role="group" aria-label={tr("rt_controls_layout")}>
                    {CONTROL_LAYOUTS.map((v) => <button key={v} type="button" aria-pressed={layout === v} onClick={() => setLayout(v)}>{tr(`rt_layout_${v}`)}</button>)}
                  </div>
                </div>
                {net && !watching && !netState.peer ? <div className="help rt-net-wait">{tr("rt_net_waiting", { name: net.peerName || "…" })}</div>
                  : <button type="button" className="btn btn-primary" autoFocus onClick={() => setPhase("running")}>{tr(watching ? "rt_watch_start" : "rt_start")}</button>}
                {net && <div className="help">{tr(watching ? "rt_watch_note" : "rt_net_note")}</div>}
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
          {net && live && phase === "running" && (netState.stalled || !netState.peer || netState.status !== "open") && (
            <div className="rt-net-banner">{netState.status !== "open" ? tr("rt_net_reconnecting") : watching ? tr("rt_watch_wait") : tr("rt_net_waiting", { name: net.peerName || "…" })}</div>
          )}
          {net && netState.desync > 0 && <div className="rt-net-banner is-bad">{tr("rt_net_desync")}</div>}
          {net && !watching && live && phase === "running" && netState.menu && (
            <div className="rt-net-menu">
              <button type="button" className="btn btn-sm" onClick={() => { setSure(-1); setNetState((n) => ({ ...n, menu: false })); }}>{tr("rt_resume")}</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => (sure === net.seat ? finish(net.seat === 0 ? "p1" : "p2") : setSure(net.seat))}>
                {sure === net.seat ? tr("rt_forfeit_sure") : tr("rt_forfeit")}
              </button>
            </div>
          )}
          {ended && view && (
            <div className="rt-overlay is-end">
              <div className="rt-card">
                <b className="rt-big">
                  {winnerIdx === 0 || winnerIdx === 1 ? (people === 1 && (live || offline || net) ? (winnerIdx === mySide ? tr("rt_win") : tr("rt_lose")) : tr("rt_winner", { name: view.sides[winnerIdx].name })) : tr("rt_tie")}
                </b>
                <div className="help">{tr(`rt_reason_${view.reason || "ko"}`)} · {fmtTime(view.seconds)}</div>
                {view.sides.map((s, i) => (seats?.[s.id]?.dialogue?.after
                  ? <p key={i} className="help" style={{ fontStyle: "italic", margin: 0 }}>“{seats[s.id].dialogue.after}” — {s.name}</p> : null))}
                {error && <div className="banner banner-danger">{String(error.message || error)}</div>}
                <div className="rt-score">
                  {view.sides.map((s, i) => (
                    <div key={i}><b className="trunc">{s.name}</b><span className="num">{s.mons.filter((m) => !m.fainted).length}/{s.mons.length}</span></div>
                  ))}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn" onClick={restart}>{tr("rt_replay")}</button>
                  {endActions}
                  {onAgain && <button type="button" className="btn btn-primary" onClick={onAgain}>{tr("rt_again")}</button>}
                  {onContinue ? <button type="button" className="btn btn-primary" autoFocus disabled={live && stored == null && !error} onClick={() => onContinue(stored)}>{continueLabel || tr("rt_close")}</button>
                    : stored == null && live ? null : <button type="button" className="btn" onClick={() => setPhase("closed")}>{tr("rt_close")}</button>}
                </div>
              </div>
            </div>
          )}
        </div>
        {!live && view && (
          <div className="b-replay">
            <button type="button" className="btn btn-sm" onClick={restart} title={tr("rt_restart")} aria-label={tr("rt_restart")}>⏮</button>
            <button type="button" className="btn btn-sm" onClick={() => setPhase((p) => (p === "playing" ? "replay-paused" : "playing"))}
              aria-label={phase === "playing" ? tr("rt_ctrl_pause") : tr("rt_ctrl_play")}>{phase === "playing" ? "⏸" : "▶"}</button>
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
              <Pad key={i} side={s} si={i} lang={lang} tr={tr} partyOpen={party[i]} cursor={cursor[i]} focus={focus[i]} plus={plus[i]} gauge={view.version >= 2} special={view.silver_special}
                onUse={onUse} onRoll={onRoll} onSwitch={onSwitch} onParty={onParty} onPlus={onPlus} onMega={onMega} onUlt={onUlt} onSwap={onSwap} onTarget={onTarget} foes={view.sides[1 - i]} keys={KEY_HINTS[people === 1 && pad ? (layout === "simple" ? "simple" : "pad") : schemes[i]]} sprites={sprites} />
            ))}
          </div>
        )}
        {training && <TrainingPanel stats={training} tr={tr} lang={lang} />}
        {!offline && <div className="help rt-credit">{tr("rt_sprites_note")}{credits.length ? `: ${credits.join(", ")}` : ""}</div>}
        {importedCredits.length > 0 && <div className="help rt-credit">{importedCredits.map((entry, i) => <React.Fragment key={entry.source}>
          {i > 0 ? " · " : ""}<a href={entry.source} target="_blank" rel="noopener noreferrer">{entry.credit.join(", ")}</a>
        </React.Fragment>)}</div>}
      </div>
      <div className="b-log rt-log" aria-live="off" ref={logRef}>
        {log.slice(-120).map((l, i) => (
          <div key={i} className={`b-log-line k-${l.k}`}><span className="rt-sec num">{l.sec}</span> {l.text}</div>
        ))}
      </div>
    </div>
  );
}
