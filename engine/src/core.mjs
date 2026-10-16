// Formats, teams and the Pokédex: everything about a team that is not a battle. Pure functions over @pkmn/sim, so the same
// file runs in the engine process and in the playable page a friend opens in a browser.
import {Dex, Teams, TeamValidator, toID, PRNG} from '@pkmn/sim';
import {Teams as SetTeams, Sets} from '@pkmn/sets';
import {TeamGenerators} from '@pkmn/randoms';
import {calcStat, evsFromPoints, pointsFromEvs, STAT_IDS} from './points.mjs';
import {championsSets, isChampions} from './champions.mjs';   // registers the Pokémon Champions formats on @pkmn/sim

Teams.setGeneratorFactory(TeamGenerators);

export {toID};

export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic',
  'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];

export class EngineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------- formats
// Rules a gym or a battle can add on top of a Showdown format. Level rules are applied to the sets themselves (Showdown only
// applies "Adjust Level" in its validator); the rest travel in the format id after "@@@" as Showdown custom rules.
export function buildFormatId(format, rules = []) {
  const base = toID(format || 'gen9nationaldexag') || 'gen9nationaldexag';
  const extra = (rules || []).map((r) => String(r).trim()).filter(Boolean);
  const raw = extra.length ? `${base}@@@${extra.join(',')}` : base;
  let id;
  try {
    id = Dex.formats.validate(raw);
  } catch (e) {
    throw new EngineError('invalid_format', `Format "${raw}" is not valid: ${e.message}`);
  }
  const fmt = Dex.formats.get(id, true);
  if (!fmt.exists || fmt.effectType !== 'Format') throw new EngineError('invalid_format', `Unknown format: ${format}`);
  return id;
}

export function formatInfo(formatId) {
  const fmt = Dex.formats.get(formatId, true);
  if (!fmt.exists) throw new EngineError('invalid_format', `Unknown format: ${formatId}`);
  const rt = Dex.formats.getRuleTable(fmt);
  return {
    id: fmt.id, name: fmt.name, gen: fmt.gen || Dex.forFormat(fmt).gen, game_type: fmt.gameType || 'singles',
    random: !!fmt.team, team_preview: rt.has('teampreview'), max_team: rt.maxTeamSize, picked: rt.pickedTeamSize || null,
    custom_rules: fmt.customRules || [], section: fmt.section || '', desc: fmt.desc || '',
  };
}

const POPULAR = ['customgame', 'doublescustomgame', 'randombattle', 'randomdoublesbattle', 'ou', 'ubers', 'uu', 'nationaldex', 'nationaldexag',
  'anythinggoes', 'vgc', 'doublesou', 'lc', 'monotype', '1v1', 'battlestadiumsingles', 'bss'];

/** Every playable format of the simulator, popular first: [{id, name, gen, game_type, random, section}]. */
export function listFormats({gen = 0, query = ''} = {}) {
  const q = toID(query);
  const out = [];
  for (const f of Dex.formats.all()) {
    if (f.effectType !== 'Format' || !f.exists) continue;
    if (['multi', 'freeforall'].includes(f.gameType)) continue;
    if (f.team && !['random', 'randomBaby', 'randomHC', 'random1v1Factory', 'randomBSSFactory', 'randomFactory'].includes(f.team)) continue;
    const g = f.gen || Number(String(f.id).match(/^gen(\d)/)?.[1] || 0);
    if (gen && g !== gen) continue;
    if (q && !f.id.includes(q) && !toID(f.name).includes(q)) continue;
    const tail = f.id.replace(/^gen\d/, '');
    const rank = POPULAR.findIndex((p) => tail === p || tail.startsWith(p));
    out.push({id: f.id, name: f.name, gen: g, game_type: f.gameType || 'singles', random: !!f.team, section: f.section || '',
      rank: rank < 0 ? 99 : rank});
  }
  out.sort((a, b) => b.gen - a.gen || a.rank - b.rank || a.name.localeCompare(b.name));
  return out.map(({rank, ...f}) => f);
}

/** National Pokédex number of a species (0 when unknown). */
export const dexNum = (species) => Dex.species.get(String(species || '')).num || 0;

export const genOf = (formatId) => Dex.formats.get(formatId, true).gen || Number(String(formatId).match(/^gen(\d)/)?.[1] || 9);

