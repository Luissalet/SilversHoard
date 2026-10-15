// A friend's turn-based battle checked again: the page's own record replayed on the app's simulator gives the same result, the AI's
// choices are the ones the AI makes again, and a changed opponent team, an illegal choice or an opponent made to play badly show.
import test from 'node:test';
import assert from 'node:assert/strict';
import {importTeam} from '../src/core.mjs';
import {Match} from '../src/match.mjs';
import {makeRng} from '../src/ai.mjs';
import {replayCheck} from '../src/replay.mjs';

const FRIEND = importTeam('Garchomp\nAbility: Rough Skin\n- Earthquake\n- Dragon Claw\n- Swords Dance\n- Stone Edge\n\nLucario\n- Aura Sphere\n- Flash Cannon');
const GYM = importTeam('Heatran\n- Flamethrower\n- Earth Power\n\nBlissey\n- Seismic Toss\n- Soft-Boiled');

/** A page's battle: no seed given, the friend picking moves with its own little random habit. */
function pageBattle(level = 'hard', seed = 3) {
  const m = new Match({format: 'gen9customgame', level_rules: {level: 50}, p1: {name: 'Amiga', sets: FRIEND, ai: null},
    p2: {name: 'Líder', sets: GYM, ai: {level, style: 'balanced'}}});
  const rng = makeRng(seed);
  m.advance();
  for (let n = 0; n < 400 && !m.battle.ended; n++) {
    const req = m.battle.sides[0].activeRequest;
    let choice = 'default';
    if (req?.active) {
      const moves = req.active[0].moves.map((x, i) => (x.disabled ? 0 : i + 1)).filter(Boolean);
      choice = `move ${moves[Math.floor(rng() * moves.length)] || 1}`;
    }
    m.choose('p1', choice);
  }
  return m;
}

const args = (m, extra = {}) => ({input: m.inputLog(), format: 'gen9customgame', rules: [], level_rules: {level: 50}, p1_sets: FRIEND, p2_sets: GYM,
  ai: {level: 'hard', style: 'balanced'}, rng_id: m.id, ...extra});

test('the replay gives the same result and the same AI choices', () => {
  for (const level of ['normal', 'hard', 'expert']) {
    const m = pageBattle(level);
    const winner = m.state().winner_side;
    const r = replayCheck(args(m, {ai: {level, style: 'balanced'}}));
    assert.ok(r.ok, JSON.stringify(r.problems));
    assert.equal(r.winner_side, winner, level);
    assert.ok(r.ai_decisions > 1);
    assert.equal(r.ai_mismatches, 0, level);
    assert.equal(r.turns, m.battle.turn);
  }
});

test('what a changed code shows', () => {
  const m = pageBattle();
  // the opponent made to play badly: one of its moves swapped for another
  const input = m.inputLog();
  const i = input.findIndex((l) => l.startsWith('>p2 move'));
  const bad = [...input];
  bad[i] = bad[i].includes('flamethrower') ? '>p2 move earthpower' : '>p2 move flamethrower';
  const r = replayCheck(args(m, {input: bad}));
  assert.ok(r.ai_mismatches >= 1);
  // another opponent team, another friend team, an illegal choice, the simulator's own ending
  assert.ok(replayCheck(args(m, {p2_sets: importTeam('Heatran\n- Flamethrower')})).problems.some((p) => p.includes("opponent's team")));
  assert.ok(replayCheck(args(m, {p1_sets: importTeam('Garchomp\n- Earthquake')})).problems.some((p) => p.includes("friend's team")));
  const illegal = [...input];
  illegal[input.findIndex((l) => l.startsWith('>p1 move'))] = '>p1 move hyperbeam';
  assert.ok(!replayCheck(args(m, {input: illegal})).ok);
  assert.ok(!replayCheck(args(m, {input: [...input.slice(0, 6), '>forcewin p1']})).ok);
  assert.throws(() => replayCheck(args(m, {input: ['>p1 move 1']})));
});

test('a forfeit by the friend is a loss', () => {
  const m = new Match({format: 'gen9customgame', p1: {name: 'A', sets: FRIEND, ai: null}, p2: {name: 'B', sets: GYM, ai: {level: 'hard', style: 'balanced'}}});
  m.advance();
  m.choose('p1', 'default');
  m.forfeit('p1');
  const r = replayCheck({...args(m), level_rules: {}, forfeit: 'p1'});
  assert.equal(r.winner_side, 'p2');
  assert.ok(r.ok);
});
