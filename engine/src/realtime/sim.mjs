// Real-time battles, after Pokémon Legends: Z-A. Two trainers, one Pokémon each on the field at a time, on a 2D arena seen from
// above. There are no turns and no PP: every move has a cooldown (moves.mjs), a wind-up during which the user stands still, and a
// shape on the field, so attacks can be dodged by moving or rolling. Teams, stats, types, abilities, items and the damage formula
// are the turn-based games' ones (through @pkmn/sim's data); what changes follows Z-A: no accuracy or evasion, stat changes of one
// stage that last a while, statuses on timers (sleep becomes drowsiness, which doubles cooldowns), three switches that come back
// after each knockout.
//
// The simulation is deterministic: the same spec (seed included) and the same inputs of the people playing give the same battle,
// in the engine process and in a browser. That is how battles are replayed and how the app checks a result sent by the screen.
import {Dex, toID} from '@pkmn/sim';
import {RtError as EngineError, rtFormatId as buildFormatId, rtGen as genOf, rtSets} from './team.mjs';
import {makeRng} from '../ai.mjs';
import {finalCooldown, rtMove, TPS} from './moves.mjs';
import {think} from './brain.mjs';

export {TPS};
export const ARENA = {w: 28, h: 17};
export const DEFAULT_TIME_LIMIT = 300; // seconds
export const MAX_SWITCHES = 3;
export const BOOST_SECONDS = 20;
export const RESIDUAL_SECONDS = 4;
const RESIDUAL = RESIDUAL_SECONDS * TPS;
const ROLL_TICKS = Math.round(0.36 * TPS);
const ROLL_COOLDOWN = Math.round(1.1 * TPS);
const ROLL_SPEED = 11;
const SWITCH_TICKS = Math.round(0.9 * TPS);
const REPLACE_TIMEOUT = 6 * TPS;
const APPROACH_LIMIT = 3 * TPS;
const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const BOOSTABLE = ['atk', 'def', 'spa', 'spd', 'spe'];
const HOME = [{x: 5, y: ARENA.h / 2}, {x: ARENA.w - 5, y: ARENA.h / 2}];
const TRAINER = [{x: 1.6, y: ARENA.h / 2}, {x: ARENA.w - 1.6, y: ARENA.h / 2}];

const TYPE_ITEMS = {
  charcoal: 'Fire', mysticwater: 'Water', miracleseed: 'Grass', magnet: 'Electric', nevermeltice: 'Ice', blackbelt: 'Fighting',
  poisonbarb: 'Poison', softsand: 'Ground', sharpbeak: 'Flying', twistedspoon: 'Psychic', silverpowder: 'Bug', hardstone: 'Rock',
  spelltag: 'Ghost', dragonfang: 'Dragon', blackglasses: 'Dark', metalcoat: 'Steel', silkscarf: 'Normal', fairyfeather: 'Fairy',
  flameplate: 'Fire', splashplate: 'Water', meadowplate: 'Grass', zapplate: 'Electric', icicleplate: 'Ice', fistplate: 'Fighting',
  toxicplate: 'Poison', earthplate: 'Ground', skyplate: 'Flying', mindplate: 'Psychic', insectplate: 'Bug', stoneplate: 'Rock',
  spookyplate: 'Ghost', dracoplate: 'Dragon', dreadplate: 'Dark', ironplate: 'Steel', pixieplate: 'Fairy', seaincense: 'Water',
  waveincense: 'Water', oddincense: 'Psychic', rockincense: 'Rock', roseincense: 'Grass',
};
const STATUS_CURES = {cheriberry: ['par'], chestoberry: ['slp'], pechaberry: ['psn', 'tox'], rawstberry: ['brn'], aspearberry: ['frz'],
  lumberry: ['par', 'slp', 'psn', 'tox', 'brn', 'frz', 'confusion'], persimberry: ['confusion']};
const STATUS_IMMUNE = {limber: ['par'], insomnia: ['slp'], vitalspirit: ['slp'], sweetveil: ['slp'], waterveil: ['brn'], waterbubble: ['brn'],
  thermalexchange: ['brn'], immunity: ['psn', 'tox'], pastelveil: ['psn', 'tox'], magmaarmor: ['frz'], comatose: ['par', 'slp', 'psn', 'tox', 'brn', 'frz'],
  purifyingsalt: ['par', 'slp', 'psn', 'tox', 'brn', 'frz']};
const ABSORB = {voltabsorb: ['Electric', 'heal'], waterabsorb: ['Water', 'heal'], dryskin: ['Water', 'heal'], eartheater: ['Ground', 'heal'],
  lightningrod: ['Electric', 'spa'], stormdrain: ['Water', 'spa'], motordrive: ['Electric', 'spe'], sapsipper: ['Grass', 'atk'],
  flashfire: ['Fire', 'flashfire'], wellbakedbody: ['Fire', 'def'], levitate: ['Ground', 'none'], windrider: ['wind', 'atk']};
const CONTACT_STATUS = {static: 'par', flamebody: 'brn', poisonpoint: 'psn'};
const PROTECTS = new Set(['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'obstruct', 'silktrap', 'burningbulwark', 'doubleteam', 'minimize', 'maxguard']);
const SCREENS = {reflect: 'reflect', lightscreen: 'lightscreen', auroraveil: 'auroraveil', safeguard: 'safeguard', mist: 'mist', tailwind: 'tailwind', luckychant: 'luckychant'};
const HAZARDS = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Math.sqrt is exact in every JavaScript engine (Math.hypot is not), so battles replay the same in Node and in browsers.
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
const norm = (x, y) => { const l = hyp(x, y); return l > 1e-9 ? {x: x / l, y: y / l} : {x: 0, y: 0}; };
const round3 = (v) => Math.round(v * 1000) / 1000;
const pct = (mon) => (mon.maxhp ? mon.hp / mon.maxhp : 0);

// ---------------------------------------------------------------- teams
function calcStats(dex, species, set) {
  const nature = dex.natures.get(set.nature || 'Serious');
  const out = {};
  for (const k of STAT_KEYS) {
    const base = species.baseStats[k];
    const iv = set.ivs?.[k] ?? 31;
    const ev = set.evs?.[k] ?? 0;
    const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * set.level) / 100);
    if (k === 'hp') out.hp = species.id === 'shedinja' ? 1 : core + set.level + 10;
    else out[k] = Math.floor((core + 5) * (nature.plus === k ? 1.1 : nature.minus === k ? 0.9 : 1));
  }
  return out;
}

/** The Pokémon of a team as the real-time battle and its screen use them: real stats, types, moves with their cooldowns. */
export function prepareRtTeam(sets, {format = 'gen9customgame', levelRules = {}} = {}) {
  const formatId = buildFormatId(format);
  const gen = genOf(formatId);
  const dex = Dex.forGen(gen);
  const complete = rtSets(sets, formatId, levelRules || {});
  return complete.slice(0, 6).map((set) => {
    const sp = dex.species.get(set.species);
    const stats = calcStats(dex, sp, set);
    const moves = set.moves.map((m) => rtMove(m, gen)).filter(Boolean);
    if (!moves.length) throw new EngineError('invalid_team', `${sp.name} has no usable moves.`);
    const item = set.item ? dex.items.get(set.item) : null;
    const ability = set.ability ? dex.abilities.get(set.ability) : null;
    return {
      species: sp.name, base_species: sp.baseSpecies, num: sp.num, forme: sp.forme || '', name: set.name || sp.name, level: set.level,
      types: sp.types.slice(), stats, base_speed: sp.baseStats.spe, heightm: sp.heightm || 1, weightkg: sp.weightkg || 10,
      nfe: !!(sp.evos && sp.evos.length), item: item?.exists ? item.id : '', item_name: item?.exists ? item.name : '',
      ability: ability?.exists ? ability.id : '', ability_name: ability?.exists ? ability.name : '', shiny: !!set.shiny,
      gender: set.gender || '', sprite_id: sp.spriteid,
      moves: moves.map((p) => ({id: p.id, name: p.name, type: p.type, category: p.category, power: p.power, pp: p.pp, cooldown: p.cooldown,
        final: Math.round(finalCooldown(p.cooldown, stats.spe, {priority: p.priority, mod: item?.id === 'choicescarf' ? 1.5 : 1}) * 10) / 10,
        za: p.za, shape: p.shape, windup: p.windup, reach: p.reach, no_effect: p.noEffect})),
    };
  });
}

// ---------------------------------------------------------------- battle
export class RtBattle {
  /**
   * spec: {id, seed, format, level_rules, time_limit (s), p1: {name, sets, ai: {level, style} | null}, p2: {...}}
   */
  constructor(spec) {
    this.spec = {...spec};
    this.id = spec.id || `rt${Date.now().toString(36)}`;
    this.formatId = buildFormatId(spec.format || 'gen9customgame');
    this.gen = genOf(this.formatId);
    this.dex = Dex.forGen(this.gen);
    this.seed = String(spec.seed || this.id);
    this.spec.seed = this.seed;
    this.rng = makeRng(`${this.seed}:battle`);
    this.timeLimit = Math.max(30, Math.min(1800, Number(spec.time_limit) || DEFAULT_TIME_LIMIT)) * TPS;
    this.t = 0;
    this.events = [];
    this.inputLog = [];
    this.projectiles = [];
    this.marks = [];             // telegraphed areas (moves that land where the target stood)
    this.weather = null;         // {id, until}
    this.terrain = null;
    this.ended = false;
    this.winner = -1;            // -1 none yet, 0/1 side, 2 tie
    this.reason = '';
    this.sides = ['p1', 'p2'].map((id, i) => this.makeSide(id, i, spec[id] || {}));
    for (const s of this.sides) this.sendOut(s, 0, true);
    for (const s of this.sides) this.onSwitchIn(s);
  }

