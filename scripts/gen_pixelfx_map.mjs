// Writes silvers_hoard/presets/pixelfx_map.json: which pixelfx effect (client/src/battle/pixelfx) each move, status, condition, weather
// and terrain plays, from the same tables the battle screens use, plus the catalog of every vendored effect (for the pixelfx_map and
// pixelfx_effects tools). Run it with `node scripts/gen_pixelfx_map.mjs` after changing the mapping or the moves' shapes;
// `node scripts/gen_pixelfx_map.mjs --check` (used by the tests) fails when the file is out of date. Pins (data/pixelfx_pins.json) are
// server state and are not written here.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Dex} from '@pkmn/sim';
import {rtMove} from '../engine/src/realtime/moves.mjs';
import {CATEGORIES, SHAPES, TYPES, ROLE_INFO, STATUS_TABLE, EVENT_TABLE, WEATHER_TABLE, TERRAIN_TABLE, TYPE_COLORS, TYPE_TABLE, hitEffects, pickEffect,
  statusEffect, conditionEffect, eventEffect, fieldEffect, mappedIds, setPins} from '../client/src/battle/pixelfx/mapping.js';
import {EFFECT_IDS, CATEGORY_LIST, CATEGORY_ES, effectInfo} from '../client/src/battle/pixelfx/registry.js';
import {EFFECTS} from '../client/src/battle/pixelfx/registry.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'silvers_hoard', 'presets', 'pixelfx_map.json');
const plan = (p) => ({effect: p.id, tinted: !!p.tint, ...(p.color ? {color: p.color} : {}), role: p.role, seconds: p.hold === Infinity ? 'loop' : p.hold});

/** Every move of the real-time battles with the effect it plays (its own, or its type's), the effects by type, and the catalog. */
export function buildMap() {
  setPins({});
  const types = {};
  for (const type of TYPES) {
    types[type] = {color: TYPE_COLORS[type], hit: hitEffects({type}).map(plan), by_category: {}, by_shape: {}};
    for (const category of CATEGORIES) types[type].by_category[category] = plan(pickEffect({type, category}));
    for (const shape of SHAPES) types[type].by_shape[shape] = plan(pickEffect({type, shape}));
  }
  const moves = {};
  const usage = {};
  const use = (id) => { usage[id] = (usage[id] || 0) + 1; };
  for (const m of Dex.forGen(9).moves.all()) {
    if (!m.exists || m.isNonstandard === 'CAP' || m.id === 'recharge') continue;
    if (m.id.startsWith('hiddenpower') && m.id !== 'hiddenpower') continue;
    const p = rtMove(m.id, 9);
    if (!p || !TYPE_TABLE[m.type]) continue;
    const pick = pickEffect({type: m.type, category: m.category, shape: p.shape, move: m.id});
    const row = {name: m.name, type: m.type, category: m.category, shape: p.shape, ...plan(pick), source: pick.source};
    if (pick.hit) row.hit = plan(pick.hit);
    moves[m.id] = row;
    if (pick.source === 'move') { use(pick.id); if (pick.hit) use(pick.hit.id); }
  }
  const status = {};
  for (const s of Object.keys(STATUS_TABLE)) {
    const st = statusEffect(s);
    status[s] = {...plan(st), body: {effect: st.body.id, tinted: !!st.body.tint, ...(st.body.color ? {color: st.body.color} : {})}};
  }
  const conditions = {};
  for (const k of Object.keys(EVENT_TABLE)) {
    const c = conditionEffect(k);
    conditions[k] = {...plan(c), ...(c.fallback ? {fallback: c.fallback.id} : {})};
  }
  const weather = Object.fromEntries(Object.keys(WEATHER_TABLE).map((k) => [k, plan(fieldEffect('weather', k))]));
  const terrain = Object.fromEntries(Object.keys(TERRAIN_TABLE).map((k) => [k, plan(fieldEffect('terrain', k))]));
  const events = {boost_up: plan(eventEffect('boost', true)), boost_down: plan(eventEffect('boost', false)), heal: plan(eventEffect('heal')), faint: plan(eventEffect('faint'))};
  const catalog = {};
  for (const id of EFFECT_IDS) {
    const i = effectInfo(id);
    catalog[id] = {category: i.category, category_es: CATEGORY_ES[i.category], title: i.title, desc: i.desc, tags: i.tags, loop: i.loop,
      seconds: Math.round(i.seconds * 100) / 100, size: i.size, on_body: i.on_body, options: Object.keys(EFFECTS[id].meta.options || {})};
  }
  const mapped = new Set(mappedIds());
  const own = Object.values(moves).filter((m) => m.source === 'move').length;
  const byCategory = {};
  for (const id of EFFECT_IDS) {
    const c = byCategory[id.split('/')[0]] ||= {effects: 0, mapped: 0, explorer_only: 0};
    c.effects++;
    if (mapped.has(id)) c.mapped++; else c.explorer_only++;
  }
  return {
    source: 'patch-gg/pixelfx 0.3.1 (MIT), vendored in client/src/battle/pixelfx',
    effects: [...EFFECT_IDS],
    categories: CATEGORY_LIST.map((id) => ({id, es: CATEGORY_ES[id], effects: byCategory[id]?.effects || 0})),
    coverage: {effects_upstream: 244, effects_vendored: EFFECT_IDS.length, effects_mapped: mapped.size, effects_explorer_only: EFFECT_IDS.length - mapped.size,
      moves: Object.keys(moves).length, moves_own: own, moves_by_type: Object.keys(moves).length - own, by_category: byCategory},
    roles: ROLE_INFO,
    types, moves, status, conditions, weather, terrain, events, usage, catalog,
  };
}

const text = () => JSON.stringify(buildMap(), null, 1) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== text()) { console.error('silvers_hoard/presets/pixelfx_map.json is out of date: run node scripts/gen_pixelfx_map.mjs'); process.exit(1); }
  } else {
    const m = buildMap();
    fs.writeFileSync(OUT, JSON.stringify(m, null, 1) + '\n');
    console.log(`wrote ${OUT}: ${m.coverage.effects_vendored} effects, ${m.coverage.effects_mapped} mapped, ${m.coverage.moves_own} of ${m.coverage.moves} moves with their own`);
  }
}
export {OUT as PIXELFX_MAP_PATH, text as pixelfxMapText};
