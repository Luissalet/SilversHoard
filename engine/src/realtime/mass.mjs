// Mass battles ("batalla campal"): dozens to hundreds of Pokémon on one field at once, every one of them driven by its own AI,
// in the style of the big battle simulators: everybody against everybody, teams (two armies, nine generations...) or a few
// giants against a crowd. Separate from the one-on-one real-time battles (sim.mjs): no trainers, no switching, no inputs.
//
// The rules borrow from real time: the moves are the same profiles (moves.mjs: cooldown, wind-up, shape, reach), damage follows the
// games' formula with types, STAB, critical hits, a handful of abilities and the common statuses, and there is no accuracy: a move
// hits whoever is where it lands. Every Pokémon picks the nearest worthwhile foe, walks into range of its best ready move, winds up
// and releases it; crowds push each other apart.
//
// Deterministic: the same spec (seed included) gives the same battle in the engine process and in a browser, which is how the screen
// replays a battle the app already ran and how the result is checked. Units are always processed in index order and every random
// draw comes from the battle's own generator.
import {Dex} from '@pkmn/sim';
import {RtError, rtFormatId, rtGen, rtSets} from './team.mjs';
import {makeRng} from '../ai.mjs';
import {finalCooldown, rtMove, TPS} from './moves.mjs';

export {TPS};
export const MASS_VERSION = 1;
export const MASS_MODES = ['ffa', 'teams', 'boss'];
export const MASS_MAX_UNITS = 1100;            // the whole National Dex (1025) fits
export const MASS_MAX_TEAMS = 16;
export const MASS_FLOORS = ['grass', 'sand', 'ice', 'cave', 'indoor', 'water', 'pyre', 'summit', 'meteor', 'champion', 'castle'];
export const MASS_COLORS = ['#3d8bfd', '#e5484d', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#ad7f58', '#6e56cf',
  '#ff8b3e', '#0090ff', '#46a758', '#d6409f', '#978365', '#5b5bd6', '#e54d2e'];
export const MASS_DEFAULT_SECONDS = 180;

const RESIDUAL_TICKS = 4 * TPS;          // burn and poison chip every 4 s
const BOOST_TICKS = 20 * TPS;            // stat changes last 20 s, as in real time
const STATUS_TICKS = {brn: 20 * TPS, par: 20 * TPS, psn: 20 * TPS, tox: 20 * TPS, slp: Math.round(2.5 * TPS), frz: 2 * TPS};
const THINK_EVERY = 8;                   // ticks between target choices (staggered over the units)
const CELL = 3;                          // meters per cell of the neighbour grid
const MAX_VICTIMS = 8;                   // most units one area move can hit
const SPREAD = 0.75;                     // an area move that hits more than one unit does three quarters of the damage
const DAMAGE_SCALE = 0.22;               // crowds focus their attacks: every hit does less, so fights last long enough to watch
const DROP_DELAY = 15;                   // ticks between marking a spot and the move landing there
const RECOVER_TICKS = 6;                 // after releasing a move, a short pause before the next decision
const RECHARGE_TICKS = Math.round(1.5 * TPS);
const STALEMATE_TICKS = 20 * TPS;        // a few left who cannot hurt each other (a Ghost and a Normal type, healers): 20 s with no damage ends it
const HEALS = new Set(['recover', 'roost', 'softboiled', 'milkdrink', 'slackoff', 'synthesis', 'moonlight', 'morningsun', 'shoreup',
  'healorder', 'rest', 'wish', 'strengthsap', 'lunarblessing', 'junglehealing', 'lifedew']);
const STATUS_IMMUNE = {brn: ['Fire'], par: ['Electric'], psn: ['Poison', 'Steel'], tox: ['Poison', 'Steel'], frz: ['Ice'], slp: []};
const STAGE = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const NATURE_STATS = ['atk', 'def', 'spa', 'spd', 'spe'];

/** The stats of a set at its level (the games' formula, with nature, EVs and IVs). */
function statsOf(dex, sp, set) {
  const nat = dex.natures.get(set.nature || 'Serious');
  const out = {};
  for (const k of ['hp', ...NATURE_STATS]) {
    const base = sp.baseStats[k];
    const iv = set.ivs?.[k] ?? 31;
    const ev = set.evs?.[k] ?? 0;
    const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * set.level) / 100);
    if (k === 'hp') { out.hp = sp.id === 'shedinja' ? 1 : core + set.level + 10; continue; }
    let v = core + 5;
    if (nat?.exists && nat.plus === k) v = Math.floor(v * 1.1);
    if (nat?.exists && nat.minus === k) v = Math.floor(v * 0.9);
    out[k] = v;
  }
  return out;
}

/** What a move can do in a mass battle: damage, or a few kinds of status move (healing, raising the user's stats, a status on the
 * foe). The rest are left out of the Pokémon's choices. */
function kindOf(p) {
  if (!p || p.noEffect) return '';
  if (p.category !== 'Status') return p.power > 0 || p.damage ? 'attack' : '';
  if (HEALS.has(p.id) || (p.heal && p.shape === 'self')) return 'heal';
  if (p.shape === 'self' && (p.selfBoosts || p.boosts)) return 'boost';
  if (p.status && ['brn', 'par', 'psn', 'tox', 'slp', 'frz'].includes(p.status)) return 'status';
  return '';
}

/** Arena size for a number of units: about seven square meters each, never smaller than the one-on-one court. */
export function massArena(n) {
  const area = Math.max(28 * 17, n * 7);
  const w = Math.round(Math.sqrt(area * 1.6) * 10) / 10;
  return {w, h: Math.round((w / 1.6) * 10) / 10};
}

