import test from 'node:test';
import assert from 'node:assert/strict';
import {ballFrame, ballFlight} from '../../client/src/battle/ball-motion.js';

test('ball opening covers every burst frame and stays inside the supplied atlas', () => {
  const rows = new Set();
  for (let i = 0; i <= 100; i++) {
    const f = ballFrame(i / 100, true);
    rows.add(f.row);
    assert(f.column >= 0 && f.column < 22 && f.row >= 0 && f.row < 32);
  }
  assert.deepEqual([...rows], [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(ballFrame(1, true).opacity, 0);
});

test('flight resets without a wall clock and reduced motion has no spatial movement', () => {
  assert.deepEqual(ballFlight(0), {x: 0, height: 0, rotation: 0});
  assert.equal(ballFlight(1).height, 0);
  assert.equal(ballFlight(.5).height, 1);
  assert.deepEqual(ballFlight(.5, true), {x: .5, height: 0, rotation: 0});
  assert.deepEqual(ballFrame(.3, false, true), ballFrame(.8, false, true));
  assert.equal(ballFrame(.4, true, true).opacity, 0);
});
