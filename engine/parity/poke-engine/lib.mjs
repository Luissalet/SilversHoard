// Shared pieces of the poke-engine parity kit: building and replaying a simulator battle, picking legal choices, a scripted random
// source that always takes the likeliest outcome (and one chosen damage roll), and the summary both engines are reduced to.
//
// The simulator (@pkmn/sim) is the reference. A case is one turn of a battle: the poke-engine state the master AI would build from the
// battle (engine/src/master.mjs), the two decisions, and what is needed to replay the battle up to that turn. The oracle plays the turn
// in the simulator; the probe plays it in poke-engine; both write the same summary of what changed.
import {Battle, PRNG, Dex, toID} from '@pkmn/sim';

export const ROLLS = 16;                  // the simulator's damage roll is random(16): 100% down to 85%
// moves the random decisions avoid: the pivots stop the turn half way for a choice, and the phazing moves drag in a Pokemon at random
// (poke-engine plays every one of them as a branch, there is no likeliest)
export const PIVOTS = new Set(['uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'batonpass', 'shedtail', 'chillyreception',
  'roar', 'whirlwind', 'dragontail', 'circlethrow']);

/** A small seeded generator for choosing decisions (mulberry32). */
export function rngFrom(seed) {
  let a = (Array.isArray(seed) ? seed.reduce((x, y) => (Math.imul(x, 31) + y) | 0, 7) : Number(seed)) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A battle for a case spec: {format, seed, teams: {p1, p2} (packed), history: [[c1, c2], ...]} replayed up to the turn. */
export function replay(spec) {
  const b = new Battle({formatid: spec.format || 'gen9customgame', seed: spec.seed});
  b.setPlayer('p1', {name: 'A', team: spec.teams.p1});
  b.setPlayer('p2', {name: 'B', team: spec.teams.p2});
  if (b.sides[0].activeRequest?.teamPreview) b.makeChoices('default', 'default');
  for (const [c1, c2, crit] of spec.history || []) {
    if (spec.modal) b.prng = modal(b, HISTORY_ROLL, crit);     // hand-written cases play their set-up turns on the likeliest path
    b.makeChoices(c1 || '', c2 || '');
  }
  return b;
}

export const HISTORY_ROLL = 8;

/** The scripted random source bound to a battle. */
export function modal(battle, roll, crit = 'none') {
  const script = new Scripted({roll, crit: crit || 'none'});
  script.battle = battle;
  return script;
}

/** The moves and switches a side may pick now, from its request. */
export function options(battle, sideId) {
  const side = battle.sides.find((s) => s.id === sideId);
  const req = side.activeRequest;
  if (!req || req.wait || req.teamPreview) return {kind: 'none', moves: [], switches: []};
  const bench = [];
  (req.side?.pokemon || []).forEach((p, i) => {
    if (!p.active && !String(p.condition || '').endsWith(' fnt')) bench.push(i + 1);
  });
  if (req.forceSwitch?.[0]) return {kind: 'switch', moves: [], switches: bench};
  const act = req.active?.[0];
  if (!act) return {kind: 'none', moves: [], switches: []};
  const moves = (act.moves || []).map((m, i) => ({n: i + 1, id: m.id, ok: !m.disabled && m.pp !== 0}))
    .filter((m) => m.ok);
  return {kind: 'turn', moves, switches: act.trapped || act.maybeTrapped ? [] : bench, canTera: !!act.canTerastallize};
}

/** A random legal choice; pivot and phazing moves are avoided (see PIVOTS). */
export function pick(battle, sideId, rng, {switchRate = 0.1, teraRate = 0.12} = {}) {
  const o = options(battle, sideId);
  if (o.kind === 'none') return '';
  if (o.kind === 'switch') return o.switches.length ? `switch ${o.switches[Math.floor(rng() * o.switches.length)]}` : 'default';
  const safe = o.moves.filter((m) => !PIVOTS.has(m.id));
  const pool = safe.length ? safe : o.moves;
  if (o.switches.length && (rng() < switchRate || !pool.length)) return `switch ${o.switches[Math.floor(rng() * o.switches.length)]}`;
  if (!pool.length) return 'default';
  const m = pool[Math.floor(rng() * pool.length)];
  return `move ${m.n}${o.canTera && rng() < teraRate ? ' terastallize' : ''}`;
}

/** A choice string as poke-engine names it: the move id (with -tera) or the Pokémon to switch to. */
export function engineMove(state, sideKey, choice) {
  const side = state[sideKey];
  const mon = side.pokemon[Number(side.active_index)];
  let m = /^move (\d)( terastallize)?$/.exec(choice);
  if (m) return `${mon.moves[Number(m[1]) - 1].id}${m[2] ? '-tera' : ''}`;
  m = /^switch (\d)$/.exec(choice);
  if (m) return side.pokemon[Number(m[1]) - 1].id;
  return null;
}

/** The random source of the experiment turn: every chance takes its likelier result, a duration its longest, the damage roll is `roll` (0 = highest). */
export class Scripted extends PRNG {
  constructor({roll = 0, crit = 'none'} = {}) {
    super([1, 2, 3, 4]);
    this.roll = roll;
    this.crit = crit;                   // none | p1 | p2 | both: who lands critical hits
    this.battle = null;
  }

  random(from, to) {
    if (from === undefined) return 0.5;
    from = Math.floor(from);
    if (to === undefined || !to) return from === ROLLS ? this.roll : Math.floor(from / 2);
    return Math.floor(to) - 1;           // a duration drawn between two numbers (sleep, confusion, a trap) takes the longest
  }

  randomChance(num, den) {
    if (this.crit !== 'none' && num === 1 && [24, 8, 2, 1].includes(den) && new Error().stack.includes('getDamage')) {
      const side = this.battle?.activePokemon?.side?.id;
      return this.crit === 'both' || this.crit === side;
    }
    return num * 2 > den;
  }
}

/** The pre-turn identity of every Pokémon (its species id), so a form change during the turn does not rename it. */
export function idsOf(battle) {
  const ids = new Map();
  for (const s of battle.sides) for (const p of s.pokemon) ids.set(p, toID(p.species?.name || p.name));
  return ids;
}

export const SIDE_KEYS = ['stealth_rock', 'spikes', 'toxic_spikes', 'sticky_web', 'tailwind', 'reflect', 'light_screen', 'aurora_veil',
  'safeguard', 'mist', 'lucky_chant', 'toxic_count'];
export const BOOST_KEYS = ['attack', 'defense', 'special_attack', 'special_defense', 'speed', 'accuracy', 'evasion'];

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v));