/** Where each unit starts: a shuffled spread over the field (everybody against everybody), blocks on opposite sides or around a
 * circle (teams), the giants on one side and the crowd on the other (boss). */
function formation(spec, units, arena, rng) {
  const {w, h} = arena;
  const teams = new Map();
  for (const u of units) { if (!teams.has(u.team)) teams.set(u.team, []); teams.get(u.team).push(u); }
  const ids = [...teams.keys()];
  const block = (list, cx, cy, bw, bh) => {
    const cols = Math.max(1, Math.round(Math.sqrt((list.length * bw) / Math.max(1, bh))));
    const rows = Math.ceil(list.length / cols);
    list.forEach((u, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      u.x = cx + (cols > 1 ? (c / (cols - 1) - 0.5) * bw : 0) + (rng() - 0.5) * 0.3;
      u.y = cy + (rows > 1 ? (r / (rows - 1) - 0.5) * bh : 0) + (rng() - 0.5) * 0.3;
    });
  };
  if (spec.mode === 'ffa' || ids.length > 8 && spec.mode !== 'boss') {
    // a grid over the whole field with the order shuffled, so neighbours at the start are random
    const order = units.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    if (spec.mode === 'ffa') { block(order, w / 2, h / 2, w - 4, h - 4); return; }
    // many teams: each team on its own row band, like the videos' lines of Poké Balls
    ids.forEach((id, k) => block(teams.get(id), w / 2, 2 + ((h - 4) * (k + 0.5)) / ids.length, w - 6, Math.max(0.5, (h - 4) / ids.length - 1.2)));
    return;
  }
  if (spec.mode === 'boss') {
    const giants = units.filter((u) => u.boss);
    const crowd = units.filter((u) => !u.boss);
    block(giants, w * 0.8, h / 2, 0, Math.min(h - 6, giants.length * 4));
    block(crowd, w * 0.3, h / 2, w * 0.4, h - 4);
    return;
  }
  if (ids.length === 2) {
    block(teams.get(ids[0]), w * 0.2, h / 2, w * 0.25, h - 4);
    block(teams.get(ids[1]), w * 0.8, h / 2, w * 0.25, h - 4);
    return;
  }
  // three to eight teams: blocks around a circle
  ids.forEach((id, k) => {
    const a = (k / ids.length) * Math.PI * 2;
    const list = teams.get(id);
    const size = Math.max(2, Math.sqrt(list.length) * 1.4);
    block(list, w / 2 + Math.cos(a) * (w / 2 - size - 1.5), h / 2 + Math.sin(a) * (h / 2 - size - 1.5), size, size);
  });
}

export class MassBattle {
  /**
   * spec: {id, seed, format, level_rules, mode: ffa|teams|boss, time_limit (s), floor,
   *        teams: [{name, color, units: [{set, boss: {hp, size, power} | null}]}]}
   */
  constructor(spec) {
    this.spec = {...spec};
    this.id = spec.id || `mass${Date.now().toString(36)}`;
    this.seed = String(spec.seed || this.id);
    this.spec.seed = this.seed;
    this.version = MASS_VERSION;
    this.mode = MASS_MODES.includes(spec.mode) ? spec.mode : 'ffa';
    this.formatId = rtFormatId(spec.format || 'gen9customgame');
    this.gen = rtGen(this.formatId);
    this.dex = Dex.forGen(this.gen);
    this.rng = makeRng(`${this.seed}:mass`);
    this.timeLimit = Math.max(30, Math.min(1800, Number(spec.time_limit) || MASS_DEFAULT_SECONDS)) * TPS;
    this.floor = MASS_FLOORS.includes(spec.floor) ? spec.floor : 'grass';
    const teams = (spec.teams || []).filter((t) => t && (t.units || []).length);
    if (!teams.length) throw new RtError('invalid', 'A mass battle needs at least one team with Pokémon.');
    if (teams.length > MASS_MAX_TEAMS && this.mode !== 'ffa') throw new RtError('invalid', `At most ${MASS_MAX_TEAMS} teams.`);
    this.teams = [];
    this.units = [];
    const levelRules = spec.level_rules || {};
    teams.forEach((t, ti) => {
      const sets = rtSets(t.units.map((x) => x.set || x), this.formatId, levelRules);
      sets.forEach((set, k) => {
        const raw = t.units[k] || {};
        if (this.mode === 'ffa') {
          // everybody against everybody: every Pokémon is its own team, named after itself
          this.teams.push({name: set.name || this.dex.species.get(set.species).name, color: MASS_COLORS[this.teams.length % MASS_COLORS.length], from: ti});
          this.units.push(this.makeUnit(set, this.teams.length - 1, null));
        } else {
          if (k === 0) this.teams.push({name: String(t.name || `Equipo ${ti + 1}`).slice(0, 40), color: t.color || MASS_COLORS[ti % MASS_COLORS.length], from: ti});
          this.units.push(this.makeUnit(set, this.teams.length - 1, raw.boss || null));
        }
      });
    });
    if (this.units.length > MASS_MAX_UNITS) throw new RtError('invalid', `At most ${MASS_MAX_UNITS} Pokémon in a mass battle.`);
    if (this.teams.length < 2) throw new RtError('invalid', 'A mass battle needs at least two sides.');
    this.units.forEach((u, i) => { u.i = i; });
    this.arena = spec.arena && spec.arena.w ? {w: Number(spec.arena.w), h: Number(spec.arena.h)} : massArena(this.units.length);
    formation({mode: this.mode}, this.units, this.arena, makeRng(`${this.seed}:formation`));
    for (const u of this.units) { u.x = Math.min(this.arena.w - u.r, Math.max(u.r, u.x)); u.y = Math.min(this.arena.h - u.r, Math.max(u.r, u.y)); }
    this.t = 0;
    this.events = [];
    this.projectiles = [];
    this.marks = [];
    this.beams = [];             // drawn for a few frames; they hit at once
    this.ended = false;
    this.winner = -1;            // team index, or -1 (none yet / tie)
    this.reason = '';
    this.order = [];             // units in the order they fainted
    this.grid = new Map();
    this.lastDamage = 0;
  }

