// Builds silvers_hoard/presets/canon.json — the in-game teams of the leaders, Elite Four, champions, rivals and bosses of
// Crystal (gen 2), FireRed/LeafGreen and Emerald (gen 3) — from the community disassemblies' data files (pret). Run once with
// network access: `node scripts/build_canon.mjs <folder with the downloaded files> <output.json>`.
import fs from 'node:fs';
import path from 'node:path';
import {Dex, toID} from '@pkmn/sim';

const [dir, outFile] = process.argv.slice(2);
const SPRITES = new Set(fs.existsSync(path.join(dir, 'trainer_sprites.txt')) ? fs.readFileSync(path.join(dir, 'trainer_sprites.txt'), 'utf8').split(/\s+/).filter(Boolean) : []);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const MOVE_FIX = {faintattack: 'feintattack', hijumpkick: 'highjumpkick', vicegrip: 'visegrip', smellingsalt: 'smellingsalts', psychicm: 'psychic',
  sonicboom: 'sonicboom', doubleslap: 'doubleslap', selfdestruct: 'selfdestruct', softboiled: 'softboiled', poisonpowder: 'poisonpowder',
  thunderpunch: 'thunderpunch', solarbeam: 'solarbeam', dragonbreath: 'dragonbreath', extremespeed: 'extremespeed', ancientpower: 'ancientpower',
  bubblebeam: 'bubblebeam', dynamicpunch: 'dynamicpunch', thundershock: 'thundershock', sandattack: 'sandattack', pinmissile: 'pinmissile'};
const SPECIES_FIX = {nidoranf: 'nidoranf', nidoranm: 'nidoranm', mrmime: 'mrmime', farfetchd: 'farfetchd', hooh: 'hooh', unownA: 'unown'};

function species(gen, raw) {
  const id = SPECIES_FIX[toID(raw)] || toID(raw);
  const sp = Dex.forGen(gen).species.get(id);
  if (!sp.exists) throw new Error(`species ${raw}`);
  return sp.name;
}
function move(gen, raw) {
  let id = toID(raw);
  id = MOVE_FIX[id] || id;
  const mv = Dex.forGen(gen).moves.get(id);
  if (!mv.exists) throw new Error(`move ${raw}`);
  return mv.name;
}
function item(gen, raw) {
  if (!raw || /NONE/.test(raw)) return '';
  const it = Dex.forGen(gen).items.get(toID(raw.replace(/^ITEM_/, '')));
  return it.exists ? it.name : '';
}
function defaultMoves(gen, name, level) {
  const dex = Dex.forGen(gen);
  const sp = dex.species.get(name);
  const data = dex.species.getLearnsetData(sp.id);
  const learned = [];
  for (const [id, sources] of Object.entries(data?.learnset || {})) {
    for (const s of sources) {
      const m = new RegExp(`^${gen}L(\\d+)$`).exec(s);
      if (m && Number(m[1]) <= level) learned.push([Number(m[1]), id]);
    }
  }
  learned.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [, id] of learned) { const n = dex.moves.get(id).name; const i = out.indexOf(n); if (i >= 0) out.splice(i, 1); out.push(n); }
  return out.slice(-4);
}
const cap = (s) => s.replace(/_/g, ' ').toLowerCase().replace(/(^|[\s.&-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/&/g, ' & ').replace(/\s+/g, ' ').trim();

// ---------- gen 3 (C sources)
function parseGen3(game, gen) {
  const parties = {};
  const ptxt = read(`${game}_trainer_parties.h`);
  for (const m of ptxt.matchAll(/static const struct (\w+) (sParty_\w+)\[\] = \{([\s\S]*?)\n\};/g)) {
    const mons = [];
    for (const e of m[3].matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)?)\}/g)) {
      const body = e[1];
      const lvl = Number(/\.lvl = (\d+)/.exec(body)?.[1]);
      const sp = /\.species = SPECIES_(\w+)/.exec(body)?.[1];
      if (!sp || !lvl) continue;
      const iv = Number(/\.iv = (\d+)/.exec(body)?.[1] || 0);
      const it = /\.heldItem = (ITEM_\w+)/.exec(body)?.[1] || '';
      const mv = /\.moves = \{([^}]*)\}/.exec(body)?.[1];
      const name = species(gen, sp);
      const moves = mv ? mv.split(',').map((x) => x.trim()).filter((x) => x && x !== 'MOVE_NONE').map((x) => move(gen, x.replace(/^MOVE_/, ''))) : defaultMoves(gen, name, lvl);
      const ivv = Math.round((iv * 31) / 255);
      mons.push({species: name, level: lvl, item: item(gen, it), moves, ivs: {hp: ivv, atk: ivv, def: ivv, spa: ivv, spd: ivv, spe: ivv}});
    }
    parties[m[2]] = mons;
  }
  const trainers = {};
  const ttxt = read(`${game}_trainers.h`);
  for (const m of ttxt.matchAll(/\[(TRAINER_\w+)\] =\s*\{([\s\S]*?)\n    \},/g)) {
    const body = m[2];
    const party = /\.party = \w+\((sParty_\w+)\)/.exec(body)?.[1] || /\.party = \{\.\w+ = (sParty_\w+)\}/.exec(body)?.[1];
    trainers[m[1]] = {name: /trainerName = _\("([^"]*)"\)/.exec(body)?.[1] || '', cls: /trainerClass = (\w+)/.exec(body)?.[1] || '',
      double: /doubleBattle = TRUE/.test(body), party: parties[party] || []};
  }
  return trainers;
}

