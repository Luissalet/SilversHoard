// Turns what happens in a battle into sounds: protocol lines of the turn-based screen and events of the real-time simulator.
// The mixer and the synthesis live in ../audio.js; this file only decides which cue goes with which event.
import { cry as realCry, sfx as realSfx } from "../audio.js";
import { spriteId, toID } from "./dex.js";

// move -> type table (about 10 KB), loaded the first time a move is heard so it stays out of the first paint
let moveTypes = null;
let loading = null;
function loadMoveTypes() {
  if (!loading) loading = import("./move-types.js").then((m) => { moveTypes = m.default; }).catch(() => { moveTypes = {}; });
  return loading;
}

/** How much to play at this playback speed (milliseconds between events): fast replays skip the small sounds so nothing piles up. */
export function levelOf(speedMs) {
  return speedMs >= 450 ? 2 : speedMs >= 200 ? 1 : 0;
}

/** Loads the move table (the player does it when it starts, so the first move already has its type). */
export const preloadSfx = loadMoveTypes;

export function newSfxState() {
  loadMoveTypes();
  return { flags: [] };
}

/** What must be known before a line is applied: whether a switch replaces a Pokémon that is still standing. */
export function sfxPre(state, line) {
  const m = /^\|(?:switch|drag)\|(p\d)([a-z])?:/.exec(line);
  if (!m) return null;
  const s = state.sides[m[1]];
  const slot = m[2] ? m[2].charCodeAt(0) - 97 : 0;
  const i = s ? s.active[slot] : null;
  const old = i !== null && i !== undefined ? s.team[i] : null;
  return { out: !!old && !old.fainted };
}

function monAt(state, side, slot) {
  const s = state.sides[side];
  const i = s && s.active[slot];
  return i === null || i === undefined ? null : s.team[i] || null;
}

/**
 * Play the sounds of one applied protocol line. `state` is the battle state after the line, `ev` what applyLine returned,
 * `mem` the object from newSfxState, opts {speedMs, cryUrl(species) -> url|null}. (`sfx` and `cry` can be replaced, for tests.)
 */
export function playLine(state, line, ev, pre, mem, { speedMs = 900, cryUrl = null, sfx = realSfx, cry = realCry } = {}) {
  if (!ev || !line || line[0] !== "|") return;
  const level = levelOf(speedMs);
  const gap = level === 2 ? 0.04 : 0.14;
  const parts = line.slice(1).split("|");
  const cmd = parts[0];
  switch (cmd) {
    case "move": {
      mem.flags = [];
      if (level < 2) break;
      const id = toID(parts[2]);
      if (moveTypes) sfx("move", { type: moveTypes[id], gap: 0.1 });
      else loadMoveTypes().then(() => sfx("move", { type: moveTypes[id], gap: 0.1 }));
      break;
    }
    case "-crit": mem.flags.push("crit"); break;
    case "-supereffective": mem.flags.push("super"); break;
    case "-resisted": mem.flags.push("resisted"); break;
    case "-damage": {
      if (ev.anim && ev.anim.delta === 0 && !/\[from\]/.test(line)) break;
      if (/\[from\]/.test(line)) { if (level > 0) sfx("chip", { gap }); break; }
      const f = mem.flags;
      mem.flags = [];
      if (f.includes("crit")) { sfx("crit", { gap }); if (f.includes("super") && level > 0) sfx("super", { gap, delay: 0.16, vol: 0.6 }); }
      else if (f.includes("super")) sfx("super", { gap });
      else if (f.includes("resisted")) sfx("resisted", { gap });
      else sfx("hit", { gap });
      break;
    }
    case "-miss": sfx("miss", { gap }); break;
    case "-immune": if (level > 0) sfx("resisted", { gap, vol: 0.6 }); break;
    case "faint": {
      sfx("faint", { gap: 0 });
      if (level === 2 && cryUrl) {
        const { side, slot } = ev.anim || {};
        const mon = monAt(state, side, slot);
        if (mon) cry(cryUrl(mon.species), { faint: true });
      }
      break;
    }
    case "switch":
    case "drag": {
      const { side, slot } = ev.anim || {};
      if (level > 0) {
        if (pre && pre.out) sfx("switchOut", { gap: 0.1 });
        sfx("switchIn", { gap: 0.1, delay: pre && pre.out ? 0.18 : 0 });
      }
      if (level === 2 && cryUrl) {
        const mon = monAt(state, side, slot);
        if (mon) cry(cryUrl(mon.species), {});
      }
      break;
    }
    case "-boost": if (level > 0 && ev.anim) sfx("statUp", { gap: 0.3 }); break;
    case "-unboost": if (level > 0 && ev.anim) sfx("statDown", { gap: 0.3 }); break;
    case "-status": if (level > 0) sfx("status", { status: parts[2], gap: 0.2 }); break;
    case "-heal": if (level > 0 && !/\[from\]/.test(line)) sfx("heal", { gap: 0.2 }); break;
    case "-terastallize":
    case "-mega":
    case "-primal":
    case "-burst": sfx("big", { gap: 0.3 }); break;
    default: break;
  }
}

/** Sounds of one real-time simulator event. `speed` is the replay speed (1 for a live battle). */
export function playRtEvent(e, { speed = 1, cryUrl = null, sfx = realSfx, cry = realCry } = {}) {
  const fast = speed > 2;
  const gap = fast ? 0.14 : 0.04;
  switch (e.k) {
    case "use": if (!fast) sfx("move", { type: e.type, gap: 0.06 }); break;
    case "hit": {
      if (e.crit) sfx("crit", { gap });
      else if (e.eff > 1) sfx("super", { gap });
      else if (e.eff < 1 && e.eff > 0) sfx("resisted", { gap });
      else sfx("hit", { gap, vol: e.hit > 0 ? 0.6 : 1 });
      break;
    }
    case "chip": if (!fast) sfx("chip", { gap: 0.1 }); break;
    case "heal": if (!fast) sfx("heal", { gap: 0.2 }); break;
    case "miss": sfx("miss", { gap }); break;
    case "protected": sfx("resisted", { gap: 0.1, vol: 0.7 }); break;
    case "status": if (!fast) sfx("status", { status: e.status, gap: 0.2 }); break;
    case "boost": if (!e.same && !fast) sfx((e.delta ?? e.stage) > 0 ? "statUp" : "statDown", { gap: 0.3 }); break;
    case "faint":
      sfx("faint", { gap: 0 });
      if (!fast && cryUrl && e.species) cry(cryUrl(e.species), { faint: true });
      break;
    case "switch":
      if (!fast) { sfx("switchIn", { gap: 0.1 }); if (cryUrl && e.species) cry(cryUrl(e.species), {}); }
      break;
    case "recall": if (!fast) sfx("switchOut", { gap: 0.1 }); break;
    default: break;
  }
}

/** The app's cached cry route. */
export const appCryUrl = (species, base = "") => (species ? `${base}/api/cries/${spriteId(species)}` : null);
