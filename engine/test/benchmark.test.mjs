import assert from 'node:assert/strict';
import test from 'node:test';
import {randomTeam} from '../src/core.mjs';
import {sharedSeeds, teamBenchmark} from '../src/benchmark.mjs';

test('sharedSeeds are stable for the same master seed', () => {
  assert.deepEqual(sharedSeeds(42, 2, 3), sharedSeeds(42, 2, 3));
  assert.notDeepEqual(sharedSeeds(42, 2, 3), sharedSeeds(43, 2, 3));
});

test('teamBenchmark uses the same seeds across variants and reports deltas both ways', () => {
  const a = randomTeam('gen9randombattle', 'va').sets;
  const b = randomTeam('gen9randombattle', 'vb').sets;
  const c = randomTeam('gen9randombattle', 'vc').sets;
  const r1 = randomTeam('gen9randombattle', 'r1').sets;
  const r2 = randomTeam('gen9randombattle', 'r2').sets;
  const easy = {level: 'easy'};
  const out = teamBenchmark({
    seed: 77,
    games: 2,
    format: 'gen9customgame',
    variants: [
      {id: 'ref', name: 'Ref', sets: a, ai: easy},
      {id: 'alt', name: 'Alt', sets: b, ai: easy},
      {id: 'other', name: 'Other', sets: c, ai: easy},
    ],
    rivals: [
      {id: 'r1', name: 'Rival1', sets: r1, ai: easy},
      {id: 'r2', name: 'Rival2', sets: r2, ai: easy},
    ],
  });
  assert.equal(out.variants.length, 3);
  assert.equal(out.reference_id, 'ref');
  assert.equal(out.hall_of_fame_touched, false);
  assert.equal(out.variants[0].by_rival.length, 2);
  assert.equal(out.variants[0].wins + out.variants[0].losses + out.variants[0].ties, 4);
  // Every variant faced the same seed list per rival.
  for (let i = 1; i < out.variants.length; i++) {
    for (let ri = 0; ri < 2; ri++) {
      assert.deepEqual(out.variants[i].by_rival[ri].seeds, out.variants[0].by_rival[ri].seeds);
    }
  }
  // Deltas are relative to the reference row.
  assert.equal(out.variants[0].delta.wins, 0);
  assert.equal(out.variants[0].delta.win_rate, 0);
  for (const row of out.variants.slice(1)) {
    assert.equal(row.delta.wins, row.wins - out.variants[0].wins);
  }
  // Improved / worsened lists only mention non-reference variants that moved.
  for (const id of out.improved) assert.notEqual(id, 'ref');
  for (const id of out.worsened) assert.notEqual(id, 'ref');
});

test('teamBenchmark rejects fewer than two variants', () => {
  assert.throws(() => teamBenchmark({variants: [{id: 'a', name: 'A', sets: [], ai: {}}], rivals: [{id: 'r', name: 'R', sets: [], ai: {}}]}),
    /at least two/i);
});

test('omitted master seed is resolved once and returned for replay', () => {
  const a = randomTeam('gen9randombattle', 'sa').sets;
  const b = randomTeam('gen9randombattle', 'sb').sets;
  const r1 = randomTeam('gen9randombattle', 'sr').sets;
  const easy = {level: 'easy'};
  const first = teamBenchmark({
    games: 1,
    format: 'gen9customgame',
    variants: [
      {id: 'ref', name: 'Ref', sets: a, ai: easy},
      {id: 'alt', name: 'Alt', sets: b, ai: easy},
    ],
    rivals: [{id: 'r1', name: 'Rival1', sets: r1, ai: easy}],
  });
  assert.notEqual(first.seed, null);
  assert.notEqual(first.seed, undefined);
  assert.notEqual(first.seed, '');
  const again = teamBenchmark({
    seed: first.seed,
    games: 1,
    format: 'gen9customgame',
    variants: [
      {id: 'ref', name: 'Ref', sets: a, ai: easy},
      {id: 'alt', name: 'Alt', sets: b, ai: easy},
    ],
    rivals: [{id: 'r1', name: 'Rival1', sets: r1, ai: easy}],
  });
  assert.equal(again.seed, first.seed);
  assert.deepEqual(again.variants[0].by_rival[0].seeds, first.variants[0].by_rival[0].seeds);
});
