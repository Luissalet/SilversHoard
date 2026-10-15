// Builds silvers_hoard/presets/unbound.json.gz: the special trainers of Pokémon Unbound's Battle Frontier (Palmer, Pat, Pablo,
// Paula, Skeli, Golche, Gail, Lixdel, Cynthia, Red, Big Mo, Galavan, Candice, Giovanni) with every pool of sets they draw from
// (special, legendary, Middle Cup and Little Cup), each set with the ability Unbound gives that species.
//
//   node scripts/build_unbound.mjs <PUSE clone> <CFRU clone> [out]
//
// Sources (read, re-derived into Silver's own format, nothing copied as is):
// - PUSE (github.com/Zannael/PUSE, MIT): Unbound's species constants and abilities as read from the ROM
//   (frontend/src/core/speciesConstants.json, speciesAbilitiesMeta.json; romre/data/unbound/json/ability_table_from_rom.json).
// - Complete Fire Red Upgrade (github.com/Skeli789/Complete-Fire-Red-Upgrade), the engine Unbound runs on: which trainers, their
//   class and gender (src/Tables/battle_frontier_trainers.c) and the facts of each set (species, nature, IVs, EVs, ability slot,
//   item, moves) in src/Tables/frontier_special_trainer_spreads.h. The repository has no licence, so only those facts are taken.
// Every species, move, item and ability is checked against Pokémon Showdown's generation 8 dex; what it does not have is dropped
// and counted.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {Dex, toID} from '@pkmn/sim';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const [puse, cfru, outArg] = process.argv.slice(2);
if (!puse || !cfru) {
  console.error('usage: node scripts/build_unbound.mjs <PUSE clone> <CFRU clone> [out]');
  process.exit(2);
}
const OUT = outArg || path.join(root, 'silvers_hoard/presets/unbound.json.gz');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const dex = Dex.forGen(8);

// ---------------------------------------------------------------- Unbound's abilities per species (PUSE)
const constants = JSON.parse(read(puse, 'frontend/src/core/speciesConstants.json'));        // id -> SPECIES_X
const abilityMeta = JSON.parse(read(puse, 'frontend/src/core/speciesAbilitiesMeta.json'));  // id -> {ability_1_id, ability_2_id, hidden_ability_id}
const abilityTable = JSON.parse(read(puse, 'romre/data/unbound/json/ability_table_from_rom.json')).abilities;
// the ROM table starts with an empty entry: species point at index + 1 of it
const ROM_ABILITY = Object.fromEntries(abilityTable.map((a) => [a.ability_id - 1, a.name]));
// names the ROM shortened to fit 12 letters
const ABILITY_FIX = {'Neutralize Gas': 'Neutralizing Gas', 'Water Compact': 'Water Compaction', 'Wandering Soul': 'Wandering Spirit',
  'Valiant Shield': 'Dauntless Shield', 'Odd Medicine': 'Curious Medicine'};
const unboundAbilities = {};   // SPECIES_X -> [slot 1, slot 2, hidden] as Showdown names ('' when Showdown lacks it)
for (const [id, c] of Object.entries(constants)) {
  const m = abilityMeta[id];
  if (!m) continue;
  unboundAbilities[c] = [m.ability_1_id, m.ability_2_id, m.hidden_ability_id].map((n) => {
    if (!n) return '';
    let name = ABILITY_FIX[ROM_ABILITY[n]] || ROM_ABILITY[n] || '';
    if (name === 'As One') name = c.includes('SPECTRIER') ? 'As One (Spectrier)' : 'As One (Glastrier)';
    const a = dex.abilities.get(name);
    return a.exists ? a.name : '';
  });
}

// ---------------------------------------------------------------- species, moves, items
const FORM_SUFFIX = {A: 'Alola', G: 'Galar', H: 'Hisui'};
function speciesOf(constant) {
  let s = constant.replace(/^SPECIES_/, '');
  const m = s.match(/^(.*)_([AGH])$/);
  if (m) s = `${m[1]}-${FORM_SUFFIX[m[2]]}`;
  s = s.replace(/_CAP_/, '_').replace(/^PIKACHU_SURFING$/, 'PIKACHU');
  const sp = dex.species.get(toID(s));
  return sp.exists ? sp : null;
}
const NATURES = Object.fromEntries(dex.natures.all().map((n) => [n.name.toUpperCase(), n.name]));

