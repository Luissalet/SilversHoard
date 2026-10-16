// Builds silvers_hoard/presets/characters.json.gz from a Bulbapedia party scrape (see docs/characters.md).
// Usage: node scripts/build_characters.mjs [scrape.json(.gz)] [spanish-names.json] [label-translations.json] [out]
// Defaults: the files in scripts/characters (the scrape is Bulbapedia's party templates read with the page's raw wikitext).
// Every species, move, item, ability and nature goes through the dex of the team's generation: names come out as the
// simulator writes them, and whatever the dex does not know is dropped (and counted in the report).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {Dex, toID} from '@pkmn/sim';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const here = (f) => path.join(root, 'scripts/characters', f);
const [scrapePath = here('bulbapedia_parties.json.gz'), esPath = here('names_es.json'), labelsPath = here('labels_es.json'), outArg] = process.argv.slice(2);
const OUT = outArg || path.join(root, 'silvers_hoard/presets/characters.json.gz');
const readMaybeGz = (f) => { const b = fs.readFileSync(f); return (f.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8'); };
const scrape = JSON.parse(readMaybeGz(scrapePath));
// a second scrape (Frontier Brains, villains' admins, more rivals and the player characters) adds the pages the first one lacks
for (const extra of [here('bulbapedia_parties_2.json.gz'), here('additional_parties.json')]) {
  if (scrapePath !== extra && fs.existsSync(extra)) for (const [k, v] of Object.entries(JSON.parse(readMaybeGz(extra)))) if (!(k in scrape)) scrape[k] = v;
}
// battle facility teams ({{lop/facility}} rows: Frontier Brains, Battle Tower, Tree, Maison, Subway), read apart, join their page
const FAC = here('bulbapedia_facilities.json.gz');
if (fs.existsSync(FAC)) {
  for (const [k, v] of Object.entries(JSON.parse(readMaybeGz(FAC)))) {
    if (!v.parties?.length) continue;
    if (scrape[k]?.parties) scrape[k].parties.push(...v.parties);
    else scrape[k] = v;
  }
}
// Battle Tower teams of the remakes ({{lop/facility8}} rows: species, ability, item, four moves and the six stats at level 50).
// The wiki gives stats, not natures and EVs, so each set gets the nature and EVs that give exactly those stats (IVs 31).
const FAC8 = here('bulbapedia_facility8.json.gz');
const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
function spreadFor(species, stats, dex) {
  const sp = dex.species.get(species);
  if (!sp.exists || stats.some((x) => !Number.isFinite(x))) return null;
  // per stat: the highest IV, then the fewest EVs, that give the stat (some sets lower an IV on purpose, e.g. 0 Sp. Atk)
  const fit = (key, mult, want) => {
    for (let iv = 31; iv >= 0; iv--) {
      for (let ev = 0; ev <= 252; ev += 4) {
        const core = Math.floor(((2 * sp.baseStats[key] + iv + Math.floor(ev / 4)) * 50) / 100);
        const v = key === 'hp' ? core + 60 : Math.floor(Math.round((core + 5) * mult * 1000) / 1000);
        if (v === want) return {iv, ev};
      }
    }
    return null;
  };
  let best = null;
  for (const nature of dex.natures.all()) {
    const evs = [], ivs = [];
    let cost = 0;
    for (let k = 0; k < 6; k++) {
      const key = STAT_KEYS[k];
      const r = fit(key, nature.plus === key ? 1.1 : nature.minus === key ? 0.9 : 1, stats[k]);
      if (!r) break;
      evs.push(r.ev); ivs.push(r.iv); cost += (31 - r.iv) * 100 + r.ev;
    }
    if (evs.length < 6 || evs.reduce((a, b) => a + b, 0) > 510) continue;
    if (!best || cost < best.cost) best = {nature: nature.name, evs, ivs, cost};
  }
  return best;
}
const plainName = (s) => String(s || '').replace(/\{\{color2\|[^|}]*\|([^|}]*)(?:\|[^}]*)?\}\}/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim();
if (fs.existsSync(FAC8)) {
  const dex8 = Dex.forGen(8);
  for (const [k, v] of Object.entries(JSON.parse(readMaybeGz(FAC8)))) {
    const parties = [];
    for (const p of v.parties) {
      const h = p.head || {};
      for (const team of p.teams) {
        const mons = team.rows.map((r) => {
          const cells = r.filter((c) => !/^[a-z]+=/i.test(c));
          const [, species, ability, item, m1, , m2, , m3, , m4] = cells;
          const stats = cells.slice(-6).map(Number);
          const spread = spreadFor(species, stats, dex8);
          return {s: species, a: ability, i: item, m: [m1, m2, m3, m4].filter(Boolean), l: '50',
            ...(spread ? {n: spread.nature, ev: spread.evs, iv: spread.ivs} : {})};
        });
        const path = [...p.path.map((x) => x.replace(/\{\{g\|([^|}]*)\}\}/g, '$1')), ...(team.label ? [team.label] : [])];
        const party = {path, tpl: p.tpl, game: h.game || 'BDSP', sprite: h.sprite || '', name: plainName(h.name), cls: h.class || '', location: h.location || '',
          note: '', facility: true, mons};
        if (p.tpl === 'Party/2') {   // a tag battle: the first two rows are the first trainer's, the last two the second's
          party.mons = mons.slice(0, 2);
          party.mons2 = mons.slice(2);
          party.name2 = plainName(h.name2);
        }
        parties.push(party);
      }
    }
    if (!parties.length) continue;
    if (scrape[k]?.parties) scrape[k].parties.push(...parties);
    else scrape[k] = {title: k, status: 200, parties};
  }
}
const ES = esPath && fs.existsSync(esPath) ? JSON.parse(fs.readFileSync(esPath, 'utf8')) : {};
const LABELS = labelsPath && fs.existsSync(labelsPath) ? JSON.parse(fs.readFileSync(labelsPath, 'utf8')) : {};
const SPRITES = JSON.parse(fs.readFileSync(path.join(root, 'silvers_hoard/presets/trainer_sprites.json'), 'utf8'));