// ---------------------------------------------------------------- teams
/** A team from what people paste: Showdown export text, packed team, JSON (array of sets, {team: [...]} or a .hoardtrainer). */
export function importTeam(input) {
  if (Array.isArray(input)) return input.map(cleanSet);
  const text = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new EngineError('empty_team', 'The team is empty.');
  if (text.startsWith('{') || text.startsWith('[')) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new EngineError('invalid_team', `Not valid JSON: ${e.message}`); }
    const list = Array.isArray(data) ? data : data.team || data.sets || data.trainer?.team || [];
    if (!Array.isArray(list) || !list.length) throw new EngineError('invalid_team', 'The JSON has no team.');
    return list.map(cleanSet);
  }
  if (!text.includes('\n') && text.includes('|')) {
    const unpacked = Teams.unpack(text);
    if (!unpacked || !unpacked.length) throw new EngineError('invalid_team', 'The packed team could not be read.');
    return unpacked.map(cleanSet);
  }
  const parsed = SetTeams.importTeam(text);
  const sets = parsed?.team || [];
  if (!sets.length) throw new EngineError('invalid_team', 'No Pokémon found in the text.');
  return sets.map(cleanSet);
}

/** The teams of a Showdown teambuilder backup (several "=== [gen9ou] Name ===" blocks). */
export function importTeams(text) {
  const parsed = SetTeams.importTeams(String(text ?? ''));
  if (!parsed || !parsed.length) return [{name: '', format: '', sets: importTeam(text)}];
  return parsed.map((t) => ({name: t.name || '', format: t.format || '', sets: (t.team || []).map(cleanSet)}));
}

export function exportTeam(sets) {
  return sets.map((s) => Sets.exportSet(cleanSet(s))).join('\n').replace(/ {2}\n/g, '\n').trim() + '\n';
}

export function cleanSet(raw) {
  const s = raw || {};
  const species = String(s.species || s.name || '').trim();
  if (!species) throw new EngineError('invalid_team', 'A Pokémon without species.');
  const out = {
    name: String(s.name && s.name !== species ? s.name : '').trim(),
    species,
    item: String(s.item || '').trim(),
    ability: String(s.ability || '').trim(),
    moves: (s.moves || []).map((m) => String(m).trim()).filter(Boolean).slice(0, 4),
    nature: String(s.nature || '').trim(),
    gender: String(s.gender || '').trim().toUpperCase().slice(0, 1),
    evs: statTable(s.evs, 0),
    ivs: statTable(s.ivs, 31),
    level: clampInt(s.level, 1, 100, 100),
  };
  if (s.shiny) out.shiny = true;
  if (s.happiness !== undefined && s.happiness !== null && s.happiness !== '') out.happiness = clampInt(s.happiness, 0, 255, 255);
  if (s.teraType) out.teraType = String(s.teraType);
  if (s.hpType) out.hpType = String(s.hpType);
  if (s.gigantamax) out.gigantamax = true;
  if (s.dynamaxLevel !== undefined && s.dynamaxLevel !== null && s.dynamaxLevel !== '') out.dynamaxLevel = clampInt(s.dynamaxLevel, 0, 10, 10);
  if (s.pokeball) out.pokeball = String(s.pokeball);
  return out;
}

