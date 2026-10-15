// Damage calculator: the range of damage each move of one Pokémon does to another, measured with the simulator's own formula
// (every generation, ability, item, weather, terrain and screen counts) over the 16 damage rolls, with and without a critical hit.
import {Battle} from '@pkmn/sim';
import {buildFormatId, completeSets, EngineError, importTeam, toID} from './core.mjs';
import {prepareTeam} from './match.mjs';

const WEATHERS = {sun: 'sunnyday', rain: 'raindance', sand: 'sandstorm', hail: 'hail', snow: 'snowscape'};
const TERRAINS = {electric: 'electricterrain', grassy: 'grassyterrain', psychic: 'psychicterrain', misty: 'mistyterrain'};
const SCREENS = ['reflect', 'lightscreen', 'auroraveil'];

function oneSet(input, what) {
  const sets = importTeam(Array.isArray(input) ? input : typeof input === 'object' && input ? [input] : input);
  if (!sets.length) throw new EngineError('invalid', `No ${what} Pokémon given.`);
  return sets[0];
}

function singlesFormat(format) {
  const id = buildFormatId(format || 'gen9customgame');
  // the calculator compares one Pokémon against one: a doubles format gives the same numbers without the spread modifier
  const gen = Number(String(id).match(/^gen(\d)/)?.[1] || 9);
  return {id: `gen${gen}customgame`, gen};
}

function setBoosts(mon, boosts) {
  for (const [k, v] of Object.entries(boosts || {})) {
    if (!['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'].includes(k)) continue;
    mon.boosts[k] = Math.max(-6, Math.min(6, Math.trunc(Number(v) || 0)));
  }
}

/** Hits needed to knock out `hp`: at best (every roll high) and for sure (every roll low); null when the move does nothing. */
function koText(min, max, hp) {
  if (max <= 0) return {hits: null, hits_sure: null};
  return {hits: Math.ceil(hp / max), hits_sure: min > 0 ? Math.ceil(hp / min) : null};
}

/**
 * How many times a multi-hit move strikes, with the weights the simulator uses (Skill Link, Loaded Dice, gen 2–4 vs 5+).
 * Each entry is `{hits, weight}`; weights are relative within that move.
 */
function hitDistribution(mv, atk, gen) {
  const ability = toID(atk.ability);
  const item = toID(atk.item);
  if (!mv.multihit) return {counts: [{hits: 1, weight: 1}], min: 1, max: 1};
  if (typeof mv.multihit === 'number') {
    const n = mv.multihit;
    if (n === 10 && item === 'loadeddice') {
      return {counts: [4, 5, 6, 7, 8, 9, 10].map((hits) => ({hits, weight: 1})), min: 4, max: 10};
    }
    return {counts: [{hits: n, weight: 1}], min: n, max: n};
  }
  const [lo, hi] = mv.multihit;
  if (ability === 'skilllink') return {counts: [{hits: hi, weight: 1}], min: hi, max: hi};
  if (lo === 2 && hi === 5) {
    if (gen >= 5) {
      if (item === 'loadeddice') return {counts: [{hits: 4, weight: 1}, {hits: 5, weight: 1}], min: 4, max: 5};
      // 35-35-15-15 out of 100 → 7-7-3-3 out of 20
      return {counts: [{hits: 2, weight: 7}, {hits: 3, weight: 7}, {hits: 4, weight: 3}, {hits: 5, weight: 3}], min: 2, max: 5};
    }
    // gen 2–4: 3/8, 3/8, 1/8, 1/8
    return {counts: [{hits: 2, weight: 3}, {hits: 3, weight: 3}, {hits: 4, weight: 1}, {hits: 5, weight: 1}], min: 2, max: 5};
  }
  const counts = [];
  for (let hits = lo; hits <= hi; hits++) counts.push({hits, weight: 1});
  return {counts, min: lo, max: hi};
}

/** Ways a sequence of independent hit-damage lists (one array per strike) totals at least `hp`. */
function ohkoFromHits(hitRolls, hp) {
  let dp = new Map([[0, 1]]);
  for (const rolls of hitRolls) {
    const next = new Map();
    for (const [dmg, ways] of dp) {
      for (const roll of rolls) {
        const nd = Math.min(hp, dmg + roll);
        next.set(nd, (next.get(nd) || 0) + ways);
      }
    }
    dp = next;
  }
  let total = 0;
  let ohko = 0;
  for (const [dmg, ways] of dp) {
    total += ways;
    if (dmg >= hp) ohko += ways;
  }
  return {ohko, total};
}

/**
 * Exact OHKO chance over a hit-count distribution. `perHit` is an array of roll lists indexed by strike (1-based stored at
 * index hit-1); when every strike shares one list, pass that list once and set `identical`.
 */
