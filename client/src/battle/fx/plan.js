// What a move looks like on the turn-based screen, as data: given where the user and the targets stand (in meters on the stage), it
// returns the timeline of effects to hand to the real-time mode's effect painter (rt/vfx.js): a charge, a projectile or a ray flying
// from one Pokémon to the other, a melee mark on the target, an area, an aura. Pure functions with no canvas or DOM, so they are
// tested on their own. Times are seconds of effect time (the stage stretches or squeezes them to fit the replay speed).
import { MOVE_FX, TYPES } from "./move-data.js";

const SHAPES = { s: "strike", d: "dash", h: "shot", b: "beam", w: "wave", c: "cone", x: "burst", p: "drop", f: "self", l: "field", g: "global" };
let TABLE = null;

/** {type, shape, heal} of a move by its id ("flamethrower"), or null when the table does not know it. */
export function moveInfo(id) {
  if (!TABLE) {
    TABLE = new Map();
    for (const row of MOVE_FX.split(",")) {
      const i = row.indexOf(":");
      const v = row.slice(i + 1);
      TABLE.set(row.slice(0, i), { type: TYPES[v.charCodeAt(0) - 97] || "Normal", shape: SHAPES[v[1]] || "shot", heal: v[2] === "H" });
    }
  }
  return TABLE.get(id) || null;
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function unit(a, b) {
  const d = dist(a, b);
  return d < 1e-6 ? { x: 1, y: 0 } : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}
function centroid(list) {
  const n = list.length || 1;
  return { x: list.reduce((s, p) => s + p.x, 0) / n, y: list.reduce((s, p) => s + p.y, 0) / n };
}
// a miss flies past the target, a little to the side
function wide(from, to) {
  const d = unit(from, to);
  return { x: to.x + d.x * 1.3 - d.y * 1.5, y: to.y + d.y * 1.3 + d.x * 1.5 };
}

// How the shapes are timed (effect seconds): the wind-up before a shot leaves, how long it flies, how long a beam stays lit on the target.
const TIMING = {
  shot: { pre: 0, fly: 0.5, hold: 0, r: 0.42 },
  beam: { pre: 0.27, fly: 0.3, hold: 0.28, r: 0.55 },
  wave: { pre: 0, fly: 0.6, hold: 0, r: 0.5 },
};
const EXPLOSIONS = new Set(["explosion", "selfdestruct", "mistyexplosion", "mindblown"]);
const BOLTS = new Set(["thunder", "thunderclap", "boltstrike"]);

/**
 * move: the move's id. user: {x, y}. targets: where the move lands (empty for self/field moves). foes: the opposing Pokémon on the
 * field (for field effects and cones). others: every other Pokémon on the field (for bursts). miss: the move missed.
 * Returns {type, shape, dur, steps, flights, sides}: `dur` is when the damage may show, `steps` the timed events ({at, ev, sides} for
 * the effect painter, or {at, burst} / {at, flash}), `flights` the projectiles, `sides` the positions the painter keeps (the user first).
 */
export function planMove({ move, user, targets = [], foes = [], others = [], miss = false }) {
  const info = moveInfo(move) || (targets.length ? { type: "Normal", shape: "strike", heal: false } : { type: "Normal", shape: "self", heal: false });
  const { type, shape } = info;
  const aim = targets.length ? centroid(targets) : foes.length ? centroid(foes) : { x: user.x + 1, y: user.y };
  const d0 = unit(user, aim);
  const me = { x: user.x, y: user.y, fx: d0.x, fy: d0.y };
  const foeCenter = foes.length ? centroid(foes) : aim;
  const steps = [];
  const flights = [];
  let end = 0;
  const add = (at, ev, sides) => { steps.push({ at, ev, sides: sides || [me] }); end = Math.max(end, at); };
  const list = shape === "self" || shape === "field" || shape === "global" ? [] : targets;

  switch (shape) {
    case "self":
      add(0, { k: "use", s: 0, shape: "self", move: info.heal ? "recover" : move, type }, [me]);
      end = Math.max(end, 0.65);
      break;
    case "field":
      add(0, { k: "use", s: 0, shape: "field", move, type }, [me, foeCenter]);
      end = Math.max(end, 0.6);
      break;
    case "global":
      add(0, { k: "use", s: 0, shape: "field", move, type }, [me, foeCenter]);
      add(0.12, { k: "use", s: 1, shape: "field", move, type }, [me, foeCenter]);
      end = Math.max(end, 0.7);
      break;
    case "strike":
    case "dash": {
      const reach = shape === "dash" ? 1.2 : 1.4;
      const lead = shape === "dash" ? 0.1 : 0.16;
      list.forEach((t, i) => {
        if (miss) return;
        const d = unit(user, t);
        // the painter draws a melee mark `reach` in front of the user: put the user back so that it lands on the target
        // it lands when the user's lunge reaches its peak
        add(lead + i * 0.12, { k: "use", s: 0, shape, move, type }, [{ x: t.x - d.x * reach, y: t.y - d.y * reach, fx: d.x, fy: d.y }]);
      });
      end = Math.max(end, lead + (list.length ? (list.length - 1) * 0.12 : 0) + (shape === "dash" ? 0.5 : 0.36));
      break;
    }
    case "shot":
    case "beam":
    case "wave": {
      const tm = TIMING[shape];
      if (tm.pre) add(0, { k: "windup", s: 0, shape, move, type, ticks: Math.round(tm.pre * 30) }, [me]);
      list.forEach((t, i) => {
        const id = `${move}-${i}`;
        const to = miss ? wide(user, t) : t;
        const t0 = tm.pre + i * 0.06;
        flights.push({ id, move, type, shape, from: { x: user.x, y: user.y }, to: { x: to.x, y: to.y }, t0, dur: tm.fly, hold: tm.hold, r: tm.r });
        add(t0, { k: "shot", id, move, shape, type, s: 0, x: user.x, y: user.y }, [me]);
        add(t0 + tm.fly + tm.hold, { k: miss ? "fizzle" : "impact", id, x: to.x, y: to.y }, [me]);
      });
      break;
    }
    case "cone": {
      const r = clamp(dist(user, aim) * 1.2, 3, 9);
      add(0, { k: "area", s: 0, move, type, x: user.x + d0.x * 0.6, y: user.y + d0.y * 0.6, r, arc: 0.55, fx: d0.x, fy: d0.y }, [me]);
      end = Math.max(end, 0.55);
      break;
    }
    case "burst": {
      const far = others.reduce((m, p) => Math.max(m, dist(user, p)), 0);
      const r = EXPLOSIONS.has(move) ? 3.4 : clamp(far * 1.05, 3, 9);
      add(0, { k: "area", s: 0, move, type, x: user.x, y: user.y, r, arc: -1, fx: 1, fy: 0 }, [me]);
      end = Math.max(end, 0.75);
      break;
    }
    case "drop": {
      list.forEach((t, i) => {
        const land = miss ? wide(user, t) : t;
        const w0 = i < 2 ? i * 0.1 : 0.5 + (i - 2) * 0.1;
        const s = i < 2 ? i : 0;   // the painter remembers one drop per user slot: serialize beyond two targets
        // a bolt waits for its cloud; rocks and the like fall at once and need a moment to land
        const wait = BOLTS.has(move) ? 0.36 : 0.22;
        add(w0, { k: "windup", s, shape: "drop", move, type, tx: land.x, ty: land.y, ticks: 11 }, [me]);
        add(w0 + wait, { k: "area", s, move, type, x: land.x, y: land.y, r: 1.5, arc: 0, fx: 0, fy: 1 }, [me]);
        if (!BOLTS.has(move)) end = Math.max(end, w0 + wait + 0.4);
      });
      break;
    }
    default:
      break;
  }
  steps.sort((a, b) => a.at - b.at);
  return { type, shape, dur: end + 0.1, steps, flights, sides: [me, { x: foeCenter.x, y: foeCenter.y, fx: -d0.x, fy: -d0.y }] };
}

// Why something other than a move hurt: the type of the burst.
const SOURCE_TYPES = { brn: "Fire", psn: "Poison", tox: "Poison", sandstorm: "Rock", hail: "Ice", snow: "Ice", snowscape: "Ice", leechseed: "Grass",
  curse: "Ghost", nightmare: "Ghost", stealthrock: "Rock", spikes: "Ground", toxicspikes: "Poison", stickyweb: "Bug", confusion: "Psychic",
  firespin: "Fire", magmastorm: "Fire", whirlpool: "Water", sandtomb: "Ground", bind: "Normal", wrap: "Normal", infestation: "Bug",
  saltcure: "Rock", sparklingaria: "Water", futuresight: "Psychic", doomdesire: "Steel", gmaxwildfire: "Fire", gmaxvinelash: "Grass",
  gmaxcannonade: "Water", gmaxvolcalith: "Rock" };

/**
 * A hit landing: `move` (the id of the move that caused it, or "") or `source` (poison, weather, recoil...), `crit`, `eff`
 * (2 super effective, 0.5 resisted, 1 normal). Returns {type, steps}.
 */
export function planHit({ move = "", source = "", crit = false, eff = 1 } = {}) {
  const byMove = move ? moveInfo(move) : null;
  const type = byMove ? byMove.type : SOURCE_TYPES[source] || moveInfo(source)?.type || "Normal";
  const steps = [];
  if (byMove && eff >= 1) {
    steps.push({ at: 0, ev: { k: "hit", s: 0, type, crit: !!crit, eff } });
  } else {
    // a resisted hit and a hit that is not a move's get a smaller burst
    steps.push({ at: 0, burst: { type, power: byMove ? 0.65 : 0.6 } });
    if (crit) steps.push({ at: 0, ev: { k: "hit", s: 0, type, crit: true, eff } });
  }
  if (crit) steps.push({ at: 0, flash: { color: "#ffffff", life: 0.16 } });
  if (byMove && eff > 1) steps.push({ at: 0.08, burst: { type: "Normal", power: 0.7 } });
  return { type, steps };
}

/** How long the effect of a move takes at a given replay speed, and how fast to play it: the effect fits in ~80% of the pause
 * the line gets, stretched at most a quarter, never under 0.25 s. At the fastest speeds the move's own effect is skipped. */
export function fitTiming(durSeconds, { budgetMs, speedMs }) {
  if (speedMs < 260) return { ms: 0, ts: 1, skip: true };
  const ms = clamp(budgetMs * 0.8, 250, durSeconds * 1000 * 1.3);
  return { ms, ts: (durSeconds * 1000) / ms, skip: false };
}