// ---------- gen 2 (asm)
function parseCrystal() {
  const txt = read('crystal_parties.asm');
  const groups = {};
  let group = null;
  let cur = null;
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const g = /^(\w+)Group:$/.exec(line);
    if (g) { group = g[1]; groups[group] = []; continue; }
    if (!group) continue;
    const head = /^db "([^"]*)@", (TRAINERTYPE_\w+)/.exec(line);
    if (head) { cur = {name: head[1], type: head[2], party: []}; groups[group].push(cur); continue; }
    if (/^db -1/.test(line)) { cur = null; continue; }
    const d = /^db\s+(\d+),\s*(.*)$/.exec(line);
    if (d && cur) {
      const parts = d[2].split(',').map((x) => x.trim());
      const lvl = Number(d[1]);
      const name = species(2, parts[0]);
      let it = '';
      let mv = [];
      if (cur.type === 'TRAINERTYPE_ITEM') it = parts[1];
      if (cur.type === 'TRAINERTYPE_MOVES') mv = parts.slice(1, 5);
      if (cur.type === 'TRAINERTYPE_ITEM_MOVES') { it = parts[1]; mv = parts.slice(2, 6); }
      const moves = mv.length ? mv.filter((x) => x !== 'NO_MOVE').map((x) => move(2, x)) : defaultMoves(2, name, lvl);
      cur.party.push({species: name, level: lvl, item: item(2, it), moves});
    }
  }
  return groups;
}

const ES = {Brock: 'Brock', Misty: 'Misty', 'Lt. Surge': 'Teniente Surge', Erika: 'Erika', Koga: 'Koga', Sabrina: 'Sabrina', Blaine: 'Blaine',
  Giovanni: 'Giovanni', Lorelei: 'Lorelei', Bruno: 'Bruno', Agatha: 'Agatha', Lance: 'Lance', Blue: 'Azul', Red: 'Rojo', Silver: 'Plata',
  Falkner: 'Pegaso', Bugsy: 'Antón', Whitney: 'Blanca', Morty: 'Morti', Chuck: 'Aníbal', Jasmine: 'Yasmina', Pryce: 'Fredo', Clair: 'Débora',
  Will: 'Mento', Karen: 'Karen', Janine: 'Sachiko', Roxanne: 'Petra', Brawly: 'Marcial', Wattson: 'Erico', Flannery: 'Candela', Norman: 'Norman',
  Winona: 'Alana', 'Tate & Liza': 'Vito y Leti', Juan: 'Galano', Sidney: 'Sixto', Phoebe: 'Fátima', Glacia: 'Nívea', Drake: 'Dracón',
  Wallace: 'Plubio', Steven: 'Máximo', Wally: 'Blasco', Maxie: 'Magno', Archie: 'Aquiles', May: 'Aura', Brendan: 'Bruno'};
