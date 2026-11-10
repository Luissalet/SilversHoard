// The "pixelfx" animation style: the move -> effect mapping, determinism of the effects, and that painting them never changes a battle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {
  CATEGORIES, SHAPES, TYPES, TYPE_TABLE, ROLES, fxSeed, hitEffects, mappedIds, pickEffect, pixelfxStyleOn, roleOf, statusEffect, typeRamp,
} from '../../client/src/battle/pixelfx/mapping.js';
import {EFFECTS, EFFECT_IDS} from '../../client/src/battle/pixelfx/registry.js';
import {PixelfxLayer, effectChecksum} from '../../client/src/battle/pixelfx/layer.js';
import {Vfx} from '../../client/src/battle/rt/vfx.js';
import {RtBattle, inputFrame} from '../src/realtime/sim.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, 'fixtures', 'rt-v9.json'), 'utf8'));

function withStyle(value, run) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: (k) => (k === 'silver-fx-style' ? JSON.stringify(value) : null), setItem() {}}});
  try { return run(); } finally { before ? Object.defineProperty(globalThis, 'localStorage', before) : delete globalThis.localStorage; }
}

test('the setting only turns the style on when it says pixelfx', () => {
  assert.equal(pixelfxStyleOn(), false);
  withStyle('pixelfx', () => assert.equal(pixelfxStyleOn(), true));
  for (const other of ['showdown', 'reborn', 'silver']) withStyle(other, () => assert.equal(pixelfxStyleOn(), false));
});

test('every type, category and shape maps to a vendored effect', () => {
  assert.equal(TYPES.length, 18);
  for (const type of TYPES) {
    for (const category of CATEGORIES) {
      const plan = pickEffect({type, category});
      assert.ok(EFFECTS[plan.id], `${type}/${category}: ${plan.id} is not vendored`);
      assert.ok(plan.hold > 0 && ROLES.includes(plan.role));
    }
    for (const shape of SHAPES) {
      for (const category of CATEGORIES) {
        const plan = pickEffect({type, category, shape});
        assert.ok(EFFECTS[plan.id], `${type}/${shape}: ${plan.id}`);
        assert.equal(plan.role, roleOf(category, shape));
      }
    }
    for (const hit of [hitEffects({type}), hitEffects({type, crit: true})]) for (const p of hit) assert.ok(EFFECTS[p.id], `${type} hit ${p.id}`);
    assert.equal(hitEffects({type}).length, 1);
    assert.equal(hitEffects({type, eff: 2}).length, 2);
  }
  // an unknown type plays Normal's effect instead of failing
  assert.equal(pickEffect({type: 'Stellar', category: 'Physical'}).id, pickEffect({type: 'Normal', category: 'Physical'}).id);
  for (const id of mappedIds()) assert.ok(EFFECTS[id], `mapped id ${id} is vendored`);
  assert.deepEqual(Object.keys(TYPE_TABLE), [...TYPES]);
});

test('category decides the role when a move has no shape: physical hits the target, special throws, status surrounds the user', () => {
  for (const type of TYPES) {
    assert.equal(pickEffect({type, category: 'Physical'}).role, 'impact');
    assert.equal(pickEffect({type, category: 'Special'}).role, 'projectile');
    assert.equal(pickEffect({type, category: 'Status'}).role, 'self');
  }
  assert.equal(roleOf('Special', 'beam'), 'beam');
  assert.equal(roleOf('Status', 'self'), 'self');
  assert.equal(roleOf('Physical', 'drop'), 'drop');
});

