import test from 'node:test';
import assert from 'node:assert/strict';
import {importTeam} from '../src/core.mjs';
import {RtBattle, GAUGE_SEGMENT} from '../src/realtime/sim.mjs';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';

const spec = (version) => ({version, seed: 'mega-return', format: 'gen9customgame', arena: 'open',
  p1: {name: 'A', sets: importTeam('Altaria @ Altarianite\n- Dragon Pulse\n\nBlissey\n- Soft-Boiled'), ai: null},
  p2: {name: 'B', sets: importTeam('Snorlax\n- Rest'), ai: null}});

test('Mega Altaria keeps its forme and remaining gauge on the bench in new battles', () => {
  const b = new RtBattle(spec(7));
  const side = b.sides[0];
  side.gauge = 3 * GAUGE_SEGMENT;
  b.megaEvolve(side);
  const remaining = side.gauge;
  b.sendOut(side, 1);
  for (let i = 0; i < 90; i++) b.updateGauges();
  assert.equal(side.mons[0].species, 'Altaria-Mega');
  assert.equal(side.mons[0].megaOn, true);
  assert.equal(side.gauge, remaining, 'benched Mega Power is paused');
  b.sendOut(side, 0);
  assert.equal(b.mon(side).species, 'Altaria-Mega');
  b.updateGauges();
  assert.ok(side.gauge < remaining, 'the gauge resumes on the field');
});

test('version 6 recordings retain the old switching rules', () => {
  const b = new RtBattle(spec(6));
  const side = b.sides[0];
  side.gauge = 3 * GAUGE_SEGMENT;
  b.megaEvolve(side);
  b.sendOut(side, 1);
  assert.equal(side.mons[0].species, 'Altaria');
  assert.equal(side.mons[0].megaOn, false);
});

test('restarting a completed replay clears the victory banner and previous effects', () => {
  const r = {offline: true, eventIndex: 98, time: 40, floats: [{}], effects: [{}], cutin: {}, hitstop: 1,
    show: {end: {winner: 0}}, vfx: {parts: [{}]}, heads: [{}]};
  ArenaRenderer.prototype.resetReplay.call(r, new RtBattle(spec(7)));
  assert.equal(r.show.end, null);
  assert.equal(r.show.intro, null);
  assert.equal(r.cutin, null);
  assert.equal(r.hitstop, 0);
  assert.deepEqual(r.floats, []);
  assert.deepEqual(r.vfx.parts, []);
  assert.equal(r.eventIndex, 0);
  assert.equal(r.time, 0);
});
