// Rosters for mass battles (mass.mjs): who fights, picked by generation, by strength, by group (starters, legendaries) or by name,
// with a set worked out for each Pokémon from what it can learn: its best moves of its own types, coverage, and one useful extra
// (healing, a stat boost or a status) when it has one. Node only: it reads learnsets, which the browser bundle does not need.
import {Dex, toID} from '@pkmn/sim';
import {makeRng} from '../ai.mjs';
import {rtMove} from './moves.mjs';
import {RtError} from './team.mjs';
import {MASS_VERSION} from './mass.mjs';

export const GEN_RANGES = {1: [1, 151], 2: [152, 251], 3: [252, 386], 4: [387, 493], 5: [494, 649], 6: [650, 721], 7: [722, 809],
  8: [810, 905], 9: [906, 1025]};
export const STARTERS = ['Bulbasaur', 'Charmander', 'Squirtle', 'Chikorita', 'Cyndaquil', 'Totodile', 'Treecko', 'Torchic', 'Mudkip',
  'Turtwig', 'Chimchar', 'Piplup', 'Snivy', 'Tepig', 'Oshawott', 'Chespin', 'Fennekin', 'Froakie', 'Rowlet', 'Litten', 'Popplio',
  'Grookey', 'Scorbunny', 'Sobble', 'Sprigatito', 'Fuecoco', 'Quaxly'];
export const ROSTER_KINDS = ['dex', 'top', 'starters', 'legendaries', 'random', 'species', 'sets'];
const MAX_ROSTER = 1100;
const HEAL = ['recover', 'roost', 'softboiled', 'milkdrink', 'slackoff', 'synthesis', 'moonlight', 'morningsun', 'shoreup'];
const BOOST_PHYS = ['swordsdance', 'dragondance', 'bulkup', 'shellsmash'];
const BOOST_SPEC = ['nastyplot', 'calmmind', 'quiverdance', 'shellsmash'];
const STATUS = ['willowisp', 'thunderwave', 'spore', 'sleeppowder', 'toxic', 'hypnosis', 'glare', 'stunspore'];
const SKIP = new Set(['dreameater', 'synchronoise', 'lastresort', 'belch', 'snore', 'sleeptalk', 'present', 'beatup', 'fling', 'naturalgift',
  'spitup', 'focuspunch', 'struggle', 'magnitude', 'triplekick', 'tripleaxel', 'rollout', 'iceball', 'furycutter', 'echoedvoice']);

const dexOf = (gen) => Dex.forGen(gen || 9);
const legendary = (sp) => (sp.tags || []).some((t) => ['Restricted Legendary', 'Sub-Legendary', 'Mythical'].includes(t));
const bst = (sp) => Object.values(sp.baseStats).reduce((a, b) => a + b, 0);