  makeUnit(set, team, boss) {
    const sp = this.dex.species.get(set.species);
    if (!sp.exists) throw new RtError('unknown_species', `Unknown Pokémon: ${set.species}`, {species: set.species});
    const stats = statsOf(this.dex, sp, set);
    const b = boss ? {hp: Math.max(1, Math.min(200, Number(boss.hp) || 1)), size: Math.max(1, Math.min(5, Number(boss.size) || 2.5)),
      power: Math.max(0.5, Math.min(5, Number(boss.power) || 1.5))} : null;
    const maxhp = Math.max(1, Math.round(stats.hp * (b ? b.hp : 1)));
    let moves = (set.moves || []).map((m) => rtMove(m, this.gen)).filter((p) => kindOf(p));
    if (!moves.some((p) => kindOf(p) === 'attack')) moves = [...moves.slice(0, 3), rtMove('struggle', this.gen)];
    moves = moves.slice(0, 4);
    const ability = this.dex.abilities.get(set.ability || sp.abilities?.['0'] || '');
    const size = (b ? b.size : 1);
    return {
      i: 0, team, species: sp.name, base_species: sp.baseSpecies, num: sp.num, forme: sp.forme || '', sprite_id: sp.spriteid,
      name: set.name || sp.name, level: set.level, shiny: !!set.shiny, types: sp.types.slice(), stats, ability: ability.exists ? ability.id : '',
      boss: b, size, r: Math.min(2.6, Math.max(0.3, 0.28 + Math.min(4, sp.heightm || 1) * 0.11) * size),
      walk: Math.max(2.4, Math.min(5.5, 2 + sp.baseStats.spe / 38)) * (b ? 0.75 : 1),
      moves, cds: moves.map(() => 0), kinds: moves.map(kindOf),
      final: moves.map((p) => Math.round(finalCooldown(p.cooldown, stats.spe, {priority: p.priority}) * TPS)),
      maxhp, hp: maxhp, x: 0, y: 0, fx: 1, fy: 0, target: -1, act: null, busyUntil: 0, moving: false,
      status: '', statusUntil: 0, toxN: 0, nextChip: 0, boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}, boostUntil: 0,
      fainted: false, diedAt: 0, killer: -1, kos: 0, dealt: 0, taken: 0, uses: 0, boostsUsed: 0,
    };
  }

  // ------------------------------------------------------------ helpers
  ev(k, data = {}) { const e = {t: this.t, k, ...data}; this.events.push(e); return e; }
  foes(a, b) { return a.team !== b.team; }
  alive(u) { return !u.fainted; }
  dist2(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return dx * dx + dy * dy; }

  rebuildGrid() {
    this.grid.clear();
    for (const u of this.units) {
      if (u.fainted) continue;
      const key = Math.floor(u.x / CELL) * 4096 + Math.floor(u.y / CELL);
      let cell = this.grid.get(key);
      if (!cell) { cell = []; this.grid.set(key, cell); }
      cell.push(u);
    }
  }

  /** Units within `rad` meters of (x, y), in index order. */
  near(x, y, rad) {
    const out = [];
    const c0 = Math.floor((x - rad) / CELL);
    const c1 = Math.floor((x + rad) / CELL);
    const r0 = Math.floor((y - rad) / CELL);
    const r1 = Math.floor((y + rad) / CELL);
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
      const cell = this.grid.get(c * 4096 + r);
      if (cell) for (const u of cell) out.push(u);
    }
    out.sort((a, b) => a.i - b.i);
    const r2 = rad * rad;
    return out.filter((u) => { const dx = u.x - x; const dy = u.y - y; return dx * dx + dy * dy <= r2 + u.r * u.r * 2; });
  }

  effectiveness(type, def) {
    if (!type || type === '???') return 1;
    if (!this.dex.getImmunity(type, def.types)) return 0;
    const ab = def.ability;
    if ((ab === 'levitate' && type === 'Ground') || (ab === 'flashfire' && type === 'Fire')
      || (['waterabsorb', 'stormdrain', 'dryskin'].includes(ab) && type === 'Water')
      || (['voltabsorb', 'lightningrod', 'motordrive'].includes(ab) && type === 'Electric')
      || (ab === 'sapsipper' && type === 'Grass') || (ab === 'eartheater' && type === 'Ground')) return 0;
    const e = 2 ** this.dex.getEffectiveness(type, def.types);
    if (ab === 'wonderguard' && e <= 1) return 0;
    return e;
  }

  /** Damage of a move from `att` on `def` (the games' formula; `expected` leaves out chance for the AI's estimates). */
  damage(att, def, p, {spread = false, expected = false} = {}) {
    if (p.damage === 'level') return att.level;
    if (typeof p.damage === 'number') return p.damage;
    const eff = this.effectiveness(p.type, def);
    if (!eff) return 0;
    const physical = p.category === 'Physical';
    const ak = p.overrideOffensiveStat || (physical ? 'atk' : 'spa');
    const dk = p.overrideDefensiveStat || (physical ? 'def' : 'spd');
    let A = att.stats[ak] * STAGE(att.boosts[ak] || 0);
    const D = Math.max(1, def.stats[dk] * STAGE(def.boosts[dk] || 0));
    if (physical && ['hugepower', 'purepower'].includes(att.ability)) A *= 2;
    if (physical && att.status === 'brn' && att.ability !== 'guts') A *= 0.5;
    if (att.ability === 'guts' && att.status) A *= 1.5;
    let power = p.power;
    if (att.ability === 'technician' && power <= 60) power *= 1.5;
    let dmg = Math.floor(Math.floor(Math.floor((2 * att.level) / 5 + 2) * power * A / D) / 50) + 2;
    if (spread) dmg *= typeof spread === 'number' ? Math.max(0.4, SPREAD - 0.05 * (spread - 2)) : SPREAD;
    const crit = !expected && this.rng() < (p.crit >= 3 ? 1 : p.crit >= 2 ? 0.5 : p.crit >= 1 ? 0.125 : 1 / 24);
    if (crit) dmg *= 1.5;
    dmg *= expected ? 0.925 : 0.85 + this.rng() * 0.15;
    if (att.types.includes(p.type)) dmg *= att.ability === 'adaptability' ? 2 : 1.5;
    dmg *= eff;
    if (def.ability === 'thickfat' && (p.type === 'Fire' || p.type === 'Ice')) dmg *= 0.5;
    if (def.ability === 'multiscale' && def.hp === def.maxhp) dmg *= 0.5;
    dmg *= p.hits || 1;
    if (att.boss) dmg *= att.boss.power;
    dmg *= DAMAGE_SCALE;
    return Math.max(1, Math.floor(dmg)) * (crit ? -1 : 1);   // negative marks a critical hit; callers take Math.abs
  }

  // ------------------------------------------------------------ the AI
  /** The foe a unit goes for: the closest, a little less close if it resists this unit's attacks, closer if it is already hurt. */
  pickTarget(u) {
    let best = null;
    let bestScore = Infinity;
    const look = (list) => {
      for (const f of list) {
        if (f.fainted || !this.foes(u, f)) continue;
        const d = Math.sqrt(this.dist2(u, f)) - f.r;
        let eff = 0;
        for (let s = 0; s < u.moves.length; s++) if (u.kinds[s] === 'attack') eff = Math.max(eff, this.effectiveness(u.moves[s].type, f));
        const score = d + (eff === 0 ? 30 : eff < 1 ? 4 : eff > 1 ? -2.5 : 0) + 3 * (f.hp / f.maxhp) - (f.boss ? 1.5 : 0);
        if (score < bestScore) { bestScore = score; best = f; }
      }
    };
    for (const rad of [6, 14]) {
      look(this.near(u.x, u.y, rad));
      if (best) return best;
    }
    look(this.units);
    return best;
  }

  reachOf(u, p) {
    if (p.shape === 'burst') return p.radius * u.size;
    if (p.shape === 'strike' || p.shape === 'cone') return p.reach * Math.max(1, u.size * 0.8) + u.r;
    if (p.shape === 'dash') return p.reach;
    return p.reach;
  }

  /** The move a unit uses now on its target (slot), or -1 when nothing ready reaches it. */
  chooseMove(u, f) {
    const d = Math.sqrt(this.dist2(u, f)) - f.r;
    let best = -1;
    let bestValue = 0;
    for (let s = 0; s < u.moves.length; s++) {
      if (u.cds[s] > this.t) continue;
      const p = u.moves[s];
      const kind = u.kinds[s];
      let value = 0;
      if (kind === 'attack') {
        if (d > this.reachOf(u, p)) continue;
        value = Math.abs(this.damage(u, f, p, {expected: true})) / Math.max(1, f.hp);
        if (p.shape === 'burst' || p.shape === 'cone') {
          const crowd = this.near(u.x, u.y, this.reachOf(u, p)).filter((o) => !o.fainted && this.foes(u, o)).length;
          value *= Math.min(4, Math.max(1, crowd) * SPREAD);
        }
        if (p.selfdestruct) value *= u.hp / u.maxhp < 0.3 ? 1 : 0.1;
        if (p.recoil) value *= 0.85;
      } else if (kind === 'heal') {
        value = u.hp / u.maxhp < 0.45 ? 0.9 : 0;
      } else if (kind === 'boost') {
        value = u.boostsUsed < 2 && u.boostUntil <= this.t && d > 2.5 ? 0.35 : 0;
      } else if (kind === 'status') {
        if (f.status || d > p.reach || STATUS_IMMUNE[p.status]?.some((t) => f.types.includes(t))) continue;
        value = f.boss ? 0.5 : 0.25;
      }
      if (value > bestValue) { bestValue = value; best = s; }
    }
    return best;
  }

  /** How far a unit wants to stand from its target: in touch for strikes, at a good distance for everything else. */
  wantDistance(u) {
    let melee = false;
    let far = 0;
    for (let s = 0; s < u.moves.length; s++) {
      if (u.kinds[s] !== 'attack') continue;
      const p = u.moves[s];
      if (['strike', 'dash', 'cone', 'burst'].includes(p.shape)) melee = true;
      else far = Math.max(far, p.reach);
    }
    if (melee) return 0.6;
    return far ? Math.min(far * 0.55, 9) : 0.6;
  }

  // ------------------------------------------------------------ the tick
  step() {
    if (this.ended) return;
    this.t++;
    this.rebuildGrid();
    for (const u of this.units) if (!u.fainted) this.updateUnit(u);
    this.updateProjectiles();
    this.updateMarks();
    this.beams = this.beams.filter((b) => b.until > this.t);
    this.checkEnd();
  }

  updateUnit(u) {
    const t = this.t;
    // timers: statuses, chip damage, stat changes
    if (u.status && u.statusUntil && t >= u.statusUntil) { this.ev('cure', {u: u.i, status: u.status}); u.status = ''; u.toxN = 0; }
    if ((u.status === 'brn' || u.status === 'psn' || u.status === 'tox') && t >= u.nextChip) {
      u.nextChip = t + RESIDUAL_TICKS;
      const frac = u.status === 'brn' ? 1 / 16 : u.status === 'psn' ? 1 / 8 : Math.min(15, ++u.toxN) / 16;
      this.hurt(u, Math.max(1, Math.floor((u.maxhp / (u.boss ? u.boss.hp : 1)) * frac)), -1, null, {chip: u.status});
      if (u.fainted) return;
    }
    if (u.boostUntil && t >= u.boostUntil) { u.boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}; u.boostUntil = 0; }
    if (u.status === 'slp' || u.status === 'frz') { u.moving = false; return; }
    // a move being wound up goes off when its time comes
    if (u.act) {
      if (t >= u.act.release) this.release(u);
      u.moving = false;
      return;
    }
    if (t < u.busyUntil) { u.moving = false; return; }
    // choose a target now and then (or when the one it had is gone)
    let f = u.target >= 0 ? this.units[u.target] : null;
    if (!f || f.fainted || (t + u.i) % THINK_EVERY === 0) {
      f = this.pickTarget(u);
      u.target = f ? f.i : -1;
    }
    if (!f) { u.moving = false; return; }
    const dx = f.x - u.x;
    const dy = f.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    u.fx = dx / d;
    u.fy = dy / d;
    const slot = this.chooseMove(u, f);
    if (slot >= 0) { this.windup(u, slot, f); u.moving = false; return; }
    // walk: closer for strikes, to a good distance for the rest; crowds push apart
    const want = this.wantDistance(u) + u.r + f.r;
    let mx = 0;
    let my = 0;
    if (d > want + 0.3) { mx = u.fx; my = u.fy; } else if (d < want * 0.5 && want > 2) { mx = -u.fx * 0.6; my = -u.fy * 0.6; }
    let px = 0;
    let py = 0;
    for (const o of this.near(u.x, u.y, u.r + 1.2)) {
      if (o === u || o.fainted) continue;
      const ox = u.x - o.x;
      const oy = u.y - o.y;
      const od = Math.sqrt(ox * ox + oy * oy) || 0.001;
      const overlap = u.r + o.r + 0.1 - od;
      if (overlap > 0) { const k = overlap / od * (o.boss && !u.boss ? 2 : u.boss && !o.boss ? 0.2 : 1); px += ox * k; py += oy * k; }
    }
    const speed = (u.walk * STAGE(u.boosts.spe || 0) * (u.status === 'par' ? 0.5 : 1)) / TPS;
    let vx = mx * speed + px * 0.25;
    let vy = my * speed + py * 0.25;
    const v = Math.sqrt(vx * vx + vy * vy);
    const cap = speed * 1.6 + 0.02;
    if (v > cap) { vx = (vx / v) * cap; vy = (vy / v) * cap; }
    u.moving = Math.abs(mx) + Math.abs(my) > 0;
    u.x = Math.min(this.arena.w - u.r, Math.max(u.r, u.x + vx));
    u.y = Math.min(this.arena.h - u.r, Math.max(u.r, u.y + vy));
  }

  windup(u, slot, f) {
    const p = u.moves[slot];
    // aimed where the target will be when the move gets there (a little ahead of a walking target)
    const lead = p.speed ? Math.min(1, Math.sqrt(this.dist2(u, f)) / p.speed) * 0.5 : 0;
    const tx = f.x + (f.moving ? f.fx * f.walk * lead : 0);
    const ty = f.y + (f.moving ? f.fy * f.walk * lead : 0);
    u.act = {slot, release: this.t + Math.max(1, Math.round(p.windup * (u.boss ? 0.7 : 1))), target: f.i, tx, ty};
    u.cds[slot] = this.t + u.final[slot] * (u.status === 'par' ? 1.5 : 1);
    u.uses++;
    this.ev('use', {u: u.i, slot, move: p.name, type: p.type, shape: p.shape, target: f.i});
  }

  release(u) {
    const {slot, target, tx, ty} = u.act;
    u.act = null;
    u.busyUntil = this.t + RECOVER_TICKS;
    const p = u.moves[slot];
    const kind = u.kinds[slot];
    const f = this.units[target];
    if (kind === 'heal') {
      const frac = p.id === 'rest' ? 1 : p.heal ? p.heal[0] / p.heal[1] : 0.5;
      this.heal(u, Math.floor(u.maxhp * frac * (u.boss ? 0.3 : 1)));
      if (p.id === 'rest') this.setStatus(u, 'slp', {force: true, ticks: 3 * TPS});
      return;
    }
    if (kind === 'boost') {
      const b = p.selfBoosts || p.boosts || {};
      for (const k of Object.keys(b)) if (k in u.boosts) u.boosts[k] = Math.max(-2, Math.min(2, u.boosts[k] + Math.sign(b[k]) * Math.min(2, Math.abs(b[k]))));
      u.boostUntil = this.t + BOOST_TICKS;
      u.boostsUsed++;
      this.ev('boost', {u: u.i, boosts: b});
      return;
    }
    const ax = tx - u.x;
    const ay = ty - u.y;
    const ad = Math.sqrt(ax * ax + ay * ay) || 0.0001;
    const dirx = ax / ad;
    const diry = ay / ad;
    u.fx = dirx;
    u.fy = diry;
    switch (p.shape) {
      case 'strike':
      case 'cone': {
        const reach = this.reachOf(u, p);
        const arc = p.shape === 'cone' ? p.arc : Math.min(p.arc, 0.3);
        const hits = this.near(u.x, u.y, reach + 1.5).filter((o) => {
          if (o.fainted || !this.foes(u, o)) return false;
          const ox = o.x - u.x;
          const oy = o.y - u.y;
          const od = Math.sqrt(ox * ox + oy * oy) || 0.001;
          return od - o.r <= reach && (ox * dirx + oy * diry) / od >= arc;
        });
        hits.sort((a, b) => this.dist2(u, a) - this.dist2(u, b));
        const list = p.shape === 'strike' ? hits.slice(0, u.boss ? 4 : 1) : hits.slice(0, MAX_VICTIMS);
        this.ev('swing', {u: u.i, move: p.name, type: p.type, shape: p.shape, reach, dx: dirx, dy: diry});
        for (const o of list) this.hit(u, o, p, {spread: list.length > 1 ? list.length : false});
        break;
      }
      case 'dash': {
        // a charge along the line to the target, stopping at the first foe in the way
        const reach = Math.min(p.reach, ad + 0.5);
        let stop = reach;
        let victim = null;
        for (const o of this.near(u.x + dirx * reach / 2, u.y + diry * reach / 2, reach / 2 + 2)) {
          if (o.fainted || !this.foes(u, o)) continue;
          const ox = o.x - u.x;
          const oy = o.y - u.y;
          const along = ox * dirx + oy * diry;
          const side = Math.abs(ox * diry - oy * dirx);
          if (along > 0 && along <= reach + o.r && side <= o.r + u.r && along - o.r < stop) { stop = Math.max(0, along - o.r - u.r); victim = o; }
        }
        const fromx = u.x;
        const fromy = u.y;
        u.x = Math.min(this.arena.w - u.r, Math.max(u.r, u.x + dirx * stop));
        u.y = Math.min(this.arena.h - u.r, Math.max(u.r, u.y + diry * stop));
        this.ev('dash', {u: u.i, move: p.name, type: p.type, x0: fromx, y0: fromy, x1: u.x, y1: u.y});
        if (victim) this.hit(u, victim, p);
        break;
      }
      case 'burst': {
        const rad = p.radius * u.size;
        const list = this.near(u.x, u.y, rad + 1).filter((o) => !o.fainted && this.foes(u, o) && Math.sqrt(this.dist2(u, o)) - o.r <= rad).slice(0, u.boss ? MAX_VICTIMS * 3 : MAX_VICTIMS);
        this.ev('burst', {u: u.i, move: p.name, type: p.type, x: u.x, y: u.y, r: rad});
        for (const o of list) this.hit(u, o, p, {spread: list.length > 1 ? list.length : false});
        if (p.selfdestruct && !u.boss) this.faint(u, -1);
        break;
      }
      case 'beam': {
        // instant, along a straight line: the first foe on it (a giant's beam goes through several)
        const reach = p.reach;
        const width = (p.radius || 0.5) * (u.boss ? Math.min(2.5, u.size * 0.6) : 1);
        const cands = this.near(u.x + dirx * reach / 2, u.y + diry * reach / 2, reach / 2 + 2).filter((o) => {
          if (o.fainted || !this.foes(u, o)) return false;
          const ox = o.x - u.x;
          const oy = o.y - u.y;
          const along = ox * dirx + oy * diry;
          return along > 0 && along <= reach + o.r && Math.abs(ox * diry - oy * dirx) <= width + o.r;
        });
        cands.sort((a, b) => ((a.x - u.x) * dirx + (a.y - u.y) * diry) - ((b.x - u.x) * dirx + (b.y - u.y) * diry));
        const list = cands.slice(0, u.boss ? 8 : 1);
        const end = list.length && !u.boss ? (list[0].x - u.x) * dirx + (list[0].y - u.y) * diry : reach;
        this.beams.push({u: u.i, type: p.type, x0: u.x, y0: u.y, x1: u.x + dirx * end, y1: u.y + diry * end, w: width, until: this.t + 8});
        this.ev('beam', {u: u.i, move: p.name, type: p.type, x0: u.x, y0: u.y, x1: u.x + dirx * end, y1: u.y + diry * end, w: width});
        for (const o of list) this.hit(u, o, p, {spread: list.length > 1 ? list.length : false});
        break;
      }
      case 'drop': {
        const rad = p.radius * (u.boss ? Math.min(3, u.size) : 1);
        this.marks.push({u: u.i, slot, x: tx, y: ty, r: rad, land: this.t + DROP_DELAY, type: p.type, move: p.name});
        this.ev('mark', {u: u.i, move: p.name, type: p.type, x: tx, y: ty, r: rad});
        break;
      }
      default: {
        // shot, wave and status moves aimed at a foe: a projectile that hits the first foe it touches
        const speed = (p.speed || 13) / TPS;
        this.projectiles.push({u: u.i, team: u.team, slot, x: u.x + dirx * u.r, y: u.y + diry * u.r, vx: dirx * speed, vy: diry * speed,
          left: (p.reach || 14) / speed, r: (p.radius || 0.45) * (u.boss ? Math.min(2.5, u.size * 0.7) : 1), type: p.type, kind});
        this.ev('shot', {u: u.i, move: p.name, type: p.type});
      }
    }
    if (p.recharge) u.busyUntil = this.t + RECHARGE_TICKS;
  }

  updateProjectiles() {
    const keep = [];
    for (const pr of this.projectiles) {
      pr.x += pr.vx;
      pr.y += pr.vy;
      pr.left--;
      const owner = this.units[pr.u];
      let hit = null;
      for (const o of this.near(pr.x, pr.y, pr.r + 1.5)) {
        if (o.fainted || o.team === pr.team) continue;
        const dx = o.x - pr.x;
        const dy = o.y - pr.y;
        if (dx * dx + dy * dy <= (o.r + pr.r) * (o.r + pr.r)) { hit = o; break; }
      }
      if (hit) {
        const p = owner.moves[pr.slot];
        if (pr.kind === 'status') this.statusHit(owner, hit, p);
        else this.hit(owner, hit, p);
        this.ev('impact', {u: pr.u, type: pr.type, x: pr.x, y: pr.y});
        continue;
      }
      if (pr.left > 0 && pr.x > -1 && pr.y > -1 && pr.x < this.arena.w + 1 && pr.y < this.arena.h + 1) keep.push(pr);
    }
    this.projectiles = keep;
  }

  updateMarks() {
    const keep = [];
    for (const m of this.marks) {
      if (this.t < m.land) { keep.push(m); continue; }
      const owner = this.units[m.u];
      const p = owner.moves[m.slot];
      const list = this.near(m.x, m.y, m.r + 1).filter((o) => !o.fainted && o.team !== owner.team
        && Math.sqrt((o.x - m.x) ** 2 + (o.y - m.y) ** 2) - o.r <= m.r).slice(0, MAX_VICTIMS);
      this.ev('land', {u: m.u, type: m.type, x: m.x, y: m.y, r: m.r});
      for (const o of list) this.hit(owner, o, p, {spread: list.length > 1});
    }
    this.marks = keep;
  }

  // ------------------------------------------------------------ effects
  hit(att, def, p, {spread = false} = {}) {
    if (def.fainted) return;
    const raw = this.damage(att, def, p, {spread});
    const dmg = Math.abs(raw);
    if (!dmg) { this.ev('immune', {u: def.i, by: att.i}); return; }
    const eff = this.effectiveness(p.type, def);
    let dealt = Math.min(def.hp, dmg);
    if (def.ability === 'sturdy' && def.hp === def.maxhp && dmg >= def.hp) dealt = def.hp - 1;
    this.ev('hit', {u: def.i, by: att.i, dmg: dealt, eff, crit: raw < 0, type: p.type});
    att.dealt += dealt;
    this.hurt(def, dealt, att.i, p);
    if (p.drain && !att.fainted) this.heal(att, Math.floor((dealt * p.drain[0]) / p.drain[1]));
    if (p.recoil && !att.fainted && !att.boss) this.hurt(att, Math.max(1, Math.floor((dealt * p.recoil[0]) / p.recoil[1])), -1, null, {chip: 'recoil'});
    if (!def.fainted) {
      for (const s of p.secondaries || []) {
        if (this.rng() * 100 >= s.chance) continue;
        if (s.status) this.setStatus(def, s.status);
        if (s.boosts) this.lower(def, s.boosts);
      }
    }
    for (const s of p.secondaries || []) if (s.selfBoosts && !att.fainted && this.rng() * 100 < s.chance) this.lower(att, s.selfBoosts);
    if (p.selfBoosts && !att.fainted) this.lower(att, p.selfBoosts);
  }

  statusHit(att, def, p) {
    if (def.fainted) return;
    if (p.status) this.setStatus(def, p.status);
    if (p.boosts) this.lower(def, p.boosts);
  }

  lower(u, boosts) {
    for (const k of Object.keys(boosts)) if (k in u.boosts) u.boosts[k] = Math.max(-2, Math.min(2, u.boosts[k] + Math.sign(boosts[k])));
    u.boostUntil = this.t + BOOST_TICKS;
  }

  setStatus(u, status, {force = false, ticks = 0} = {}) {
    if (!status || (u.status && !force) || u.fainted) return;
    if (!force && STATUS_IMMUNE[status]?.some((t) => u.types.includes(t))) return;
    if (u.boss && (status === 'slp' || status === 'frz')) return;     // giants shrug off sleep and freezing
    u.status = status;
    u.statusUntil = this.t + (ticks || STATUS_TICKS[status] || 10 * TPS);
    u.nextChip = this.t + RESIDUAL_TICKS;
    if (status === 'slp' || status === 'frz') u.act = null;
    this.ev('status', {u: u.i, status});
  }

  heal(u, amount) {
    if (u.fainted || amount <= 0) return;
    const n = Math.min(u.maxhp - u.hp, amount);
    if (n <= 0) return;
    u.hp += n;
    this.ev('heal', {u: u.i, n});
  }

  hurt(u, amount, by, p, {chip = ''} = {}) {
    if (u.fainted) return;
    u.hp = Math.max(0, u.hp - amount);
    u.taken += amount;
    if (by >= 0) this.lastDamage = this.t;
    if (chip) this.ev('chip', {u: u.i, n: amount, why: chip});
    if (u.hp <= 0) this.faint(u, by);
  }

  faint(u, by) {
    if (u.fainted) return;
    u.fainted = true;
    u.hp = 0;
    u.act = null;
    u.diedAt = this.t;
    u.killer = by;
    this.order.push(u.i);
    if (by >= 0) this.units[by].kos++;
    this.ev('ko', {u: u.i, by});
    const left = this.units.filter((o) => !o.fainted && o.team === u.team).length;
    if (!left) this.ev('out', {team: u.team});
  }

  checkEnd() {
    const alive = new Set();
    for (const u of this.units) if (!u.fainted) alive.add(u.team);
    if (alive.size <= 1) return this.finish(alive.size ? [...alive][0] : -1, alive.size ? 'last_standing' : 'tie');
    const stalled = alive.size > 1 && this.t - this.lastDamage >= STALEMATE_TICKS && this.units.filter((u) => !u.fainted).length <= 6;
    if (this.t >= this.timeLimit || stalled) {
      // time: the side with more Pokémon standing, then more of its health left
      const score = new Map();
      for (const u of this.units) if (!u.fainted) {
        const s = score.get(u.team) || [0, 0];
        s[0] += u.boss ? Math.max(1, Math.round(u.boss.hp / 4)) : 1;
        s[1] += u.hp / u.maxhp;
        score.set(u.team, s);
      }
      const ranked = [...score.entries()].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1] || a[0] - b[0]);
      const tie = ranked.length > 1 && ranked[0][1][0] === ranked[1][1][0] && Math.abs(ranked[0][1][1] - ranked[1][1][1]) < 1e-9;
      return this.finish(tie ? -1 : ranked[0][0], stalled && this.t < this.timeLimit ? 'stalemate' : 'time');
    }
    return null;
  }

  finish(winner, reason) {
    this.ended = true;
    this.winner = winner;
    this.reason = reason;
    this.ev('end', {winner, reason});
  }

  // ------------------------------------------------------------ reading
  teamStats() {
    // one pass over the units (everybody against everybody has as many teams as Pokémon)
    const out = this.teams.map((tm) => ({name: tm.name, color: tm.color, size: 0, alive: 0, hp: 0, maxhp: 0, kos: 0, dealt: 0}));
    for (const u of this.units) {
      const s = out[u.team];
      s.size++;
      if (!u.fainted) s.alive++;
      s.hp += u.hp;
      s.maxhp += u.maxhp;
      s.kos += u.kos;
      s.dealt += u.dealt;
    }
    return out;
  }

  /** The result: winner, how it ended, every side's numbers and the Pokémon ranked (last standing first, then by when they fell). */
  summary() {
    const teams = this.teamStats();
    const placeOf = new Map();
    const survivors = this.units.filter((u) => !u.fainted).sort((a, b) => b.hp / b.maxhp - a.hp / a.maxhp || b.kos - a.kos || a.i - b.i);
    let place = 1;
    for (const u of survivors) placeOf.set(u.i, place++);
    for (const i of this.order.slice().reverse()) placeOf.set(i, place++);
    const row = (u) => ({i: u.i, species: u.species, name: u.name, team: u.team, team_name: this.teams[u.team].name, kos: u.kos,
      dealt: u.dealt, taken: u.taken, alive: !u.fainted, hp: u.hp, maxhp: u.maxhp, place: placeOf.get(u.i),
      seconds: Math.round(((u.fainted ? u.diedAt : this.t) / TPS) * 10) / 10, killer: u.killer >= 0 ? this.units[u.killer].name : '', boss: !!u.boss});
    const ranking = this.units.map(row).sort((a, b) => a.place - b.place);
    const mvp = this.units.slice().sort((a, b) => b.kos - a.kos || b.dealt - a.dealt || a.i - b.i)[0];
    return {version: this.version, mode: this.mode, ended: this.ended, winner: this.winner,
      winner_name: this.winner >= 0 ? this.teams[this.winner].name : '', reason: this.reason, seconds: Math.round((this.t / TPS) * 10) / 10,
      ticks: this.t, units: this.units.length, teams, ranking: ranking.slice(0, 50), mvp: mvp ? row(mvp) : null,
      ko_feed: this.events.filter((e) => e.k === 'ko').slice(-30).map((e) => ({t: e.t, victim: this.units[e.u].name, by: e.by >= 0 ? this.units[e.by].name : ''}))};
  }

  /** A fingerprint of where the battle is (positions and health), to compare two runs of the same spec. */
  hash() {
    let h = 2166136261;
    const feed = (n) => { h ^= n & 0xffffffff; h = Math.imul(h, 16777619); };
    feed(this.t);
    for (const u of this.units) { feed(Math.round(u.x * 100)); feed(Math.round(u.y * 100)); feed(u.hp); }
    return (h >>> 0).toString(36);
  }
}

/** Run a mass battle to its end (or `maxSeconds`): the battle object, for its summary and hash. */
export function massRun(spec, {maxSeconds = 0} = {}) {
  const b = new MassBattle(spec);
  const cap = maxSeconds ? Math.min(b.timeLimit, maxSeconds * TPS) : b.timeLimit;
  while (!b.ended && b.t < cap) b.step();
  return b;
}
