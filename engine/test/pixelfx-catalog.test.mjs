// The whole pixelfx catalog in Silver: all 244 effects vendored and playable, moves with an effect of their own, pins chosen by hand,
// statuses on the Pokemon's own pixels, weather and terrain over the field, and none of it changes a battle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {EFFECTS, EFFECT_IDS, CATEGORY_LIST, CATEGORY_ES, effectInfo} from '../../client/src/battle/pixelfx/registry.js';
import {
  MOVE_TABLE, TYPE_TABLE, WEATHER_TABLE, TERRAIN_TABLE, EVENT_TABLE, STATUS_BODY, mappedIds, ownMoves, parseCell, pickEffect, hitEffects,
  setPins, pinnedMoves, statusEffect, conditionEffect, fieldEffect,
} from '../../client/src/battle/pixelfx/mapping.js';
import {PixelfxLayer, actorFromPixels, effectChecksum} from '../../client/src/battle/pixelfx/layer.js';
import {createFx, createFrame, clearFrame, stockActor} from '../../client/src/battle/pixelfx/core/index.js';
import {Vfx} from '../../client/src/battle/rt/vfx.js';
import {RtBattle, inputFrame} from '../src/realtime/sim.mjs';
import {rtMove} from '../src/realtime/moves.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {Dex} = require('@pkmn/sim');
const FIXTURE = JSON.parse(readFileSync(join(here, 'fixtures', 'rt-v9.json'), 'utf8'));
const renderer = {scale: 40, px: (x) => x * 40, py: (y) => y * 40};

function withStyle(value, run) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: (k) => (k === 'silver-fx-style' ? JSON.stringify(value) : null), setItem() {}}});
  try { return run(); } finally { before ? Object.defineProperty(globalThis, 'localStorage', before) : delete globalThis.localStorage; }
}

test('the whole upstream catalog is vendored: 244 effects in 21 categories, every one plays', () => {
  assert.equal(EFFECT_IDS.length, 244);
  assert.equal(CATEGORY_LIST.length, 21);
  for (const c of CATEGORY_LIST) assert.ok(CATEGORY_ES[c], `${c} has a Spanish name`);
  for (const id of EFFECT_IDS) {
    const i = effectInfo(id);
    assert.ok(i.size[0] > 0 && i.seconds > 0, id);
    const fx = createFx(EFFECTS[id], {seed: 5});
    const f = createFrame(i.size[0], i.size[1], -i.origin[0], -i.origin[1]);
    for (let k = 0; k < 6; k++) { fx.update(1 / 20); clearFrame(f); fx.draw(f, 'back'); fx.draw(f, 'front'); }
  }
  const body = EFFECT_IDS.filter((id) => effectInfo(id).on_body);
  assert.ok(body.includes('status/frozen') && body.includes('holy/halo') && body.length >= 30);
});

test('every effect is deterministic, on-body ones included', () => {
  for (const id of ['status/frozen', 'status/burning', 'melee/claw-swipe', 'weather/rain', 'critters/slime', 'moves/meteor-call', 'transitions/iris', 'ui/level-up']) {
    assert.equal(effectChecksum(id, {seed: 9, seconds: 0.5}), effectChecksum(id, {seed: 9, seconds: 0.5}), id);
  }
});

test('moves with an effect of their own: real moves, vendored effects, chosen by name', (t) => {
  const own = ownMoves();
  for (const id of own) assert.ok(Dex.forGen(9).moves.get(id).exists, `${id} is a move`);
  for (const id of mappedIds()) assert.ok(EFFECTS[id], `${id} is vendored`);
  let total = 0, mine = 0;
  for (const m of Dex.forGen(9).moves.all()) {
    if (!m.exists || m.isNonstandard === 'CAP' || m.id === 'recharge' || (m.id.startsWith('hiddenpower') && m.id !== 'hiddenpower')) continue;
    const p = rtMove(m.id, 9);
    if (!p || !TYPE_TABLE[m.type]) continue;
    total++;
    if (pickEffect({type: m.type, category: m.category, shape: p.shape, move: m.id}).source === 'move') mine++;
  }
  t.diagnostic(`${mine} of ${total} moves have an effect of their own; ${mappedIds().length} of ${EFFECT_IDS.length} effects are mapped`);
  assert.ok(mine >= 400, `${mine} moves with their own effect`);
  const want = {flamethrower: 'fire/flamethrower', thunderbolt: 'lightning/chain-lightning', thunder: 'lightning/lightning-strike', earthquake: 'nature/quake',
    hydropump: 'water/water-jet', surf: 'water/wave-crash', slash: 'melee/sword-slash', xscissor: 'melee/double-slash', crunch: 'melee/claw-swipe',
    gigadrain: 'shadow/soul-drain', shadowball: 'shadow/void-orb', blizzard: 'ice/blizzard-vortex', icebeam: 'arcane/arcane-beam', skyuppercut: 'melee/uppercut',
    protect: 'holy/divine-shield', rest: 'status/sleep', makeitrain: 'spawn/coin-drop', roaroftime: 'arcane/time-stop'};
  for (const [move, id] of Object.entries(want)) assert.equal(parseCell(MOVE_TABLE[move]).id, id, move);
  // role from the move's shape unless the cell says otherwise
  assert.equal(pickEffect({type: 'Fire', category: 'Special', shape: 'beam', move: 'flamethrower'}).role, 'beam');
  assert.equal(pickEffect({type: 'Fire', category: 'Special', shape: 'beam', move: 'fireblast'}).role, 'projectile');
  assert.equal(pickEffect({type: 'Normal', category: 'Physical', shape: 'strike', move: 'slash'}).role, 'impact');
  // a strike's own effect lands on the target; a projectile's "| hit" too
  assert.equal(hitEffects({type: 'Normal', move: 'slash', category: 'Physical', shape: 'strike'})[0].id, 'melee/sword-slash');
  assert.equal(hitEffects({type: 'Fire', move: 'fireblast', category: 'Special', shape: 'beam'})[0].id, 'explosions/small-explosion');
  assert.equal(hitEffects({type: 'Fire', move: 'flamethrower', category: 'Special', shape: 'beam'})[0].id, 'explosions/small-explosion');
});

