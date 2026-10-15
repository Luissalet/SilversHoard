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
 * {attacker, defender, format?, moves?, attacker_boosts?, defender_boosts?, attacker_tera?, defender_tera?, attacker_mega?, defender_mega?, weather?, terrain?,
 *  screens?: ['reflect', ...], defender_hp?: 0-100} → {attacker, defender, defender_hp, moves: [{move, type, category, rolls, min, max,
 *  min_pct, max_pct, crit_min, crit_max, ohko_rolls, ko}]}
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
  const out = [];
  for (const id of moveIds) {
    const mv = b.dex.moves.get(id);
    if (!mv.exists) { out.push({move: id, error: 'unknown move'}); continue; }
    const used = prepared(id);
    const row = {move: mv.name, id: mv.id, type: used.type, category: used.category, power: used.basePower || 0};
    if (used.category === 'Status') { out.push({...row, hits: 0, rolls: [], min: 0, max: 0, min_pct: 0, max_pct: 0, crit_min: 0, crit_max: 0, ohko_rolls: 0, ko: koText(0, 0, hp), immune: false}); continue; }
    const measure = (crit) => {
      const rolls = [];
      for (let r = 15; r >= 0; r--) {
        b.randomizer = (base) => tr(tr(base * (100 - r)) / 100);
        const move = prepared(id);
        move.willCrit = crit;
        let d;
        try { d = b.actions.getDamage(atk, def, move, true); } catch { d = 0; }
        rolls.push(typeof d === 'number' ? d : 0);
      }
      b.randomizer = realRandomizer;
      return rolls;
    };
    let rolls = measure(false);
    const crit = measure(true);
    let hits = 1;
    if (Array.isArray(mv.multihit)) hits = toID(atk.ability) === 'skilllink' ? mv.multihit[1] : mv.multihit[0];
    else if (typeof mv.multihit === 'number') hits = mv.multihit;
    if (hits > 1) rolls = rolls.map((x) => x * hits);
    const min = Math.min(...rolls);
    const max = Math.max(...rolls);
    out.push({
      ...row, hits, rolls, min, max,
      min_pct: Math.round((1000 * min) / def.maxhp) / 10, max_pct: Math.round((1000 * max) / def.maxhp) / 10,
      crit_min: Math.min(...crit) * hits, crit_max: Math.max(...crit) * hits,
      ohko_rolls: rolls.filter((x) => x >= hp).length,
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
