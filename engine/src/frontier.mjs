// A battle's starting state and its end state, for the Battle Frontier facilities that carry things from one battle to the next
// (the Castle: HP, PP; the Arcade's roulette: statuses, lower HP, weather, Trick Room, fog). Browser-safe like match.mjs.
//
// spec.start = {p1: [{hp, maxhp, hp_cut, status, sleep_turns, pp: [...]}, ...], p2: [...], field: {weather, trickroom}}: entry i is
// the i-th set of that side as the battle gets it. It is applied right after the simulator's Battle is created and before the
// first Pokémon come out (the format's onBegin; the field at onBattleStart, after |start|), so the switch-in lines already show the
// HP and status. The state lives in the battle from then on: snapshots keep it, and the input log carries it as a `>silverstart`
// line that battleFromInput reads, so practice branches and replays rebuild the same battle. Levels are not part of it: the app
// writes them in the sets (they go into the packed teams of the input log).
//
// spec.start.owners = {p1: [0|1 for each set], p2: [...]} makes a doubles side a multi battle side: two trainers, each with its own
// Pokémon (owner k plays slot k). See "multi battles" below.
import {Battle, Dex} from '@pkmn/sim';
import {buildFormatId, completeSets, EngineError, importTeam, teamSummary} from './core.mjs';

const STATUSES = new Set(['psn', 'tox', 'par', 'brn', 'slp', 'frz']);
const WEATHERS = {sunnyday: 'sunnyday', sun: 'sunnyday', raindance: 'raindance', rain: 'raindance', sandstorm: 'sandstorm', sand: 'sandstorm',
  hail: 'hail', fog: 'fog'};
const PREFIX = '>silverstart ';

// Generation 4 fog (the Arcade's Fog panel) has no Showdown equivalent. It is a weather of its own here, shown as `|-weather|Fog`:
// every move's accuracy (when it has one) times 3/5, Weather Ball doubled in power (still Normal), Moonlight, Synthesis and Morning
// Sun heal 1/4. Cloud Nine and Air Lock suppress it like any weather and a new weather replaces it. The numbers are the games'
// as generally documented [UNVERIFIED: not read from the decompilation]; Defog does not clear it in battle here.
const FOG = {
  name: 'Fog',
  effectType: 'Weather',
  onModifyAccuracyPriority: -1,
  onModifyAccuracy(accuracy) {
    if (typeof accuracy !== 'number') return;
    return this.chainModify(3, 5);
  },
  onBasePowerPriority: 1,
  onBasePower(basePower, attacker, defender, move) {
    if (move.id === 'weatherball') return this.chainModify(2);
  },
  onTryHeal(damage, target, source, effect) {
    if (effect && ['moonlight', 'synthesis', 'morningsun'].includes(effect.id)) return Math.floor(target.maxhp / 4);
  },
  onFieldResidualOrder: 1,
  onFieldResidual() {
    this.add('-weather', 'Fog', '[upkeep]');
  },
  onFieldEnd() {
    this.add('-weather', 'none');
  },
};

/** Make the fog weather known to the format's generation (once; every battle of that generation can then use and restore it). */
export function prepareFrontierDex(formatId) {
  let dex;
  try { dex = Dex.forFormat(Dex.formats.get(formatId, true)); } catch { return; }
  const conditions = dex.data.Conditions;
  if (!Object.prototype.hasOwnProperty.call(conditions, 'fog')) conditions.fog = FOG;
}

export function hasStart(start) {
  if (!start || typeof start !== 'object') return false;
  const any = (list) => Array.isArray(list) && list.some((x) => x && Object.keys(x).length);
  return any(start.p1) || any(start.p2) || !!(start.field && Object.keys(start.field).length) || !!cleanOwners(start.owners);
}

// ---------------------------------------------------------------- multi battles
// The Frontier's multi battles: you and a partner against two rival trainers, each trainer with its own Pokémon, on a doubles
// field. The battle keeps whose each Pokémon is as `silverOwners` ({p1: [0|1 per set, in the order of the sets], p2: [...]}; owner
// k plays slot k), a plain field that snapshots and the AI's copies keep. A slot is refilled only from its owner's Pokémon and
// stays empty once they are all down, as in the games; a move that switches out or drags in (U-turn, Baton Pass, Roar) only
// brings in one of the owner's, and does nothing when the owner has none left.