test('cells: role, tint, colour and a hit effect', () => {
  assert.deepEqual(parseCell('projectile:fire/fireball~#4aa8ff | fire/flame-pillar~'),
    {id: 'fire/fireball', tint: true, color: '#4aa8ff', role: 'projectile', hit: {id: 'fire/flame-pillar', tint: true}});
  assert.deepEqual(parseCell('nature/quake'), {id: 'nature/quake', tint: false});
});

test('a pinned effect wins over the move, and dropping it brings the mapping back', () => {
  const auto = pickEffect({type: 'Normal', category: 'Physical', shape: 'dash', move: 'tackle'});
  setPins([{move: 'Tackle', effect: 'critters/slime', tint: true}]);
  try {
    const pinned = pickEffect({type: 'Normal', category: 'Physical', shape: 'dash', move: 'tackle'});
    assert.equal(pinned.id, 'critters/slime');
    assert.equal(pinned.source, 'pin');
    assert.equal(pinned.role, 'impact');
    assert.equal(hitEffects({type: 'Normal', move: 'tackle', category: 'Physical', shape: 'dash'})[0].id, 'critters/slime');
    assert.deepEqual(Object.keys(pinnedMoves()), ['tackle']);
    setPins({ember: {effect: 'weather/rain', role: 'self', color: '#ff0000'}});
    const e = pickEffect({type: 'Fire', category: 'Special', shape: 'shot', move: 'ember'});
    assert.equal(e.role, 'self');
    assert.equal(e.color, '#ff0000');
  } finally { setPins({}); }
  assert.equal(pickEffect({type: 'Normal', category: 'Physical', shape: 'dash', move: 'tackle'}).id, auto.id);
});

test('statuses, conditions, weather and terrains have effects', () => {
  for (const s of ['brn', 'par', 'psn', 'tox', 'frz', 'slp']) {
    const p = statusEffect(s);
    assert.ok(EFFECTS[p.id] && EFFECTS[p.body.id], s);
    assert.ok(effectInfo(STATUS_BODY[s].replace(/~.*$/, '')).on_body, `${s} plays on the body`);
  }
  for (const k of Object.keys(EVENT_TABLE)) assert.ok(EFFECTS[conditionEffect(k).id], k);
  for (const id of Object.keys(WEATHER_TABLE)) assert.equal(fieldEffect('weather', id).role, 'screen');
  for (const id of Object.keys(TERRAIN_TABLE)) assert.ok(EFFECTS[fieldEffect('terrain', id).id]);
  assert.equal(fieldEffect('weather', 'nonsense'), null);
});

test('weather and terrain loop over the field while they last', () => {
  const layer = new PixelfxLayer(renderer);
  layer.update(1 / 30, {projectiles: [], weather: {id: 'raindance'}, terrain: {id: 'grassyterrain'}});
  assert.equal(layer.list.filter((e) => e.role === 'screen').map((e) => e.id).sort().join(), 'weather/falling-leaves,weather/rain');
  assert.ok(layer.hasWeather());
  for (let i = 0; i < 90; i++) layer.update(1 / 30, {projectiles: [], weather: {id: 'raindance'}, terrain: null});
  assert.deepEqual(layer.list.map((e) => e.id), ['weather/rain'], 'the terrain faded out, the rain loops on');
  layer.update(1 / 30, {projectiles: [], weather: {id: 'sandstorm'}, terrain: null});
  const sand = layer.list.find((e) => e.id === 'weather/blizzard');
  assert.ok(sand && sand.fx.options.palette, 'sand is a recoloured gale');
  // the engine names Rain Dance's weather as the move data does
  const rain = new PixelfxLayer(renderer);
  rain.update(1 / 30, {projectiles: [], weather: {id: 'RainDance'}});
  assert.deepEqual(rain.list.map((e) => e.id), ['weather/rain']);
});

