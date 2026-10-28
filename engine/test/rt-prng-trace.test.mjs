// The real-time fixtures carry the trace of their random sources (engine/parity/rt-prng.mjs): replaying a recorded battle must roll
// the dice in the same order, not only end with the same events. A failure names the first chunk of 128 calls that differs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digestCalls, firstDifference, FIXTURES, fixturePath, recordCalls} from '../parity/rt-prng.mjs';
import {rtRun, tapRng} from '../src/realtime/sim.mjs';

for (const name of FIXTURES) {
  test(`${name}: every recorded battle replays with the same random-source trace`, () => {
    const fix = JSON.parse(readFileSync(fixturePath(name), 'utf8'));
    assert.ok(fix.battles.length >= 3);
    for (const rec of fix.battles) {
      assert.ok(rec.prng && rec.prng.calls > 0, `${rec.name}: the fixture has no prng trace`);
      const {calls, battle} = recordCalls(rec);
      const fresh = digestCalls(calls);
      assert.equal(firstDifference(rec.prng, fresh, calls), '', `${name} · ${rec.name}`);
      assert.deepEqual(fresh, rec.prng);
      assert.equal(battle.t, rec.ticks);
    }
  });
}

test('the tap only observes: a tapped battle ends with the same events as an untapped one', () => {
  const fix = JSON.parse(readFileSync(fixturePath('rt-v9.json'), 'utf8'));
  const rec = fix.battles[0];
  const plain = rtRun(rec.spec, {inputs: rec.inputs});
  const seen = [];
  const before = tapRng((stream, value) => seen.push(value));
  const tapped = rtRun(rec.spec, {inputs: rec.inputs});
  tapRng(before);
  assert.deepEqual(tapped.events, plain.events);
  assert.ok(seen.length > 100);
  // taps do not leak into later battles
  const after = [];
  rtRun(rec.spec, {inputs: [], maxSeconds: 2});
  assert.equal(after.length, 0);
});

test('digests locate the first chunk that differs', () => {
  const calls = Array.from({length: 300}, (_, i) => ['battle', i, i / 300]);
  const base = digestCalls(calls);
  const moved = calls.map((c) => c.slice());
  moved[200][2] = 0.5;
  const fresh = digestCalls(moved);
  assert.match(firstDifference(base, fresh, moved), /random calls 128\.\.255 differ/);
  assert.equal(firstDifference(base, digestCalls(calls), calls), '');
  const longer = digestCalls([...calls, ['battle', 301, 0.1]]);
  assert.match(firstDifference(base, longer, calls), /recorded 300 calls, now 301/);
});
