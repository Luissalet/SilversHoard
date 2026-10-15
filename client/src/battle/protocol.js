// Reads the Showdown battle protocol line by line: keeps what the screen draws (both teams, HP, status, boosts, field) and turns
// each line into a sentence for the log (Spanish or English) plus an animation hint. Pure JavaScript, shared by the app and the
// playable page.
import { L, STAT_NAMES, STATUS_NAMES, nameOf, typeName, toID } from "./dex.js";
import { officialText } from "./text/logtext.js";
import {protocolAbility} from "../../../engine/src/ability-events.mjs";

// Free-form lines the simulator writes in English.
const MESSAGES_ES = [
  [/^(.+) forfeited\.$/, "$1 se ha rendido."],
  [/^(.+) lost due to inactivity\.$/, "$1 ha perdido por inactividad."],
  [/^(.+) has been disqualified\.$/, "$1 ha sido descalificado."],
  [/^Turn limit \((\d+)\) reached\.$/, "Se ha alcanzado el límite de $1 turnos."],
];
function messageEs(text) {
  for (const [re, out] of MESSAGES_ES) if (re.test(text)) return text.replace(re, out);
  return text;
}

export function newState() {
  return {
    turn: 0, gametype: "singles", gen: 9, tier: "", started: false, ended: false, winner: "", tie: false,
    sides: { p1: newSide("p1"), p2: newSide("p2") }, field: { weather: "", terrain: "", pseudo: {} }, preview: false, fx: freshFx(),
  };
}

// What the move being played told so far: the damage lines that follow read it for their effect (the move that caused the hit,
// a critical hit, how effective it was). Cleared when the turn ends.
function freshFx() {
  return { move: "", crit: false, eff: 1 };
}

function newSide(id) {
  return { id, name: id, team: [], active: [null, null, null], conditions: {}, teamSize: 0, lastMove: "" };
}

export function parseIdent(ident) {
  const m = /^(p\d)([a-z])?: ?(.*)$/.exec(String(ident || "").trim());
  if (!m) return { side: "", slot: -1, name: String(ident || "") };
  return { side: m[1], slot: m[2] ? m[2].charCodeAt(0) - 97 : -1, name: m[3] };
}

export function parseDetails(details) {
  const parts = String(details || "").split(", ");
  const out = { species: parts[0] || "", level: 100, gender: "", shiny: false, tera: "" };
  for (const p of parts.slice(1)) {
    if (/^L\d+$/.test(p)) out.level = Number(p.slice(1));
    else if (p === "M" || p === "F") out.gender = p;
    else if (p === "shiny") out.shiny = true;
    else if (p.startsWith("tera:")) out.tera = p.slice(5);
  }
  return out;
}

export function parseHP(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const [hpPart, status = ""] = t.split(" ");
  if (hpPart === "0") return { hp: 0, maxhp: 0, status: "", fainted: true };
  const m = /^(\d+)\/(\d+)$/.exec(hpPart);
  if (!m) return null;
  return { hp: Number(m[1]), maxhp: Number(m[2]), status: status === "fnt" ? "" : status, fainted: status === "fnt" || Number(m[1]) === 0 };
}

function cleanEffect(text) {
  const t = String(text || "").replace(/^\[from\] ?/, "").trim();
  const m = /^(move|item|ability|pokemon): ?(.*)$/.exec(t);
  return m ? { kind: m[1], name: m[2] } : { kind: "", name: t };
}

const EFFECTS = {
  recoil: ["el retroceso", "recoil"], sandstorm: ["la tormenta de arena", "the sandstorm"], hail: ["el granizo", "the hail"],
  confusion: ["la confusión", "confusion"], psn: ["el veneno", "poison"], tox: ["el veneno", "poison"], brn: ["la quemadura", "its burn"],
  mimikyubusted: ["su disfraz roto", "its broken disguise"], highjumpkick: ["el golpe fallido", "the crash"], jumpkick: ["el golpe fallido", "the crash"],
  struggle: ["Forcejeo", "Struggle"], curse: ["la maldición", "the curse"], nightmare: ["la pesadilla", "the nightmare"],
};