// Game codes of the party template: generation, names, and the Showdown sprite suffixes that look like that game.
const G = (gen, en, es, sprites, order) => ({gen, en, es, sprites, order});
const GAMES = {
  RGB: G(1, 'Red and Blue', 'Rojo y Azul', ['gen1rb', 'gen1'], 10), Y: G(1, 'Yellow', 'Amarillo', ['gen1', 'gen1rb'], 11),
  Stadium: G(1, 'Pokémon Stadium', 'Pokémon Stadium', ['gen1', 'gen1rb'], 12),
  GSC: G(2, 'Gold, Silver and Crystal', 'Oro, Plata y Cristal', ['gen2'], 20), Stadium2: G(2, 'Pokémon Stadium 2', 'Pokémon Stadium 2', ['gen2'], 21),
  RS: G(3, 'Ruby and Sapphire', 'Rubí y Zafiro', ['gen3rs', 'rs', 'gen3'], 30), Ru: G(3, 'Ruby', 'Rubí', ['gen3rs', 'rs', 'gen3'], 30),
  Sa: G(3, 'Sapphire', 'Zafiro', ['gen3rs', 'rs', 'gen3'], 30), E: G(3, 'Emerald', 'Esmeralda', ['e', 'gen3'], 31),
  RSE: G(3, 'Ruby, Sapphire and Emerald', 'Rubí, Zafiro y Esmeralda', ['gen3', 'rse', 'e'], 31),
  FRLG: G(3, 'FireRed and LeafGreen', 'Rojo Fuego y Verde Hoja', ['frlg', 'gen3'], 32),
  DP: G(4, 'Diamond and Pearl', 'Diamante y Perla', ['gen4dp', 'gen4'], 40), Pt: G(4, 'Platinum', 'Platino', ['gen4'], 41),
  HGSS: G(4, 'HeartGold and SoulSilver', 'Oro HeartGold y Plata SoulSilver', ['gen4'], 42),
  PtHGSS: G(4, 'Platinum, HeartGold and SoulSilver', 'Platino, Oro HeartGold y Plata SoulSilver', ['gen4'], 42),
  BWB2W2: G(5, 'Black, White, Black 2 and White 2', 'Negro, Blanco, Negro 2 y Blanco 2', ['gen5bw', 'gen5bw2', ''], 51),
  XYORAS: G(6, 'X, Y, Omega Ruby and Alpha Sapphire', 'X, Y, Rubí Omega y Zafiro Alfa', ['gen6xy', 'gen6'], 61),
  BW: G(5, 'Black and White', 'Negro y Blanco', ['gen5bw', 'gen5'], 50), Bl: G(5, 'Black', 'Negro', ['gen5bw', 'gen5'], 50),
  W: G(5, 'White', 'Blanco', ['gen5bw', 'gen5'], 50),
  B2W2: G(5, 'Black 2 and White 2', 'Negro 2 y Blanco 2', ['gen5bw2', ''], 51), B2: G(5, 'Black 2', 'Negro 2', ['gen5bw2', ''], 51),
  W2: G(5, 'White 2', 'Blanco 2', ['gen5bw2', ''], 51),
  XY: G(6, 'X and Y', 'X e Y', ['gen6xy', 'gen6'], 60), ORAS: G(6, 'Omega Ruby and Alpha Sapphire', 'Rubí Omega y Zafiro Alfa', ['gen6'], 61),
  OR: G(6, 'Omega Ruby', 'Rubí Omega', ['gen6'], 61), AS: G(6, 'Alpha Sapphire', 'Zafiro Alfa', ['gen6'], 61),
  SM: G(7, 'Sun and Moon', 'Sol y Luna', ['gen7'], 70), Su: G(7, 'Sun', 'Sol', ['gen7'], 70), M: G(7, 'Moon', 'Luna', ['gen7'], 70),
  USUM: G(7, 'Ultra Sun and Ultra Moon', 'Ultrasol y Ultraluna', ['usum', 'gen7'], 71), US: G(7, 'Ultra Sun', 'Ultrasol', ['usum', 'gen7'], 71),
  UM: G(7, 'Ultra Moon', 'Ultraluna', ['usum', 'gen7'], 71),
  SMUSUM: G(7, 'Sun, Moon, Ultra Sun and Ultra Moon', 'Sol, Luna, Ultrasol y Ultraluna', ['gen7', 'usum'], 71),
  SUS: G(7, 'Sun and Ultra Sun', 'Sol y Ultrasol', ['gen7', 'usum'], 71), MUM: G(7, 'Moon and Ultra Moon', 'Luna y Ultraluna', ['gen7', 'usum'], 71),
  PE: G(7, "Let's Go, Pikachu! and Let's Go, Eevee!", "Let's Go, Pikachu! y Let's Go, Eevee!", ['lgpe'], 72),
  SwSh: G(8, 'Sword and Shield', 'Espada y Escudo', [''], 80), Sw: G(8, 'Sword', 'Espada', [''], 80), Sh: G(8, 'Shield', 'Escudo', [''], 80),
  BDSP: G(8, 'Brilliant Diamond and Shining Pearl', 'Diamante Brillante y Perla Reluciente', ['', 'gen4dp'], 81),
  SV: G(9, 'Scarlet and Violet', 'Escarlata y Púrpura', ['', 's', 'v'], 90), ZA: G(9, 'Legends: Z-A', 'Leyendas Pokémon: Z-A', [''], 91),
  // Legends: Arceus is a generation 8 game, but its Hisuian Pokémon and moves only exist in the generation 9 dex
  LA: {...G(8, 'Legends: Arceus', 'Leyendas Pokémon: Arceus', ['la', ''], 85), dex: 9},
};
const GAME_ALIASES = {Yellow: 'Y', 'Black and White': 'BW', 'Pokémon X and Y': 'XY', 'X and Y': 'XY', 'Pokémon Omega Ruby and Alpha Sapphire': 'ORAS'};