  makeSide(id, index, seat) {
    if (!seat.sets || !seat.sets.length) throw new EngineError('empty_team', `${id} has no team.`);
    const team = prepareRtTeam(seat.sets, {format: this.formatId, levelRules: this.spec.level_rules});
    const mons = team.map((info, slot) => ({
      ...info, slot, maxhp: info.stats.hp, hp: info.stats.hp, status: '', statusUntil: 0, toxN: 0, fainted: false,
      boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}, boostUntil: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0},
      itemUsed: false, cds: info.moves.map(() => 0), profiles: info.moves.map((m) => rtMove(m.id, this.gen)),
      dealt: 0, taken: 0, kos: 0, uses: 0, switchesIn: 0, choiceLock: -1, flashFire: false, airBalloon: info.item === 'airballoon',
    }));
    return {id, index, name: String(seat.name || (index ? 'Player 2' : 'Player 1')).slice(0, 40), ai: seat.ai || null,
      aiRng: makeRng(`${this.seed}:${id}:ai`), mons, active: 0, x: HOME[index].x, y: HOME[index].y, fx: index ? -1 : 1, fy: 0,
      act: null, rollReady: 0, switchesLeft: MAX_SWITCHES, need: false, needSince: 0, vol: {}, cond: {}, hazards: {}, wish: null,
      lastInput: null, brain: {}, moving: false};
  }

  // ------------------------------------------------------------ helpers
  ev(k, data = {}) {
    const e = {t: this.t, k, ...data};
    this.events.push(e);
    return e;
  }
  foe(side) { return this.sides[1 - side.index]; }
  mon(side) { return side.mons[side.active]; }
  alive(side) { return side.mons.filter((m) => !m.fainted); }
  onField(side) { const m = this.mon(side); return m && !m.fainted && !side.need && !(side.act && side.act.kind === 'switch'); }
  hasAbility(side, ...ids) { const m = this.mon(side); return !!m && ids.includes(m.ability); }
  hasItem(mon, ...ids) { return !!mon.item && !mon.itemUsed && ids.includes(mon.item); }
  grounded(side) {
    const m = this.mon(side);
    if (!m) return false;
    if (m.types.includes('Flying') || m.ability === 'levitate' || (m.airBalloon && !m.itemUsed) || side.vol.magnetrise > this.t) return false;
    return true;
  }
  weatherIs(...ids) {
    if (!this.weather || this.weather.until <= this.t) return false;
    if (this.sides.some((s) => this.onField(s) && ['cloudnine', 'airlock'].includes(this.mon(s).ability))) return false;
    return ids.includes(this.weather.id);
  }
  terrainIs(id) { return !!this.terrain && this.terrain.until > this.t && this.terrain.id === id; }
  typesOf(side) { const m = this.mon(side); return side.vol.types || m.types; }

  stageMult(stage) { return stage > 0 ? 1.5 : stage < 0 ? 2 / 3 : 1; }

  /** A stat as it is right now: the stat, its stage, items, abilities, weather. */
  stat(side, key, {crit = false, attacking = false, ignoreStages = false} = {}) {
    const m = this.mon(side);
    let v = m.stats[key];
    let stage = ignoreStages ? 0 : m.boosts[key] || 0;
    if (crit && attacking && stage < 0) stage = 0;
    if (crit && !attacking && stage > 0) stage = 0;
    v *= this.stageMult(stage);
    const ab = m.ability;
    const has = (...ids) => this.hasItem(m, ...ids);
    const base = m.base_species;
    if (has('lightball') && base === 'Pikachu' && (key === 'atk' || key === 'spa')) v *= 2;
    if (has('thickclub') && (base === 'Cubone' || base === 'Marowak') && key === 'atk') v *= 2;
    if (has('deepseatooth') && base === 'Clamperl' && key === 'spa') v *= 2;
    if (has('deepseascale') && base === 'Clamperl' && key === 'spd') v *= 2;
    if (has('metalpowder') && base === 'Ditto' && key === 'def') v *= 2;
    if (key === 'atk') {
      if (['hugepower', 'purepower'].includes(ab)) v *= 2;
      if (ab === 'guts' && m.status) v *= 1.5;
      if (ab === 'hustle') v *= 1.2;
      if (has('choiceband')) v *= 1.5;
      if (ab === 'gorillatactics') v *= 1.5;
    }
    if (key === 'spa') {
      if (has('choicespecs')) v *= 1.5;
      if (ab === 'solarpower' && this.weatherIs('sunnyday', 'desolateland')) v *= 1.5;
    }
    if (key === 'def') {
      if (ab === 'furcoat') v *= 2;
      if (ab === 'marvelscale' && m.status) v *= 1.5;
      if (has('eviolite') && m.nfe) v *= 1.5;
      if (this.weatherIs('snow') && this.typesOf(side).includes('Ice') && this.gen >= 9) v *= 1.5;
    }
    if (key === 'spd') {
      if (has('assaultvest')) v *= 1.5;
      if (has('eviolite') && m.nfe) v *= 1.5;
      if (this.weatherIs('sandstorm') && this.typesOf(side).includes('Rock')) v *= 1.5;
    }
    return v;
  }

  /** How fast the active Pokémon walks, in m/s (Speed stages, paralysis, weather abilities...). */
  moveSpeed(side) {
    const m = this.mon(side);
    let v = 3.2 + m.base_speed / 45;
    const st = m.boosts.spe;
    if (st > 0) v *= 1.3; else if (st < 0) v *= 0.75;
    if (m.status === 'par') v *= 0.5;
    if (m.status === 'slp') v *= 0.8;
    if (this.hasItem(m, 'choicescarf')) v *= 1.15;
    if (this.hasItem(m, 'ironball', 'machobrace', 'powerweight', 'powerbracer', 'powerbelt', 'powerlens', 'powerband', 'poweranklet')) v *= 0.8;
    if (side.cond.tailwind > this.t) v *= 1.25;
    if (this.speedWeather(side)) v *= 1.3;
    if (m.ability === 'quickfeet' && m.status) v *= 1.3;
    return v;
  }

  speedWeather(side) {
    const ab = this.mon(side).ability;
    return (ab === 'swiftswim' && this.weatherIs('raindance', 'primordialsea')) || (ab === 'chlorophyll' && this.weatherIs('sunnyday', 'desolateland')) ||
      (ab === 'sandrush' && this.weatherIs('sandstorm')) || (ab === 'slushrush' && this.weatherIs('snow', 'hail')) ||
      (ab === 'surgesurfer' && this.terrainIs('electricterrain'));
  }

  /** The cooldown this Pokémon waits after a move, in ticks (Z-A's rule; Choice Scarf, Tailwind and weather abilities count as
   * Speed modifiers like Z-A's donuts). */
  cooldownTicks(side, p) {
    const m = this.mon(side);
    let mod = 1;
    if (this.hasItem(m, 'choicescarf')) mod *= 1.5;
    if (side.cond.tailwind > this.t) mod *= 1.5;
    if (this.speedWeather(side)) mod *= 1.5;
    const prio = p.priority > 0 || (m.ability === 'prankster' && p.category === 'Status') || (m.ability === 'galewings' && p.type === 'Flying' && m.hp === m.maxhp);
    return Math.round(finalCooldown(p.cooldown, m.stats.spe, {priority: prio ? 1 : 0, mod}) * TPS);
  }

  radius(side) {
    const m = this.mon(side);
    return clamp(0.32 + m.heightm * 0.22, 0.4, 1.1);
  }

  // ------------------------------------------------------------ switching
  sendOut(side, slot, first = false) {
    const prev = this.mon(side);
    if (prev && !first) this.onSwitchOut(side);
    side.active = slot;
    side.vol = {in: this.t};
    side.act = null;
    side.need = false;
    const m = this.mon(side);
    m.switchesIn++;
    m.choiceLock = -1;
    m.boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
    side.x = HOME[side.index].x + (side.index ? -1 : 1) * 0.5;
    side.y = HOME[side.index].y + (first ? 0 : (this.rng() - 0.5) * 2);
    const foe = this.foe(side);
    const d = norm((foe.x ?? HOME[1 - side.index].x) - side.x, (foe.y ?? HOME[1 - side.index].y) - side.y);
    side.fx = d.x || (side.index ? -1 : 1); side.fy = d.y;
    this.ev('switch', {s: side.index, slot, species: m.species, hp: m.hp, maxhp: m.maxhp, first});
  }

  onSwitchOut(side) {
    const m = this.mon(side);
    if (!m || m.fainted) return;
    if (m.ability === 'regenerator') this.heal(side, Math.floor(m.maxhp / 3), 'regenerator');
    if (m.ability === 'naturalcure' && m.status) { m.status = ''; m.toxN = 0; }
    if (m.status === 'tox') m.toxN = 1;
  }

  onSwitchIn(side) {
    const m = this.mon(side);
    const foe = this.foe(side);
    // hazards
    const h = side.hazards;
    if (!this.hasItem(m, 'heavydutyboots') && m.ability !== 'magicguard') {
      if (h.stealthrock) {
        const eff = 2 ** this.dex.getEffectiveness('Rock', this.typesOf(side));
        this.chip(side, Math.floor((m.maxhp * eff) / 8), 'stealthrock');
      }
      if (h.spikes && this.grounded(side)) this.chip(side, Math.floor(m.maxhp / [0, 8, 6, 4][Math.min(3, h.spikes)]), 'spikes');
      if (h.toxicspikes && this.grounded(side)) {
        if (this.typesOf(side).includes('Poison')) { delete h.toxicspikes; this.ev('hazard_clear', {s: side.index, id: 'toxicspikes'}); }
        else this.setStatus(side, h.toxicspikes >= 2 ? 'tox' : 'psn', null);
      }
      if (h.stickyweb && this.grounded(side)) this.boost(side, {spe: -1}, foe, 'stickyweb');
    }
    if (m.fainted) return;
    const ab = m.ability;
    if (ab === 'intimidate' && this.onField(foe)) {
      const fm = this.mon(foe);
      if (!['innerfocus', 'oblivious', 'owntempo', 'scrappy', 'clearbody', 'whitesmoke', 'fullmetalbody', 'hypercutter'].includes(fm.ability)) this.boost(foe, {atk: -1}, side, 'intimidate');
      else this.ev('ability', {s: foe.index, id: fm.ability});
    }
    const weatherAb = {drought: 'sunnyday', drizzle: 'raindance', sandstream: 'sandstorm', snowwarning: this.gen >= 9 ? 'snow' : 'hail', orichalcumpulse: 'sunnyday'}[ab];
    if (weatherAb) this.setWeather(weatherAb, side);
    const terrainAb = {electricsurge: 'electricterrain', grassysurge: 'grassyterrain', psychicsurge: 'psychicterrain', mistysurge: 'mistyterrain', hadronengine: 'electricterrain'}[ab];
    if (terrainAb) this.setTerrain(terrainAb, side);
    if (ab === 'pressure' || ab === 'moldbreaker' || ab === 'unnerve') this.ev('ability', {s: side.index, id: ab});
    if (ab === 'speedboost') side.vol.speedboostAt = this.t + 8 * TPS;
    if (m.airBalloon && !m.itemUsed) this.ev('item', {s: side.index, id: 'airballoon'});
  }

  canSwitch(side, slot) {
    const m = side.mons[slot];
    if (!m || m.fainted || slot === side.active) return false;
    if (side.need) return true;
    if (side.switchesLeft <= 0) return false;
    if (side.vol.trapUntil > this.t && !this.typesOf(side).includes('Ghost')) return false;
    if (side.act && !['approach', 'roll'].includes(side.act.kind)) return false;
    return true;
  }

  startSwitch(side, slot, {forced = false, free = false} = {}) {
    if (side.need) {
      this.sendOut(side, slot);
      this.onSwitchIn(side);
      return;
    }
    if (!forced && !free) side.switchesLeft--;
    side.act = {kind: 'switch', to: slot, end: this.t + SWITCH_TICKS};
    this.ev('recall', {s: side.index, slot: side.active, to: slot, left: side.switchesLeft, forced});
  }

  bestReplacement(side) {
    const options = side.mons.filter((m) => !m.fainted && m.slot !== side.active);
    return options.length ? options[0].slot : -1;
  }

  // ------------------------------------------------------------ the loop
  /** One tick. `inputs` = {p1: {mx, my, use, dodge, sw} | null, p2: ...} for the seats people play; AI seats decide here. */
  step(inputs = {}) {
    if (this.ended) return;
    this.t++;
    for (const side of this.sides) {
      let input = side.ai ? think(this, side) : inputs[side.id] || null;
      if (!side.ai && input) this.record(side, input);
      this.applyInput(side, input || {});
    }
    for (const side of this.sides) this.updateAct(side);
    this.updateProjectiles();
    this.updateMarks();
    this.updateTimers();
    this.checkEnd();
  }

  record(side, input) {
    const q = {mx: round3(input.mx || 0), my: round3(input.my || 0), use: input.use ?? -1, dodge: !!input.dodge, sw: input.sw ?? -1};
    const last = side.lastInput;
    const acts = q.use >= 0 || q.dodge || q.sw >= 0;
    if (!last || acts || last.mx !== q.mx || last.my !== q.my) {
      this.inputLog.push([this.t, side.index, q.mx, q.my, q.use, q.dodge ? 1 : 0, q.sw]);
      side.lastInput = {mx: q.mx, my: q.my};
    }
  }

  applyInput(side, input) {
    const m = this.mon(side);
    const foe = this.foe(side);
    // replacing a fainted Pokémon
    if (side.need) {
      let slot = input.sw ?? -1;
      if ((slot < 0 || !this.canSwitch(side, slot)) && this.t - side.needSince >= REPLACE_TIMEOUT) slot = this.bestReplacement(side);
      if (slot >= 0 && this.canSwitch(side, slot)) this.startSwitch(side, slot);
      return;
    }
    if (!m || m.fainted) return;
    if (input.sw >= 0 && this.canSwitch(side, input.sw)) { this.startSwitch(side, input.sw); return; }
    const busy = side.act && side.act.kind !== 'approach';
    if (m.status === 'frz') return;
    // dodge roll: a short dash with no damage taken, then a short wait
    if (input.dodge && !busy && this.t >= side.rollReady) {
      let d = norm(input.mx || 0, input.my || 0);
      if (!d.x && !d.y) d = {x: -side.fx, y: -side.fy};
      side.act = {kind: 'roll', end: this.t + ROLL_TICKS, dx: d.x, dy: d.y};
      side.rollReady = this.t + ROLL_TICKS + ROLL_COOLDOWN;
      this.ev('roll', {s: side.index});
      return;
    }
    if (input.use >= 0 && !busy) this.tryUse(side, input.use);
    // walking
    side.moving = false;
    if (!side.act) {
      let mx = input.mx || 0, my = input.my || 0;
      if (side.vol.confusedUntil > this.t && (mx || my)) {
        // confusion: the stick turns about 50 degrees one way or the other every third of a second
        const turn = ((Math.floor(this.t / 10) + side.index) % 3) - 1;
        const c = turn ? 0.6216099682706644 : 1, s = turn * 0.7833269096274834;
        [mx, my] = [mx * c - my * s, mx * s + my * c];
      }
      const l = hyp(mx, my);
      if (l > 0.05) {
        const k = Math.min(1, l) / l;
        const v = this.moveSpeed(side) / TPS;
        this.moveBy(side, mx * k * v, my * k * v);
        side.moving = true;
      }
      if (this.onField(foe)) this.face(side, foe.x - side.x, foe.y - side.y);
    }
  }

  face(side, dx, dy) {
    const d = norm(dx, dy);
    if (d.x || d.y) { side.fx = d.x; side.fy = d.y; }
  }

  moveBy(side, dx, dy) {
    const r = this.radius(side);
    side.x = clamp(side.x + dx, r, ARENA.w - r);
    side.y = clamp(side.y + dy, r, ARENA.h - r);
    const foe = this.foe(side);
    if (this.onField(foe) && foe.act?.kind !== 'roll' && side.act?.kind !== 'roll' && !this.semiInvulnerable(foe) && !this.semiInvulnerable(side)) {
      const min = r + this.radius(foe);
      const d = dist(side, foe);
      if (d < min && d > 1e-6) {
        const push = (min - d);
        side.x = clamp(side.x + ((side.x - foe.x) / d) * push, r, ARENA.w - r);
        side.y = clamp(side.y + ((side.y - foe.y) / d) * push, r, ARENA.h - r);
      }
    }
  }

  usable(side, slot) {
    const m = this.mon(side);
    const p = m.profiles[slot];
    if (!p) return 'none';
    if (m.cds[slot] > 0) return 'cooldown';
    if (m.choiceLock >= 0 && m.choiceLock !== slot && this.hasItem(m, 'choiceband', 'choicespecs', 'choicescarf')) return 'choice';
    if (p.category === 'Status' && (side.vol.tauntUntil > this.t || this.hasItem(m, 'assaultvest'))) return 'taunt';
    if (side.vol.tormentUntil > this.t && side.vol.lastSlot === slot) return 'torment';
    if (p.heal && side.vol.healBlockUntil > this.t) return 'healblock';
    if (['fakeout', 'firstimpression'].includes(p.id) && this.t - (side.vol.in || 0) > 3 * TPS) return 'late';
    return '';
  }

  tryUse(side, slot) {
    if (this.usable(side, slot)) return false;
    const foe = this.foe(side);
    const p = this.mon(side).profiles[slot];
    const needsFoe = !['self', 'field'].includes(p.shape);
    if (needsFoe && !this.onField(foe)) return false;
    const range = this.reachFor(side, foe, p);
    if (needsFoe && dist(side, foe) > range) {
      side.act = {kind: 'approach', slot, end: this.t + APPROACH_LIMIT};
      return true;
    }
    this.startWindup(side, slot);
    return true;
  }

  reachFor(side, foe, p) {
    if (p.shape === 'strike') return p.reach + this.radius(side) + this.radius(foe) - 0.25;
    if (p.shape === 'cone') return p.reach + this.radius(foe) - 0.3;
    if (p.shape === 'burst') return p.radius + this.radius(foe) - 0.4;
    return p.reach;
  }

  startWindup(side, slot) {
    const m = this.mon(side);
    const p = m.profiles[slot];
    const foe = this.foe(side);
    let w = p.windup;
    if (m.ability === 'prankster' && p.category === 'Status') w = 0;
    if (m.ability === 'galewings' && p.type === 'Flying' && m.hp === m.maxhp) w = 0;
    if (p.flags.charge && (this.hasItem(m, 'powerherb') || (['solarbeam', 'solarblade'].includes(p.id) && this.weatherIs('sunnyday', 'desolateland')))) {
      if (this.hasItem(m, 'powerherb')) { m.itemUsed = true; this.ev('item', {s: side.index, id: 'powerherb'}); }
      w = Math.min(w, 10);
    }
    if (this.onField(foe)) this.face(side, foe.x - side.x, foe.y - side.y);
    const act = {kind: 'windup', slot, end: this.t + w, start: this.t};
    if (p.shape === 'drop' && this.onField(foe)) {
      act.tx = foe.x; act.ty = foe.y;
      this.marks.push({s: side.index, slot, x: foe.x, y: foe.y, r: p.radius, at: this.t + w, mon: side.active});
    }
    side.act = act;
    this.ev('windup', {s: side.index, move: p.id, name: p.name, type: p.type, shape: p.shape, ticks: w, tx: act.tx, ty: act.ty});
    if (w === 0) this.execute(side);
  }

  semiInvulnerable(side) {
    const a = side.act;
    if (!a) return false;
    if (a.kind === 'roll') return true;
    if (a.kind === 'windup') {
      const p = this.mon(side).profiles[a.slot];
      return ['fly', 'bounce', 'dig', 'dive', 'phantomforce', 'shadowforce'].includes(p?.id) && this.t - a.start > 3;
    }
    return false;
  }

  updateAct(side) {
    const a = side.act;
    if (!a) return;
    const foe = this.foe(side);
    if (a.kind === 'switch') {
      if (this.t >= a.end) { this.sendOut(side, a.to); this.onSwitchIn(side); }
      return;
    }
    if (a.kind === 'roll') {
      this.moveBy(side, (a.dx * ROLL_SPEED) / TPS, (a.dy * ROLL_SPEED) / TPS);
      if (this.t >= a.end) side.act = null;
      return;
    }
    if (a.kind === 'recover') {
      if (this.t >= a.end) side.act = null;
      return;
    }
    if (a.kind === 'approach') {
      const p = this.mon(side).profiles[a.slot];
      if (!this.onField(foe) || this.t >= a.end || this.usable(side, a.slot)) { side.act = null; return; }
      const reach = this.reachFor(side, foe, p);
      const d = dist(side, foe);
      if (d <= reach) { this.startWindup(side, a.slot); return; }
      const dir = norm(foe.x - side.x, foe.y - side.y);
      const v = (this.moveSpeed(side) * 1.2) / TPS;
      this.moveBy(side, dir.x * v, dir.y * v);
      this.face(side, dir.x, dir.y);
      return;
    }
    if (a.kind === 'windup') {
      const p = this.mon(side).profiles[a.slot];
      if (p.shape === 'strike' && this.onField(foe)) this.face(side, foe.x - side.x, foe.y - side.y);
      if (this.t >= a.end) this.execute(side);
      return;
    }
    if (a.kind === 'dash') {
      const v = a.speed / TPS;
      this.moveBy(side, a.dx * v, a.dy * v);
      a.traveled += v;
      if (this.onField(foe) && !a.hit && !this.semiInvulnerable(foe) && dist(side, foe) <= this.radius(side) + this.radius(foe) + 0.35) {
        a.hit = true;
        this.resolveHit(side, foe, this.mon(side).profiles[a.slot], {mon: side.active});
        this.finishMove(side, a.slot);
        return;
      }
      if (a.traveled >= a.max || this.t >= a.end) {
        if (!a.hit) this.ev('miss', {s: side.index, move: this.mon(side).profiles[a.slot].id});
        this.finishMove(side, a.slot);
      }
    }
  }

  /** The wind-up is over: the move happens (a strike lands, a projectile leaves, a status move takes effect...). */
  execute(side) {
    const m = this.mon(side);
    const slot = side.act.slot;
    const act = side.act;
    const p = m.profiles[slot];
    const foe = this.foe(side);
    m.uses++;
    side.vol.lastSlot = slot;
    if (this.hasItem(m, 'choiceband', 'choicespecs', 'choicescarf')) m.choiceLock = slot;
    if (m.ability === 'protean' || m.ability === 'libero') { side.vol.types = [p.type]; }
    this.ev('use', {s: side.index, move: p.id, name: p.name, type: p.type, shape: p.shape, category: p.category});
    if (p.noEffect) { this.ev('noeffect', {s: side.index, move: p.id}); this.finishMove(side, slot); return; }
    if (p.id === 'metronome') {
      const pool = this.dex.moves.all().filter((x) => x.exists && x.basePower > 0 && !x.isNonstandard && !x.isZ && !x.isMax && x.category !== 'Status');
      const pick = pool[Math.floor(this.rng() * pool.length)];
      const prof = rtMove(pick.id, this.gen);
      this.ev('metronome', {s: side.index, move: prof.id, name: prof.name});
      this.performShape(side, foe, prof, act);
      m.cds[slot] = this.cooldownTicks(side, p);
      if (side.act === act) side.act = null;
      return;
    }
    this.performShape(side, foe, p, act);
    if (side.act === act) this.finishMove(side, slot);
    else if (side.act?.kind !== 'dash') m.cds[slot] = this.cooldownTicks(side, p);
  }

  performShape(side, foe, p, act) {
    const ctx = {mon: side.active};
    switch (p.shape) {
      case 'self':
        this.statusMove(side, side, p);
        break;
      case 'field':
        this.statusMove(side, foe, p);
        break;
      case 'strike': {
        if (this.onField(foe) && this.inFront(side, foe, this.reachFor(side, foe, p) + 0.25, p.arc) && !this.semiInvulnerable(foe)) this.resolveHit(side, foe, p, ctx);
        else this.ev('miss', {s: side.index, move: p.id});
        break;
      }
      case 'cone': {
        this.ev('area', {s: side.index, move: p.id, x: side.x, y: side.y, fx: side.fx, fy: side.fy, r: p.reach, arc: p.arc, type: p.type});
        if (this.onField(foe) && this.inFront(side, foe, p.reach + this.radius(foe), p.arc) && !this.semiInvulnerable(foe)) this.resolveHit(side, foe, p, ctx);
        else this.ev('miss', {s: side.index, move: p.id});
        break;
      }
      case 'burst': {
        this.ev('area', {s: side.index, move: p.id, x: side.x, y: side.y, r: p.radius, arc: -1, type: p.type});
        if (this.onField(foe) && dist(side, foe) <= p.radius + this.radius(foe) && !this.semiInvulnerable(foe)) this.resolveHit(side, foe, p, ctx);
        else if (p.category !== 'Status') this.ev('miss', {s: side.index, move: p.id});
        if (p.selfdestruct) this.faint(side, null);
        break;
      }
      case 'drop':
        break; // the mark lands by itself (updateMarks)
      case 'dash': {
        const d = this.onField(foe) ? norm(foe.x - side.x, foe.y - side.y) : {x: side.fx, y: side.fy};
        side.act = {kind: 'dash', slot: act.slot, dx: d.x, dy: d.y, speed: p.speed, traveled: 0, max: p.reach + 1, end: this.t + TPS, hit: false};
        this.face(side, d.x, d.y);
        this.ev('dash', {s: side.index, move: p.id});
        break;
      }
      default: { // shot, beam, wave
        const tx = this.onField(foe) ? foe.x : side.x + side.fx * p.reach;
        const ty = this.onField(foe) ? foe.y : side.y + side.fy * p.reach;
        const d = norm(tx - side.x, ty - side.y);
        const r0 = this.radius(side) + 0.2;
        const pr = {id: `${this.t}:${side.index}:${act.slot}`, s: side.index, mon: side.active, move: p.id, x: side.x + d.x * r0, y: side.y + d.y * r0,
          vx: d.x * p.speed, vy: d.y * p.speed, r: p.radius, left: p.reach, type: p.type, shape: p.shape};
        this.projectiles.push(pr);
        this.ev('shot', {s: side.index, move: p.id, id: pr.id, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, r: pr.r, type: p.type, shape: p.shape});
      }
    }
  }

  finishMove(side, slot) {
    const m = this.mon(side);
    const p = m.profiles[slot];
    m.cds[slot] = this.cooldownTicks(side, p);
    side.act = null;
    if (m.fainted) return;
    if (p.recharge) { side.act = {kind: 'recover', end: this.t + 2 * TPS}; this.ev('recharge', {s: side.index}); }
    if (p.selfBoostAfter === 'confusion' && m.ability !== 'owntempo') { side.vol.confusedUntil = this.t + 5 * TPS; this.ev('confused', {s: side.index}); }
  }

  inFront(side, foe, reach, arc) {
    const dx = foe.x - side.x, dy = foe.y - side.y;
    const d = hyp(dx, dy);
    if (d > reach) return false;
    if (d < 0.3) return true;
    return (dx * side.fx + dy * side.fy) / d >= arc;
  }

  updateProjectiles() {
    const keep = [];
    for (const pr of this.projectiles) {
      const owner = this.sides[pr.s];
      const target = this.foe(owner);
      const steps = Math.max(1, Math.ceil(hyp(pr.vx, pr.vy) / TPS / 0.25));
      let done = false;
      for (let i = 0; i < steps && !done; i++) {
        pr.x += pr.vx / TPS / steps;
        pr.y += pr.vy / TPS / steps;
        pr.left -= hyp(pr.vx, pr.vy) / TPS / steps;
        if (this.onField(target) && !this.semiInvulnerable(target) && dist(pr, target) <= pr.r + this.radius(target)) {
          const p = rtMove(pr.move, this.gen);
          if (owner.mons[pr.mon].fainted) { done = true; break; }
          this.resolveHit(owner, target, p, {mon: pr.mon, x: pr.x, y: pr.y});
          this.ev('impact', {id: pr.id, x: pr.x, y: pr.y});
          done = true;
        }
        if (pr.left <= 0 || pr.x < 0 || pr.y < 0 || pr.x > ARENA.w || pr.y > ARENA.h) { this.ev('fizzle', {id: pr.id, x: pr.x, y: pr.y, s: pr.s, move: pr.move}); done = true; }
      }
      if (!done) keep.push(pr);
    }
    this.projectiles = keep;
  }

  updateMarks() {
    const keep = [];
    for (const mk of this.marks) {
      if (this.t < mk.at) { keep.push(mk); continue; }
      const owner = this.sides[mk.s];
      const target = this.foe(owner);
      const m = owner.mons[mk.mon];
      const p = m.profiles[mk.slot];
      this.ev('area', {s: mk.s, move: p.id, x: mk.x, y: mk.y, r: mk.r, arc: -1, type: p.type});
      if (!m.fainted && this.onField(target) && !this.semiInvulnerable(target) && dist(mk, target) <= mk.r + this.radius(target)) {
        this.resolveHit(owner, target, p, {mon: mk.mon});
      } else {
        this.ev('miss', {s: mk.s, move: p.id});
      }
    }
    this.marks = keep;
  }

  // ------------------------------------------------------------ damage
  effectiveness(type, side, p = null) {
    const types = this.typesOf(side);
    let eff = 2 ** this.dex.getEffectiveness(type, types);
    if (p?.id === 'freezedry' && types.includes('Water')) eff *= 4;
    if (p?.id === 'flyingpress') eff *= 2 ** this.dex.getEffectiveness('Flying', types);
    return eff;
  }

  immune(att, def, p) {
    const dm = this.mon(def);
    const am = this.mon(att);
    const mold = ['moldbreaker', 'teravolt', 'turboblaze'].includes(am.ability);
    if (p.category === 'Status') {
      if (p.id.endsWith('powder') || ['spore', 'sleeppowder', 'stunspore', 'poisonpowder', 'ragepowder', 'cottonspore'].includes(p.id)) {
        if (this.typesOf(def).includes('Grass') || dm.ability === 'overcoat' || this.hasItem(dm, 'safetygoggles')) return 'immune';
      }
      if (p.flags.sound && dm.ability === 'soundproof' && !mold) return 'immune';
      if (dm.ability === 'goodasgold' && !mold && att !== def) return 'immune';
      if (p.id === 'thunderwave' && !this.dex.getImmunity('Electric', this.typesOf(def))) return 'immune';
      return '';
    }
    const type = this.moveType(att, p);
    if (p.flags.sound && dm.ability === 'soundproof' && !mold) return 'immune';
    if (p.flags.bullet && dm.ability === 'bulletproof' && !mold) return 'immune';
    if (!mold) {
      const ab = ABSORB[dm.ability];
      if (ab && (ab[0] === type || (ab[0] === 'wind' && p.flags.wind))) return 'absorb';
      if (dm.ability === 'wonderguard' && this.effectiveness(type, def, p) <= 1) return 'immune';
    }
    if (type === 'Ground' && !this.grounded(def) && p.id !== 'thousandarrows') return 'immune';
    if (!p.ignoreImmunity && !this.dex.getImmunity(type, this.typesOf(def))) {
      if (!(am.ability === 'scrappy' && (type === 'Normal' || type === 'Fighting'))) return 'immune';
    }
    return '';
  }

  moveType(side, p) {
    const m = this.mon(side);
    if (p.id === 'weatherball') {
      if (this.weatherIs('sunnyday', 'desolateland')) return 'Fire';
      if (this.weatherIs('raindance', 'primordialsea')) return 'Water';
      if (this.weatherIs('sandstorm')) return 'Rock';
      if (this.weatherIs('snow', 'hail')) return 'Ice';
    }
    if (p.id === 'terrainpulse' && this.terrain && this.terrain.until > this.t) return {electricterrain: 'Electric', grassyterrain: 'Grass', psychicterrain: 'Psychic', mistyterrain: 'Fairy'}[this.terrain.id];
    if (p.type === 'Normal') {
      const ate = {pixilate: 'Fairy', aerilate: 'Flying', refrigerate: 'Ice', galvanize: 'Electric'}[m.ability];
      if (ate) return ate;
      if (m.ability === 'normalize') return 'Normal';
    }
    if (p.id === 'aurawheel' && m.species.includes('Hangry')) return 'Dark';
    return p.type;
  }

  basePower(att, def, p) {
    const am = this.mon(att);
    const dm = this.mon(def);
    let bp = p.power;
    const ratio = (a, b) => a / Math.max(1, b);
    switch (p.id) {
      case 'lowkick': case 'grassknot': {
        const w = dm.weightkg;
        bp = w >= 200 ? 120 : w >= 100 ? 100 : w >= 50 ? 80 : w >= 25 ? 60 : w >= 10 ? 40 : 20;
        break;
      }
      case 'heavyslam': case 'heatcrash': {
        const r = ratio(am.weightkg, dm.weightkg);
        bp = r >= 5 ? 120 : r >= 4 ? 100 : r >= 3 ? 80 : r >= 2 ? 60 : 40;
        break;
      }
      case 'gyroball': bp = Math.min(150, Math.floor((25 * this.stat(def, 'spe')) / Math.max(1, this.stat(att, 'spe'))) + 1); break;
      case 'electroball': { const r = ratio(this.stat(att, 'spe'), this.stat(def, 'spe')); bp = r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; break; }
      case 'reversal': case 'flail': { const f = pct(am); bp = f <= 0.0417 ? 200 : f <= 0.1042 ? 150 : f <= 0.2083 ? 100 : f <= 0.3542 ? 80 : f <= 0.6875 ? 40 : 20; break; }
      case 'eruption': case 'waterspout': case 'dragonenergy': bp = Math.max(1, Math.floor(150 * pct(am))); break;
      case 'return': case 'frustration': bp = 102; break;
      case 'hiddenpower': bp = 60; break;
      case 'weatherball': bp = this.weather && this.weather.until > this.t ? 100 : 50; break;
      case 'storedpower': case 'powertrip': bp = 20 + 20 * Object.values(am.boosts).filter((v) => v > 0).length; break;
      case 'acrobatics': bp = !am.item || am.itemUsed ? 110 : 55; break;
      case 'facade': bp = am.status ? 140 : 70; break;
      case 'hex': case 'infernalparade': case 'bittermalice': bp = dm.status ? p.power * 2 : p.power; break;
      case 'venoshock': case 'barbbarrage': bp = ['psn', 'tox'].includes(dm.status) ? p.power * 2 : p.power; break;
      case 'brine': bp = pct(dm) <= 0.5 ? p.power * 2 : p.power; break;
      case 'knockoff': bp = dm.item && !dm.itemUsed ? Math.floor(p.power * 1.5) : p.power; break;
      case 'lastrespects': bp = 50 + 50 * att.mons.filter((x) => x.fainted).length; break;
      case 'ragefist': bp = Math.min(350, 50 + 50 * (att.vol.hitsTaken || 0)); break;
      case 'boltbeak': case 'fishiousrend': bp = def.act && def.act.kind === 'windup' ? p.power * 2 : p.power; break;
      case 'payback': case 'avalanche': case 'revenge': bp = att.vol.lastHitAt && this.t - att.vol.lastHitAt < 2 * TPS ? p.power * 2 : p.power; break;
      case 'solarbeam': case 'solarblade': bp = this.weatherIs('raindance', 'sandstorm', 'hail', 'snow', 'primordialsea') ? p.power / 2 : p.power; break;
      default: break;
    }
    if (!bp && p.category !== 'Status' && p.damage == null && !p.ohko) bp = 60;
    return bp;
  }

  /** Damage of one hit: the turn-based formula with its modifiers. `expected` gives the average (no random roll, crits weighted)
   * for the AI. Returns {dmg, eff, crit, immune}. */
  damage(att, def, p, {expected = false, mon = null} = {}) {
    const am = mon != null ? att.mons[mon] : this.mon(att);
    const dm = this.mon(def);
    const type = this.moveType(att, p);
    const imm = this.immune(att, def, p);
    if (imm) return {dmg: 0, eff: 0, crit: false, immune: imm};
    // fixed damage
    if (p.ohko) return {dmg: dm.ability === 'sturdy' ? 0 : dm.hp, eff: 1, crit: false, immune: dm.ability === 'sturdy' ? 'immune' : ''};
    if (p.damage === 'level') return {dmg: am.level, eff: 1, crit: false, immune: ''};
    if (typeof p.damage === 'number') return {dmg: p.damage, eff: 1, crit: false, immune: ''};
    if (['superfang', 'naturesmadness', 'ruination'].includes(p.id)) return {dmg: Math.max(1, Math.floor(dm.hp / 2)), eff: 1, crit: false, immune: ''};
    if (p.id === 'endeavor') return {dmg: Math.max(0, dm.hp - am.hp), eff: 1, crit: false, immune: ''};
    if (p.id === 'finalgambit') return {dmg: am.hp, eff: 1, crit: false, immune: ''};
    if (p.id === 'psywave') return {dmg: Math.max(1, Math.floor(am.level * (expected ? 1 : 0.5 + this.rng()))), eff: 1, crit: false, immune: ''};
    let bp = this.basePower(att, def, p);
    const ab = am.ability;
    // crit
    let stage = p.crit + (att.vol.focusEnergy ? 2 : 0) + (ab === 'superluck' ? 1 : 0) + (this.hasItem(am, 'scopelens', 'razorclaw') ? 1 : 0);
    if (['battlearmor', 'shellarmor'].includes(dm.ability) || def.cond.luckychant > this.t) stage = -99;
    const critChance = stage < 0 ? 0 : stage >= 3 ? 1 : [1 / 24, 1 / 8, 1 / 2][stage];
    const crit = expected ? false : this.rng() < critChance;
    // base power modifiers
    if (ab === 'technician' && bp <= 60) bp *= 1.5;
    if (ab === 'toughclaws' && p.contact) bp *= 1.3;
    if (ab === 'ironfist' && p.flags.punch) bp *= 1.2;
    if (ab === 'strongjaw' && p.flags.bite) bp *= 1.5;
    if (ab === 'megalauncher' && p.flags.pulse) bp *= 1.5;
    if (ab === 'sharpness' && p.flags.slicing) bp *= 1.5;
    if (ab === 'punkrock' && p.flags.sound) bp *= 1.3;
    if (ab === 'sheerforce' && p.secondaries.length) bp *= 1.3;
    if (ab === 'reckless' && p.recoil) bp *= 1.2;
    if (['aerilate', 'pixilate', 'refrigerate', 'galvanize'].includes(ab) && p.type === 'Normal') bp *= 1.2;
    if (ab === 'sandforce' && this.weatherIs('sandstorm') && ['Rock', 'Ground', 'Steel'].includes(type)) bp *= 1.3;
    if (ab === 'analytic' && def.act && def.act.kind === 'windup') bp *= 1.3;
    if (att.vol.flashFire && type === 'Fire') bp *= 1.5;
    if (att.vol.charged && type === 'Electric') { bp *= 2; }
    if (TYPE_ITEMS[am.item] === type && !am.itemUsed) bp *= 1.2;
    if (this.hasItem(am, 'muscleband') && p.category === 'Physical') bp *= 1.1;
    if (this.hasItem(am, 'wiseglasses') && p.category === 'Special') bp *= 1.1;
    if (this.hasItem(am, 'punchingglove') && p.flags.punch) bp *= 1.1;
    const lowHp = pct(am) <= 1 / 3;
    if (lowHp && ((ab === 'overgrow' && type === 'Grass') || (ab === 'blaze' && type === 'Fire') || (ab === 'torrent' && type === 'Water') || (ab === 'swarm' && type === 'Bug'))) bp *= 1.5;
    if (this.grounded(att)) {
      if (this.terrainIs('electricterrain') && type === 'Electric') bp *= 1.3;
      if (this.terrainIs('grassyterrain') && type === 'Grass') bp *= 1.3;
      if (this.terrainIs('psychicterrain') && type === 'Psychic') bp *= 1.3;
    }
    if (this.grounded(def) && this.terrainIs('mistyterrain') && type === 'Dragon') bp *= 0.5;
    if (this.grounded(def) && this.terrainIs('grassyterrain') && ['earthquake', 'bulldoze', 'magnitude'].includes(p.id)) bp *= 0.5;
    // stats
    const atkKey = p.overrideOffensiveStat || (p.category === 'Physical' ? 'atk' : 'spa');
    const defKey = p.overrideDefensiveStat || (p.category === 'Physical' || ['psyshock', 'psystrike', 'secretsword'].includes(p.id) ? 'def' : 'spd');
    const unawareDef = dm.ability === 'unaware';
    const unawareAtk = ab === 'unaware';
    const atkSide = p.id === 'foulplay' ? def : att;
    let A = this.stat(atkSide, atkKey, {crit, attacking: true, ignoreStages: unawareDef});
    if (p.id === 'bodypress') A = this.stat(att, 'def', {crit, attacking: true, ignoreStages: unawareDef});
    let D = this.stat(def, defKey, {crit, attacking: false, ignoreStages: unawareAtk || p.ignoreDefensive});
    if (dm.ability === 'thickfat' && (type === 'Fire' || type === 'Ice')) A *= 0.5;
    if (dm.ability === 'heatproof' && type === 'Fire') A *= 0.5;
    if (dm.ability === 'purifyingsalt' && type === 'Ghost') A *= 0.5;
    if (dm.ability === 'waterbubble' && type === 'Fire') A *= 0.5;
    if (ab === 'waterbubble' && type === 'Water') A *= 2;
    if (ab === 'transistor' && type === 'Electric') A *= 1.3;
    if (ab === 'dragonsmaw' && type === 'Dragon') A *= 1.5;
    if (ab === 'steelworker' && type === 'Steel') A *= 1.5;
    if (ab === 'rockypayload' && type === 'Rock') A *= 1.5;
    const L = am.level;
    let dmg = Math.floor(Math.floor((Math.floor((2 * L) / 5 + 2) * bp * A) / Math.max(1, D)) / 50) + 2;
    // modifiers
    if (this.weatherIs('sunnyday', 'desolateland')) { if (type === 'Fire') dmg *= 1.5; else if (type === 'Water') dmg *= 0.5; }
    if (this.weatherIs('raindance', 'primordialsea')) { if (type === 'Water') dmg *= 1.5; else if (type === 'Fire') dmg *= 0.5; }
    if (crit) dmg *= ab === 'sniper' ? 2.25 : 1.5;
    else if (expected && critChance) dmg *= 1 + critChance * 0.5;
    dmg *= expected ? 0.925 : 0.85 + 0.15 * this.rng();
    const types = att.vol.types && att.mons[att.active] === am ? att.vol.types : am.types;
    if (types.includes(type)) dmg *= ab === 'adaptability' ? 2 : 1.5;
    const eff = this.effectiveness(type, def, p);
    dmg *= eff;
    if (eff < 1 && ab === 'tintedlens') dmg *= 2;
    if (am.status === 'brn' && p.category === 'Physical' && ab !== 'guts' && p.id !== 'facade') dmg *= 0.5;
    if (!crit && ab !== 'infiltrator') {
      if (p.category === 'Physical' && (def.cond.reflect > this.t || def.cond.auroraveil > this.t)) dmg *= 0.5;
      if (p.category === 'Special' && (def.cond.lightscreen > this.t || def.cond.auroraveil > this.t)) dmg *= 0.5;
    }
    if (['multiscale', 'shadowshield'].includes(dm.ability) && dm.hp === dm.maxhp) dmg *= 0.5;
    if (['filter', 'solidrock', 'prismarmor'].includes(dm.ability) && eff > 1) dmg *= 0.75;
    if (dm.ability === 'fluffy' && p.contact) dmg *= 0.5;
    if (dm.ability === 'fluffy' && type === 'Fire') dmg *= 2;
    if (dm.ability === 'icescales' && p.category === 'Special') dmg *= 0.5;
    if (dm.ability === 'punkrock' && p.flags.sound) dmg *= 0.5;
    if (this.hasItem(am, 'lifeorb')) dmg *= 1.3;
    if (this.hasItem(am, 'expertbelt') && eff > 1) dmg *= 1.2;
    if (ab === 'neuroforce' && eff > 1) dmg *= 1.25;
    const resistBerry = {occaberry: 'Fire', passhoberry: 'Water', wacanberry: 'Electric', rindoberry: 'Grass', yacheberry: 'Ice', chopleberry: 'Fighting',
      kebiaberry: 'Poison', shucaberry: 'Ground', cobaberry: 'Flying', payapaberry: 'Psychic', tangaberry: 'Bug', chartiberry: 'Rock',
      kasibberry: 'Ghost', habanberry: 'Dragon', colburberry: 'Dark', babiriberry: 'Steel', roseliberry: 'Fairy'}[dm.item];
    let berry = false;
    if (resistBerry === type && eff > 1 && !dm.itemUsed && !expected) { dmg *= 0.5; berry = true; }
    dmg = Math.max(eff > 0 ? 1 : 0, Math.floor(dmg));
    return {dmg, eff, crit, immune: '', berry};
  }

  /** A move reached its target: protection, absorption, damage, effects. */
  resolveHit(att, def, p, ctx = {}) {
    const am = ctx.mon != null ? att.mons[ctx.mon] : this.mon(att);
    const dm = this.mon(def);
    if (!dm || dm.fainted) return;
    // protection
    if (def.vol.protectUntil > this.t && !p.breaksProtect && !(p.category === 'Status' && p.shape === 'self')) {
      this.ev('protected', {s: def.index, move: p.id});
      const kind = def.vol.protectKind;
      if (p.contact) {
        if (kind === 'kingsshield' && att.mons[att.active] === am) this.boost(att, {atk: -1}, def, 'kingsshield');
        if (kind === 'obstruct' && att.mons[att.active] === am) this.boost(att, {def: -1}, def, 'obstruct');
        if (kind === 'silktrap' && att.mons[att.active] === am) this.boost(att, {spe: -1}, def, 'silktrap');
        if (kind === 'spikyshield' && att.mons[att.active] === am) this.chip(att, Math.floor(am.maxhp / 8), 'spikyshield');
        if (kind === 'banefulbunker' && att.mons[att.active] === am) this.setStatus(att, 'psn', def);
        if (kind === 'burningbulwark' && att.mons[att.active] === am) this.setStatus(att, 'brn', def);
      }
      return;
    }
    if (p.category === 'Status') { this.statusMove(att, def, p); return; }
    const imm = this.immune(att, def, p);
    if (imm === 'absorb') { this.absorb(def, att, p); return; }
    if (imm) { this.ev('immune', {s: def.index, move: p.id}); return; }
    // thaw
    if (dm.status === 'frz' && (this.moveType(att, p) === 'Fire' || p.thaws)) this.cure(def, 'frz');
    let total = 0;
    let lastEff = 1;
    let crits = 0;
    const hits = am.ability === 'skilllink' ? Math.max(p.hits, p.hits > 1 ? 5 : 1) : p.hits;
    for (let h = 0; h < hits && !dm.fainted; h++) {
      const r = this.damage(att, def, p, {mon: ctx.mon});
      lastEff = r.eff;
      if (r.crit) crits++;
      let dmg = r.dmg;
      if (r.berry) { dm.itemUsed = true; this.ev('item', {s: def.index, id: dm.item}); }
      // substitute
      if (def.vol.sub > 0 && !p.flags.sound && am.ability !== 'infiltrator') {
        const taken = Math.min(def.vol.sub, dmg);
        def.vol.sub -= taken;
        this.ev('sub', {s: def.index, dmg: taken, broke: def.vol.sub <= 0});
        if (def.vol.sub <= 0) delete def.vol.sub;
        total += taken;
        continue;
      }
      // disguise
      if (dm.ability === 'disguise' && !def.vol.busted && dm.species.startsWith('Mimikyu')) {
        def.vol.busted = true;
        dmg = Math.min(dmg, Math.floor(dm.maxhp / 8));
        this.ev('ability', {s: def.index, id: 'disguise'});
      }
      // survive at 1 HP
      if (dmg >= dm.hp) {
        if (def.vol.endureUntil > this.t) { dmg = dm.hp - 1; this.ev('endure', {s: def.index}); }
        else if (dm.hp === dm.maxhp && (dm.ability === 'sturdy' || this.hasItem(dm, 'focussash'))) {
          dmg = dm.hp - 1;
          if (dm.ability === 'sturdy') this.ev('ability', {s: def.index, id: 'sturdy'});
          else { dm.itemUsed = true; this.ev('item', {s: def.index, id: 'focussash'}); }
        }
      }
      dmg = Math.min(dmg, dm.hp);
      dm.hp -= dmg;
      dm.taken += dmg;
      am.dealt += dmg;
      total += dmg;
      def.vol.hitsTaken = (def.vol.hitsTaken || 0) + 1;
      def.vol.lastHitAt = this.t;
      this.ev('hit', {s: def.index, from: att.index, move: p.id, type: this.moveType(att, p), dmg, hp: dm.hp, maxhp: dm.maxhp, eff: r.eff, crit: r.crit, hit: h});
      if (dm.airBalloon && !dm.itemUsed) { dm.itemUsed = true; this.ev('item', {s: def.index, id: 'airballoon', popped: true}); }
      if (dm.hp <= 0) { this.faint(def, att, am); break; }
    }
    if (total <= 0) return;
    if (hits > 1) this.ev('hits', {s: def.index, n: hits});
    // a hit during the target's wind-up can make it flinch
    const flinchAll = p.secondaries.some((s) => s.volatile === 'flinch');
    // secondary effects
    if (am.ability !== 'sheerforce') {
      for (const sec of p.secondaries) {
        const chance = Math.min(100, sec.chance * (am.ability === 'serenegrace' ? 2 : 1));
        if (this.rng() * 100 >= chance) continue;
        if (sec.selfBoosts && att.mons[att.active] === am) this.boost(att, sec.selfBoosts, att, p.id);
        if (dm.fainted) continue;
        if (dm.ability === 'shielddust' || this.hasItem(dm, 'covertcloak')) continue;
        if (sec.status) this.setStatus(def, sec.status, att);
        if (sec.volatile === 'flinch') this.flinch(def);
        if (sec.volatile === 'confusion') this.confuse(def);
        if (sec.boosts) this.boost(def, sec.boosts, att, p.id);
      }
    }
    if (!flinchAll && (this.hasItem(am, 'kingsrock', 'razorfang') || am.ability === 'stench') && this.rng() < 0.1 && !dm.fainted) this.flinch(def);
    // contact
    if (p.contact && !this.hasItem(am, 'protectivepads') && am.ability !== 'longreach' && att.mons[att.active] === am) {
      if (['roughskin', 'ironbarbs'].includes(dm.ability)) this.chip(att, Math.floor(am.maxhp / 8), dm.ability);
      if (this.hasItem(dm, 'rockyhelmet')) this.chip(att, Math.floor(am.maxhp / 6), 'rockyhelmet');
      const cs = CONTACT_STATUS[dm.ability];
      if (cs && this.rng() < 0.3) this.setStatus(att, cs, def);
      if (dm.ability === 'effectspore' && this.rng() < 0.3) this.setStatus(att, ['psn', 'par', 'slp'][Math.floor(this.rng() * 3)], def);
      if (dm.ability === 'cursedbody' && this.rng() < 0.3) att.vol.tauntUntil = this.t + 6 * TPS;
      if (dm.ability === 'gooey' || dm.ability === 'tanglinghair') this.boost(att, {spe: -1}, def, dm.ability);
    }
    // the attacker
    if (att.mons[att.active] === am && !am.fainted) {
      if (p.drain) this.heal(att, Math.max(1, Math.floor((total * p.drain[0]) / p.drain[1]) * (this.hasItem(am, 'bigroot') ? 1.3 : 1)), 'drain');
      if (p.recoil && !['rockhead', 'magicguard'].includes(am.ability)) this.chip(att, Math.max(1, Math.floor((total * p.recoil[0]) / p.recoil[1])), 'recoil');
      if (this.hasItem(am, 'lifeorb') && am.ability !== 'magicguard') this.chip(att, Math.floor(am.maxhp / 10), 'lifeorb');
      if (this.hasItem(am, 'shellbell')) this.heal(att, Math.floor(total / 8), 'shellbell');
      if (p.selfBoosts) this.boost(att, p.selfBoosts, att, p.id);
      if (p.id === 'knockoff' && dm.item && !dm.itemUsed && !dm.fainted && dm.ability !== 'stickyhold') { dm.itemUsed = true; this.ev('knockoff', {s: def.index, item: dm.item}); }
      if (['rapidspin', 'mortalspin', 'tidyup'].includes(p.id)) this.clearHazards(att);
      if (p.id === 'rapidspin') this.boost(att, {spe: 1}, att, p.id);
      if (p.id === 'mortalspin' && !dm.fainted) this.setStatus(def, 'psn', att);
      if (['firespin', 'whirlpool', 'sandtomb', 'infestation', 'magmastorm', 'bind', 'wrap', 'clamp', 'snaptrap', 'thundercage'].includes(p.id) && !dm.fainted) {
        def.vol.trapUntil = this.t + (this.hasItem(am, 'gripclaw') ? 18 : 12) * TPS;
        def.vol.trapBy = att.index;
        this.ev('trapped', {s: def.index, move: p.id});
      }
      if (p.selfSwitch && this.alive(att).length > 1) att.vol.pivot = true;
      if (p.forceSwitch && !dm.fainted && this.alive(def).length > 1) this.forceOut(def);
      if (dm.fainted && am.ability === 'moxie') this.boost(att, {atk: 1}, att, 'moxie');
      if (dm.fainted && ['beastboost', 'chillingneigh', 'grimneigh', 'asoneglastrier', 'asonespectrier'].includes(am.ability)) this.boost(att, {[am.ability === 'grimneigh' || am.ability === 'asonespectrier' ? 'spa' : 'atk']: 1}, att, am.ability);
    }
    if (!dm.fainted) {
      if (dm.ability === 'weakarmor' && p.category === 'Physical') this.boost(def, {def: -1, spe: 1}, def, 'weakarmor');
      if (dm.ability === 'stamina') this.boost(def, {def: 1}, def, 'stamina');
      if (dm.ability === 'justified' && this.moveType(att, p) === 'Dark') this.boost(def, {atk: 1}, def, 'justified');
      if (dm.ability === 'rattled' && ['Dark', 'Bug', 'Ghost'].includes(this.moveType(att, p))) this.boost(def, {spe: 1}, def, 'rattled');
      if (dm.ability === 'angerpoint' && crits) this.boost(def, {atk: 1}, def, 'angerpoint');
      if (this.hasItem(dm, 'weaknesspolicy') && lastEff > 1) { dm.itemUsed = true; this.boost(def, {atk: 1, spa: 1}, def, 'weaknesspolicy'); }
      this.berries(def);
    }
    if (att.vol.pivot && att.mons[att.active] === am && !am.fainted) {
      delete att.vol.pivot;
      att.vol.pivotPending = this.t;
    }
  }

  absorb(def, att, p) {
    const dm = this.mon(def);
    const kind = ABSORB[dm.ability][1];
    this.ev('ability', {s: def.index, id: dm.ability});
    if (kind === 'heal') this.heal(def, Math.floor(dm.maxhp / 4), dm.ability);
    else if (kind === 'flashfire') def.vol.flashFire = true;
    else if (kind !== 'none') this.boost(def, {[kind]: 1}, def, dm.ability);
  }

  flinch(side) {
    const m = this.mon(side);
    if (m.ability === 'innerfocus') return;
    if (side.act && side.act.kind === 'windup') {
      const slot = side.act.slot;
      m.cds[slot] = this.cooldownTicks(side, m.profiles[slot]);
      this.marks = this.marks.filter((mk) => !(mk.s === side.index && mk.slot === slot));
      side.act = null;
      this.ev('flinch', {s: side.index});
      if (m.ability === 'steadfast') this.boost(side, {spe: 1}, side, 'steadfast');
    }
  }

  confuse(side) {
    const m = this.mon(side);
    if (m.ability === 'owntempo' || side.vol.confusedUntil > this.t) return;
    if (this.grounded(side) && this.terrainIs('mistyterrain')) return;
    side.vol.confusedUntil = this.t + 6 * TPS;
    this.ev('confused', {s: side.index});
  }

  forceOut(side) {
    const options = side.mons.filter((m) => !m.fainted && m.slot !== side.active);
    if (!options.length || this.mon(side).ability === 'suctioncups') return;
    const pick = options[Math.floor(this.rng() * options.length)];
    side.act = null;
    this.ev('dragged', {s: side.index, to: pick.slot});
    this.sendOut(side, pick.slot);
    this.onSwitchIn(side);
  }

  clearHazards(side) {
    if (Object.keys(side.hazards).length) this.ev('hazard_clear', {s: side.index, id: 'all'});
    side.hazards = {};
  }

  // ------------------------------------------------------------ status moves
  statusMove(att, def, p) {
    const am = this.mon(att);
    const dm = this.mon(def);
    const self = att === def;
    const id = p.id;
    if (!self && def.vol.protectUntil > this.t && p.shape !== 'field') { this.ev('protected', {s: def.index, move: id}); return; }
    if (!self && p.shape !== 'field') {
      const imm = this.immune(att, def, p);
      if (imm) { this.ev('immune', {s: def.index, move: id}); return; }
      if (dm.ability === 'magicbounce' && !['moldbreaker', 'teravolt', 'turboblaze'].includes(am.ability)) { this.ev('ability', {s: def.index, id: 'magicbounce'}); this.statusMove(def, att, p); return; }
    }
    if (PROTECTS.has(id)) {
      att.vol.protectUntil = this.t + Math.round(1.2 * TPS);
      att.vol.protectKind = id;
      this.ev('protect', {s: att.index, move: id});
      return;
    }
    if (id === 'endure') { att.vol.endureUntil = this.t + 2 * TPS; this.ev('endure_on', {s: att.index}); return; }
    if (id === 'substitute') {
      const cost = Math.floor(am.maxhp / 4);
      if (am.hp <= cost || att.vol.sub > 0) { this.ev('fail', {s: att.index, move: id}); return; }
      am.hp -= cost; att.vol.sub = cost;
      this.ev('substitute', {s: att.index, hp: am.hp, maxhp: am.maxhp});
      return;
    }
    if (p.weather) { this.setWeather(p.weather, att); return; }
    if (p.terrain) { this.setTerrain(p.terrain, att); return; }
    if (HAZARDS.has(p.sideCondition)) {
      const h = def.hazards;
      if (p.sideCondition === 'spikes') h.spikes = Math.min(3, (h.spikes || 0) + 1);
      else if (p.sideCondition === 'toxicspikes') h.toxicspikes = Math.min(2, (h.toxicspikes || 0) + 1);
      else h[p.sideCondition] = 1;
      this.ev('hazard', {s: def.index, id: p.sideCondition});
      return;
    }
    if (SCREENS[p.sideCondition] || SCREENS[id]) {
      const key = SCREENS[p.sideCondition] || SCREENS[id];
      if (key === 'auroraveil' && !this.weatherIs('snow', 'hail')) { this.ev('fail', {s: att.index, move: id}); return; }
      const secs = key === 'tailwind' ? 16 : (this.hasItem(am, 'lightclay') && ['reflect', 'lightscreen', 'auroraveil'].includes(key) ? 40 : 25);
      att.cond[key] = this.t + secs * TPS;
      this.ev('side', {s: att.index, id: key, secs});
      return;
    }
    if (id === 'defog' || id === 'tidyup' || id === 'courtchange') {
      this.clearHazards(att);
      if (id === 'defog') { this.clearHazards(def); def.cond = {}; this.boost(def, {spe: 0}, att, id); }
      return;
    }
    if (id === 'haze') { for (const s of this.sides) if (this.onField(s)) this.mon(s).boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}; this.ev('haze', {}); return; }
    if (id === 'clearsmog') return;
    if (id === 'rest') {
      if (am.hp === am.maxhp) { this.ev('fail', {s: att.index, move: id}); return; }
      this.heal(att, am.maxhp, 'rest');
      am.status = ''; am.toxN = 0;
      this.setStatus(att, 'slp', null, {force: true, secs: 10});
      return;
    }
    if (id === 'wish') { att.wish = {at: this.t + 3 * TPS, hp: Math.floor(am.maxhp / 2)}; this.ev('wish', {s: att.index}); return; }
    if (id === 'aquaring' || id === 'ingrain') { att.vol[id] = true; this.ev('vol', {s: att.index, id}); return; }
    if (id === 'focusenergy' || id === 'dragoncheer') { att.vol.focusEnergy = true; this.ev('vol', {s: att.index, id: 'focusenergy'}); return; }
    if (id === 'charge') { att.vol.charged = true; this.boost(att, {spd: 1}, att, id); return; }
    if (id === 'magnetrise') { att.vol.magnetrise = this.t + 15 * TPS; this.ev('vol', {s: att.index, id}); return; }
    if (id === 'leechseed') {
      if (this.typesOf(def).includes('Grass')) { this.ev('immune', {s: def.index, move: id}); return; }
      def.vol.seededBy = att.index; this.ev('vol', {s: def.index, id}); return;
    }
    if (id === 'taunt') { if (dm.ability === 'oblivious') return; def.vol.tauntUntil = this.t + 10 * TPS; this.ev('vol', {s: def.index, id}); return; }
    if (id === 'torment') { def.vol.tormentUntil = this.t + 10 * TPS; this.ev('vol', {s: def.index, id}); return; }
    if (id === 'healblock') { def.vol.healBlockUntil = this.t + 10 * TPS; this.ev('vol', {s: def.index, id}); return; }
    if (id === 'yawn') { if (!dm.status) { def.vol.yawnAt = this.t + 3 * TPS; this.ev('vol', {s: def.index, id}); } return; }
    if (id === 'curse' && !this.typesOf(att).includes('Ghost')) { this.boost(att, {atk: 1, def: 1, spe: -1}, att, id); return; }
    if (id === 'curse') { this.chip(att, Math.floor(am.maxhp / 2), 'curse'); def.vol.cursed = true; this.ev('vol', {s: def.index, id}); return; }
    if (id === 'bellydrum') {
      if (am.hp <= am.maxhp / 2) { this.ev('fail', {s: att.index, move: id}); return; }
      this.chip(att, Math.floor(am.maxhp / 2), 'bellydrum'); this.boost(att, {atk: 2}, att, id); return;
    }
    if (id === 'painsplit') {
      const avg = Math.floor((am.hp + dm.hp) / 2);
      am.hp = Math.min(am.maxhp, avg); dm.hp = Math.min(dm.maxhp, avg);
      this.ev('painsplit', {s: att.index, hp: am.hp, maxhp: am.maxhp, foeHp: dm.hp, foeMax: dm.maxhp});
      return;
    }
    if (['roar', 'whirlwind'].includes(id)) { if (this.alive(def).length > 1) this.forceOut(def); else this.ev('fail', {s: att.index, move: id}); return; }
    if (['batonpass', 'teleport', 'partingshot', 'shedtail', 'uturn'].includes(id)) {
      if (id === 'partingshot') this.boost(def, {atk: -1, spa: -1}, att, id);
      if (this.alive(att).length > 1) att.vol.pivotPending = this.t;
      return;
    }
    if (p.heal || ['moonlight', 'morningsun', 'synthesis', 'shoreup', 'strengthsap', 'lifedew', 'junglehealing', 'lunarblessing'].includes(id)) {
      let frac = p.heal ? p.heal[0] / p.heal[1] : 0.5;
      if (['moonlight', 'morningsun', 'synthesis'].includes(id)) frac = this.weatherIs('sunnyday', 'desolateland') ? 2 / 3 : this.weather && this.weather.until > this.t ? 0.25 : 0.5;
      if (id === 'shoreup' && this.weatherIs('sandstorm')) frac = 2 / 3;
      if (id === 'strengthsap') { this.heal(att, Math.floor(this.stat(def, 'atk')), id); this.boost(def, {atk: -1}, att, id); return; }
      if (att.vol.healBlockUntil > this.t) { this.ev('fail', {s: att.index, move: id}); return; }
      this.heal(att, Math.floor(am.maxhp * frac), id);
      if (id === 'roost') att.vol.roosted = this.t + 1;
      return;
    }
    let did = false;
    if (p.boosts) {
      const target = p.target === 'self' || self ? att : def;
      this.boost(target, p.boosts, att, id);
      did = true;
    }
    if (p.selfBoosts) { this.boost(att, p.selfBoosts, att, id); did = true; }
    if (p.status) { this.setStatus(def, p.status, att); did = true; }
    if (p.volatile === 'confusion') { this.confuse(def); did = true; }
    if (id === 'swagger') this.boost(def, {atk: 1}, att, id);
    if (id === 'flatter') this.boost(def, {spa: 1}, att, id);
    if (!did) this.ev('noeffect', {s: att.index, move: id});
  }

  // ------------------------------------------------------------ hp, status, boosts
  heal(side, amount, source) {
    const m = this.mon(side);
    if (!m || m.fainted || amount <= 0) return 0;
    const before = m.hp;
    m.hp = Math.min(m.maxhp, m.hp + Math.floor(amount));
    if (m.hp !== before) this.ev('heal', {s: side.index, hp: m.hp, maxhp: m.maxhp, amount: m.hp - before, source});
    return m.hp - before;
  }

  chip(side, amount, source) {
    const m = this.mon(side);
    if (!m || m.fainted || amount <= 0) return;
    if (m.ability === 'magicguard' && !['recoil', 'bellydrum', 'curse', 'substitute'].includes(source)) return;
    const lost = Math.min(m.hp, Math.max(1, Math.floor(amount)));
    m.hp -= lost;
    m.taken += lost;
    this.ev('chip', {s: side.index, hp: m.hp, maxhp: m.maxhp, amount: lost, source});
    if (m.hp <= 0) this.faint(side, null);
    else this.berries(side);
  }

  berries(side) {
    const m = this.mon(side);
    if (!m || m.fainted || !m.item || m.itemUsed) return;
    const f = pct(m);
    if (m.item === 'sitrusberry' && f <= 0.5) { m.itemUsed = true; this.ev('item', {s: side.index, id: m.item}); this.heal(side, Math.floor(m.maxhp / 4), 'sitrusberry'); }
    else if (m.item === 'oranberry' && f <= 0.5) { m.itemUsed = true; this.ev('item', {s: side.index, id: m.item}); this.heal(side, 10, 'oranberry'); }
    else if (['figyberry', 'wikiberry', 'magoberry', 'aguavberry', 'iapapaberry'].includes(m.item) && f <= 0.25) { m.itemUsed = true; this.ev('item', {s: side.index, id: m.item}); this.heal(side, Math.floor(m.maxhp / 3), m.item); }
    const pinch = {liechiberry: 'atk', ganlonberry: 'def', petayaberry: 'spa', apicotberry: 'spd', salacberry: 'spe'}[m.item];
    if (pinch && f <= 0.25 && !m.itemUsed) { m.itemUsed = true; this.ev('item', {s: side.index, id: m.item}); this.boost(side, {[pinch]: 1}, side, m.item); }
  }

  statusImmune(side, status, source) {
    const m = this.mon(side);
    const types = this.typesOf(side);
    if (m.status) return true;
    if (STATUS_IMMUNE[m.ability]?.includes(status)) return true;
    if (status === 'brn' && types.includes('Fire')) return true;
    if (status === 'par' && types.includes('Electric') && this.gen >= 6) return true;
    if ((status === 'psn' || status === 'tox') && (types.includes('Poison') || types.includes('Steel')) && this.mon(source ? source : side)?.ability !== 'corrosion') return true;
    if (status === 'frz' && (types.includes('Ice') || this.weatherIs('sunnyday', 'desolateland'))) return true;
    if (source && source !== side && side.cond.safeguard > this.t) return true;
    if (this.grounded(side) && this.terrainIs('mistyterrain')) return true;
    if (status === 'slp' && this.grounded(side) && this.terrainIs('electricterrain')) return true;
    if (m.ability === 'leafguard' && this.weatherIs('sunnyday', 'desolateland')) return true;
    if (m.ability === 'shieldsdown' && pct(m) > 0.5) return true;
    return false;
  }

  /** Burn, paralysis and poison last until cured; sleep is Z-A's drowsiness (10 s, cooldowns at half speed); freeze holds the
   * Pokémon still for 3 s. */
  setStatus(side, status, source, {force = false, secs = 0} = {}) {
    const m = this.mon(side);
    if (!m || m.fainted) return false;
    if (!force && this.statusImmune(side, status, source)) return false;
    m.status = status;
    m.toxN = status === 'tox' ? 1 : 0;
    m.statusUntil = status === 'slp' ? this.t + (secs || 10) * TPS : status === 'frz' ? this.t + 3 * TPS : 0;
    if (status === 'frz' && side.act && side.act.kind !== 'switch') side.act = null;
    this.ev('status', {s: side.index, status});
    if (m.ability === 'synchronize' && source && source !== side && ['brn', 'par', 'psn', 'tox'].includes(status)) this.setStatus(source, status, side);
    const cure = STATUS_CURES[m.item];
    if (cure && cure.includes(status) && !m.itemUsed) { m.itemUsed = true; this.ev('item', {s: side.index, id: m.item}); this.cure(side, status); }
    return true;
  }

  cure(side, status) {
    const m = this.mon(side);
    if (m.status && (!status || m.status === status)) { this.ev('cure', {s: side.index, status: m.status}); m.status = ''; m.toxN = 0; m.statusUntil = 0; }
  }

  /** Z-A's stat changes: one stage at most, up or down, for BOOST_SECONDS; a change in the other direction cancels. */
  boost(side, boosts, source, cause = '') {
    const m = this.mon(side);
    if (!m || m.fainted) return;
    const fromFoe = source && source !== side;
    for (const [k, raw] of Object.entries(boosts || {})) {
      if (!BOOSTABLE.includes(k) || !raw) continue;
      let delta = Math.sign(raw);
      if (m.ability === 'contrary') delta = -delta;
      if (delta < 0 && fromFoe) {
        if (['clearbody', 'whitesmoke', 'fullmetalbody'].includes(m.ability) || side.cond.mist > this.t) { this.ev('ability', {s: side.index, id: m.ability || 'mist'}); continue; }
        if (k === 'atk' && m.ability === 'hypercutter') continue;
        if (k === 'def' && m.ability === 'bigpecks') continue;
        if (this.hasItem(m, 'clearamulet')) continue;
      }
      const before = m.boosts[k];
      const after = clamp(before + delta, -1, 1);
      m.boostUntil[k] = this.t + BOOST_SECONDS * TPS;
      if (after === before) { this.ev('boost', {s: side.index, stat: k, stage: after, same: true, cause}); continue; }
      m.boosts[k] = after;
      this.ev('boost', {s: side.index, stat: k, stage: after, delta, cause});
      if (delta < 0 && fromFoe) {
        if (m.ability === 'defiant') this.boost(side, {atk: 1}, side, 'defiant');
        if (m.ability === 'competitive') this.boost(side, {spa: 1}, side, 'competitive');
        if (this.hasItem(m, 'whiteherb')) { m.itemUsed = true; for (const b of BOOSTABLE) if (m.boosts[b] < 0) m.boosts[b] = 0; this.ev('item', {s: side.index, id: 'whiteherb'}); }
      }
    }
  }

  setWeather(id, side) {
    const m = side ? this.mon(side) : null;
    const rock = {sunnyday: 'heatrock', raindance: 'damprock', sandstorm: 'smoothrock', snow: 'icyrock', hail: 'icyrock'}[id];
    const secs = m && rock && this.hasItem(m, rock) ? 50 : 30;
    this.weather = {id, until: this.t + secs * TPS};
    this.ev('weather', {id, secs});
  }

  setTerrain(id, side) {
    const m = side ? this.mon(side) : null;
    const secs = m && this.hasItem(m, 'terrainextender') ? 50 : 30;
    this.terrain = {id, until: this.t + secs * TPS};
    this.ev('terrain', {id, secs});
  }

  faint(side, by, byMon = null) {
    const m = this.mon(side);
    if (m.fainted) return;
    m.hp = 0;
    m.fainted = true;
    side.act = null;
    this.marks = this.marks.filter((mk) => !(mk.s === side.index && mk.mon === side.active));
    if (by && byMon) byMon.kos++;
    else if (by) this.mon(by).kos++;
    this.ev('faint', {s: side.index, slot: side.active, species: m.species, by: by ? by.index : -1});
    // Z-A Battle Club: the switch count comes back after every knockout
    for (const s of this.sides) s.switchesLeft = MAX_SWITCHES;
    if (this.alive(side).length) { side.need = true; side.needSince = this.t; }
  }

  // ------------------------------------------------------------ timers
  updateTimers() {
    for (const side of this.sides) {
      const m = this.mon(side);
      if (!m || m.fainted) continue;
      // cooldowns (drowsy: half speed, as in Z-A)
      for (let i = 0; i < m.cds.length; i++) {
        if (m.cds[i] > 0) m.cds[i] = Math.max(0, m.cds[i] - (m.status === 'slp' ? 0.5 : 1));
      }
      // stat changes wear off
      for (const k of BOOSTABLE) {
        if (m.boosts[k] && m.boostUntil[k] <= this.t) { m.boosts[k] = 0; this.ev('boost_end', {s: side.index, stat: k}); }
      }
      if ((m.status === 'slp' || m.status === 'frz') && m.statusUntil <= this.t) this.cure(side, m.status);
      if (side.vol.yawnAt && side.vol.yawnAt <= this.t) { delete side.vol.yawnAt; this.setStatus(side, 'slp', null); }
      if (side.vol.confusedUntil && side.vol.confusedUntil <= this.t) { delete side.vol.confusedUntil; this.ev('confusion_end', {s: side.index}); }
      if (side.vol.protectUntil && side.vol.protectUntil <= this.t) delete side.vol.protectUntil;
      if (side.wish && side.wish.at <= this.t) { this.heal(side, side.wish.hp, 'wish'); side.wish = null; }
      if (side.vol.speedboostAt && side.vol.speedboostAt <= this.t && m.ability === 'speedboost') { this.boost(side, {spe: 1}, side, 'speedboost'); side.vol.speedboostAt = this.t + 8 * TPS; }
      // a pivot move ended: the Pokémon goes back (an AI picks at once, a person has REPLACE_TIMEOUT to choose)
      if (side.vol.pivotPending && !side.act) {
        delete side.vol.pivotPending;
        side.need = true;
        side.needSince = this.t;
        this.ev('pivot', {s: side.index});
      }
      // residual effects every RESIDUAL_SECONDS since this Pokémon came in
      if ((this.t - (side.vol.in || 0)) % RESIDUAL === 0 && this.t > (side.vol.in || 0)) this.residual(side);
    }
    if (this.weather && this.weather.until <= this.t) { this.ev('weather_end', {id: this.weather.id}); this.weather = null; }
    if (this.terrain && this.terrain.until <= this.t) { this.ev('terrain_end', {id: this.terrain.id}); this.terrain = null; }
  }

  residual(side) {
    const m = this.mon(side);
    const foe = this.foe(side);
    const types = this.typesOf(side);
    const hp16 = Math.max(1, Math.floor(m.maxhp / 16));
    if (this.weatherIs('sandstorm') && !types.some((x) => ['Rock', 'Ground', 'Steel'].includes(x)) && !['sandveil', 'sandrush', 'sandforce', 'overcoat'].includes(m.ability) && !this.hasItem(m, 'safetygoggles')) this.chip(side, hp16, 'sandstorm');
    if (this.weatherIs('hail') && !types.includes('Ice') && !['icebody', 'snowcloak', 'overcoat'].includes(m.ability)) this.chip(side, hp16, 'hail');
    if (m.fainted) return;
    if (this.weatherIs('raindance', 'primordialsea') && (m.ability === 'raindish' || m.ability === 'dryskin')) this.heal(side, m.ability === 'dryskin' ? m.maxhp / 8 : hp16, m.ability);
    if (this.weatherIs('snow', 'hail') && m.ability === 'icebody') this.heal(side, hp16, m.ability);
    if (this.weatherIs('sunnyday', 'desolateland') && ['dryskin', 'solarpower'].includes(m.ability)) this.chip(side, m.maxhp / 8, m.ability);
    if (this.terrainIs('grassyterrain') && this.grounded(side)) this.heal(side, hp16, 'grassyterrain');
    if (side.vol.aquaring || side.vol.ingrain) this.heal(side, hp16, side.vol.aquaring ? 'aquaring' : 'ingrain');
    if (this.hasItem(m, 'leftovers') || (this.hasItem(m, 'blacksludge') && types.includes('Poison'))) this.heal(side, hp16, m.item);
    if (this.hasItem(m, 'blacksludge') && !types.includes('Poison')) this.chip(side, m.maxhp / 8, 'blacksludge');
    if (m.fainted) return;
    if (side.vol.seededBy != null && this.onField(foe)) {
      const amount = Math.max(1, Math.floor(m.maxhp / 8));
      this.chip(side, amount, 'leechseed');
      this.heal(foe, amount, 'leechseed');
    }
    if (m.fainted) return;
    if (side.vol.trapUntil > this.t) this.chip(side, m.maxhp / 8, 'trap');
    if (side.vol.cursed) this.chip(side, m.maxhp / 4, 'curse');
    if (m.fainted) return;
    if (m.status === 'brn') this.chip(side, m.maxhp / (m.ability === 'heatproof' ? 32 : 16), 'brn');
    if (m.status === 'psn' || m.status === 'tox') {
      if (m.ability === 'poisonheal') this.heal(side, m.maxhp / 8, 'poisonheal');
      else if (m.status === 'psn') this.chip(side, m.maxhp / 8, 'psn');
      else { this.chip(side, (m.maxhp * Math.min(15, m.toxN)) / 16, 'tox'); m.toxN++; }
    }
    if (m.fainted) return;
    if (m.ability === 'shedskin' && m.status && this.rng() < 0.3) this.cure(side);
    if (m.ability === 'hydration' && m.status && this.weatherIs('raindance', 'primordialsea')) this.cure(side);
    if (this.hasItem(m, 'flameorb') && !m.status) this.setStatus(side, 'brn', null);
    if (this.hasItem(m, 'toxicorb') && !m.status) this.setStatus(side, 'tox', null);
  }

  checkEnd() {
    if (this.ended) return;
    const out = this.sides.map((s) => this.alive(s).length === 0);
    if (out[0] || out[1]) {
      this.finish(out[0] && out[1] ? 2 : out[0] ? 1 : 0, 'ko');
      return;
    }
    if (this.t >= this.timeLimit) {
      // time: more Pokémon standing wins, then more HP left in total
      const score = this.sides.map((s) => [this.alive(s).length, s.mons.reduce((a, m) => a + pct(m), 0)]);
      let w = 2;
      if (score[0][0] !== score[1][0]) w = score[0][0] > score[1][0] ? 0 : 1;
      else if (Math.abs(score[0][1] - score[1][1]) > 1e-6) w = score[0][1] > score[1][1] ? 0 : 1;
      this.finish(w, 'time');
    }
  }

  forfeit(sideId) {
    if (this.ended) return;
    const side = this.sides.find((s) => s.id === sideId);
    if (!side) throw new EngineError('invalid', `No side ${sideId}.`);
    this.ev('forfeit', {s: side.index});
    this.finish(1 - side.index, 'forfeit');
  }

  finish(winner, reason) {
    this.ended = true;
    this.winner = winner;
    this.reason = reason;
    this.ev('end', {winner, reason});
  }

  // ------------------------------------------------------------ views
  /** What a screen draws this tick. */
  view() {
    return {
      t: this.t, seconds: this.t / TPS, time_limit: this.timeLimit / TPS, ended: this.ended, winner: this.winner, reason: this.reason,
      weather: this.weather && this.weather.until > this.t ? {id: this.weather.id, left: (this.weather.until - this.t) / TPS} : null,
      terrain: this.terrain && this.terrain.until > this.t ? {id: this.terrain.id, left: (this.terrain.until - this.t) / TPS} : null,
      projectiles: this.projectiles.map((p) => ({id: p.id, s: p.s, x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r, type: p.type, shape: p.shape, move: p.move})),
      marks: this.marks.map((m) => ({s: m.s, x: m.x, y: m.y, r: m.r, at: m.at})),
      sides: this.sides.map((s) => {
        const m = this.mon(s);
        return {
          id: s.id, name: s.name, ai: !!s.ai, active: s.active, x: s.x, y: s.y, fx: s.fx, fy: s.fy, r: this.radius(s), moving: s.moving,
          act: s.act ? {kind: s.act.kind, slot: s.act.slot ?? -1, left: s.act.end != null ? Math.max(0, s.act.end - this.t) : 0,
            total: s.act.start != null ? s.act.end - s.act.start : 0, tx: s.act.tx, ty: s.act.ty} : null,
          need: s.need, switches_left: s.switchesLeft, roll_ready: Math.max(0, s.rollReady - this.t) / TPS, cond: Object.fromEntries(Object.entries(s.cond).filter(([, v]) => v > this.t).map(([k, v]) => [k, (v - this.t) / TPS])),
          hazards: {...s.hazards}, protect: s.vol.protectUntil > this.t, sub: s.vol.sub > 0, confused: s.vol.confusedUntil > this.t,
          trapped: s.vol.trapUntil > this.t, taunt: s.vol.tauntUntil > this.t, invulnerable: this.semiInvulnerable(s),
          mons: s.mons.map((x, i) => ({slot: i, species: x.species, name: x.name, num: x.num, forme: x.forme, sprite_id: x.sprite_id, shiny: x.shiny, level: x.level,
            hp: x.hp, maxhp: x.maxhp, status: x.status, fainted: x.fainted, types: x.types, item: x.itemUsed ? '' : x.item_name, ability: x.ability_name,
            boosts: {...x.boosts},
            moves: x.moves.map((mv, j) => ({...mv, cd: x.cds[j] / TPS, total: i === s.active && m && !m.fainted ? this.cooldownTicks(s, x.profiles[j]) / TPS : mv.final,
              blocked: i === s.active && m && !m.fainted ? this.usableReason(s, j) : ''}))})),
        };
      }),
    };
  }

  usableReason(side, slot) {
    const r = this.usable(side, slot);
    return r === 'cooldown' ? '' : r;
  }

  /** Per side and per Pokémon, in the shape the classic battles' summary has (so lists and stats read both). */
  summary() {
    const sides = {};
    for (const s of this.sides) {
      sides[s.id] = {name: s.name, kos: s.mons.reduce((a, m) => a + m.kos, 0), lost: s.mons.filter((m) => m.fainted).length,
        pokemon: s.mons.map((m) => ({side: s.id, name: m.name, species: m.species, kos: m.kos, damage: Math.round((m.dealt / Math.max(1, this.foeHpTotal(s))) * 100) / 100,
          dealt: m.dealt, taken: m.taken, fainted: m.fainted, switches: m.switchesIn, moves: m.uses, hp: m.hp, maxhp: m.maxhp}))};
    }
    const w = this.winner;
    return {mode: 'realtime', turns: 0, seconds: Math.round((this.t / TPS) * 10) / 10, reason: this.reason,
      winner: w === 0 || w === 1 ? this.sides[w].name : '', winner_side: w === 0 || w === 1 ? this.sides[w].id : '', sides};
  }

  foeHpTotal(side) {
    const foe = this.foe(side);
    return foe.mons.reduce((a, m) => a + m.maxhp, 0) / Math.max(1, foe.mons.length);
  }
}