function statTable(t, fill) {
  const out = {};
  for (const k of STATS) {
    const v = t && t[k] !== undefined && t[k] !== null && t[k] !== '' ? Number(t[k]) : fill;
    out[k] = Number.isFinite(v) ? v : fill;
  }
  return out;
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** Fill what a battle needs and people often leave out (ability, tera type), for the generation of the format. */
export function completeSets(sets, formatId) {
  const dex = Dex.forFormat(Dex.formats.get(formatId, true));
  const out = sets.map((raw) => {
    const s = cleanSet(raw);
    const sp = dex.species.get(s.species);
    if (!sp.exists) throw new EngineError('unknown_species', `Unknown Pokémon: ${s.species}`, {species: s.species});
    if (!s.ability && dex.gen >= 3) s.ability = sp.abilities?.['0'] || 'No Ability';
    if (!s.teraType && dex.gen >= 9) s.teraType = sp.requiredTeraType || sp.types[0];
    if (!s.moves.length) throw new EngineError('invalid_team', `${s.species} has no moves.`, {species: s.species});
    return s;
  });
  // Pokémon Champions reads the EVs field as stat points (champions.mjs)
  return isChampions(formatId) ? championsSets(out) : out;
}

/** Level rules of a gym or battle: {level} fixes every level, {level_cap} lowers the ones above, {level_min} raises the ones below. */
export function applyLevelRules(sets, rules = {}) {
  const fixed = Number(rules.level) || 0;
  const cap = Number(rules.level_cap) || 0;
  const min = Number(rules.level_min) || 0;
  return sets.map((s) => {
    let level = s.level || 100;
    if (fixed) level = fixed;
    if (cap && level > cap) level = cap;
    if (min && level < min) level = min;
    return {...s, level};
  });
}

export const packTeam = (sets) => Teams.pack(sets);
export const unpackTeam = (packed) => Teams.unpack(packed).map(cleanSet);

/** Showdown's validator for the format: {ok, problems[]}. Custom games accept anything that exists. */
export function validateTeam(formatId, sets) {
  let complete;
  try {
    complete = completeSets(sets, formatId);
  } catch (e) {
    return {ok: false, problems: [e.message]};
  }
  const validator = new TeamValidator(formatId);
  const problems = validator.validateTeam(complete.map((s) => ({...s})));
  return {ok: !problems || !problems.length, problems: problems || []};
}

/** A random team of a random format (or of the generation of any other format). */
export function randomTeam(formatId = 'gen9randombattle', seed = null) {
  let fmt = Dex.formats.get(formatId, true);
  if (!fmt.team) fmt = Dex.formats.get(`gen${fmt.gen || 9}randombattle`, true);
  if (!fmt.exists || !fmt.team) fmt = Dex.formats.get('gen9randombattle', true);
  const prng = seed ? new PRNG(seedArray(seed)) : undefined;
  const sets = Teams.generate(fmt, prng ? {seed: prng.getSeed()} : undefined);
  const dex = Dex.forFormat(fmt);
  const pretty = (table, v) => { const e = v ? table.get(v) : null; return e && e.exists ? e.name : v; };
  return {format: fmt.id, sets: sets.map((s) => cleanSet({...s, moves: (s.moves || []).map((m) => pretty(dex.moves, m)),
    item: pretty(dex.items, s.item), ability: pretty(dex.abilities, s.ability), nature: pretty(dex.natures, s.nature)}))};
}

export function seedArray(seed) {
  if (Array.isArray(seed)) return seed.slice(0, 4).map((n) => (Number(n) >>> 0) % 65536);
  if (typeof seed === 'string' && /^\s*\d+\s*(,\s*\d+\s*){3}$/.test(seed)) return seed.split(',').map((n) => (Number(n) >>> 0) % 65536);
  if (typeof seed === 'string' && seed.startsWith('sodium,')) return seed;
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const out = [];
  for (let i = 0; i < 4; i++) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; out.push(h % 65536); }
  return out;
}

/** What the team page shows about each member: types, base stats, sprite id, real abilities of the species. */
export function teamSummary(sets, formatId = 'gen9customgame') {
  const dex = Dex.forFormat(Dex.formats.get(formatId, true));
  return sets.map((raw) => {
    const s = cleanSet(raw);
    const sp = dex.species.get(s.species);
    return {
      species: sp.exists ? sp.name : s.species, exists: !!sp.exists, num: sp.num || 0, types: sp.types || [],
      base_stats: sp.baseStats || {}, sprite_id: sp.spriteid || toID(s.species), nickname: s.name, level: s.level,
      item: s.item, ability: s.ability, moves: s.moves.map((m) => { const mv = dex.moves.get(m); return {name: mv.exists ? mv.name : m, type: mv.type || '', category: mv.category || '', power: mv.basePower || 0, exists: !!mv.exists}; }),
      tera_type: s.teraType || '', shiny: !!s.shiny, nature: s.nature, evs: s.evs, ivs: s.ivs, ...statPoints(s, sp, dex),
    };
  });
}

/** A set's stat points (Champions' 66 / 32 system, read from its EVs) and its stats at its level. */
function statPoints(s, sp, dex) {
  const {points, total} = pointsFromEvs(s.evs);
  const nat = s.nature ? dex.natures.get(s.nature) : null;
  const mult = (k) => (nat?.exists && nat.plus === k ? 1.1 : nat?.exists && nat.minus === k ? 0.9 : 1);
  const stats = {};
  if (sp.exists) for (const k of STAT_IDS) stats[k] = calcStat(k, sp.baseStats[k], {level: s.level, ev: s.evs[k], iv: s.ivs[k], nature: mult(k)});
  return {points, points_total: total, stats};
}

/** Give every set of `sets` the stat points in `spreads` (index -> {hp, atk, ...}); points become EVs (HOME's rule). */
export function applyStatPoints(sets, spreads = {}) {
  return sets.map((raw, i) => {
    const s = cleanSet(raw);
    const p = spreads[i] ?? spreads[String(i)];
    return p ? {...s, evs: evsFromPoints(p)} : s;
  });
}