const dropped = {species: {}, moves: {}, items: {}, abilities: {}};
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

// one `{ .species = ..., ... }` block of a spreads table
function parseSet(block) {
  const field = (name) => (block.match(new RegExp(`\\.${name}\\s*=\\s*([A-Z0-9_]+)`)) || [])[1];
  const num = (name, dflt) => { const v = field(name); return v === undefined ? dflt : Number(v); };
  const constant = field('species');
  const sp = speciesOf(constant);
  if (!sp) { bump(dropped.species, constant); return null; }
  const set = {species: sp.name};
  const itemC = field('item');
  if (itemC && itemC !== 'ITEM_NONE') {
    const it = dex.items.get(toID(itemC.replace(/^ITEM_/, '')));
    if (it.exists) set.item = it.name; else bump(dropped.items, itemC);
  }
  const slot = {FRONTIER_ABILITY_1: 0, FRONTIER_ABILITY_2: 1, FRONTIER_ABILITY_HIDDEN: 2}[field('ability')] ?? 0;
  const own = unboundAbilities[constant] || [];
  const ability = own[slot] || own[0] || '';
  if (ability) set.ability = ability;
  else bump(dropped.abilities, `${constant}:${slot}`);
  const movesBlock = (block.match(/\.moves\s*=\s*\{([^}]*)\}/) || [])[1] || '';
  set.moves = [];
  for (const mc of movesBlock.match(/MOVE_[A-Z0-9_]+/g) || []) {
    if (mc === 'MOVE_NONE') continue;
    const mv = dex.moves.get(toID(mc.replace(/^MOVE_/, '')));
    if (mv.exists) set.moves.push(mv.name); else bump(dropped.moves, mc);
  }
  const nature = NATURES[(field('nature') || '').replace(/^NATURE_/, '')];
  if (nature) set.nature = nature;
  const ivs = {hp: num('hpIv', 31), atk: num('atkIv', 31), def: num('defIv', 31), spa: num('spAtkIv', 31), spd: num('spDefIv', 31), spe: num('spdIv', 31)};
  if (Object.values(ivs).some((v) => v !== 31)) set.ivs = ivs;
  const evs = {hp: num('hpEv', 0), atk: num('atkEv', 0), def: num('defEv', 0), spa: num('spAtkEv', 0), spd: num('spDefEv', 0), spe: num('spdEv', 0)};
  if (Object.values(evs).some(Boolean)) set.evs = evs;
  if (field('shiny') === 'TRUE') set.shiny = true;
  return set.moves.length ? set : null;
}

