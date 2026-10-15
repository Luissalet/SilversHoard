// The master AI: the battle as poke-engine's state, the search's answer mapped back to a legal Showdown choice, the expert when the
// search is missing or fails, and, when the app's helper is available (SILVER_MASTER_PY, SILVER_MASTER_SCRIPT), real searches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {importTeam, packTeam} from '../src/core.mjs';
import {LEVELS, chooseFor, makeRng, setMasterSearch} from '../src/ai.mjs';
import {masterAvailable, masterChoice, masterState} from '../src/master.mjs';
import {playOut} from '../src/stats.mjs';

const MINE = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\nTera Type: Steel\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n'
  + '- Swords Dance\n- Stone Edge\n\nRotom-Wash @ Leftovers\nAbility: Levitate\nEVs: 252 HP / 252 Def\nBold Nature\n- Hydro Pump\n- Volt Switch\n'
  + '- Will-O-Wisp\n- Protect';
const THEIRS = 'Heatran @ Leftovers\nAbility: Flash Fire\nEVs: 252 SpA / 252 Spe\nTimid Nature\n- Magma Storm\n- Earth Power\n- Flash Cannon\n'
  + '- Stealth Rock\n\nCorviknight\nAbility: Pressure\n- Brave Bird\n- Roost\n- U-turn\n- Defog';

function battle(format = 'gen9customgame') {
  const b = new Battle({formatid: format, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'A', team: packTeam(importTeam(MINE))});
  b.setPlayer('p2', {name: 'B', team: packTeam(importTeam(THEIRS))});
  b.makeChoices('default', 'default');
  return b;
}

test('master is a level', () => {
  assert.ok(LEVELS.includes('master'));
});

test('the battle as poke-engine state', () => {
  const b = battle();
  b.makeChoices('move 4', 'move 4');     // Stone Edge into Heatran's Stealth Rock
  const s = masterState(b, 'p2');
  assert.equal(s.side_one.pokemon[0].id, 'heatran');
  assert.deepEqual(s.side_one.pokemon[0].types, ['fire', 'steel']);
  assert.equal(s.side_one.pokemon[0].nature, 'timid');
  assert.equal(s.side_one.pokemon[0].moves.length, 4);
  assert.equal(s.side_two.pokemon[0].id, 'garchomp');
  assert.equal(s.side_two.pokemon[0].item, 'choicescarf');
  assert.equal(s.side_two.side_conditions.stealth_rock, 1);
  assert.equal(s.side_two.pokemon[0].tera_type, 'steel');
  assert.ok(s.side_two.pokemon[0].hp > 0 && s.side_two.pokemon[0].speed > s.side_one.pokemon[0].speed);
  // Garchomp is locked into Stone Edge by its Choice Scarf: the request disables the rest
  const mine = masterState(b, 'p1').side_one.pokemon[0].moves;
  assert.deepEqual(mine.map((m) => m.disabled), [true, true, true, false]);
  assert.equal(masterState(b, 'p1').side_one.last_used_move, 'move:3');
  assert.equal(s.weather, 'none');
});

test('a search answer becomes a legal choice and the expert covers when it fails', () => {
  const b = battle();
  const req = b.sides[0].activeRequest;
  setMasterSearch(() => 'move 3');
  try {
    assert.equal(chooseFor(b, 'p1', {level: 'master'}), 'move 3');
    const trace = {};
    setMasterSearch(() => { throw new Error('boom'); });
    const choice = chooseFor(b, 'p1', {level: 'master', rng: makeRng(4), trace});
    assert.equal(choice, chooseFor(b, 'p1', {level: 'expert', rng: makeRng(4)}));
    assert.equal(trace.fallback, 'expert');
    assert.equal(trace.master_error, 'boom');
    assert.equal(trace.level, 'master');
    // with no search at all it is the expert
    setMasterSearch(null);
    assert.equal(chooseFor(b, 'p1', {level: 'master', rng: makeRng(2)}), chooseFor(b, 'p1', {level: 'expert', rng: makeRng(2)}));
    assert.ok(req.active);
  } finally {
    setMasterSearch(masterAvailable() ? masterChoice : null);
  }
});

test('outside 9th-generation singles the master does not search', () => {
  const b = new Battle({formatid: 'gen8customgame', seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'A', team: packTeam(importTeam('Garchomp\n- Earthquake'))});
  b.setPlayer('p2', {name: 'B', team: packTeam(importTeam('Heatran\n- Flamethrower'))});
  b.makeChoices('default', 'default');
  assert.equal(masterChoice(b, 'p1', b.sides[0].activeRequest), null);
});

test('real searches pick legal moves and play a battle out', {skip: !masterAvailable() && 'poke-engine helper not configured'}, () => {
  const b = battle();
  const trace = {};
  const choice = chooseFor(b, 'p1', {level: 'master', trace, masterMs: 300});
  assert.match(choice, /^(move [1-4]( terastallize)?|switch 2)$/);
  assert.ok(trace.search && trace.search.iterations > 100 && trace.search.options.length >= 2, JSON.stringify(trace.search));
  assert.ok(trace.search.options.every((o) => typeof o.label === 'string' && o.share >= 0 && o.share <= 1));
  assert.ok(!trace.fallback);
  const r = playOut({format: 'gen9customgame', seed: [3, 1, 4, 1], p1: {name: 'A', sets: importTeam(MINE), ai: {level: 'master'}},
    p2: {name: 'B', sets: importTeam(THEIRS), ai: {level: 'hard'}}});
  assert.deepEqual(r.errors, []);
  assert.ok(r.summary.turns > 0);
});
