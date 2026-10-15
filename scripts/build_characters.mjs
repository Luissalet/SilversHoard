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
};
const GAME_ALIASES = {Yellow: 'Y', 'Black and White': 'BW', 'Pokémon X and Y': 'XY', 'X and Y': 'XY'};

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
const SKIP = new Set(['Barry', 'Serena', 'Rose (game)', 'Rose']);  // empty duplicates, or a different Rose

// Bag items the leaders use, from the text above the party.
const BAG = {
  'Full Restore': 'Restaurar Todo', 'Max Potion': 'Poción Máxima', 'Hyper Potion': 'Hiperpoción', 'Super Potion': 'Superpoción', Potion: 'Poción',
  'Full Heal': 'Cura Total', 'Max Revive': 'Revivir Máximo', Revive: 'Revivir', 'X Attack': 'Ataque X', 'X Defense': 'Defensa X', 'X Defend': 'Defensa X',
  'X Speed': 'Velocidad X', 'X Special': 'Especial X', 'X Sp. Atk': 'Ataque Especial X', 'X Sp. Def': 'Defensa Especial X', 'X Accuracy': 'Precisión X',
  'Guard Spec.': 'Protección X', 'Dire Hit': 'Directo', 'Max Elixir': 'Elixir Máximo', Elixir: 'Elixir', 'Max Ether': 'Éter Máximo', Ether: 'Éter',
  'Sacred Ash': 'Ceniza Sagrada', Antidote: 'Antídoto', 'Paralyze Heal': 'Antiparalizador', Awakening: 'Despertar', 'Burn Heal': 'Antiquemar',
  'Ice Heal': 'Antihielo', 'Fresh Water': 'Agua Fresca', 'Moomoo Milk': 'Leche Mu-mu',
};
const COUNTS = {a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10};
function bagItems(note) {
  const out = [];
  const names = Object.keys(BAG).sort((a, b) => b.length - a.length);
  const taken = [];
  for (const item of names) {
    const re = new RegExp(`(?:\\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+)?${item.replace(/[.]/g, '\\.')}(?:e?s)?\\b(\\s+per Pokémon)?`, 'gi');
    let m;
    while ((m = re.exec(note))) {
      if (taken.some(([a, b]) => m.index < b && a < m.index + m[0].length)) continue;
      taken.push([m.index, m.index + m[0].length]);
      const n = m[1] ? (COUNTS[m[1].toLowerCase()] || Number(m[1]) || 1) : 1;
      const prev = out.find((x) => x.item === item);
      if (prev) prev.count = Math.max(prev.count, n);
      else out.push({item, item_es: BAG[item], count: n, per_pokemon: !!m[2]});
    }
  }
  return out;
}

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
    const dex = Dex.forGen(game.gen);
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
      _sig: sig, id: '', game: code, game_name: game.en, game_name_es: game.es, gen: game.gen, order: game.order, format: `gen${game.gen}${doubles ? 'doubles' : ''}customgame`,
      labels: labelsEn, labels_alt: [], trainer_class: cleanTemplates(p.cls), location: cleanTemplates(p.location),
      note: note.slice(0, 300), bag: bagItems(note), sprite, sets, side: /side series/i.test(p.path[0] || ''),
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
  const esName = ES[page] || ES[title] || ES[nameEn];
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

const out = {schema: 1, source: 'Teams, levels, held items and bag items from Bulbapedia (bulbapedia.bulbagarden.net, CC BY-NC-SA 2.5), checked against the Pokémon Showdown dex of each generation. Trainer sprites from Pokémon Showdown.',
  characters};
fs.writeFileSync(OUT, OUT.endsWith('.gz') ? zlib.gzipSync(JSON.stringify(out), {level: 9}) : JSON.stringify(out));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 25);
console.error(JSON.stringify({...stats, labels: stats.labels.size, missing_labels: missing.size, out: OUT, bytes: fs.statSync(OUT).size}, null, 0));
console.error('dropped moves', JSON.stringify(top(dropped.moves)));
console.error('dropped species', JSON.stringify(top(dropped.species)));
console.error('dropped items', JSON.stringify(top(dropped.items)));
console.error('dropped abilities', JSON.stringify(top(dropped.abilities)));
if (process.env.LABELS_OUT) fs.writeFileSync(process.env.LABELS_OUT, JSON.stringify([...missing].sort(), null, 1));