test('on-body effects read the Pokemon: they wait for its pixels, or play their fallback where none can be read', () => {
  const px = new Uint8ClampedArray(10 * 12 * 4);
  for (let j = 2; j < 12; j++) for (let i = 3; i < 8; i++) { const k = (j * 10 + i) * 4; px[k] = 200; px[k + 1] = 100; px[k + 2] = 50; px[k + 3] = 255; }
  const actor = actorFromPixels(px, 10, 12, -5, -12);
  assert.deepEqual([actor.x, actor.y, actor.w, actor.h], [-2, -10, 5, 10]);
  assert.equal(actor.pixels[0], ((255 << 24) | (50 << 16) | (100 << 8) | 200) >>> 0);
  const battle = {sides: [{x: 4, y: 5}, {x: 10, y: 5}], seed: 1};
  // the turn-based screen: nothing to read, so the burn plays its flat effect
  const flat = new PixelfxLayer(renderer);
  flat.event({k: 'status', s: 0, status: 'brn', t: 3}, battle);
  assert.deepEqual(flat.list.map((e) => e.id), ['fire/torch']);
  // real time: the burn waits for the Pokemon's pixels and plays on them
  const live = new PixelfxLayer(renderer);
  live.canCapture = true;
  live.event({k: 'status', s: 1, status: 'brn', t: 3}, battle);
  assert.equal(live.list.length, 0);
  assert.ok(live.want.has('1:0'));
  live.actors.set('1:0', {actor});
  live.update(1 / 30, {projectiles: []});
  assert.deepEqual(live.list.map((e) => e.id), ['status/burning']);
  assert.equal(live.list[0].fx.options.actor, actor);
  // nothing arrives in time: the fallback plays
  const late = new PixelfxLayer(renderer);
  late.canCapture = true;
  late.event({k: 'status', s: 1, status: 'frz', t: 3}, battle);
  for (let i = 0; i < 15; i++) late.update(1 / 30, {projectiles: []});
  assert.deepEqual(late.list.map((e) => e.id), ['ice/ice-crystal']);
  assert.ok(stockActor(2).mask.w > 0);
});

test('a melee blow is placed so its own target point lands on the Pokemon hit', () => {
  const layer = new PixelfxLayer(renderer);
  const d = {x: 10, y: 5}, att = {x: 6, y: 5};
  const claw = layer.landing({id: 'melee/claw-swipe'}, d, att, 0.8);
  assert.ok(claw.x < d.x && claw.x > att.x && !claw.flip);
  const back = layer.landing({id: 'melee/claw-swipe'}, att, d, 0.8);
  assert.ok(back.flip && back.x > att.x);
  assert.deepEqual(layer.landing({id: 'impacts/blunt-hit'}, d, att, 0.8), {x: 10, y: 5, flip: false});
});

function runBattle(rec) {
  const b = new RtBattle(rec.spec);
  const byTick = new Map();
  for (const row of rec.inputs) { if (!byTick.has(row[0])) byTick.set(row[0], []); byTick.get(row[0]).push(row); }
  const held = [null, null];
  const vfx = new Vfx(renderer), layer = new PixelfxLayer(renderer);
  vfx.pixelfx = layer;
  const ctx = new Proxy({}, {get: (_, key) => (key === 'createRadialGradient' || key === 'createLinearGradient' ? () => ({addColorStop() {}}) : () => {})});
  const spawned = [];
  let index = 0;
  while (!b.ended && b.t < 20000) {
    b.step(inputFrame(b, byTick.get(b.t + 1) || [], held));
    const before = layer.list.length;
    for (; index < b.events.length; index++) vfx.onEvent(b.events[index], b);
    for (const e of layer.list.slice(before)) spawned.push(`${b.t}:${e.id}:${e.fx.options.seed}`);
    vfx.update(1 / 30, b.view());
    if (b.t % 15 === 0) { vfx.drawUnder(ctx); vfx.drawOver(ctx, b.view(), b); }
  }
  return {result: createHash('sha256').update(JSON.stringify({t: b.t, events: b.events, winner: b.winner ?? null})).digest('hex'), spawned, events: b.events};
}

test('pins and per-move effects never change a battle and replay the same', () => {
  const rec = FIXTURE.battles[0];
  const plain = new RtBattle(rec.spec);
  const used = withStyle('pixelfx', () => runBattle(rec));
  const move = used.events.find((e) => e.k === 'use' && (e.shape === 'strike' || e.shape === 'dash'))?.move
    || used.events.find((e) => e.k === 'use')?.move;
  assert.ok(move, 'the fixture uses moves');
  setPins([{move, effect: 'critters/slime', role: 'self'}]);
  try {
    const a = withStyle('pixelfx', () => runBattle(rec));
    const b = withStyle('pixelfx', () => runBattle(rec));
    assert.equal(a.result, used.result, 'the pin does not change the battle');
    assert.deepEqual(a.spawned, b.spawned);
    assert.ok(a.spawned.some((s) => s.split(':')[1] === 'critters/slime'), `the pinned effect plays for ${move}`);
  } finally { setPins({}); }
  assert.ok(plain);
});