const CLASS_ES = {leader: 'Líder de gimnasio', elite: 'Alto Mando', champion: 'Campeón', rival: 'Rival', boss: 'Jefe', legend: 'Leyenda'};

const out = [];
function avatarFor(name, game) {
  const base = toID(name === 'Tate & Liza' ? 'tateandliza' : name);
  const tries = game === 'Crystal' ? [`${base}-gen2`, base] : game === 'FireRed/LeafGreen' ? [`${base}-gen3`, `${base}-frlg`, base] : [`${base}-gen3`, base];
  return tries.find((t) => SPRITES.has(t)) || '';
}
const VARIANT_ES = {rematch: 'revancha', 'Victory Road': 'Calle Victoria', 'Meteor Falls': 'Cascada Meteoro', 'Mt. Silver': 'Monte Plateado',
  'Silph Co.': 'Silph S.A.', Mossdeep: 'Algaria'};
const variantName = (v, es) => String(v).split(' ').map((w) => (es && VARIANT_ES[w]) || (/^[a-z]+$/.test(w) ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
function add(key, name, cls, region, game, format, sets, extra = {}) {
  if (!sets.length) throw new Error(`empty ${key}`);
  if (extra.variant) extra = {...extra, variant: variantName(VARIANT_ES[extra.variant] ? extra.variant : extra.variant, false), variant_es: VARIANT_ES[extra.variant] || variantName(extra.variant, true)};
  out.push({key, name, name_es: ES[name] || name, class: cls, class_es: CLASS_ES[cls], region, game, format, avatar: avatarFor(name, game), sets, ...extra});
}

// Kanto, FireRed/LeafGreen
const fr = parseGen3('firered', 3);
const KANTO = [['LEADER_BROCK', 'Brock'], ['LEADER_MISTY', 'Misty'], ['LEADER_LT_SURGE', 'Lt. Surge'], ['LEADER_ERIKA', 'Erika'], ['LEADER_KOGA', 'Koga'],
  ['LEADER_SABRINA', 'Sabrina'], ['LEADER_BLAINE', 'Blaine'], ['LEADER_GIOVANNI', 'Giovanni']];
for (const [id, name] of KANTO) add(`frlg-${toID(name)}`, name, 'leader', 'Kanto', 'FireRed/LeafGreen', 'gen3customgame', fr[`TRAINER_${id}`].party);
for (const [id, name] of [['ELITE_FOUR_LORELEI', 'Lorelei'], ['ELITE_FOUR_BRUNO', 'Bruno'], ['ELITE_FOUR_AGATHA', 'Agatha'], ['ELITE_FOUR_LANCE', 'Lance']]) {
  add(`frlg-${toID(name)}`, name, 'elite', 'Kanto', 'FireRed/LeafGreen', 'gen3customgame', fr[`TRAINER_${id}`].party);
  add(`frlg-${toID(name)}-rematch`, name, 'elite', 'Kanto', 'FireRed/LeafGreen', 'gen3customgame', fr[`TRAINER_${id}_2`].party, {variant: 'rematch'});
}
for (const st of ['SQUIRTLE', 'BULBASAUR', 'CHARMANDER']) {
  add(`frlg-blue-${st.toLowerCase()}`, 'Blue', 'champion', 'Kanto', 'FireRed/LeafGreen', 'gen3customgame', fr[`TRAINER_CHAMPION_FIRST_${st}`].party, {variant: st.toLowerCase()});
  add(`frlg-blue-${st.toLowerCase()}-rematch`, 'Blue', 'champion', 'Kanto', 'FireRed/LeafGreen', 'gen3customgame', fr[`TRAINER_CHAMPION_REMATCH_${st}`].party, {variant: `${st.toLowerCase()} rematch`});
}
add('frlg-giovanni-boss', 'Giovanni', 'boss', 'Kanto', 'FireRed/LeafGreen', 'gen3customgame', fr.TRAINER_BOSS_GIOVANNI_2.party, {variant: 'Silph Co.'});

// Hoenn, Emerald
const em = parseGen3('emerald', 3);
const HOENN = [['ROXANNE', 'Roxanne'], ['BRAWLY', 'Brawly'], ['WATTSON', 'Wattson'], ['FLANNERY', 'Flannery'], ['NORMAN', 'Norman'], ['WINONA', 'Winona'],
  ['TATE_AND_LIZA', 'Tate & Liza'], ['JUAN', 'Juan']];
for (const [id, name] of HOENN) {
  add(`em-${toID(name)}`, name, 'leader', 'Hoenn', 'Emerald', em[`TRAINER_${id}_1`].double ? 'gen3doublescustomgame' : 'gen3customgame', em[`TRAINER_${id}_1`].party,
    {double: em[`TRAINER_${id}_1`].double});
  add(`em-${toID(name)}-rematch`, name, 'leader', 'Hoenn', 'Emerald', em[`TRAINER_${id}_5`].double ? 'gen3doublescustomgame' : 'gen3customgame', em[`TRAINER_${id}_5`].party,
    {variant: 'rematch', double: em[`TRAINER_${id}_5`].double});
}
for (const [id, name] of [['SIDNEY', 'Sidney'], ['PHOEBE', 'Phoebe'], ['GLACIA', 'Glacia'], ['DRAKE', 'Drake']]) add(`em-${toID(name)}`, name, 'elite', 'Hoenn', 'Emerald', 'gen3customgame', em[`TRAINER_${id}`].party);
add('em-wallace', 'Wallace', 'champion', 'Hoenn', 'Emerald', 'gen3customgame', em.TRAINER_WALLACE.party);
add('em-steven', 'Steven', 'legend', 'Hoenn', 'Emerald', 'gen3customgame', em.TRAINER_STEVEN.party, {variant: 'Meteor Falls'});
add('em-wally', 'Wally', 'rival', 'Hoenn', 'Emerald', 'gen3customgame', em.TRAINER_WALLY_VR_1.party, {variant: 'Victory Road'});
for (const st of ['MUDKIP', 'TREECKO', 'TORCHIC']) {
  add(`em-may-${st.toLowerCase()}`, 'May', 'rival', 'Hoenn', 'Emerald', 'gen3customgame', em[`TRAINER_MAY_LILYCOVE_${st}`].party, {variant: st.toLowerCase()});
  add(`em-brendan-${st.toLowerCase()}`, 'Brendan', 'rival', 'Hoenn', 'Emerald', 'gen3customgame', em[`TRAINER_BRENDAN_LILYCOVE_${st}`].party, {variant: st.toLowerCase()});
}
add('em-maxie', 'Maxie', 'boss', 'Hoenn', 'Emerald', em.TRAINER_MAXIE_MOSSDEEP.double ? 'gen3doublescustomgame' : 'gen3customgame', em.TRAINER_MAXIE_MOSSDEEP.party, {variant: 'Mossdeep'});
add('em-archie', 'Archie', 'boss', 'Hoenn', 'Emerald', 'gen3customgame', em.TRAINER_ARCHIE.party);

// Johto and Kanto, Crystal
const cr = parseCrystal();
const J = [['Falkner', 'Falkner'], ['Bugsy', 'Bugsy'], ['Whitney', 'Whitney'], ['Morty', 'Morty'], ['Chuck', 'Chuck'], ['Jasmine', 'Jasmine'], ['Pryce', 'Pryce'], ['Clair', 'Clair']];
for (const [g, name] of J) add(`gsc-${toID(name)}`, name, 'leader', 'Johto', 'Crystal', 'gen2customgame', cr[g][0].party);
const K2 = [['Brock', 'Brock'], ['Misty', 'Misty'], ['LtSurge', 'Lt. Surge'], ['Erika', 'Erika'], ['Janine', 'Janine'], ['Sabrina', 'Sabrina'], ['Blaine', 'Blaine'], ['Blue', 'Blue']];
for (const [g, name] of K2) add(`gsc-${toID(name)}`, name, 'leader', 'Kanto', 'Crystal', 'gen2customgame', cr[g][0].party);
for (const [g, name] of [['Will', 'Will'], ['Koga', 'Koga'], ['Bruno', 'Bruno'], ['Karen', 'Karen']]) add(`gsc-${toID(name)}`, name, 'elite', 'Johto', 'Crystal', 'gen2customgame', cr[g][0].party);
add('gsc-lance', 'Lance', 'champion', 'Johto', 'Crystal', 'gen2customgame', cr.Champion[0].party);
add('gsc-red', 'Red', 'legend', 'Kanto', 'Crystal', 'gen2customgame', cr.Red[0].party, {variant: 'Mt. Silver'});
['meganium', 'typhlosion', 'feraligatr'].forEach((st, i) => add(`gsc-silver-${st}`, 'Silver', 'rival', 'Johto', 'Crystal', 'gen2customgame', cr.Rival2[i + 3].party, {variant: st}));

// Leagues: the gyms in order with their badge and type, then the Elite Four and the champion.
const gym = (leader, city, city_es, type, badge, badge_es) => ({leader, city, city_es, type, badge, badge_es});
const leagues = [
  {key: 'kanto-frlg', name: 'Kanto League', name_es: 'Liga Kanto', region: 'Kanto', game: 'FireRed/LeafGreen', format: 'gen3customgame', gyms: [
    gym('frlg-brock', 'Pewter City', 'Ciudad Plateada', 'Rock', 'Boulder Badge', 'Medalla Roca'),
    gym('frlg-misty', 'Cerulean City', 'Ciudad Celeste', 'Water', 'Cascade Badge', 'Medalla Cascada'),
    gym('frlg-ltsurge', 'Vermilion City', 'Ciudad Carmín', 'Electric', 'Thunder Badge', 'Medalla Trueno'),
    gym('frlg-erika', 'Celadon City', 'Ciudad Azulona', 'Grass', 'Rainbow Badge', 'Medalla Arcoíris'),
    gym('frlg-koga', 'Fuchsia City', 'Ciudad Fucsia', 'Poison', 'Soul Badge', 'Medalla Alma'),
    gym('frlg-sabrina', 'Saffron City', 'Ciudad Azafrán', 'Psychic', 'Marsh Badge', 'Medalla Pantano'),
    gym('frlg-blaine', 'Cinnabar Island', 'Isla Canela', 'Fire', 'Volcano Badge', 'Medalla Volcán'),
    gym('frlg-giovanni', 'Viridian City', 'Ciudad Verde', 'Ground', 'Earth Badge', 'Medalla Tierra')],
  elite_four: ['frlg-lorelei', 'frlg-bruno', 'frlg-agatha', 'frlg-lance'], champion: 'frlg-blue-squirtle'},
  {key: 'johto-crystal', name: 'Johto League', name_es: 'Liga Johto', region: 'Johto', game: 'Crystal', format: 'gen2customgame', gyms: [
    gym('gsc-falkner', 'Violet City', 'Ciudad Malva', 'Flying', 'Zephyr Badge', 'Medalla Céfiro'),
    gym('gsc-bugsy', 'Azalea Town', 'Pueblo Azalea', 'Bug', 'Hive Badge', 'Medalla Colmena'),
    gym('gsc-whitney', 'Goldenrod City', 'Ciudad Trigal', 'Normal', 'Plain Badge', 'Medalla Planicie'),
    gym('gsc-morty', 'Ecruteak City', 'Ciudad Iris', 'Ghost', 'Fog Badge', 'Medalla Niebla'),
    gym('gsc-chuck', 'Cianwood City', 'Ciudad Orquídea', 'Fighting', 'Storm Badge', 'Medalla Tormenta'),
    gym('gsc-jasmine', 'Olivine City', 'Ciudad Olivo', 'Steel', 'Mineral Badge', 'Medalla Mineral'),
    gym('gsc-pryce', 'Mahogany Town', 'Pueblo Caoba', 'Ice', 'Glacier Badge', 'Medalla Glaciar'),
    gym('gsc-clair', 'Blackthorn City', 'Ciudad Endrino', 'Dragon', 'Rising Badge', 'Medalla Dragón')],
  elite_four: ['gsc-will', 'gsc-koga', 'gsc-bruno', 'gsc-karen'], champion: 'gsc-lance'},
  {key: 'hoenn-emerald', name: 'Hoenn League', name_es: 'Liga Hoenn', region: 'Hoenn', game: 'Emerald', format: 'gen3customgame', gyms: [
    gym('em-roxanne', 'Rustboro City', 'Ciudad Férrica', 'Rock', 'Stone Badge', 'Medalla Piedra'),
    gym('em-brawly', 'Dewford Town', 'Pueblo Azuliza', 'Fighting', 'Knuckle Badge', 'Medalla Puño'),
    gym('em-wattson', 'Mauville City', 'Ciudad Malvalona', 'Electric', 'Dynamo Badge', 'Medalla Dinamo'),
    gym('em-flannery', 'Lavaridge Town', 'Pueblo Lavacalda', 'Fire', 'Heat Badge', 'Medalla Calor'),
    gym('em-norman', 'Petalburg City', 'Ciudad Petalia', 'Normal', 'Balance Badge', 'Medalla Equilibrio'),
    gym('em-winona', 'Fortree City', 'Ciudad Arborada', 'Flying', 'Feather Badge', 'Medalla Pluma'),
    gym('em-tateliza', 'Mossdeep City', 'Ciudad Algaria', 'Psychic', 'Mind Badge', 'Medalla Mente'),
    gym('em-juan', 'Sootopolis City', 'Arrecípolis', 'Water', 'Rain Badge', 'Medalla Lluvia')],
  elite_four: ['em-sidney', 'em-phoebe', 'em-glacia', 'em-drake'], champion: 'em-wallace'},
  {key: 'kanto-crystal', name: 'Kanto Gyms (Crystal)', name_es: 'Gimnasios de Kanto (Cristal)', region: 'Kanto', game: 'Crystal', format: 'gen2customgame', gyms: [
    gym('gsc-brock', 'Pewter City', 'Ciudad Plateada', 'Rock', 'Boulder Badge', 'Medalla Roca'),
    gym('gsc-misty', 'Cerulean City', 'Ciudad Celeste', 'Water', 'Cascade Badge', 'Medalla Cascada'),
    gym('gsc-ltsurge', 'Vermilion City', 'Ciudad Carmín', 'Electric', 'Thunder Badge', 'Medalla Trueno'),
    gym('gsc-erika', 'Celadon City', 'Ciudad Azulona', 'Grass', 'Rainbow Badge', 'Medalla Arcoíris'),
    gym('gsc-janine', 'Fuchsia City', 'Ciudad Fucsia', 'Poison', 'Soul Badge', 'Medalla Alma'),
    gym('gsc-sabrina', 'Saffron City', 'Ciudad Azafrán', 'Psychic', 'Marsh Badge', 'Medalla Pantano'),
    gym('gsc-blaine', 'Seafoam Islands', 'Islas Espuma', 'Fire', 'Volcano Badge', 'Medalla Volcán'),
    gym('gsc-blue', 'Viridian City', 'Ciudad Verde', 'Various', 'Earth Badge', 'Medalla Tierra')],
  elite_four: [], champion: 'gsc-red'},
];
const keys = new Set(out.map((t) => t.key));
for (const l of leagues) for (const k of [...l.gyms.map((g) => g.leader), ...l.elite_four, l.champion]) if (!keys.has(k)) throw new Error(`league ${l.key}: ${k}`);
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, JSON.stringify({schema: 1, source: 'In-game parties from the pret disassemblies (pokecrystal, pokefirered, pokeemerald); moves left empty there are the last four level-up moves, as the games do.', trainers: out, leagues}, null, 1));
console.log(`${out.length} trainers, ${leagues.length} leagues -> ${outFile}`);
