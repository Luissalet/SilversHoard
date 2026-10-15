// Custom arenas (the arena designer): rocks placed by hand travel inside the battle spec, the engine keeps them within its limits, and
// a battle on one plays and replays the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import {importTeam, randomTeam} from '../src/core.mjs';
import {ARENA, FLOORS, MAX_ROCKS, RtBattle, arenaOf, customRocks, rtRun} from '../src/realtime/sim.mjs';
import {handle} from '../src/server.mjs';

const TEAM = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\n- Earthquake\n- Outrage\n- Swords Dance\n- Stone Edge\n';
const FIELD = {name: 'Cráter', floor: 'cave', rocks: [{x: 14, y: 8.5, r: 2}, {x: 9, y: 3, r: 1}, {x: 19, y: 3, r: 1}]};

test('custom rocks: inside the walls, off the entry spots, 0.4-3 m, at most 16, to the millimetre', () => {
  const out = customRocks([
    {x: 14, y: 8.5, r: 2},
    {x: 5.5, y: 8.5, r: 1},                 // on the left entry spot: left out
    {x: -3, y: 20, r: 9},                   // too big and outside: 3 m, pushed inside
    {x: 'a', y: 1, r: 1},                   // not a number: left out
    {x: 10.12345, y: 4.98765, r: 0.1},      // too small: 0.4 m
  ]);
  assert.deepEqual(out, [{x: 14, y: 8.5, r: 2}, {x: 3, y: ARENA.h - 3, r: 3}, {x: 10.123, y: 4.988, r: 0.4}]);
  assert.equal(customRocks(Array.from({length: 40}, (_, i) => ({x: 8 + (i % 10), y: 2 + Math.floor(i / 10) * 0.5, r: 0.4}))).length, MAX_ROCKS);
  assert.deepEqual(customRocks('nope'), []);
});

test('the arena a spec asks for', () => {
  assert.equal(arenaOf('open', 's').kind, 'open');
  assert.equal(arenaOf('rocks', 's').kind, 'rocks');
  assert.ok(arenaOf('rocks', 's').rocks.length >= 3);
  const c = arenaOf(FIELD, 's');
  assert.equal(c.kind, 'custom');
  assert.equal(c.floor, 'cave');
  assert.equal(c.rocks.length, 3);
  assert.equal(arenaOf({rocks: [], floor: 'lava'}, 's').floor, 'grass');
  assert.ok(FLOORS.includes('water'));
});

test('a battle on a custom arena shows its field, plays to the end and replays the same', () => {
  const spec = {seed: 'arena-1', format: 'gen9customgame', version: 4, arena: FIELD, time_limit: 60,
    p1: {name: 'A', sets: randomTeam('gen9randombattle', 'arena-a').sets, ai: {level: 'hard', style: 'balanced'}},
    p2: {name: 'B', sets: randomTeam('gen9randombattle', 'arena-b').sets, ai: {level: 'hard', style: 'balanced'}}};
  const b = new RtBattle(spec);
  const v = b.view();
  assert.equal(v.arena, 'custom');
  assert.equal(v.floor, 'cave');
  assert.equal(v.arena_name, 'Cráter');
  assert.deepEqual(v.rocks, FIELD.rocks);
  const one = rtRun(spec);
  const two = rtRun(spec);
  assert.ok(one.ended);
  assert.deepEqual(one.summary(), two.summary());
  // nobody ever stands inside a rock
  const live = new RtBattle(spec);
  for (let i = 0; i < 60 * 30 && !live.ended; i++) {
    live.step({});
    for (const s of live.sides) for (const rk of live.rocks) assert.ok(Math.hypot(s.x - rk.x, s.y - rk.y) >= rk.r - 1e-6, `tick ${i}`);
  }
});

test('the engine commands take a custom arena', async () => {
  const sets = importTeam(TEAM);
  const r = await handle({cmd: 'rt_check', args: {spec: {id: 'x', seed: 'q', format: 'gen9customgame', version: 4, arena: FIELD,
    p1: {name: 'A', sets, ai: null}, p2: {name: 'B', sets, ai: {level: 'easy'}}}}});
  assert.ok(r.ok !== false, JSON.stringify(r).slice(0, 300));
});