function sideSummary(ms, ids, simSide) {
  const mons = ms.pokemon.map((p, i) => ({...p, id: ids ? ids.get(simSide.pokemon[i]) : p.id}));
  const out = {active: mons[Number(ms.active_index)]?.id ?? null, hp: {}, status: {}, item: {}, tera: []};
  for (const p of mons) {
    out.hp[p.id] = p.hp;
    if (p.status !== 'none' && p.hp > 0) out.status[p.id] = p.status;
    out.item[p.id] = p.item;
    if (p.terastallized && p.hp > 0) out.tera.push(p.id);
  }
  out.tera.sort();
  out.boosts = Object.fromEntries(BOOST_KEYS.map((k) => [k, ms.boosts[k] || 0]));
  out.side = clean(Object.fromEntries(SIDE_KEYS.map((k) => [k, ms.side_conditions[k] || 0])));
  out.volatile = [...ms.volatile_statuses].sort();
  out.sub = ms.substitute_health || 0;
  return out;
}

/** What both engines are reduced to after the turn (the probe builds the same shape from poke-engine's state). A turn that ends the
 * battle stops the simulator before the end-of-turn effects, so only the hit points are kept. */
export function summarize(ms, ids, battle, ends = false) {
  const full = {
    weather: ms.weather, weather_turns: ms.weather_turns_remaining, terrain: ms.terrain, terrain_turns: ms.terrain_turns_remaining,
    trick_room: ms.trick_room, trick_room_turns: ms.trick_room_turns_remaining,
    p1: sideSummary(ms.side_one, ids, battle?.sides[0]), p2: sideSummary(ms.side_two, ids, battle?.sides[1]),
  };
  return ends ? {p1: {hp: full.p1.hp}, p2: {hp: full.p2.hp}} : full;
}

export const category = (id) => Dex.moves.get(id).category;
export {Dex, toID};