// ---------------------------------------------------------------- pokédex
/** Search species, moves, items, abilities or natures of a generation: [{id, name, ...}] best match first. */
export function dexSearch(kind, query = '', {gen = 9, limit = 30, species = '', format = ''} = {}) {
  const dex = Dex.forGen(gen);
  const q = toID(query);
  const table = {species: dex.species, moves: dex.moves, items: dex.items, abilities: dex.abilities, natures: dex.natures}[kind];
  if (!table) throw new EngineError('invalid', `Unknown kind: ${kind}`);
  let pool = table.all().filter((e) => e.exists && !(e.isNonstandard && ['CAP', 'Custom', 'LGPE', 'Future'].includes(e.isNonstandard)));
  if (kind === 'moves' && species) {
    const learn = learnableMoves(species, gen, {natdex: isNatDexFormat(format)});
    if (learn) pool = pool.filter((m) => learn.has(m.id));
  }
  const scored = [];
  for (const e of pool) {
    const id = e.id;
    let score = 0;
    if (q) {
      if (id === q) score = 100;
      else if (id.startsWith(q)) score = 80 - id.length / 100;
      else if (id.includes(q)) score = 50 - id.length / 100;
      else continue;
    }
    scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, e]) => dexEntry(kind, e));
}

function dexEntry(kind, e) {
  if (kind === 'species') return {id: e.id, name: e.name, num: e.num, types: e.types, base_stats: e.baseStats, abilities: Object.values(e.abilities || {}), sprite_id: e.spriteid, tier: e.tier || ''};
  if (kind === 'moves') return {id: e.id, name: e.name, type: e.type, category: e.category, power: e.basePower, accuracy: e.accuracy, pp: e.pp, priority: e.priority, desc: e.shortDesc || e.desc || ''};
  if (kind === 'items') return {id: e.id, name: e.name, desc: e.shortDesc || e.desc || ''};
  if (kind === 'abilities') return {id: e.id, name: e.name, desc: e.shortDesc || e.desc || ''};
  return {id: e.id, name: e.name, plus: e.plus || '', minus: e.minus || ''};
}

/** A National Dex format (gen9nationaldex, gen9nationaldexag, ...) lets a Pokémon use moves its line learned in earlier games. */
export const isNatDexFormat = (format) => toID(format).includes('nationaldex');

/** The ids of the moves a Pokémon can learn in a generation, or null for an unknown Pokémon.
 * National Dex formats use the National Dex movepool. A Pokémon that is not in the generation's own Pokédex
 * (Scolipede in Scarlet and Violet) has no movepool of that generation, so it gets the National Dex one too. */
export function learnableMoves(species, gen = 9, {natdex = false} = {}) {
  const dex = Dex.forGen(gen);
  const sp = dex.species.get(species);
  if (!sp.exists) return null;
  const pool = (nd) => { try { return dex.species.getMovePool(sp.id, nd); } catch { return new Set(); } };
  const own = pool(natdex);
  return own.size || natdex ? own : pool(true);
}

export function speciesInfo(name, gen = 9, format = '') {
  const dex = Dex.forGen(gen);
  const sp = dex.species.get(name);
  if (!sp.exists) throw new EngineError('unknown_species', `Unknown Pokémon: ${name}`);
  const pool = learnableMoves(sp.id, gen, {natdex: isNatDexFormat(format)});
  return {
    ...dexEntry('species', sp), weightkg: sp.weightkg, evos: sp.evos || [], prevo: sp.prevo || '', formes: sp.otherFormes || [],
    moves: pool ? [...pool].map((id) => dex.moves.get(id)).filter((m) => m.exists).map((m) => dexEntry('moves', m)).sort((a, b) => b.power - a.power) : [],
  };
}

/** The first of `names` that is a Pokémon of the generation, with what a team needs to know about it: its base species
 * and, for a Mega Evolution or a Primal Reversion, the item that triggers it (the team holds the base species with that item).
 * Null when none of the names is one. */
export function speciesResolve(names = [], gen = 9) {
  const dex = Dex.forGen(gen);
  for (const name of names) {
    const sp = dex.species.get(String(name || ''));
    if (!sp.exists) continue;
    const item = sp.requiredItem || (sp.requiredItems && sp.requiredItems[0]) || '';
    return {id: sp.id, name: sp.name, base_species: sp.baseSpecies || sp.name, forme: sp.forme || '', required_item: item,
            mega: Boolean(sp.isMega) || /^Mega/.test(sp.forme || ''), primal: sp.forme === 'Primal', battle_only: Boolean(sp.battleOnly),
            abilities: Object.values(sp.abilities || {})};
  }
  return null;
}

/** Type effectiveness multiplier of an attacking type against defending types, in a generation. */
export function effectiveness(type, defTypes, gen = 9) {
  const dex = Dex.forGen(gen);
  if (!dex.getImmunity(type, defTypes)) return 0;
  return 2 ** dex.getEffectiveness(type, defTypes);
}
