// Writes silvers_hoard/presets/pixelfx_map.json: which pixelfx effect (client/src/battle/pixelfx) each move plays, from the same table
// the battle screens use, for the `pixelfx_map` tool. Run it with `node scripts/gen_pixelfx_map.mjs` after changing the mapping or the
// moves' shapes; `node scripts/gen_pixelfx_map.mjs --check` (used by the tests) fails when the file is out of date.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Dex} from '@pkmn/sim';
import {rtMove} from '../engine/src/realtime/moves.mjs';
import {CATEGORIES, SHAPES, TYPES, ROLE_INFO, STATUS_TABLE, TYPE_COLORS, TYPE_TABLE, hitEffects, pickEffect, statusEffect, eventEffect} from '../client/src/battle/pixelfx/mapping.js';
import {EFFECT_IDS} from '../client/src/battle/pixelfx/registry.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'silvers_hoard', 'presets', 'pixelfx_map.json');
const plan = (p) => ({effect: p.id, tinted: !!p.tint, role: p.role, seconds: p.hold});

export function buildMap() {
  const types = {};
  for (const type of TYPES) {
    types[type] = {color: TYPE_COLORS[type], hit: hitEffects({type}).map(plan), by_category: {}, by_shape: {}};
    for (const category of CATEGORIES) types[type].by_category[category] = plan(pickEffect({type, category}));
    for (const shape of SHAPES) types[type].by_shape[shape] = plan(pickEffect({type, shape}));
  }
  const moves = {};
  for (const m of Dex.forGen(9).moves.all()) {
    if (!m.exists || m.isNonstandard === 'CAP' || m.id === 'recharge') continue;
    if (m.id.startsWith('hiddenpower') && m.id !== 'hiddenpower') continue;
    const p = rtMove(m.id, 9);
    if (!p || !TYPE_TABLE[m.type]) continue;
    const pick = pickEffect({type: m.type, category: m.category, shape: p.shape});
    moves[m.id] = {name: m.name, type: m.type, category: m.category, shape: p.shape, ...plan(pick)};
  }
  const status = {};
  for (const s of Object.keys(STATUS_TABLE)) status[s] = plan(statusEffect(s));
  const events = {boost_up: plan(eventEffect('boost', true)), boost_down: plan(eventEffect('boost', false)), heal: plan(eventEffect('heal')), faint: plan(eventEffect('faint'))};
  return {
    source: 'patch-gg/pixelfx 0.3.1 (MIT), vendored in client/src/battle/pixelfx',
    effects: [...EFFECT_IDS],
    roles: ROLE_INFO,
    types, moves, status, events,
  };
}

const text = () => JSON.stringify(buildMap(), null, 1) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== text()) { console.error('silvers_hoard/presets/pixelfx_map.json is out of date: run node scripts/gen_pixelfx_map.mjs'); process.exit(1); }
  } else {
    fs.writeFileSync(OUT, text());
    console.log(`wrote ${OUT}`);
  }
}
export {OUT as PIXELFX_MAP_PATH, text as pixelfxMapText};