function effectName(text, lang) {
  const e = cleanEffect(text);
  if (!e.name) return "";
  const known = EFFECTS[toID(e.name)];
  if (known) return L(known, lang);
  if (e.kind === "pokemon") return e.name;
  if (e.kind) return nameOf(e.kind, e.name, lang);
  const st = STATUS_NAMES[e.name];
  if (st) return L(st, lang);
  for (const kind of ["move", "ability", "item"]) {
    const n = nameOf(kind, e.name, lang);
    if (n !== e.name) return n;
  }
  return e.name;
}

function kwargs(parts) {
  const out = {};
  for (const p of parts) {
    const m = /^\[(\w+)\] ?(.*)$/.exec(p);
    if (m) out[m[1]] = m[2] || true;
  }
  return out;
}

function findMon(state, ident, details) {
  const { side, slot, name } = parseIdent(ident);
  const s = state.sides[side];
  if (!s) return null;
  let mon = slot >= 0 && s.active[slot] !== null ? s.team[s.active[slot]] : null;
  if (!mon || mon.name !== name) {
    mon = s.team.find((m) => m.name === name && (!details || !m.species || m.species === parseDetails(details).species || m.baseSpecies === parseDetails(details).species.split("-")[0]))
      || s.team.find((m) => m.name === name) || null;
  }
  if (!mon && details) {
    const d = parseDetails(details);
    const sameSpecies = s.team.find((m) => !m.seen && m.species === d.species);
    if (sameSpecies) {
      sameSpecies.name = name;
      sameSpecies.seen = true;
      return sameSpecies;
    }
    mon = newMon(name, d);
    s.team.push(mon);
  }
  if (!mon && name) {
    mon = newMon(name, { species: name, level: 100 });
    s.team.push(mon);
  }
  return mon;
}

function newMon(name, d) {
  return { name, species: d.species, baseSpecies: String(d.species || "").split("-")[0], level: d.level || 100, gender: d.gender || "", shiny: !!d.shiny,
    hp: 100, maxhp: 100, status: "", fainted: false, active: false, boosts: {}, volatiles: {}, tera: "", item: "", ability: "", moves: [], seen: false };
}

const BOOST_WORDS = {
  up: [["subió", "subió mucho", "subió muchísimo"], ["rose", "rose sharply", "rose drastically"]],
  down: [["bajó", "bajó mucho", "bajó muchísimo"], ["fell", "harshly fell", "severely fell"]],
};

const WEATHER = {
  raindance: [["Ha empezado a llover.", "It started to rain!"], ["Sigue lloviendo.", "Rain continues to fall."]],
  sunnyday: [["El sol pega con fuerza.", "The sunlight turned harsh!"], ["El sol sigue pegando fuerte.", "The sunlight is strong."]],
  sandstorm: [["Se ha desatado una tormenta de arena.", "A sandstorm kicked up!"], ["La tormenta de arena arrecia.", "The sandstorm is raging."]],
  hail: [["Ha empezado a granizar.", "It started to hail!"], ["Sigue granizando.", "The hail is crashing down."]],
  snowscape: [["Ha empezado a nevar.", "It started to snow!"], ["Sigue nevando.", "Snow continues to fall."]],
  snow: [["Ha empezado a nevar.", "It started to snow!"], ["Sigue nevando.", "Snow continues to fall."]],
  desolateland: [["El sol se ha vuelto abrasador.", "The sunlight turned extremely harsh!"], ["", ""]],
  primordialsea: [["Ha empezado a diluviar.", "A heavy rain began to fall!"], ["", ""]],
  deltastream: [["Soplan vientos misteriosos.", "Mysterious strong winds are protecting Flying-type Pokémon!"], ["", ""]],
};