/** Run a battle to the end: AI seats play themselves, people's seats replay `inputs` (their recorded `inputLog`; a person's seat
 * without inputs stands still). `forfeit` + `tick` stop at that tick with that side giving up. */
export function rtRun(spec, {inputs = [], maxSeconds = 0, forfeit = '', tick = 0} = {}) {
  const b = new RtBattle(spec);
  const limit = (maxSeconds || b.timeLimit / TPS + 5) * TPS;
  const stop = forfeit ? Math.max(0, Number(tick) || 0) : Infinity;
  fastForward(b, inputs, Math.min(limit, stop));
  if (!b.ended && forfeit) b.forfeit(forfeit);
  if (!b.ended) b.finish(2, 'time');
  return b;
}

/** Feed a battle the recorded inputs up to `until` (a reload of a live battle, or a seek in a replay). */
export function fastForward(b, inputs, until) {
  const byTick = new Map();
  for (const row of inputs || []) {
    if (!byTick.has(row[0])) byTick.set(row[0], []);
    byTick.get(row[0]).push(row);
  }
  const held = [null, null];
  while (!b.ended && b.t < until) b.step(inputFrame(b, byTick.get(b.t + 1) || [], held));
  return {byTick, held};
}

/** The inputs of the people's seats for the next tick, from the recorded rows of that tick and what they were holding. */
export function inputFrame(b, rows, held) {
  const now = [null, null];
  for (const [, side, mx, my, use, dodge, sw] of rows) {
    held[side] = {mx, my};
    now[side] = {mx, my, use, dodge: !!dodge, sw};
  }
  const frame = {};
  for (const i of [0, 1]) {
    if (b.sides[i].ai) continue;
    frame[b.sides[i].id] = now[i] || (held[i] ? {mx: held[i].mx, my: held[i].my, use: -1, dodge: false, sw: -1} : null);
  }
  return frame;
}