const spreadsText = read(cfru, 'src/Tables/frontier_special_trainer_spreads.h');
const POOLS = {};   // table name -> [sets]
for (const m of spreadsText.matchAll(/const struct BattleTowerSpread (g\w+)\[\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
  const sets = [];
  for (const b of m[2].matchAll(/\{\s*\.species[\s\S]*?\n\t\},?/g)) {
    const s = parseSet(b[0]);
    if (s) sets.push(s);
  }
  POOLS[m[1]] = sets;
}

// ---------------------------------------------------------------- the special trainers
const trainersText = read(cfru, 'src/Tables/battle_frontier_trainers.c');
const CLASSES = {CLASS_FRONTIER_BRAIN: 'Frontier Brain', CLASS_DEVELOPER: 'Developer', CLASS_CHAMPION: 'Champion', CLASS_LEADER: 'Gym Leader',
  CLASS_BOSS: 'Boss', CLASS_PKMN_TRAINER_2: 'Pokémon Trainer'};
// Showdown sprites: the character's own where Showdown has it, a trainer class of the same gender otherwise (Unbound's own art is
// not in Showdown); the player picks another when installing.
const SPRITES = {palmer: 'palmer', cynthia: 'cynthia', red: 'red', giovanni: 'giovanni', candice: 'candice',
  pat: 'veteran', pablo: 'acetrainer', paula: 'acetrainerf', skeli: 'scientist', golche: 'gentleman', gail: 'acetrainer', lixdel: 'psychic',
  bigmo: 'blackbelt', galavan: 'veteran'};
const NAMES = {bigmo: 'Big Mo'};
const TIERS = [['regularSpreads', 'special', 'Special', 'Especial', 50], ['legendarySpreads', 'legendary', 'Legendary', 'Legendarios', 50],
  ['middleCupSpreads', 'middlecup', 'Middle Cup', 'Copa Media', 50], ['littleCupSpreads', 'littlecup', 'Little Cup', 'Copa Pequeña', 5]];
const GAME = {id: 'unbound', gen: 8, name: 'Pokémon Unbound', name_es: 'Pokémon Unbound', side: true};

// the pool's first six are different species (the facility's Species Clause): installing a trainer takes those six
function ordered(pool) {
  const first = [];
  const rest = [];
  const seen = new Set();
  for (const s of pool) {
    if (first.length < 6 && !seen.has(s.species)) { first.push(s); seen.add(s.species); } else rest.push(s);
  }
  return [...first, ...rest];
}

const chars = new Map();
const blocks = [...trainersText.matchAll(/\{\s*\.owNum[\s\S]*?\n\t*\},?/g)].map((b) => b[0]);
let order = 0;
for (const b of blocks) {
  const field = (name) => (b.match(new RegExp(`\\.${name}\\s*=\\s*([A-Za-z0-9_]+)`)) || [])[1];
  const nameC = field('name');
  if (!nameC) continue;
  const key = toID(nameC.replace(/^sTrainerName_/, ''));
  const name = NAMES[key] || nameC.replace(/^sTrainerName_/, '');
  const cls = CLASSES[field('trainerClass')] || 'Pokémon Trainer';
  const c = chars.get(key) || {key, name, name_es: name, base_sprite: SPRITES[key] || 'acetrainer', sprites: [], variants: [], seenPools: new Set()};
  chars.set(key, c);
  for (const [slot, tier, en, es, level] of TIERS) {
    const table = field(slot);
    if (!table || !POOLS[table] || c.seenPools.has(table)) continue;
    c.seenPools.add(table);
    const pool = ordered(POOLS[table]).map((s) => ({...s, level}));
    if (!pool.length) continue;
    const same = c.variants.filter((v) => v.tier === tier).length;
    const id = `unbound-${tier}${same ? `-${same + 1}` : ''}`;
    const labels = [en, ...(same ? [`${same + 1}`] : [])];
    const labelsEs = [es, ...(same ? [`${same + 1}`] : [])];
    c.variants.push({games: ['unbound'], category: 'facilities', id, tier, game: 'Unbound', game_name: 'Pokémon Unbound', game_name_es: 'Pokémon Unbound',
      gen: 8, order: 900 + order++, format: 'gen8customgame', labels: ['Battle Tower', ...labels], labels_alt: [], labels_es: ['Torre Batalla', ...labelsEs],
      labels_alt_es: [], trainer_class: cls, location: 'Battle Tower', note: '', sprite: SPRITES[key] || 'acetrainer', sets: pool, pool: pool.length,
      side: true, credit: 'Sets de la Frontera de Pokémon Unbound (motor Complete Fire Red Upgrade) con las habilidades de Unbound (PUSE, MIT).'});
  }
}
const characters = [...chars.values()].filter((c) => c.variants.length).map(({seenPools, ...c}) => ({...c,
  sprites: [{id: c.base_sprite, suffix: '', label: 'Showdown', label_es: 'Showdown'}],
  variants: c.variants.map(({tier, ...v}) => v)}));
const out = {schema: 2, games: [GAME], characters,
  source: "Pokémon Unbound's Battle Frontier special trainers: facts of each set from Complete Fire Red Upgrade (the engine Unbound runs on), abilities as Unbound gives them (PUSE, MIT, read from the ROM), checked against Pokémon Showdown's generation 8 dex."};
fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out), {level: 9}));
const count = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({characters: characters.length, variants: characters.reduce((a, c) => a + c.variants.length, 0),
  sets: characters.reduce((a, c) => a + c.variants.reduce((x, v) => x + v.sets.length, 0), 0),
  dropped: {species: dropped.species, moves: dropped.moves, items: dropped.items, abilities: count(dropped.abilities)}}, null, 1));