const STATUS_START = {
  brn: ["se ha quemado", "was burned!"], par: ["está paralizado y quizá no pueda moverse", "is paralyzed! It may be unable to move!"],
  psn: ["ha sido envenenado", "was poisoned!"], tox: ["ha sido gravemente envenenado", "was badly poisoned!"], slp: ["se ha dormido", "fell asleep!"],
  frz: ["se ha congelado", "was frozen solid!"],
};
const CANT = {
  slp: ["está profundamente dormido", "is fast asleep."], par: ["está paralizado y no se puede mover", "is paralyzed! It can't move!"],
  frz: ["está congelado", "is frozen solid!"], flinch: ["retrocedió y no pudo atacar", "flinched and couldn't move!"],
  recharge: ["tiene que recuperarse", "must recharge!"], nopp: ["no tiene PP para ese movimiento", "has no PP left for that move!"],
};

/** Applies one protocol line to `state`. Returns {text, kind, anim} for the log and the animations (or null for silent lines). */
export function applyLine(state, line, opts = {}) {
  let out = applyRaw(state, line, opts);
  const ability = protocolAbility(line);
  if (ability) out = {...out, ability};
  // the simulator's own message for the effect of a move, ability or item, the field, the weather… (the parser reads every line)
  const official = officialText(state, line, opts);
  if (official) {
    if (!out) out = { text: official, kind: "minor" };
    else if (typeof out.text === "string") {
      const pct = out.text.match(/ \(([−+]\d+%)\)\.?$/);
      out.text = official + (pct ? ` (${pct[1]})` : "");
    }
  }
  if (out && out.text && opts.lang !== "en") out.text = out.text.replace(/\b([aA]) el\b/g, "$1l").replace(/\b([dD])e el\b/g, "$1el");
  return out;
}