function cleanOwners(owners) {
  if (!owners || typeof owners !== 'object') return null;
  const out = {};
  for (const id of ['p1', 'p2']) if (Array.isArray(owners[id]) && owners[id].length) out[id] = owners[id].map((o) => (o ? 1 : 0));
  return Object.keys(out).length ? out : null;
}

function sharedSide(battle, side) {
  return !!(side && side.active && side.active.length > 1 && Array.isArray(battle?.silverOwners?.[side.id]));
}

/** The owner (0 or 1) of a Pokémon of a multi battle side, or -1 when the side is not shared. */
export function ownerOf(side, mon) {
  if (!mon || !sharedSide(side.battle, side)) return -1;
  const k = side.team.indexOf(mon.set);
  return k < 0 ? -1 : side.battle.silverOwners[side.id][k] ? 1 : 0;
}

/** The benched Pokémon that may come in at `slot`: the slot owner's that are not fainted (any of them when the side is not shared). */
export function ownBench(side, slot) {
  const out = [];
  for (let i = side.active.length; i < side.pokemon.length; i++) {
    const p = side.pokemon[i];
    if (!p || p.fainted) continue;
    const o = ownerOf(side, p);
    if (o < 0 || o === slot) out.push(p);
  }
  return out;
}

// After a knockout (or a switch-out move) the simulator asks the side to fill every flagged slot while anything is on its bench;
// here a slot whose owner has nobody left is let go instead, so it stays empty.
const baseCanSwitch = Battle.prototype.canSwitch;
Battle.prototype.canSwitch = function canSwitch(side) {
  const n = baseCanSwitch.call(this, side);
  if (!n || !sharedSide(this, side)) return n;
  let pruned = false;
  side.active.forEach((p, slot) => {
    if (p && p.switchFlag && !ownBench(side, slot).length) {
      p.switchFlag = false;
      pruned = true;
    }
  });
  return pruned && !side.active.some((p) => p && p.switchFlag) ? 0 : n;
};

function readyActions(b) {
  const proto = b && b.actions && Object.getPrototypeOf(b.actions);
  if (!proto || proto.silverDragIn) return;
  const baseDragIn = proto.dragIn;
  proto.silverDragIn = true;
  proto.dragIn = function dragIn(side, pos) {
    if (!sharedSide(this.battle, side)) return baseDragIn.call(this, side, pos);
    const own = ownBench(side, pos);
    if (!own.length) return false;
    const pokemon = this.battle.sample(own);
    const oldActive = side.active[pos];
    if (!oldActive) throw new Error('nothing to drag out');
    if (!oldActive.hp) return false;
    if (!this.battle.runEvent('DragOut', oldActive)) return false;
    return !!this.switchIn(pokemon, pos, null, true);
  };
}