// Sprite suffix → label. Pokémon Masters EX and similar keep a number.
const SPRITE_LABELS = {
  '': ['Showdown (current)', 'Showdown (actual)'], gen1rb: ['Red and Blue', 'Rojo y Azul'], gen1: ['Yellow', 'Amarillo'],
  gen1champion: ['Yellow (Champion)', 'Amarillo (campeón)'], gen1rbchampion: ['Red and Blue (Champion)', 'Rojo y Azul (campeón)'],
  gen1two: ['Yellow (second)', 'Amarillo (segundo)'], gen1rbtwo: ['Red and Blue (second)', 'Rojo y Azul (segundo)'],
  gen1main: ['Red and Blue (main)', 'Rojo y Azul (principal)'], gen1title: ['Red and Blue (title screen)', 'Rojo y Azul (portada)'],
  gen2: ['Gold, Silver and Crystal', 'Oro, Plata y Cristal'], gen2kanto: ['Gold, Silver and Crystal (Kanto)', 'Oro, Plata y Cristal (Kanto)'],
  gen3: ['Generation III', 'Tercera generación'], gen3rs: ['Ruby and Sapphire', 'Rubí y Zafiro'], gen3jp: ['Generation III (Japan)', 'Tercera generación (Japón)'],
  gen3champion: ['FireRed and LeafGreen (Champion)', 'Rojo Fuego y Verde Hoja (campeón)'], gen3two: ['FireRed and LeafGreen (second)', 'Rojo Fuego y Verde Hoja (segundo)'],
  frlg: ['FireRed and LeafGreen', 'Rojo Fuego y Verde Hoja'], e: ['Emerald', 'Esmeralda'], rs: ['Ruby and Sapphire', 'Rubí y Zafiro'],
  rse: ['Ruby, Sapphire and Emerald', 'Rubí, Zafiro y Esmeralda'], gen4: ['Platinum and HeartGold/SoulSilver', 'Platino y HeartGold/SoulSilver'],
  gen4dp: ['Diamond and Pearl', 'Diamante y Perla'], gen5bw: ['Black and White', 'Negro y Blanco'], gen5bw2: ['Black 2 and White 2', 'Negro 2 y Blanco 2'],
  gen6: ['Omega Ruby and Alpha Sapphire', 'Rubí Omega y Zafiro Alfa'], gen6xy: ['X and Y', 'X e Y'], gen7: ['Sun and Moon', 'Sol y Luna'],
  usum: ['Ultra Sun and Ultra Moon', 'Ultrasol y Ultraluna'], lgpe: ["Let's Go", "Let's Go"], s: ['Scarlet', 'Escarlata'], v: ['Violet', 'Púrpura'],
  anime: ['Anime', 'Anime'], anime2: ['Anime (2)', 'Anime (2)'], contest: ['Contest', 'Concursos'], champion: ['Champion', 'Campeón'],
  festival: ['Festival', 'Festival'], league: ['League', 'Liga'], leader: ['Gym Leader', 'Líder de gimnasio'], tower: ['Battle Tower', 'Torre Batalla'],
  stance: ['Pose', 'Pose'], stand: ['Standing', 'De pie'], unmasked: ['Unmasked', 'Sin máscara'], zerosuit: ['Casual', 'Informal'], pwt: ['World Tournament', 'Torneo Mundial'],
  nihilego: ['With Nihilego', 'Con Nihilego'], gen5bw2kanto: ['Black 2 and White 2', 'Negro 2 y Blanco 2'],
};
const spriteLabel = (suffix) => {
  const m = suffix.match(/^masters(\d*)$/);
  if (m) return m[1] ? [`Pokémon Masters EX (${m[1]})`, `Pokémon Masters EX (${m[1]})`] : ['Pokémon Masters EX', 'Pokémon Masters EX'];
  return SPRITE_LABELS[suffix] || [suffix, suffix];
};

