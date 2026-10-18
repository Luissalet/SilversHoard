// Real-time battle log lines. Names must follow the active Pokémon *at the event*,
// not the seats' current active after a seek or fast-forward (see eventLines in sim.mjs).
import { L, STATUS_NAMES, STAT_SHORT, nameOf, typeName } from "../dex.js";

const TPS = 30;

const SOURCES = {
  sandstorm: ["tormenta de arena", "sandstorm"], hail: ["granizo", "hail"], recoil: ["retroceso", "recoil"], trap: ["atrapado", "trapped"],
  brn: ["quemadura", "burn"], psn: ["veneno", "poison"], tox: ["veneno grave", "bad poison"], curse: ["maldición", "curse"],
};

/** What hurt a Pokémon, in words: a weather, a status, or the move, ability or item of that id. */
export function sourceName(id, b, lang) {
  if (SOURCES[id]) return L(SOURCES[id], lang);
  for (const [kind, table] of [["move", b.dex.moves], ["item", b.dex.items], ["ability", b.dex.abilities]]) {
    const e = table.get(id);
    if (e?.exists) return nameOf(kind, e.name, lang);
  }
  return id;
}

/** Per-side, per-unit team slots that were on the field as events are walked in order. */
export function freshActives() {
  return [[0, 1], [0, 1]];
}

/** Update tracked actives from a switch or drag-out (same rule as engine eventLines). */
export function trackActive(active, e) {
  if (e?.s == null) return;
  const u = e.u || 0;
  if (e.k === "switch" && e.slot != null) active[e.s][u] = e.slot;
  else if (e.k === "dragged" && e.to != null) active[e.s][u] = e.to;
}

/**
 * One line of the log for an event, in Spanish or English.
 * `active` is the historical [[p1u0,p1u1],[p2u0,p2u1]] map walked so far; when omitted,
 * falls back to the battle's current active (live play only).
 */
export function logLine(e, b, lang, tr, active) {
  const side = (i) => b.sides[i];
  const liveOf = (i, u) => (b.doubles ? side(i)?.units[u || 0]?.active : side(i)?.active);
  const histOf = (i, u = 0) => (active ? active[i]?.[u || 0] : liveOf(i, u));
  const monName = (i, slot, u = e.u) => {
    if (e.s === i && e.pokemon && (slot == null || slot === (e.slot ?? histOf(i, u)))) return e.pokemon;
    return side(i)?.mons[slot ?? histOf(i, u)]?.name || "?";
  };
  const who = (i, u = e.u) => (lang === "en" ? `${side(i).name}'s ${monName(i, undefined, u)}` : `${monName(i, undefined, u)} de ${side(i).name}`);
  const dodger = () => {
    if (b.doubles) {
      const t = b.foe(side(e.s).units[e.u || 0]);
      return t ? who(t.index, t.pos) : who(1 - e.s, 0);
    }
    return who(1 - e.s, 0);
  };
  const mv = (name) => (name === "Ultimate" ? tr("rt_ult") : nameOf("move", name, lang));
  const sec = (e.t / TPS).toFixed(1);
  const es = lang !== "en";
  switch (e.k) {
    case "ability": return {sec, k:"ability", text:`${e.pokemon || monName(e.s)}: ${nameOf("ability",b.dex.abilities.get(e.id).name,lang)}`};
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

/** Walk events in order and format the log, tracking who was active (seek-safe). */
export function buildBattleLog(events, b, lang, tr, active = freshActives()) {
  const lines = [];
  for (const e of events) {
    const line = logLine(e, b, lang, tr, active);
    trackActive(active, e);
    if (line) lines.push(line);
  }
  return lines;
}