/** Make a battle (new, restored from a snapshot or copied) a multi battle with these owners ({p1, p2}; null leaves it as it is). */
export function useOwners(b, owners) {
  const clean = cleanOwners(owners || b?.silverOwners);
  if (!b || !clean) return b;
  b.silverOwners = clean;
  readyActions(b);
  return b;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function applyMon(b, p, st) {
  if (Number.isFinite(st.hp_cut) && st.hp_cut > 0) {
    // the Arcade's Lower HP: maxHp - ((u32)((double)maxHp * 1.2) - maxHp), with 0.2 for the cut
    p.hp = clamp(p.maxhp - (Math.floor(p.maxhp * (1 + st.hp_cut)) - p.maxhp), 1, p.maxhp);
  }
  if (Number.isFinite(st.hp)) {
    const hp = st.maxhp && st.maxhp !== p.maxhp ? Math.round((st.hp * p.maxhp) / st.maxhp) : st.hp;
    p.hp = clamp(Math.floor(hp), 1, p.maxhp);
  }
  if (STATUSES.has(st.status)) {
    p.status = st.status;
    p.statusState = b.initEffectState({id: st.status, target: p});
    if (st.status === 'slp') p.statusState.time = clamp(Math.floor(Number(st.sleep_turns) || 3), 1, 7);
    if (st.status === 'tox') p.statusState.stage = 0;
  }
  if (Array.isArray(st.pp)) {
    st.pp.forEach((v, i) => {
      const slot = p.baseMoveSlots[i];
      if (slot && Number.isFinite(v)) slot.pp = clamp(Math.floor(v), 0, slot.maxpp);
    });
  }
}

function applyMons(b, start) {
  for (const side of b.sides) {
    const list = side && start[side.id];
    if (!Array.isArray(list)) continue;
    side.pokemon.forEach((p, i) => { if (list[i] && typeof list[i] === 'object') applyMon(b, p, list[i]); });
  }
}

function applyField(b, field) {
  if (!field) return;
  const w = WEATHERS[String(field.weather || '').toLowerCase()];
  if (w) {
    if (w === 'fog') prepareFrontierDex(b.format.id);
    b.field.weather = w;
    b.field.weatherState = b.initEffectState({id: w});   // no duration: it lasts the whole battle unless replaced
    b.add('-weather', b.dex.conditions.get(w).name);
  }
  const tr = Math.floor(Number(field.trickroom) || 0);
  if (tr > 0) {
    b.field.pseudoWeather.trickroom = b.initEffectState({id: 'trickroom', duration: clamp(tr, 1, 99)});
    b.add('-fieldstart', 'move: Trick Room');
  }
}

/** new Battle(options), with `start` applied when there is one. */
export function newBattle(options, start = null) {
  if (!hasStart(start)) return new Battle(options);
  const base = Dex.formats.get(options.formatid, true);
  const format = Object.create(base);
  const owners = cleanOwners(start.owners);
  format.onBegin = function () {
    if (owners) useOwners(this, owners);   // before anybody can switch
    base.onBegin?.call(this);
    applyMons(this, start);
  };
  format.onBattleStart = function () { base.onBattleStart?.call(this); applyField(this, start.field); };
  const b = new Battle({...options, format});
  b.inputLog.push(PREFIX + JSON.stringify(start));
  return b;
}

/** The start state a battle's input log carries, or null. */
export function startFromInput(input) {
  const line = (Array.isArray(input) ? input : []).find((l) => typeof l === 'string' && l.startsWith(PREFIX));
  return line ? JSON.parse(line.slice(PREFIX.length)) : null;
}

/** Each side's Pokémon as the battle left them, in the order of the sets it was given (unpicked ones are absent). */
export function endState(b) {
  const out = {turns: b.turn};
  for (const side of b.sides) {
    if (!side) continue;
    const mons = side.pokemon.map((p) => {
      let index = side.team.indexOf(p.set);
      if (index < 0) index = side.team.findIndex((s) => s.species === p.set.species && (s.name || '') === (p.set.name || ''));
      return {index, species: p.species.name, level: p.level, hp: p.fainted ? 0 : p.hp, maxhp: p.maxhp, fainted: !!p.fainted,
        status: p.fainted ? '' : p.status || '', item: p.item ? b.dex.items.get(p.item).name : '',
        moves: p.baseMoveSlots.map((m) => m.move), pp: p.baseMoveSlots.map((m) => m.pp), maxpp: p.baseMoveSlots.map((m) => m.maxpp)};
    });
    out[side.id] = mons.sort((a, c) => a.index - c.index);
  }
  return out;
}

/** What the facilities need to know of some sets before a battle: species, its number and types in that generation, the ability
 * the battle will use, level, stats, held item, and each move with its PP as the battle counts them. */
export function frontierParty(sets, format = 'gen4customgame') {
  const formatId = buildFormatId(format || 'gen4customgame');
  const dex = Dex.forFormat(Dex.formats.get(formatId, true));
  const complete = completeSets(importTeam(sets), formatId);
  const summary = teamSummary(complete, formatId);
  return complete.map((s, i) => {
    const sp = dex.species.get(s.species);
    if (!sp.exists) throw new EngineError('unknown_species', `Unknown Pokémon: ${s.species}`, {species: s.species});
    return {species: sp.name, num: sp.num, gen: sp.gen || 0, types: sp.types.slice(), ability: s.ability ? dex.abilities.get(s.ability).name : '',
      level: s.level || 100, stats: summary[i].stats, maxhp: summary[i].stats.hp, item: s.item ? dex.items.get(s.item).name : '',
      nature: s.nature || '', moves: s.moves.map((m) => {
        const mv = dex.moves.get(m);
        return {id: mv.id, name: mv.exists ? mv.name : m, type: mv.type || '', gen: mv.gen || 0,
          pp: mv.exists ? (mv.noPPBoosts ? mv.pp : Math.floor((mv.pp * 8) / 5)) : 0};
      })};
  });
}