const BASE_OVERRIDES = {'Steven Stone': 'steven', 'Professor Kukui': 'kukui', Kukui: 'kukui', 'Tate and Liza': 'tateandliza'};
const NAME_OVERRIDES = {'Professor Kukui': 'Kukui'};
const SKIP = new Set(['Barry', 'Serena', 'Rose (game)']);  // empty duplicates; Rose is the chairman's valid Sword/Shield party

// Bag items (potions and the like): battles here use held items only, so sentences about them leave the note.
const BAG = {
  'Full Restore': 'Restaurar Todo', 'Max Potion': 'Poción Máxima', 'Hyper Potion': 'Hiperpoción', 'Super Potion': 'Superpoción', Potion: 'Poción',
  'Full Heal': 'Cura Total', 'Max Revive': 'Revivir Máximo', Revive: 'Revivir', 'X Attack': 'Ataque X', 'X Defense': 'Defensa X', 'X Defend': 'Defensa X',
  'X Speed': 'Velocidad X', 'X Special': 'Especial X', 'X Sp. Atk': 'Ataque Especial X', 'X Sp. Def': 'Defensa Especial X', 'X Accuracy': 'Precisión X',
  'Guard Spec.': 'Protección X', 'Dire Hit': 'Directo', 'Max Elixir': 'Elixir Máximo', Elixir: 'Elixir', 'Max Ether': 'Éter Máximo', Ether: 'Éter',
  'Sacred Ash': 'Ceniza Sagrada', Antidote: 'Antídoto', 'Paralyze Heal': 'Antiparalizador', Awakening: 'Despertar', 'Burn Heal': 'Antiquemar',
  'Ice Heal': 'Antihielo', 'Fresh Water': 'Agua Fresca', 'Moomoo Milk': 'Leche Mu-mu',
};
const BAG_RE = new RegExp(`\\b(${Object.keys(BAG).map((k) => k.replace(/[.]/g, '\\.')).join('|')})(e?s)?\\b`, 'i');
const withoutBag = (note) => note.split(/(?<=[.!?])\s+/).filter((x) => !BAG_RE.test(x)).join(' ').trim();

