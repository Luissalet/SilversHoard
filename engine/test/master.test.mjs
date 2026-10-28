// The master AI: the battle as poke-engine's state, the search's answer mapped back to a legal Showdown choice, the expert when the
// search is missing or fails, and, when the app's helper is available (SILVER_MASTER_PY, SILVER_MASTER_SCRIPT), real searches.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {importTeam, packTeam} from '../src/core.mjs';
import {LEVELS, chooseFor, makeRng, setMasterSearch} from '../src/ai.mjs';
import {masterAvailable, masterChoice, masterState, volatileDuration} from '../src/master.mjs';
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

// poke-engine counts the turns that have PASSED of Taunt, Encore and a rampage move (0, 1, 2; 3 or more panics in generate_instructions);
// the simulator keeps the turns that REMAIN. The durations below are what the simulator really holds on each turn of these battles.
function duel(a, b, moves1, moves2, turns, target) {
  const bt = new Battle({formatid: 'gen9customgame', seed: [5, 6, 7, 8]});
  bt.setPlayer('p1', {name: 'A', team: packTeam(importTeam(a))});
  bt.setPlayer('p2', {name: 'B', team: packTeam(importTeam(b))});
  bt.makeChoices('default', 'default');
  const seen = [];
  for (let i = 0; i < turns; i++) {
    const s = masterState(bt, 'p1');
    seen.push((target === 'p1' ? s.side_one : s.side_two).volatile_status_durations);
    bt.makeChoices(moves1[i], moves2[i]);
  }
  return seen;
}

const QUICK = 'Jolteon\nAbility: Volt Absorb\nEVs: 252 Spe\n- Taunt\n- Encore\n- Yawn\n- Confuse Ray';
const SLOW = 'Snorlax\nAbility: Immunity\nEVs: 252 HP\n- Taunt\n- Encore\n- Yawn\n- Confuse Ray';
const FOE = 'Jolteon\nAbility: Volt Absorb\nEVs: 252 Spe\n- Tackle\n- Recover\n- Protect';
const WALL = 'Chansey\nAbility: Natural Cure\nLevel: 100\nEVs: 252 HP / 252 Def\n- Tackle\n- Recover\n- Softboiled\n- Protect';
const same = (n, m) => Array(n).fill(m);

test('Taunt and Encore reach poke-engine as turns passed, never 3 or more', () => {
  // Taunt from the faster side: 2 turns remain on the next turn, then 1; the target had not moved yet, so it lasts the 3 turns
  assert.deepEqual(duel(QUICK, WALL, ['move 1', 'move 3', 'move 3', 'move 3'], same(4, 'move 1'), 4, 'p2').map((d) => d.taunt),
    [undefined, 1, 2, undefined]);
  // Taunt from the slower side: the target had already moved, 3 turns remain on the next turn (poke-engine panics on a 3)
  assert.deepEqual(duel(SLOW, FOE, ['move 1', 'move 3', 'move 3', 'move 3', 'move 3'], same(5, 'move 1'), 5, 'p2').map((d) => d.taunt),
    [undefined, 0, 1, 2, undefined]);
  assert.deepEqual(duel(SLOW, FOE, ['move 2', 'move 3', 'move 3', 'move 3', 'move 3'], same(5, 'move 1'), 5, 'p2').map((d) => d.encore),
    [undefined, 0, 1, 2, undefined]);
});

test('a rampage move, Yawn and Slow Start reach poke-engine in its own counting', () => {
  const rampage = duel('Dragonite\nAbility: Inner Focus\nEVs: 252 Atk\n- Outrage\n- Tackle', WALL, same(3, 'move 1'), same(3, 'move 2'), 3, 'p1');
  assert.equal(rampage[0].lockedmove, undefined);
  assert.equal(rampage[1].lockedmove, 2);                // the simulator has 1 turn left, poke-engine ends the lock at 2
  const yawn = duel(QUICK, WALL, ['move 3', 'move 1', 'move 1'], same(3, 'move 1'), 3, 'p2');
  assert.deepEqual(yawn.map((d) => d.yawn), [undefined, 1, undefined]);
  const regi = duel('Regigigas\nAbility: Slow Start\n- Tackle\n- Recover', WALL, same(4, 'move 1'), same(4, 'move 2'), 4, 'p1');
  assert.deepEqual(regi.map((d) => d.slowstart), [5, 4, 3, 2]);
  const b = new Battle({formatid: 'gen9customgame', seed: [5, 6, 7, 8]});
  b.setPlayer('p1', {name: 'A', team: packTeam(importTeam('Regigigas\nAbility: Slow Start\n- Tackle'))});
  b.setPlayer('p2', {name: 'B', team: packTeam(importTeam(WALL))});
  b.makeChoices('default', 'default');
  assert.ok(masterState(b, 'p1').side_one.volatile_statuses.includes('slowstart'));
});

test('the translation of every counter', () => {
  const left = (n) => ({duration: n});
  for (const id of ['taunt', 'encore', 'lockedmove']) {
    assert.deepEqual([4, 3, 2, 1, 0].map((n) => volatileDuration(id, left(n))), [0, 0, 1, 2, 2]);
  }
  assert.equal(volatileDuration('lockedmove', {duration: 1, trueDuration: 2}), 1);   // a rampage's `duration` is a constant, trueDuration counts
  assert.deepEqual([3, 2, 1, 0].map((n) => volatileDuration('yawn', left(n))), [1, 1, 1, 0]);
  assert.equal(volatileDuration('confusion', {time: 3}), 3);
  assert.equal(volatileDuration('substitute', left(1)), null);
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