/** English lines of what happened, for the battle's stored log and for assistants. */
export function eventLines(battle) {
  const names = battle.sides.map((s) => s.name);
  const monName = (si, slot) => battle.sides[si].mons[slot]?.name || '?';
  const lines = [`|rt|${names[0]} vs ${names[1]}|${battle.formatId}|seed ${battle.seed}`];
  const active = [0, 0];
  const sec = (t) => (t / TPS).toFixed(1);
  for (const e of battle.events) {
    const who = e.s != null ? `${names[e.s]}'s ${monName(e.s, active[e.s])}` : '';
    switch (e.k) {
      case 'switch': active[e.s] = e.slot; lines.push(`[${sec(e.t)}] ${names[e.s]} sent out ${monName(e.s, e.slot)}`); break;
      case 'use': lines.push(`[${sec(e.t)}] ${who} used ${e.name}`); break;
      case 'hit': lines.push(`[${sec(e.t)}] ${names[e.s]}'s ${monName(e.s, active[e.s])} took ${e.dmg} (${e.hp}/${e.maxhp})${e.crit ? ', critical hit' : ''}${e.eff > 1 ? ', super effective' : e.eff < 1 && e.eff > 0 ? ', not very effective' : ''}`); break;
      case 'miss': lines.push(`[${sec(e.t)}] ${who}'s ${e.move} missed (dodged)`); break;
      case 'protected': lines.push(`[${sec(e.t)}] ${who} protected itself`); break;
      case 'immune': lines.push(`[${sec(e.t)}] ${who} is not affected`); break;
      case 'status': lines.push(`[${sec(e.t)}] ${who} got ${e.status}`); break;
      case 'boost': if (!e.same) lines.push(`[${sec(e.t)}] ${who}: ${e.stat} ${e.stage > 0 ? 'up' : e.stage < 0 ? 'down' : 'back to normal'}`); break;
      case 'heal': lines.push(`[${sec(e.t)}] ${who} restored HP (${e.hp}/${e.maxhp})`); break;
      case 'chip': lines.push(`[${sec(e.t)}] ${who} was hurt by ${e.source} (${e.hp}/${e.maxhp})`); break;
      case 'faint': lines.push(`[${sec(e.t)}] ${names[e.s]}'s ${monName(e.s, e.slot)} fainted`); break;
      case 'recall': lines.push(`[${sec(e.t)}] ${names[e.s]} called back ${monName(e.s, e.slot)} (${e.left} switches left)`); break;
      case 'roll': break;
      case 'weather': lines.push(`[${sec(e.t)}] Weather: ${e.id} for ${e.secs} s`); break;
      case 'terrain': lines.push(`[${sec(e.t)}] Terrain: ${e.id} for ${e.secs} s`); break;
      case 'hazard': lines.push(`[${sec(e.t)}] ${e.id} on ${names[e.s]}'s side`); break;
      case 'side': lines.push(`[${sec(e.t)}] ${names[e.s]}: ${e.id} for ${e.secs} s`); break;
      case 'flinch': lines.push(`[${sec(e.t)}] ${who} flinched and lost its move`); break;
      case 'forfeit': lines.push(`[${sec(e.t)}] ${names[e.s]} forfeited`); break;
      case 'end': lines.push(`[${sec(e.t)}] ${e.winner === 0 || e.winner === 1 ? `${names[e.winner]} won` : 'Tie'} (${e.reason})`); break;
      default: break;
    }
  }
  return lines;
}