function ohkoChance(perHit, dist, hp, identical) {
  let space = 0;
  let ohko = 0;
  for (const {hits, weight} of dist.counts) {
    const hitRolls = identical
      ? Array.from({length: hits}, () => perHit[0])
      : perHit.slice(0, hits);
    const {ohko: o, total} = ohkoFromHits(hitRolls, hp);
    space += weight * total;
    ohko += weight * o;
  }
  if (!space) return {ohko_rolls: 0, roll_space: 0, ohko_chance: null};
  return {ohko_rolls: ohko, roll_space: space, ohko_chance: ohko / space};
}

/**
 * {attacker, defender, format?, moves?, attacker_boosts?, defender_boosts?, attacker_tera?, defender_tera?, attacker_mega?, defender_mega?, weather?, terrain?,
 *  screens?: ['reflect', ...], defender_hp?: 0-100} → {attacker, defender, defender_hp, moves: [{move, type, category, rolls, min, max,
 *  min_pct, max_pct, crit_min, crit_max, ohko_rolls, roll_space, ohko_chance, hits_min, hits_max, ko}]}
 *
 * Rolls: gen 1–2 enumerate the 39 factors `random(217, 256)`; gen 3+ the 16 modern rolls. Multi-hit moves keep those as the
 * per-strike rolls and combine them (independent strikes, Skill Link / Loaded Dice / 2–5 weights) for min/max and OHKO.
 */
