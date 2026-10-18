import test from 'node:test';
import assert from 'node:assert/strict';
import { Vfx } from '../../client/src/battle/rt/vfx.js';

const renderer = () => ({ scale: 20, px: x => x * 20, py: y => y * 20 });
const view = () => ({ seconds: 1, sides: [], projectiles: [{ id: 'fire', move: 'flameburst', type: 'Fire', shape: 'shot', x: 2, y: 2, vx: 1, vy: 0, r: .5 }] });
function deterministic(run) {
  const random = Math.random;
  Math.random = () => 0;
  try { run(); } finally { Math.random = random; }
}

test('paused projectile frames neither emit nor age particles; resume advances and expires them', () => deterministic(() => {
  const fx = new Vfx(renderer()), snapshot = view();
  for (let n = 0; n < 120; n++) fx.update(0, snapshot);
  assert.equal(fx.parts.length, 0);
  fx.update(.016, snapshot);
  assert.equal(fx.parts.length, 1);
  const frozen = structuredClone(fx.parts);
  for (let n = 0; n < 120; n++) fx.update(0, snapshot);
  assert.deepEqual(fx.parts, frozen);
  fx.update(.016, snapshot);
  assert.equal(fx.parts.length, 2);
  assert.ok(fx.parts[0].t > 0);
  snapshot.projectiles = [];
  fx.update(1, snapshot);
  assert.equal(fx.parts.length, 0);
}));

test('charge drawing cannot accumulate particles while paused and resumes afterwards', () => deterministic(() => {
  const fx = new Vfx(renderer()), snapshot = { ...view(), projectiles: [] };
  fx.fx.push({ kind: 'charge', s: 0, t: .2, life: 1, color: '#ff9900' });
  const battle = { sides: [{ x: 1, y: 1, fx: 1, fy: 0 }] };
  const ctx = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {} });
  fx.update(0, snapshot);
  for (let n = 0; n < 120; n++) fx.drawOver(ctx, snapshot, battle);
  assert.equal(fx.parts.length, 0);
  fx.update(.016, snapshot);
  fx.drawOver(ctx, snapshot, battle);
  assert.equal(fx.parts.length, 1);
  fx.update(0, snapshot);
  const frozen = structuredClone(fx.parts);
  for (let n = 0; n < 120; n++) fx.drawOver(ctx, snapshot, battle);
  assert.deepEqual(fx.parts, frozen);
}));

test('zero-time snapshots still reach supplied sprite effects', () => {
  const fx = new Vfx(renderer()), snapshot = view(), received = [];
  fx.supplied = { update: (...args) => received.push(args) };
  fx.update(0, snapshot);
  assert.deepEqual(received, [[0, snapshot]]);
});

test('explicit event bursts remain available on a frozen replay frame', () => deterministic(() => {
  const fx = new Vfx(renderer()), snapshot = { ...view(), projectiles: [] };
  fx.update(0, snapshot);
  fx.burst('Fire', 2, 2, { power: 1 });
  assert.ok(fx.parts.length > 0);
  const frozen = structuredClone(fx.parts);
  fx.update(0, snapshot);
  assert.deepEqual(fx.parts, frozen);
}));