/** The base Pokémon of the National Dex numbers of some generations (no alternate formes, no fan-made ones). */
function baseSpecies(gens, dex) {
  const want = (gens && gens.length ? gens : [1, 2, 3, 4, 5, 6, 7, 8, 9]).map(Number).filter((g) => GEN_RANGES[g]);
  const out = [];
  for (const sp of dex.species.all()) {
    if (!sp.exists || sp.forme || sp.num <= 0) continue;
    if (['CAP', 'Custom', 'Future'].includes(sp.isNonstandard)) continue;
    if (!want.some((g) => sp.num >= GEN_RANGES[g][0] && sp.num <= GEN_RANGES[g][1])) continue;
    out.push(sp);
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

/** Every move a Pokémon can learn (its own learnset, its base forme's and those of what it evolves from). */
function learnable(sp, dex) {
  const ids = new Set();
  const seen = new Set();
  const visit = (s) => {
    if (!s || !s.exists || seen.has(s.id)) return;
    seen.add(s.id);
    const data = dex.species.getLearnsetData(s.id);
    for (const m of Object.keys(data?.learnset || {})) ids.add(m);
    if (s.prevo) visit(dex.species.get(s.prevo));
    if (s.changesFrom) visit(dex.species.get(s.changesFrom));
    if (s.baseSpecies && s.baseSpecies !== s.name) visit(dex.species.get(s.baseSpecies));
  };
  visit(sp);
  return ids;
}

/** A set for one Pokémon: up to three of its strongest attacks (its own types first, then other types) and one extra. */
export function autoSet(species, {gen = 9, level = 100, shiny = false} = {}) {
  const dex = dexOf(gen);
  const sp = dex.species.get(species);
  if (!sp.exists) throw new RtError('unknown_species', `Unknown Pokémon: ${species}`, {species});
  const ids = learnable(sp, dex);
  const phys = sp.baseStats.atk >= sp.baseStats.spa;
  const ratio = Math.min(sp.baseStats.atk, sp.baseStats.spa) / Math.max(1, Math.max(sp.baseStats.atk, sp.baseStats.spa));
  const attacks = [];
  for (const id of ids) {
    if (SKIP.has(id) || id.startsWith('hiddenpower') && ids.size > 4) continue;
    const m = dex.moves.get(id);
    if (!m.exists || m.isZ || m.isMax || m.category === 'Status') continue;
    const p = rtMove(id, gen);
    if (!p || p.noEffect || !(p.power > 0 || p.damage)) continue;
    let score = (p.power || 60) * (p.hits || 1);
    if (sp.types.includes(m.type)) score *= 1.5;
    if ((m.category === 'Physical') !== phys) score *= Math.max(0.4, ratio);
    score *= m.accuracy === true ? 1 : (m.accuracy || 100) / 100;
    if (p.recharge) score *= 0.55;
    if (p.selfdestruct) score *= 0.15;
    if (p.ohko) score *= 0;
    if (m.flags?.charge) score *= 0.6;
    if (p.recoil) score *= 0.92;
    if (m.priority > 0) score *= 0.85;
    attacks.push({id: m.name, type: m.type, score, key: m.id});
  }
  attacks.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const chosen = [];
  const types = new Set();
  for (const t of sp.types) {
    const best = attacks.find((a) => a.type === t);
    if (best && chosen.length < 3) { chosen.push(best.id); types.add(t); }
  }
  for (const a of attacks) {
    if (chosen.length >= 3) break;
    if (types.has(a.type) || chosen.includes(a.id)) continue;
    chosen.push(a.id);
    types.add(a.type);
  }
  for (const a of attacks) { if (chosen.length >= 3) break; if (!chosen.includes(a.id)) chosen.push(a.id); }
  const extraFrom = [...HEAL, ...(phys ? BOOST_PHYS : BOOST_SPEC), ...STATUS];
  const extra = extraFrom.find((id) => ids.has(id));
  if (extra) chosen.push(dex.moves.get(extra).name);
  else { const more = attacks.find((a) => !chosen.includes(a.id)); if (more) chosen.push(more.id); }
  const moves = chosen.slice(0, 4);
  if (!moves.length) moves.push('Struggle');
  return {species: sp.name, ability: sp.abilities?.['0'] || '', moves, level, shiny: !!shiny, evs: {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84},
    nature: 'Serious'};
}

/** Species names for a roster: {kind: dex|top|starters|legendaries|random|species, gens, count, list, seed, fully_evolved}. */
export function rosterSpecies(r, gen = 9) {
  const dex = dexOf(gen);
  const kind = ROSTER_KINDS.includes(r.kind) ? r.kind : 'dex';
  const count = Number(r.count) > 0 ? Math.min(MAX_ROSTER, Math.floor(Number(r.count))) : 0;
  let list = [];
  if (kind === 'dex') list = baseSpecies(r.gens, dex);
  else if (kind === 'top') {
    // the strongest of each generation asked for (by base stat total), `count` each
    const per = count || 15;
    for (const g of (r.gens && r.gens.length ? r.gens : [1])) {
      const all = baseSpecies([g], dex).filter((sp) => !r.no_legends || !legendary(sp));
      all.sort((a, b) => bst(b) - bst(a) || a.num - b.num);
      list.push(...all.slice(0, per));
    }
    return list.map((sp) => sp.name);
  } else if (kind === 'starters') list = STARTERS.map((n) => dex.species.get(n));
  else if (kind === 'legendaries') list = baseSpecies(r.gens, dex).filter(legendary);
  else if (kind === 'random') {
    const pool = baseSpecies(r.gens, dex).filter((sp) => !r.fully_evolved || !sp.nfe);
    const rng = makeRng(`${r.seed || 'roster'}:random`);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    list = pool.slice(0, count || 20);
    return list.map((sp) => sp.name);
  } else if (kind === 'species') {
    list = (r.list || []).map((n) => dex.species.get(String(n)));
    const bad = list.find((sp) => !sp.exists);
    if (bad) throw new RtError('unknown_species', `Unknown Pokémon: ${(r.list || [])[list.indexOf(bad)]}`);
  }
  if (r.fully_evolved) list = list.filter((sp) => !sp.nfe);
  if (count && list.length > count) list = list.slice(0, count);
  return list.map((sp) => sp.name);
}

/** A team of a mass battle: [{set, boss}] from a roster (or the sets given, for a trainer's team). Shinies come at random with
 * `shiny_chance` (the videos hide a few). */
export function massRoster(r, {gen = 9, level = 100, seed = 'roster'} = {}) {
  const rng = makeRng(`${seed}:shiny`);
  const chance = Math.max(0, Math.min(1, Number(r.shiny_chance) || 0));
  const boss = r.boss ? {hp: Number(r.boss.hp) || 0, size: Number(r.boss.size) || 0, power: Number(r.boss.power) || 0} : null;
  if (r.kind === 'sets') {
    return (r.sets || []).slice(0, MAX_ROSTER).map((set) => ({set: {...set, moves: (set.moves && set.moves.length) ? set.moves : autoSet(set.species, {gen}).moves}, boss}));
  }
  return rosterSpecies(r, gen).map((name) => ({set: autoSet(name, {gen, level, shiny: rng() < chance}), boss}));
}

/** How much health a giant needs to face a crowd: about this share of the whole crowd's (auto boss strength). */
export function bossHpFor(bossSet, crowdSets, {gen = 9, share = 0.45} = {}) {
  const dex = dexOf(gen);
  const hpOf = (s) => {
    const sp = dex.species.get(s.species);
    const lv = s.level || 100;
    return Math.floor(((2 * sp.baseStats.hp + 31 + 21) * lv) / 100) + lv + 10;
  };
  const crowd = crowdSets.reduce((a, s) => a + hpOf(s), 0);
  return Math.max(1, Math.min(200, Math.round((crowd * share) / Math.max(1, hpOf(bossSet)))));
}

export {toID};

const ROSTER_NAMES = {starters: 'Iniciales', legendaries: 'Legendarios', random: 'Al azar', species: 'Elegidos', sets: 'Equipo'};

/** A team's default name: its generations ("Gen 1", "Gen 1-3") or its kind. */
function rosterName(r, i) {
  if ((r.kind === 'dex' || r.kind === 'top' || !r.kind) && r.gens && r.gens.length) {
    const g = r.gens.map(Number).sort((a, b) => a - b);
    return g.length === 1 ? `Gen ${g[0]}` : g.every((x, k) => !k || x === g[k - 1] + 1) ? `Gen ${g[0]}-${g[g.length - 1]}` : `Gen ${g.join(', ')}`;
  }
  if (r.kind === 'species' && (r.list || []).length === 1) return String(r.list[0]);
  return ROSTER_NAMES[r.kind] || `Equipo ${i + 1}`;
}

/** A whole mass battle spec from teams of rosters: {mode, teams: [{name, color, roster, boss}], format, level, seed, floor,
 * time_limit}. In boss mode the first team are the giants: their health is worked out from the crowd's unless given. */
export function composeMass(a) {
  const mode = ['ffa', 'teams', 'boss'].includes(a.mode) ? a.mode : 'ffa';
  const format = a.format || 'gen9customgame';
  const gen = Dex.formats.get(toID(format), true).gen || 9;
  const seed = String(a.seed || `mass${Date.now().toString(36)}`);
  const level = a.level === 0 ? 0 : Math.max(1, Math.min(100, Number(a.level) || 50));
  const teams = (a.teams || []).map((t, i) => ({name: String(t.name || rosterName(t.roster || t, i)).slice(0, 40), color: t.color || '',
    units: massRoster(t.roster || t, {gen, seed: `${seed}:${i}`}), boss: t.boss || (t.roster || {}).boss || null}));
  if (!teams.length || !teams.some((t) => t.units.length)) throw new RtError('invalid', 'Nobody to fight: the teams are empty.');
  const total = teams.reduce((n, t) => n + t.units.length, 0);
  if (total > MAX_ROSTER) throw new RtError('invalid', `At most ${MAX_ROSTER} Pokémon in a mass battle (this one has ${total}).`);
  if (mode === 'boss') {
    if (teams.length < 2) throw new RtError('invalid', 'A boss battle needs the giants and at least one team against them.');
    const giants = teams[0].units;
    const crowd = teams.slice(1).flatMap((t) => t.units.map((u) => ({...u.set, level: level || u.set.level})));
    const given = teams[0].boss || {};
    for (const u of giants) {
      const set = {...u.set, level: level || u.set.level};
      // a crowd of hundreds lands far more hits than a handful of legends: the bigger the crowd, the tougher and harder-hitting the giant
      const n = crowd.length;
      const share = (n <= 10 ? 1.3 : Math.min(1.9, 1.3 + n / 250)) / giants.length;
      u.boss = {hp: Number(given.hp) || bossHpFor(set, crowd, {gen, share}),
        size: Number(given.size) || Math.max(2, Math.min(4, 1.6 + Math.sqrt(crowd.length) / 5)), power: Number(given.power) || Math.round((n <= 10 ? 1.5 : Math.min(2.3, 1.5 + n / 200)) * 10) / 10};
    }
  }
  // a new battle plays by the current rules; the version travels with the spec, so replays and friends' pages play it the same
  return {version: MASS_VERSION, mode, format, level_rules: level ? {level} : {}, seed, floor: a.floor || 'grass', time_limit: Number(a.time_limit) || 180,
    teams: teams.map((t) => ({name: t.name, color: t.color, units: t.units}))};
}
