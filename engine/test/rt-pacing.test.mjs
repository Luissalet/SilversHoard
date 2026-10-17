import test from 'node:test';
import assert from 'node:assert/strict';
import {importTeam} from '../src/core.mjs';
import {RtBattle, TPS, rtRun} from '../src/realtime/sim.mjs';
import {think} from '../src/realtime/brain.mjs';

const spec = (version) => ({version, seed: 'pacing', format: 'gen9customgame', time_limit: 10,
  p1: {sets: importTeam('Pikachu\n- Tackle'), ai: null},
  p2: {sets: importTeam('Snorlax\n- Tackle'), ai: null}});

test('version 10 slows walking while preserving old speeds and Speed ordering', () => {
  const old = new RtBattle(spec(9)), now = new RtBattle(spec(10));
  assert.equal(now.version, 10);
  assert.equal(old.moveSpeed(old.sides[0]), 5.2);
  assert.equal(now.moveSpeed(now.sides[0]), old.moveSpeed(old.sides[0]) * 0.65);
  assert.ok(now.moveSpeed(now.sides[0]) > now.moveSpeed(now.sides[1]));
  const x = now.sides[0].x;
  for (let t = 0; t < TPS; t++) now.step({p1: {my: 1}});
  assert.equal(now.sides[0].x, x);
  assert.ok(now.sides[0].y - 8.5 < 3.5);
});

test('AI waits for its reaction time and rolls the dice only once per danger', () => {
  for (const version of [9, 10]) {
    const b = new RtBattle(spec(version)), s = b.sides[1];
    s.ai = {level: 'expert', style: 'balanced'};
    s.brain.next = 1000;
    s.aiRng = () => 0;
    b.projectiles.push({s: 0, x: s.x - 2, y: s.y, vx: 10, vy: 0, r: 0.5});
    assert.equal(think(b, s).dodge, version === 9);
    if (version === 10) {
      b.t = Math.round(0.15 * TPS) - 1;
      assert.equal(think(b, s).dodge, false);
      b.t++;
      assert.equal(think(b, s).dodge, true);
      b.t++;
      assert.equal(think(b, s).dodge, false, 'no reroll for the same danger');
      b.projectiles = [];
      think(b, s);
      b.projectiles.push({s: 0, x: s.x - 2, y: s.y, vx: 10, vy: 0, r: 0.5});
      assert.equal(think(b, s).dodge, false, 'a new danger also needs reaction time');
    }
  }
});

test('version 10 input replay reproduces movement, rolls and battle result', () => {
  const s = spec(10), b = new RtBattle(s);
  while (!b.ended) b.step({p1: {mx: 1, use: 0, dodge: b.t % 90 === 0}});
  const replay = rtRun(s, {inputs: b.inputLog});
  assert.deepEqual(replay.summary(), b.summary());
  assert.deepEqual(replay.events, b.events);
});

test('version 10 rolls travel less and cannot be chained as often', () => {
  const distances = [], cooldowns = [];
  for (const version of [9, 10]) {
    const b = new RtBattle(spec(version)), s = b.sides[0], y = s.y;
    b.step({p1: {my: 1, dodge: true}});
    cooldowns.push(s.rollReady);
    while (s.act?.kind === 'roll') b.step({});
    distances.push(s.y - y);
  }
  assert.ok(distances[1] < distances[0] * 0.75);
  assert.ok(cooldowns[1] - cooldowns[0] >= 0.89 * TPS);
});

test('a failed AI dodge is not retried every reaction interval', () => {
  const b = new RtBattle(spec(10)), s = b.sides[1];
  s.ai = {level: 'expert', style: 'balanced'}; s.brain.next = 10000;
  s.brain.strafeUntil = 10000; s.brain.strafe = 1;
  let calls = 0; s.aiRng = () => { calls++; return 0.99; };
  b.projectiles.push({s: 0, x: s.x - 2, y: s.y, vx: 10, vy: 0, r: 0.5});
  for (b.t = 0; b.t < TPS; b.t++) assert.equal(think(b, s).dodge, false);
  assert.equal(calls, 1);
});

test('AI sidesteps at the intended partial speed instead of sprinting sideways', () => {
  for (const version of [9, 10]) {
    const b = new RtBattle(spec(version)), s = b.sides[1];
    s.ai = {level: 'normal', style: 'balanced'}; s.brain.next = 10000;
    s.brain.strafeUntil = 10000; s.brain.strafe = 1;
    s.x = b.sides[0].x + 1.4;
    const input = think(b, s);
    assert.equal(Math.sqrt(input.mx ** 2 + input.my ** 2), version === 10 ? 0.55 : 1);
  }
});