function applyRaw(state, line, { lang = "es", me = "p1" } = {}) {
  if (!line || line[0] !== "|") return line && line.trim() ? { text: line, kind: "raw" } : null;
  const parts = line.slice(1).split("|");
  const cmd = parts[0];
  const kw = kwargs(parts.slice(1));
  const es = lang !== "en";
  const T = (esText, enText) => (es ? esText : enText);
  const sideName = (id) => state.sides[id]?.name || id;
  const monLabel = (ident, start = false) => {
    const { side, name } = parseIdent(ident);
    if (side === me || !side) return name;
    const s = es ? `el ${name} rival` : `the opposing ${name}`;
    return start ? s[0].toUpperCase() + s.slice(1) : s;
  };
  const M = (ident) => monLabel(ident, true);
  switch (cmd) {
    case "player": {
      const s = state.sides[parts[1]];
      if (s && parts[2]) s.name = parts[2];
      return null;
    }
    case "teamsize": {
      const s = state.sides[parts[1]];
      if (s) s.teamSize = Number(parts[2]) || 0;
      return null;
    }
    case "gametype":
      state.gametype = parts[1] || "singles";
      return null;
    case "gen":
      state.gen = Number(parts[1]) || 9;
      return null;
    case "tier":
      state.tier = parts[1] || "";
      return null;
    case "clearpoke":
      state.preview = true;
      for (const s of Object.values(state.sides)) s.team = [];
      return null;
    case "poke": {
      const s = state.sides[parts[1]];
      if (s) {
        const d = parseDetails(parts[2]);
        const mon = newMon(d.species, d);
        mon.seen = false;
        s.team.push(mon);
      }
      return null;
    }
    case "teampreview":
      return { text: T("Vista previa de los equipos.", "Team preview."), kind: "info" };
    case "start":
      state.started = true;
      state.preview = false;
      return { text: T("¡Empieza el combate!", "The battle starts!"), kind: "turn" };
    case "upkeep":
      state.fx = freshFx();
      return null;
    case "turn":
      state.turn = Number(parts[1]) || state.turn + 1;
      state.fx = freshFx();
      return { text: T(`Turno ${state.turn}`, `Turn ${state.turn}`), kind: "turn" };
    case "switch":
    case "drag":
    case "replace": {
      const { side, slot } = parseIdent(parts[1]);
      const s = state.sides[side];
      if (!s) return null;
      const d = parseDetails(parts[2]);
      const old = slot >= 0 && s.active[slot] !== null ? s.team[s.active[slot]] : null;
      let mon;
      if (cmd === "replace" && old) {
        mon = old;
        mon.name = parseIdent(parts[1]).name;
      } else {
        mon = findMon(state, parts[1], parts[2]);
      }
      if (!mon) return null;
      if (old && old !== mon) {
        old.active = false;
        old.boosts = {};
        old.volatiles = {};
      }
      Object.assign(mon, { species: d.species, baseSpecies: d.species.split("-")[0], level: d.level, gender: d.gender, shiny: d.shiny, seen: true, active: true });
      if (d.tera) mon.tera = d.tera;
      const hp = parseHP(parts[3]);
      if (hp) Object.assign(mon, { hp: hp.hp, maxhp: hp.maxhp || mon.maxhp, status: hp.status, fainted: hp.fainted });
      if (slot >= 0) s.active[slot] = s.team.indexOf(mon);
      if (cmd === "replace") return null;
      const text = cmd === "drag" ? T(`¡${M(parts[1])} fue arrastrado al combate!`, `${M(parts[1])} was dragged out!`)
        : side === me ? T(`¡Adelante, ${mon.name}!`, `Go! ${mon.name}!`) : T(`¡${sideName(side)} sacó a ${mon.name}!`, `${sideName(side)} sent out ${mon.name}!`);
      return { text, kind: "switch", anim: { type: "switch", side, slot } };
    }
    case "detailschange":
    case "-formechange": {
      const mon = findMon(state, parts[1]);
      if (mon) {
        const d = parseDetails(parts[2]);
        mon.species = d.species;
        if (cmd === "detailschange") mon.baseSpecies = d.species.split("-")[0];
      }
      const { side, slot } = parseIdent(parts[1]);
      return { text: T(`${M(parts[1])} cambió de forma.`, `${M(parts[1])} transformed!`), kind: "minor", anim: { type: "switch", side, slot } };
    }
    case "move": {
      const mon = findMon(state, parts[1]);
      const move = parts[2];
      if (mon && move && !mon.moves.includes(move) && !kw.from) mon.moves.push(move);
      const { side, slot } = parseIdent(parts[1]);
      if (state.sides[side]) state.sides[side].lastMove = move;
      const target = parts[3] ? parseIdent(parts[3]) : null;
      state.fx = { move: toID(move), crit: false, eff: 1 };
      const spread = typeof kw.spread === "string" ? kw.spread.split(",").map((x) => parseIdent(`${x.trim()}: `)).filter((x) => x.side) : [];
      return { text: T(`¡${M(parts[1])} usó ${nameOf("move", move, lang)}!`, `${M(parts[1])} used ${move}!`), kind: "move",
        anim: { type: "move", side, slot, target: target && target.side ? { side: target.side, slot: target.slot } : null, miss: !!kw.miss,
          move: toID(move), spread: spread.map((x) => ({ side: x.side, slot: x.slot })), still: !!kw.still } };
    }
    case "-damage":
    case "-heal":
    case "-sethp": {
      const mon = findMon(state, parts[1]);
      const hp = parseHP(parts[2]);
      if (!mon || !hp) return null;
      const before = mon.maxhp ? mon.hp / mon.maxhp : 1;
      Object.assign(mon, { hp: hp.hp, maxhp: hp.maxhp || mon.maxhp, status: hp.status, fainted: hp.fainted });
      const after = mon.maxhp ? mon.hp / mon.maxhp : 0;
      const pct = Math.round(Math.abs(before - after) * 100);
      const { side, slot } = parseIdent(parts[1]);
      const from = kw.from ? effectName(kw.from, lang) : "";
      // why it was hit: the move that caused it (none for poison, weather, recoil...), a critical hit, how effective it was
      const cause = cmd === "-damage"
        ? { move: kw.from ? "" : state.fx.move, source: kw.from ? toID(cleanEffect(kw.from).name) : "", crit: state.fx.crit, eff: state.fx.eff } : null;
      if (cause) { state.fx.crit = false; state.fx.eff = 1; }
      let text;
      if (cmd === "-damage") {
        if (!pct && !from) return { text: "", kind: "damage", anim: { type: "hit", side, slot, delta: 0, ...cause } };
        text = from ? T(`${M(parts[1])} se resiente por ${from} (−${pct}%).`, `${M(parts[1])} was hurt by ${from} (−${pct}%).`)
          : T(`${M(parts[1])} ha perdido el ${pct}% de su salud.`, `${M(parts[1])} lost ${pct}% of its health.`);
      } else if (cmd === "-heal") {
        text = from ? T(`${M(parts[1])} recuperó salud gracias a ${from} (+${pct}%).`, `${M(parts[1])} restored HP with ${from} (+${pct}%).`)
          : T(`${M(parts[1])} ha recuperado salud (+${pct}%).`, `${M(parts[1])} restored HP (+${pct}%).`);
      } else {
        text = "";
      }
      return { text, kind: cmd === "-heal" ? "heal" : "damage", anim: { type: cmd === "-heal" ? "heal" : "hit", side, slot, delta: after - before, ...cause } };
    }
    case "faint": {
      const mon = findMon(state, parts[1]);
      if (mon) Object.assign(mon, { hp: 0, fainted: true, status: "" });
      const { side, slot } = parseIdent(parts[1]);
      return { text: T(`¡${M(parts[1])} se debilitó!`, `${M(parts[1])} fainted!`), kind: "faint", anim: { type: "faint", side, slot } };
    }
    case "-status": {
      const mon = findMon(state, parts[1]);
      if (mon) mon.status = parts[2];
      const phrase = STATUS_START[parts[2]];
      const { side, slot } = parseIdent(parts[1]);
      return { text: phrase ? (es ? `¡${M(parts[1])} ${phrase[0]}!` : `${M(parts[1])} ${phrase[1]}`) : `${M(parts[1])}: ${parts[2]}`, kind: "status",
        anim: { type: "status", side, slot, status: parts[2] } };
    }
    case "-curestatus": {
      const mon = findMon(state, parts[1]);
      if (mon) mon.status = "";
      const st = STATUS_NAMES[parts[2]] ? L(STATUS_NAMES[parts[2]], lang) : parts[2];
      return { text: T(`${M(parts[1])} se ha recuperado de ${st}.`, `${M(parts[1])} recovered from ${st}.`), kind: "minor" };
    }
    case "-cureteam": {
      const s = state.sides[parseIdent(parts[1]).side];
      if (s) for (const m of s.team) m.status = "";
      return { text: T("El equipo se ha curado de sus problemas de estado.", "The team was cured of its status conditions."), kind: "minor" };
    }
    case "-boost":
    case "-unboost": {
      const mon = findMon(state, parts[1]);
      const n = Number(parts[3]) || 0;
      if (mon) mon.boosts[parts[2]] = Math.max(-6, Math.min(6, (mon.boosts[parts[2]] || 0) + (cmd === "-boost" ? n : -n)));
      const stat = L(STAT_NAMES[parts[2]] || [parts[2], parts[2]], lang);
      const words = BOOST_WORDS[cmd === "-boost" ? "up" : "down"][es ? 0 : 1];
      const w = words[Math.min(2, Math.max(0, n - 1))];
      const { side, slot } = parseIdent(parts[1]);
      if (n === 0) return { text: T(`¡${stat} de ${monLabel(parts[1])} no puede ${cmd === "-boost" ? "subir" : "bajar"} más!`, `${M(parts[1])}'s ${stat} won't go any ${cmd === "-boost" ? "higher" : "lower"}!`), kind: "minor" };
      return { text: T(`¡${stat} de ${monLabel(parts[1])} ${w}!`, `${M(parts[1])}'s ${stat} ${w}!`), kind: "boost", anim: { type: cmd === "-boost" ? "boost" : "unboost", side, slot } };
    }
    case "-setboost": {
      const mon = findMon(state, parts[1]);
      if (mon) mon.boosts[parts[2]] = Number(parts[3]) || 0;
      return { text: T(`${M(parts[1])} cambió sus características.`, `${M(parts[1])}'s stats changed.`), kind: "minor" };
    }
    case "-clearboost":
    case "-clearallboost":
    case "-clearnegativeboost": {
      if (cmd === "-clearallboost") for (const s of Object.values(state.sides)) for (const m of s.team) m.boosts = {};
      else {
        const mon = findMon(state, parts[1]);
        if (mon) mon.boosts = cmd === "-clearnegativeboost" ? Object.fromEntries(Object.entries(mon.boosts).filter(([, v]) => v > 0)) : {};
      }
      return { text: T("Los cambios de características se han anulado.", "Stat changes were removed."), kind: "minor" };
    }
    case "-weather": {
      const id = toID(parts[1]);
      if (id === "none" || !id) {
        state.field.weather = "";
        return { text: T("El tiempo vuelve a la normalidad.", "The weather returned to normal."), kind: "field" };
      }
      state.field.weather = parts[1];
      const w = WEATHER[id];
      if (kw.upkeep) return w && w[1][0] ? { text: es ? w[1][0] : w[1][1], kind: "minor" } : null;
      return { text: w ? (es ? w[0][0] : w[0][1]) : parts[1], kind: "field" };
    }
    case "-fieldstart":
    case "-fieldend": {
      const e = cleanEffect(parts[1]);
      const name = effectName(parts[1], lang);
      if (/terrain/i.test(e.name)) state.field.terrain = cmd === "-fieldstart" ? e.name : "";
      else state.field.pseudo[e.name] = cmd === "-fieldstart";
      return { text: cmd === "-fieldstart" ? T(`Empieza ${name}.`, `${name} started.`) : T(`Se acabó ${name}.`, `${name} ended.`), kind: "field" };
    }
    case "-sidestart":
    case "-sideend": {
      const sid = parseIdent(parts[1]).side || String(parts[1]).slice(0, 2);
      const s = state.sides[sid];
      const e = cleanEffect(parts[2]);
      const name = effectName(parts[2], lang);
      if (s) {
        if (cmd === "-sidestart") s.conditions[e.name] = (s.conditions[e.name] || 0) + 1;
        else delete s.conditions[e.name];
      }
      return { text: cmd === "-sidestart" ? T(`${name} en el bando de ${sideName(sid)}.`, `${name} on ${sideName(sid)}'s side.`)
        : T(`${name} desapareció del bando de ${sideName(sid)}.`, `${name} ended on ${sideName(sid)}'s side.`), kind: "field" };
    }
    case "-terastallize": {
      const mon = findMon(state, parts[1]);
      if (mon) mon.tera = parts[2];
      const { side, slot } = parseIdent(parts[1]);
      return { text: T(`¡${M(parts[1])} se teracristalizó en tipo ${typeName(parts[2], lang)}!`, `${M(parts[1])} terastallized into the ${parts[2]} type!`),
        kind: "big", anim: { type: "tera", side, slot } };
    }
    case "-mega":
    case "-primal":
    case "-burst": {
      const { side, slot } = parseIdent(parts[1]);
      const word = cmd === "-mega" ? T("megaevolucionó", "has Mega Evolved") : cmd === "-primal" ? T("recuperó su forma primigenia", "underwent Primal Reversion") : T("liberó su poder", "regained its true power");
      return { text: es ? `¡${M(parts[1])} ${word}!` : `${M(parts[1])} ${word}!`, kind: "big", anim: { type: "tera", side, slot } };
    }
    case "silverphase": {
      // Silver's own line: a trainer changes tactics (its phase), with what it says
      const sid = parts[1] === "p2" ? "p2" : "p1";
      const who = state.sides[sid]?.name || sid;
      const line = parts.slice(2).join("|").trim();
      return { text: line ? `${who}: «${line}»` : T(`¡${who} cambia de táctica!`, `${who} changes tactics!`), kind: "big",
        anim: { type: "phase", side: sid, slot: 0, line } };
    }
    case "-zpower":
      return { text: T(`¡${M(parts[1])} desata su poder Z!`, `${M(parts[1])} surrounded itself with its Z-Power!`), kind: "big" };
    case "cant": {
      const reason = cleanEffect(parts[2]).name;
      const c = CANT[toID(reason)];
      return { text: c ? (es ? `¡${M(parts[1])} ${c[0]}!` : `${M(parts[1])} ${c[1]}`) : T(`${M(parts[1])} no puede moverse (${effectName(parts[2], lang)}).`, `${M(parts[1])} can't move (${effectName(parts[2], lang)}).`), kind: "minor" };
    }
    case "-supereffective": {
      state.fx.eff = 2;
      const { side, slot } = parseIdent(parts[1] || "");
      return { text: T("¡Es muy eficaz!", "It's super effective!"), kind: "effect", ...(side ? { anim: { type: "super", side, slot } } : {}) };
    }
    case "-resisted":
      state.fx.eff = 0.5;
      return { text: T("No es muy eficaz…", "It's not very effective…"), kind: "effect" };
    case "-immune":
      return { text: T(`No afecta a ${monLabel(parts[1])}…`, `It doesn't affect ${monLabel(parts[1])}…`), kind: "effect" };
    case "-crit":
      state.fx.crit = true;
      return { text: T("¡Un golpe crítico!", "A critical hit!"), kind: "effect" };
    case "-miss":
      return { text: parts[2] ? T(`¡${M(parts[2])} esquivó el ataque!`, `${M(parts[2])} avoided the attack!`) : T("¡Falló!", "It missed!"), kind: "effect" };
    case "-fail":
      return { text: T("¡Pero falló!", "But it failed!"), kind: "effect" };
    case "-notarget":
      return { text: T("¡Pero no había objetivo!", "But there was no target…"), kind: "effect" };
    case "-ohko":
      return { text: T("¡KO de un golpe!", "It's a one-hit KO!"), kind: "effect" };
    case "-hitcount":
      return { text: T(`¡Golpeó ${parts[2]} veces!`, `The Pokémon was hit ${parts[2]} times!`), kind: "effect" };
    case "-ability": {
      const mon = findMon(state, parts[1]);
      if (mon && parts[2]) mon.ability = parts[2];
      return { text: es ? `[${nameOf("ability", parts[2], lang)} de ${monLabel(parts[1])}]` : `[${M(parts[1])}'s ${parts[2]}]`, kind: "ability" };
    }
    case "-endability":
      return { text: T(`La habilidad de ${monLabel(parts[1])} dejó de funcionar.`, `${M(parts[1])}'s ability was suppressed.`), kind: "minor" };
    case "-item": {
      const mon = findMon(state, parts[1]);
      if (mon) mon.item = parts[2];
      return { text: T(`${M(parts[1])} lleva ${nameOf("item", parts[2], lang)}.`, `${M(parts[1])} has ${parts[2]}.`), kind: "minor" };
    }
    case "-enditem": {
      const mon = findMon(state, parts[1]);
      if (mon) mon.item = "";
      const item = nameOf("item", parts[2], lang);
      if (kw.eat) return { text: T(`¡${M(parts[1])} se comió ${item}!`, `${M(parts[1])} ate its ${parts[2]}!`), kind: "minor" };
      return { text: T(`${M(parts[1])} ya no tiene ${item}.`, `${M(parts[1])}'s ${parts[2]} was used up.`), kind: "minor" };
    }
    case "-activate": {
      const e = cleanEffect(parts[2]);
      const id = toID(e.name);
      if (["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "silktrap", "burningbulwark", "maxguard"].includes(id)) {
        return { text: T(`¡${M(parts[1])} se protege!`, `${M(parts[1])} protected itself!`), kind: "effect" };
      }
      if (id === "substitute") return { text: T("¡El sustituto recibió el daño!", "The substitute took damage!"), kind: "effect" };
      if (id === "confusion") return { text: T(`¡${M(parts[1])} está confuso!`, `${M(parts[1])} is confused!`), kind: "minor" };
      return { text: `${M(parts[1])}: ${effectName(parts[2], lang)}.`, kind: "minor" };
    }
    case "-start": {
      const mon = findMon(state, parts[1]);
      const e = cleanEffect(parts[2]);
      const id = toID(e.name);
      if (mon) mon.volatiles[id] = true;
      if (id === "substitute") return { text: T(`¡${M(parts[1])} creó un sustituto!`, `${M(parts[1])} put in a substitute!`), kind: "minor" };
      if (id === "confusion") return { text: T(`¡${M(parts[1])} se ha confundido!`, `${M(parts[1])} became confused!`), kind: "status" };
      if (id === "typechange") return { text: T(`${M(parts[1])} ahora es de tipo ${parts[3]}.`, `${M(parts[1])} became the ${parts[3]} type!`), kind: "minor" };
      return { text: `${M(parts[1])}: ${effectName(parts[2], lang)}.`, kind: "minor" };
    }
    case "-end": {
      const mon = findMon(state, parts[1]);
      const e = cleanEffect(parts[2]);
      const id = toID(e.name);
      if (mon) delete mon.volatiles[id];
      if (id === "substitute") return { text: T(`¡El sustituto de ${monLabel(parts[1])} se rompió!`, `${M(parts[1])}'s substitute faded!`), kind: "minor" };
      if (id === "confusion") return { text: T(`${M(parts[1])} ya no está confuso.`, `${M(parts[1])} snapped out of its confusion!`), kind: "minor" };
      return { text: T(`${M(parts[1])}: termina ${effectName(parts[2], lang)}.`, `${M(parts[1])}'s ${effectName(parts[2], lang)} ended.`), kind: "minor" };
    }
    case "-transform":
      return { text: T(`¡${M(parts[1])} se transformó en ${parseIdent(parts[2]).name}!`, `${M(parts[1])} transformed into ${parseIdent(parts[2]).name}!`), kind: "minor" };
    case "-prepare":
      return { text: T(`${M(parts[1])} se está preparando…`, `${M(parts[1])} is getting ready…`), kind: "minor" };
    case "-mustrecharge":
      return null;
    case "-singleturn":
    case "-singlemove":
      return { text: `${M(parts[1])}: ${effectName(parts[2], lang)}.`, kind: "minor" };
    case "-message":
    case "message":
      return { text: es ? messageEs(parts.slice(1).join("|")) : parts.slice(1).join("|"), kind: "info" };
    case "raw":
    case "html":
      return { text: parts.slice(1).join("|").replace(/<[^>]+>/g, ""), kind: "info" };
    case "win":
      state.ended = true;
      state.winner = parts[1] || "";
      return { text: T(`¡${parts[1]} ha ganado el combate!`, `${parts[1]} won the battle!`), kind: "win" };
    case "tie":
      state.ended = true;
      state.tie = true;
      return { text: T("¡El combate ha terminado en empate!", "The battle ended in a tie!"), kind: "win" };
    default:
      return null;
  }
}

/** Index of the first line of each turn ("|turn|N"), for scrubbing a replay. */
export function turnMarks(lines) {
  const marks = [];
  lines.forEach((l, i) => { if (l.startsWith("|turn|")) marks.push({ turn: Number(l.slice(6)) || marks.length + 1, index: i }); });
  return marks;
}

/** State after `count` lines, built from scratch. */
export function stateAt(lines, count, opts) {
  const st = newState();
  for (let i = 0; i < Math.min(count, lines.length); i++) applyLine(st, lines[i], opts);
  return st;
}