const stats = {characters: 0, variants: 0, merged: 0, sets: 0, droppedMoves: 0, droppedSpecies: 0, droppedItems: 0, droppedAbilities: 0, skippedParties: 0, labels: new Set()};
const dropped = {moves: {}, species: {}, items: {}, abilities: {}};
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

function cleanTemplates(s) {
  return String(s || '').replace(/\{\{(?:kal|game\d?|g|tt)\|([^|}]*)(?:\|[^}]*)?\}\}/g, (m, a) => GAMES[a]?.en || a).replace(/\{\{[^}]*\}\}/g, '').replace(/\bthe the\b/g, 'the').replace(/\s+/g, ' ').trim();
}

function level(raw) {
  const s = String(raw ?? '');
  const tts = [...s.matchAll(/\{\{tt\|(\d+)\|/g)].map((m) => Number(m[1]));
  if (tts.length) return {level: tts[tts.length - 1], range: tts.length > 1 ? [Math.min(...tts), Math.max(...tts)] : null};
  const r = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (r) return {level: Number(r[1]), range: [Number(r[1]), Number(r[2])]};
  const n = parseInt(s, 10);
  return {level: Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 50, range: null};
}

function makeSet(mon, dex) {
  if (!mon.s) { stats.droppedSpecies++; return null; }
  let sp = dex.species.get(mon.s);
  if (!sp.exists) { bump(dropped.species, mon.s); stats.droppedSpecies++; return null; }
  let shiny = false;
  const form = (mon.f || '').replace(/^-/, '');
  if (form === 'Shiny') shiny = true;
  else if (form && !['Male', 'Female', 'Terastal'].includes(form)) {
    const f = dex.species.get(`${sp.baseSpecies}-${form}`);
    if (f.exists) sp = f;
  }
  if (form === 'Female' && dex.species.get(`${sp.baseSpecies}-F`).exists) sp = dex.species.get(`${sp.baseSpecies}-F`);
  const moves = [];
  for (const m0 of mon.m || []) {
    const m = m0.replace(/&nbsp;/g, ' ');
    const mv = dex.moves.get(m);
    if (mv.exists && !moves.includes(mv.name)) moves.push(mv.name);
    else if (!mv.exists) { bump(dropped.moves, m); stats.droppedMoves++; }
  }
  let item = '';
  const rawItem = mon.i && !/^(none|—|-)$/i.test(mon.i) ? mon.i : mon.x || '';
  if (rawItem) {
    const it = dex.items.get(rawItem);
    if (it.exists) item = it.name; else { bump(dropped.items, rawItem); stats.droppedItems++; }
  }
  let ability = '';
  if (mon.a && dex.gen >= 3) {
    const ab = dex.abilities.get(mon.a.split(/\s*\/\s*|\s+or\s+/)[0]);
    if (ab.exists) ability = ab.name; else { bump(dropped.abilities, mon.a); stats.droppedAbilities++; }
  }
  let nature = '';
  if (mon.n && dex.gen >= 3) { const na = dex.natures.get(mon.n); if (na.exists) nature = na.name; }
  if (!moves.length) { stats.droppedSpecies++; bump(dropped.species, `${mon.s} (no moves)`); return null; }
  const {level: lv, range} = level(mon.l);
  const g = (mon.g || '').toLowerCase();
  const out = {species: sp.name, level: lv, moves};
  if (Array.isArray(mon.ev) && mon.ev.some(Boolean)) out.evs = Object.fromEntries(['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k, j) => [k, Math.min(255, mon.ev[j] || 0)]));
  if (Array.isArray(mon.iv) && mon.iv.some((x) => x !== 31)) out.ivs = Object.fromEntries(['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k, j) => [k, mon.iv[j] ?? 31]));
  if (item) out.item = item;
  if (ability) out.ability = ability;
  if (nature) out.nature = nature;
  if (dex.gen >= 2 && (g === 'male' || g === 'female' || g === '♀')) out.gender = g === 'male' ? 'M' : 'F';
  if (mon.t && dex.gen >= 9 && dex.types.get(mon.t).exists) out.teraType = dex.types.get(mon.t).name;
  if (shiny) out.shiny = true;
  if (range) out.level_range = range;
  stats.sets++;
  return out;
}

const gameId = (x) => toID(x.replace(/^Pokémon:?\s+/, '').replace(/\band\b/g, ''));
const GAME_NAMES = new Set([...Object.values(GAMES).map((g) => gameId(g.en)), ...Object.keys(GAMES).map(toID), ...['Gold, Silver, Crystal', "Let's Go, Pikachu! and Let's Go, Eevee!",
  'Sun, Moon, Ultra Sun, and Ultra Moon', 'Ruby, Sapphire, and Emerald', 'Stadium 2', 'Stadium', 'LGPE', 'Ruby', 'Sapphire', 'Omega Ruby', 'Alpha Sapphire', 'Sword', 'Shield',
  'Ultra Sun', 'Ultra Moon', 'Sun', 'Moon', 'Black', 'White', 'Black 2', 'White 2', 'X', 'Y'].map(gameId)]);
const isGameName = (x) => GAME_NAMES.has(gameId(x));
const NOT_LABELS = new Set(['Pokémon', 'Role', 'Party', 'battle', 'battles']);
// Game cards: the codes of the party template grouped as the games are sold (a team of 'Sun, Moon, Ultra Sun and Ultra Moon' is in both).
const CARDS = [
  ['rb', ['RGB'], 1], ['y', ['Y'], 1], ['stadium', ['Stadium'], 1], ['gsc', ['GSC'], 2], ['stadium2', ['Stadium2'], 2],
  ['rs', ['RS', 'Ru', 'Sa', 'RSE'], 3], ['e', ['E', 'RSE'], 3], ['frlg', ['FRLG'], 3], ['dp', ['DP'], 4], ['pt', ['Pt', 'PtHGSS'], 4], ['hgss', ['HGSS', 'PtHGSS'], 4],
  ['bw', ['BW', 'Bl', 'W', 'BWB2W2'], 5], ['b2w2', ['B2W2', 'B2', 'W2', 'BWB2W2'], 5], ['xy', ['XY', 'XYORAS'], 6], ['oras', ['ORAS', 'OR', 'AS', 'XYORAS'], 6],
  ['sm', ['SM', 'Su', 'M', 'SMUSUM', 'SUS', 'MUM'], 7], ['usum', ['USUM', 'US', 'UM', 'SMUSUM', 'SUS', 'MUM'], 7], ['lgpe', ['PE'], 7],
  ['swsh', ['SwSh', 'Sw', 'Sh'], 8], ['bdsp', ['BDSP'], 8], ['la', ['LA'], 8], ['sv', ['SV'], 9], ['za', ['ZA'], 9],
];
const CARD_NAMES = {rb: 'RGB', y: 'Y', stadium: 'Stadium', gsc: 'GSC', stadium2: 'Stadium2', rs: 'RS', e: 'E', frlg: 'FRLG', dp: 'DP', pt: 'Pt', hgss: 'HGSS',
  bw: 'BW', b2w2: 'B2W2', xy: 'XY', oras: 'ORAS', sm: 'SM', usum: 'USUM', lgpe: 'PE', swsh: 'SwSh', bdsp: 'BDSP', la: 'LA', sv: 'SV', za: 'ZA'};
const cardsOf = (code) => CARDS.filter(([, codes]) => codes.includes(code)).map(([id]) => id);

// The role a team plays in its game, for the game page's sections.
const RIVALS = new Set(['blue', 'silver', 'brendan', 'may', 'wally', 'barry', 'cheren', 'bianca', 'n', 'hugh', 'shauna', 'calem', 'serena', 'tierno', 'trevor',
  'hau', 'gladion', 'hop', 'bede', 'marnie', 'nemona', 'arven', 'penny', 'kieran', 'carmine', 'klara', 'avery', 'lucas', 'dawn', 'hilbert', 'hilda', 'nate',
  'rosa', 'elio', 'selene', 'victor', 'gloria', 'florian', 'juliana', 'kris', 'ethan', 'lyra', 'lillie']);
const VILLAINS = new Set(['giovanni', 'archie', 'maxie', 'cyrus', 'ghetsis', 'colress', 'lysandre', 'guzma', 'lusamine', 'rose', 'xerosic', 'archer', 'ariana',
  'proton', 'petrel', 'courtney', 'tabitha', 'matt', 'shelly', 'mars', 'jupiter', 'saturn', 'charon', 'zinzolin', 'aliana', 'celosia', 'bryony', 'mable',
  'plumeria', 'faba', 'oleana', 'giacomo', 'mela', 'atticus', 'ortega', 'eri', 'sordward', 'shielbert']);
// Generation I parties carry no class: their role by character.
const KNOWN = {brock: 'leaders', misty: 'leaders', ltsurge: 'leaders', erika: 'leaders', koga: 'leaders', sabrina: 'leaders', blaine: 'leaders', viola: 'leaders',
  lorelei: 'elite', bruno: 'elite', agatha: 'elite', lance: 'elite', drayton: 'elite', lacey: 'elite', crispin: 'elite', amarys: 'elite', rika: 'elite',
  poppy: 'elite', hassel: 'elite', larry: 'elite', steven: 'champions', kukui: 'champions'};
function categoryOf(key, cls, labels, tag) {
  const c = tag ? '' : cls.toLowerCase();
  const L = labels.join(' | ');
  if (/battle (tower|tree|maison|chateau|subway|frontier|agency|factory|hall|castle|arcade|palace|pike|pyramid|dome|arena)|master (class|rank)|royal dome/i.test(L)
    || /^(marquis|marchioness|duke|duchess|grand duchess|frontier brain|tower tycoon|factory head|arcade star|castle valet|hall matron|subway boss|chatelaine|battle chatelaine|salon maiden|dome ace|palace maven|arena tycoon|pike queen|pyramid king)$/i.test(c)) return 'facilities';
  if (/world tournament|star tournament|leaders tournament|champions tournament|mix tournament|driftveil|academy ace|league club room|type expert|champion tournament|battle royal/i.test(L)) return 'tournaments';
  if (/champion battle|title defense|champion assessment/i.test(L)) return 'champions';
  if (/gym battle/i.test(L)) return 'leaders';
  if (/champion/.test(c)) return 'champions';
  if (c === 'elite four') return 'elite';
  if (/^(gym )?leaders?$/.test(c)) return 'leaders';
  if (/captain|kahuna/.test(c) || /trial/i.test(L)) return 'trials';
  if (/boss|team |magma|aqua|galactic|plasma|flare|skull|rocket|admin|commander|aether president/.test(c) || VILLAINS.has(key)) return 'villains';
  if (c === 'rival' || RIVALS.has(key)) return 'rivals';
  if (!c && !tag && KNOWN[key]) return KNOWN[key];
  return 'others';
}

const tidyKey = (s) => toID(s).slice(0, 40);
const characters = [];
for (const [page, entry] of Object.entries(scrape)) {
  if (SKIP.has(page) || !entry.parties?.length) continue;
  const title = String(entry.title || page).split('#')[0];
  const nameEn = NAME_OVERRIDES[title] || title.replace(/\s*\(game\)$/, '');
  const base = BASE_OVERRIDES[title] || BASE_OVERRIDES[nameEn] || toID(nameEn);
  const key = base;
  const sprites = SPRITES.filter((n) => n === base || n.startsWith(base + '-')).map((id) => {
    const suffix = id === base ? '' : id.slice(base.length + 1);
    const [en, es] = spriteLabel(suffix);
    return {id, suffix, label: en, label_es: es};
  });
  const firstWord = toID(nameEn.split(/\s+/)[0]);
  const variants = [];
  for (const p of entry.parties) {
    const code = GAME_ALIASES[p.game] || p.game;
    const game = GAMES[code];
    if (!game) { stats.skippedParties++; (stats.skippedWhy ||= []).push(`${page}: game ${p.game}`); continue; }
    // A tag battle lists both trainers; keep the side that belongs to this character.
    let mons = p.mons || [];
    if (p.tpl === 'Party/2') {
      const n1 = toID(p.name), n2 = toID(p.name2);
      if (n2 && (n2.includes(firstWord) || firstWord.includes(n2)) && p.mons2) mons = p.mons2;
      else if (!(n1 && (n1.includes(firstWord) || firstWord.includes(n1)))) { stats.skippedParties++; continue; }
    }
    if (!mons.length) { stats.skippedParties++; (stats.skippedWhy ||= []).push(`${page}: empty ${p.path.join('/')}`); continue; }
    const dex = Dex.forGen(game.dex || game.gen);
    const sets = mons.map((m) => makeSet(m, dex)).filter(Boolean);
    const doubles = base === 'tateandliza';
    if (!sets.length) { stats.skippedParties++; continue; }
    const labelsEn = p.path.slice(1).map(cleanTemplates).filter((x) => x && !NOT_LABELS.has(x) && !isGameName(x));
    if (p.path[0] && /side series/i.test(p.path[0]) && !/Stadium/.test(game.en)) labelsEn.unshift(cleanTemplates(p.path[1]));
    labelsEn.forEach((l) => stats.labels.add(l));
    const note = cleanTemplates(p.note || '');
    const sprite = game.sprites.map((suf) => (suf ? `${base}-${suf}` : base)).find((id) => SPRITES.includes(id)) || (SPRITES.includes(base) ? base : sprites[0]?.id || '');
    const sig = JSON.stringify([code, sets]);
    const same = variants.find((v) => v._sig === sig);
    if (same) {
      const extra = labelsEn.join(' · ');
      if (extra && !same.labels_alt.includes(extra)) same.labels_alt.push(extra);
      stats.merged++;
      continue;
    }
    variants.push({
      games: cardsOf(code), category: p.facility ? 'facilities' : categoryOf(base, cleanTemplates(p.cls), labelsEn, p.tpl === 'Party/2'),
      _sig: sig, id: '', game: code, game_name: game.en, game_name_es: game.es, gen: game.gen, order: game.order, format: `gen${game.dex || game.gen}${doubles ? 'doubles' : ''}customgame`,
      labels: labelsEn, labels_alt: [], trainer_class: cleanTemplates(p.cls), location: cleanTemplates(p.location),
      note: withoutBag(note).slice(0, 300), sprite, sets, ...(sets.length > 6 ? {pool: sets.length} : {}), side: /side series/i.test(p.path[0] || ''),
    });
  }
  if (!variants.length) continue;
  variants.sort((a, b) => a.side - b.side || a.order - b.order);
  // Rivals change team with the player's starter: when one game and stage has several teams, name each by the Pokémon only it has.
  const groups = {};
  for (const v of variants) (groups[v.game + '|' + v.labels.join('|')] ||= []).push(v);
  for (const list of Object.values(groups)) {
    if (list.length < 2) continue;
    for (const v of list) {
      const others = new Set(list.filter((o) => o !== v).flatMap((o) => o.sets.map((x) => x.species)));
      const own = [...v.sets].reverse().map((x) => x.species).find((sp) => !others.has(sp));
      if (own) v.with = own;
    }
  }
  const used = new Set();
  for (const v of variants) {
    let id = tidyKey([v.game, ...v.labels, v.with || ''].join('-')) || v.game.toLowerCase();
    let n = 2;
    while (used.has(id)) id = `${tidyKey([v.game, ...v.labels].join('-'))}${n++}`;
    used.add(id);
    v.id = id;
    delete v._sig;
  }
  const esName = ES[page] || ES[title] || ES[nameEn] || entry.es;
  characters.push({key, name: nameEn, name_es: esName && !/^(err|\d{3} )/.test(esName) ? esName : nameEn, base_sprite: SPRITES.includes(base) ? base : sprites[0]?.id || '',
    sprites, variants, games: [...new Set(variants.map((v) => v.game))]});
  stats.characters++;
  stats.variants += variants.length;
}

// Labels: translated by the table when it has them; the rest stay in English.
const missing = new Set();
for (const c of characters) for (const v of c.variants) {
  v.labels_es = v.labels.map((l) => LABELS[l] || (missing.add(l), l));
  v.labels_alt_es = v.labels_alt.map((l) => l.split(' · ').map((x) => LABELS[x] || (missing.add(x), x)).join(' · '));
}

const games = CARDS.map(([id, , gen]) => {
  const g = GAMES[CARD_NAMES[id]];
  return {id, gen, name: g.en, name_es: g.es, side: /Stadium/.test(g.en)};
});
const out = {schema: 2, games, categories: ['leaders', 'elite', 'champions', 'trials', 'rivals', 'villains', 'facilities', 'tournaments', 'others'], source: 'Teams, levels and held items from Bulbapedia (bulbapedia.bulbagarden.net, CC BY-NC-SA 2.5), checked against the Pokémon Showdown dex of each generation. Trainer sprites from Pokémon Showdown.',
  characters};
fs.writeFileSync(OUT, OUT.endsWith('.gz') ? zlib.gzipSync(JSON.stringify(out), {level: 9}) : JSON.stringify(out));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 25);
console.error(JSON.stringify({...stats, labels: stats.labels.size, missing_labels: missing.size, out: OUT, bytes: fs.statSync(OUT).size}, null, 0));
console.error('dropped moves', JSON.stringify(top(dropped.moves)));
console.error('dropped species', JSON.stringify(top(dropped.species)));
console.error('dropped items', JSON.stringify(top(dropped.items)));
console.error('dropped abilities', JSON.stringify(top(dropped.abilities)));
if (process.env.LABELS_OUT) fs.writeFileSync(process.env.LABELS_OUT, JSON.stringify([...missing].sort(), null, 1));