export function damageCalc(a) {
  const {id: formatId, gen} = singlesFormat(a.format);
  const atkSet = completeSets([oneSet(a.attacker, 'attacking')], formatId)[0];
  // the defender only takes hits: a Pokémon given without moves gets a harmless one so the simulator accepts it
  const defIn = oneSet(a.defender, 'defending');
  if (!(defIn.moves || []).filter(Boolean).length) defIn.moves = ['Splash'];
  const defSet = completeSets([defIn], formatId)[0];
  const b = new Battle({formatid: formatId, seed: [1, 2, 3, 4]});
  b.send = () => {};
  b.setPlayer('p1', {name: 'A', team: prepareTeam([atkSet], formatId, {})});
  b.setPlayer('p2', {name: 'D', team: prepareTeam([defSet], formatId, {})});
  if (b.p1.activeRequest?.teamPreview) b.makeChoices('default', 'default');
  const atk = b.p1.active[0];
  const def = b.p2.active[0];
  if (!atk || !def) throw new EngineError('invalid', 'The simulator could not put both Pokémon on the field.');
  // switch-in effects (Intimidate, Drought...) have happened; what the caller states wins over them
  if (a.weather !== undefined) {
    const w = WEATHERS[toID(a.weather)] || toID(a.weather);
    if (w) b.field.setWeather(w, atk); else b.field.clearWeather();
  }
  if (a.terrain !== undefined && gen >= 6) {
    const t = TERRAINS[toID(a.terrain).replace(/terrain$/, '')] || toID(a.terrain);
    if (t) b.field.setTerrain(t, atk); else b.field.clearTerrain();
  }
  for (const s of a.screens || []) if (SCREENS.includes(toID(s))) b.p2.addSideCondition(toID(s), def);
  if (a.attacker_boosts) { atk.clearBoosts(); setBoosts(atk, a.attacker_boosts); }
  if (a.defender_boosts) { def.clearBoosts(); setBoosts(def, a.defender_boosts); }
  for (const [mon, tera] of [[atk, a.attacker_tera], [def, a.defender_tera]]) {
    if (!tera || gen < 9) continue;
    if (tera !== true) mon.teraType = String(tera);
    if (mon.canTerastallize !== null) b.actions.terastallize(mon);
  }
  for (const [mon, mega] of [[atk, a.attacker_mega], [def, a.defender_mega]]) {
    if (mega && (mon.canMegaEvo || mon.canUltraBurst)) b.actions.runMegaEvo(mon);
  }
  if (a.defender_hp !== undefined) def.hp = Math.max(1, Math.round(def.maxhp * Math.min(100, Math.max(1, Number(a.defender_hp))) / 100));
  const hp = def.hp;
  const moveIds = (a.moves && a.moves.length ? a.moves : atk.moveSlots.map((m) => m.id)).map(toID).filter(Boolean).slice(0, 8);
  const tr = b.trunc;
  const realRandomizer = b.randomizer.bind(b);
  const realRandom = b.random.bind(b);
  const realRandomChance = b.randomChance.bind(b);
  // the move as it is used: type changes (Pixilate, Weather Ball, Tera Blast...) and move changes run as in a real turn
  const prepared = (id) => {
    const move = b.dex.getActiveMove(id);
    b.activeMove = move;
    b.activePokemon = atk;
    b.activeTarget = def;
    try {
      b.singleEvent('ModifyType', move, null, atk, def, move, move);
      b.singleEvent('ModifyMove', move, null, atk, def, move, move);
      b.runEvent('ModifyType', atk, def, move, move);
      b.runEvent('ModifyMove', atk, def, move, move);
    } catch { /* the plain move */ }
    return move;
  };
  /** One strike's damage for every damage roll of this generation (39 in gen 1–2, 16 from gen 3). */
  const measureStrike = (id, crit, hit) => {
    const rolls = [];
    b.randomChance = () => false; // willCrit below decides critical hits; do not let a stray roll crit mid-enumeration
    if (gen <= 2) {
      for (let r = 217; r <= 255; r++) {
        b.random = (from, to) => (from === 217 && to === 256 ? r : realRandom(from, to));
        const move = prepared(id);
        move.willCrit = crit;
        if (hit) move.hit = hit;
        let d;
        try { d = b.actions.getDamage(atk, def, move, true); } catch { d = 0; }
        rolls.push(typeof d === 'number' ? d : 0);
      }
      b.random = realRandom;
    } else {
      for (let r = 15; r >= 0; r--) {
        b.randomizer = (base) => tr(tr(base * (100 - r)) / 100);
        const move = prepared(id);
        move.willCrit = crit;
        if (hit) move.hit = hit;
        let d;
        try { d = b.actions.getDamage(atk, def, move, true); } catch { d = 0; }
        rolls.push(typeof d === 'number' ? d : 0);
      }
      b.randomizer = realRandomizer;
    }
    b.randomChance = realRandomChance;
    return rolls;
  };
  const sameRolls = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const out = [];
  for (const id of moveIds) {
    const mv = b.dex.moves.get(id);
    if (!mv.exists) { out.push({move: id, error: 'unknown move'}); continue; }
    const used = prepared(id);
    const row = {move: mv.name, id: mv.id, type: used.type, category: used.category, power: used.basePower || 0};
    if (used.category === 'Status') {
      out.push({
        ...row, hits: 0, hits_min: 0, hits_max: 0, rolls: [], min: 0, max: 0, min_pct: 0, max_pct: 0,
        crit_min: 0, crit_max: 0, ohko_rolls: 0, roll_space: 0, ohko_chance: null, ko: koText(0, 0, hp), immune: false,
      });
      continue;
    }
    // ModifyMove (Skill Link, Parental Bond…) may fix or widen multihit on the used move
    const dist = hitDistribution({multihit: used.multihit ?? mv.multihit}, atk, gen);
    // measure each strike: Triple Kick / Triple Axel change power with move.hit; most multi-hits share one distribution
    const perHit = [];
    const perCrit = [];
    for (let hit = 1; hit <= dist.max; hit++) {
      perHit.push(measureStrike(id, false, dist.max > 1 ? hit : 0));
      perCrit.push(measureStrike(id, true, dist.max > 1 ? hit : 0));
    }
    const identical = perHit.every((r) => sameRolls(r, perHit[0]));
    const rolls = perHit[0];
    let min;
    let max;
    let critMin;
    let critMax;
    if (identical) {
      const lo = Math.min(...rolls);
      const hi = Math.max(...rolls);
      min = dist.min * lo;
      max = dist.max * hi;
      critMin = dist.min * Math.min(...perCrit[0]);
      critMax = dist.max * Math.max(...perCrit[0]);
    } else {
      // fewest hits with each strike's lowest roll; most hits with each strike's highest
      min = perHit.slice(0, dist.min).reduce((s, r) => s + Math.min(...r), 0);
      max = perHit.slice(0, dist.max).reduce((s, r) => s + Math.max(...r), 0);
      critMin = perCrit.slice(0, dist.min).reduce((s, r) => s + Math.min(...r), 0);
      critMax = perCrit.slice(0, dist.max).reduce((s, r) => s + Math.max(...r), 0);
    }
    const ohko = ohkoChance(identical ? [rolls] : perHit, dist, hp, identical);
    out.push({
      ...row,
      hits: dist.min === dist.max ? dist.max : dist.min,
      hits_min: dist.min,
      hits_max: dist.max,
      rolls, min, max,
      min_pct: Math.round((1000 * min) / def.maxhp) / 10, max_pct: Math.round((1000 * max) / def.maxhp) / 10,
      crit_min: critMin, crit_max: critMax,
      ohko_rolls: ohko.ohko_rolls, roll_space: ohko.roll_space, ohko_chance: ohko.ohko_chance,
      ko: koText(min, max, hp),
      immune: max === 0 && !def.runImmunity(b.dex.getActiveMove(id)),
    });
  }
  b.activeMove = null;
  b.activePokemon = null;
  b.activeTarget = null;
  const who = (m) => ({species: m.species.name, can_mega: !!(m.canMegaEvo || m.canUltraBurst), level: m.level, item: m.item ? b.dex.items.get(m.item).name : '',
    ability: b.dex.abilities.get(m.ability).name, types: m.getTypes(), boosts: {...m.boosts},
    stats: {...m.storedStats}, maxhp: m.maxhp});
  return {format: formatId, attacker: who(atk), defender: who(def), defender_hp: hp,
    field: {weather: b.field.weather || '', terrain: b.field.terrain || '', screens: Object.keys(b.p2.sideConditions)}, moves: out};
}
