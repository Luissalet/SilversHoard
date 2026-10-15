// The expert AI in doubles (it plays pairings of both slots out on copies of the battle, sends legal choices and keeps within its
// time budget) and Revival Blessing, whose switch request wants a fainted Pokémon.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {importTeam, packTeam, randomTeam} from '../src/core.mjs';
import {chooseFor, makeRng} from '../src/ai.mjs';
import {playOut} from '../src/stats.mjs';

const team = (seed) => randomTeam('gen9randomdoublesbattle', seed).sets;

test('expert AI plays whole doubles battles with legal choices', () => {
  for (const s of ['d1', 'd2']) {
    const r = playOut({format: 'gen9doublescustomgame', seed: [2, 7, 1, 8], p1: {name: 'A', sets: team(`a${s}`), ai: {level: 'expert'}},
      p2: {name: 'B', sets: team(`b${s}`), ai: {level: 'expert'}}}, {keepLog: true});
    assert.deepEqual(r.errors, []);
    assert.ok(r.lines.some((l) => l.startsWith('|win|') || l === '|tie'));
  }
});

test('expert doubles choice covers both slots and stays within its time budget', () => {
  const b = new Battle({formatid: 'gen9doublescustomgame', seed: [5, 5, 5, 5]});
  b.setPlayer('p1', {name: 'A', team: team('t1')});
  b.setPlayer('p2', {name: 'B', team: team('t2')});
  b.makeChoices('default', 'default');   // team preview
  const started = Date.now();
  const choice = chooseFor(b, 'p1', {level: 'expert', rng: makeRng(3)});
  const took = Date.now() - started;
  assert.equal(choice.split(',').length, 2, choice);
  assert.ok(took < 6000, `took ${took} ms`);
  assert.ok(b.choose('p1', choice), `the simulator refuses ${choice}`);
});

test('every level answers Revival Blessing with a fainted Pokémon', () => {
  const b = new Battle({formatid: 'gen9customgame', seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'A', team: packTeam(importTeam('Magikarp\nLevel: 1\n- Splash\n\nPawmot\nAbility: Volt Absorb\n- Revival Blessing\n\nPikachu\n- Thunderbolt'))});
  b.setPlayer('p2', {name: 'B', team: packTeam(importTeam('Garchomp\nAbility: Rough Skin\n- Earthquake\n- Swords Dance'))});
  b.makeChoices('default', 'default');
  b.makeChoices('move 1', 'move 1');   // Earthquake knocks Magikarp out
  b.choose('p1', 'switch 2');
  b.makeChoices('move 1', 'move 2');   // Revival Blessing against Swords Dance
  assert.ok(b.p1.slotConditions[0].revivalblessing);
  for (const level of ['random', 'easy', 'normal', 'hard', 'expert']) {
    const choice = chooseFor(b, 'p1', {level, rng: makeRng(1)});
    const copy = Battle.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    assert.ok(copy.choose('p1', choice), `${level}: ${choice} — ${copy.p1.choice.error}`);
  }
});