test('types look different: fire is fire, water is water, and the tinted ones take their type colour', () => {
  assert.match(pickEffect({type: 'Fire', category: 'Special', shape: 'shot'}).id, /^fire\//);
  assert.match(pickEffect({type: 'Water', category: 'Special', shape: 'shot'}).id, /^water\//);
  assert.match(pickEffect({type: 'Ice', category: 'Special', shape: 'beam'}).id, /^ice\//);
  assert.match(pickEffect({type: 'Electric', category: 'Special', shape: 'shot'}).id, /^lightning\//);
  assert.match(pickEffect({type: 'Ghost', category: 'Special', shape: 'shot'}).id, /^shadow\//);
  assert.equal(pickEffect({type: 'Fire', category: 'Special', shape: 'shot'}).tint, false);
  assert.equal(pickEffect({type: 'Psychic', category: 'Special', shape: 'shot'}).tint, true);
  const ramps = TYPES.map((t) => typeRamp(t).join());
  assert.equal(new Set(ramps).size, TYPES.length);
  for (const status of ['brn', 'par', 'psn', 'tox', 'frz', 'slp']) assert.ok(EFFECTS[statusEffect(status).id]);
  assert.equal(statusEffect('nonsense'), null);
  assert.ok(new Set(TYPES.map((t) => pickEffect({type: t, category: 'Special', shape: 'shot'}).id)).size >= 10, 'projectiles are varied');
});

test('the registry carries only effects with a licence next to them', () => {
  const root = join(here, '..', '..', 'client', 'src', 'battle', 'pixelfx');
  const license = readFileSync(join(root, 'LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Hugo Duprez/);
  assert.match(readFileSync(join(root, 'NOTICE.md'), 'utf8'), /Patch Pixel/);
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(root);
  assert.equal(files.some((f) => /\.(ttf|otf|woff2?)$/i.test(f)), false, 'the Patch Pixel font is not vendored');
  assert.ok(EFFECT_IDS.length >= 70);
});

test('an effect is deterministic: the same seed and options give the same pixels, another seed or colour does not', () => {
  let simulated = 0;
  for (const id of mappedIds()) {
    const a = effectChecksum(id, {seed: 11, seconds: 0.4});
    assert.equal(effectChecksum(id, {seed: 11, seconds: 0.4}), a, id);
    if (typeof EFFECTS[id].create === 'function') simulated++;
  }
  assert.ok(simulated > 10);
  assert.notEqual(effectChecksum('fire/fireball', {seed: 1, seconds: 0.3}), effectChecksum('fire/fireball', {seed: 1, seconds: 0.3, palette: typeRamp('Water')}));
  assert.notEqual(effectChecksum('explosions/small-explosion', {seed: 1, seconds: 0.3}), effectChecksum('explosions/small-explosion', {seed: 2, seconds: 0.3}));
  assert.equal(effectChecksum('water/splash', {seed: 5, seconds: 0.3, flip: true, angle: 0.4}), effectChecksum('water/splash', {seed: 5, seconds: 0.3, flip: true, angle: 0.4}));
  assert.equal(fxSeed(1, 'a', 3), fxSeed(1, 'a', 3));
  assert.notEqual(fxSeed(1, 'a', 3), fxSeed(1, 'a', 4));
});

function runBattle(rec, {style}) {
  const b = new RtBattle(rec.spec);
  const byTick = new Map();
  for (const row of rec.inputs) { if (!byTick.has(row[0])) byTick.set(row[0], []); byTick.get(row[0]).push(row); }
  const held = [null, null];
  const renderer = {scale: 40, px: (x) => x * 40, py: (y) => y * 40};
  let vfx = null, layer = null, index = 0;
  if (style) { vfx = new Vfx(renderer); layer = new PixelfxLayer(renderer); vfx.pixelfx = layer; }
  const spawned = [];
  const ctx = new Proxy({}, {get: (_, key) => (key === 'createRadialGradient' || key === 'createLinearGradient' ? () => ({addColorStop() {}}) : () => {})});
  let peak = 0;
  while (!b.ended && b.t < 20000) {
    b.step(inputFrame(b, byTick.get(b.t + 1) || [], held));
    if (!vfx) continue;
    const before = layer.list.length;
    for (; index < b.events.length; index++) vfx.onEvent(b.events[index], b);
    for (const e of layer.list.slice(before)) spawned.push(`${b.t}:${e.id}:${e.fx.options.seed}:${e.x.toFixed(2)}:${e.y.toFixed(2)}`);
    vfx.update(1 / 30, b.view());
    peak = Math.max(peak, layer.list.length);
    if (b.t % 15 === 0) { vfx.drawUnder(ctx); vfx.drawOver(ctx, b.view(), b); }
  }
  const result = createHash('sha256').update(JSON.stringify({t: b.t, events: b.events, winner: b.winner ?? null, view: b.view()})).digest('hex');
  return {result, ticks: b.t, spawned, peak, events: b.events.length};
}

test('painting the pixelfx style never changes a fixed battle, and its effects are the same on every run', () => {
  const rec = FIXTURE.battles[0];
  const plain = runBattle(rec, {style: false});
  const a = withStyle('pixelfx', () => runBattle(rec, {style: true}));
  const b = withStyle('pixelfx', () => runBattle(rec, {style: true}));
  assert.equal(a.result, plain.result);
  assert.equal(b.result, plain.result);
  assert.equal(a.ticks, rec.ticks);
  assert.ok(a.spawned.length > 20, `the battle plays ${a.spawned.length} effects`);
  assert.deepEqual(a.spawned, b.spawned);
  assert.ok(a.peak > 0 && a.peak <= 18);
  assert.ok(new Set(a.spawned.map((s) => s.split(':')[1])).size >= 4, 'several different effects play');
});

test('with another style set the layer stays silent', () => {
  const rec = FIXTURE.battles[0];
  const renderer = {scale: 40, px: (x) => x * 40, py: (y) => y * 40};
  withStyle('showdown', () => {
    const vfx = new Vfx(renderer), layer = new PixelfxLayer(renderer);
    vfx.pixelfx = layer;
    const b = new RtBattle(rec.spec);
    for (let i = 0; i < 400 && !b.ended; i++) { b.step(inputFrame(b, [], [null, null])); }
    for (const e of b.events) vfx.onEvent(e, b);
    vfx.update(1 / 30, b.view());
    assert.equal(layer.list.length, 0);
  });
});
