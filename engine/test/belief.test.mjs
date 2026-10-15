// An AI that does not see the opponent's team: what the log shows (moves, items, abilities, Tera, who was seen), the copy of the
// battle with guesses for the rest (usage statistics or its own), the real battle untouched, legal choices for every level and
// whole battles played that way.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {importTeam, packTeam} from '../src/core.mjs';
import {LEVELS, chooseFor, makeRng} from '../src/ai.mjs';
import {believe, revealed} from '../src/belief.mjs';
import {playOut} from '../src/stats.mjs';

const MINE = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Swords Dance\n- Outrage\n- Stone Edge\n- Fire Fang\n\n'
  + 'Gholdengo @ Leftovers\nAbility: Good as Gold\nEVs: 252 SpA / 252 Spe\n- Make It Rain\n- Shadow Ball';
const THEIRS = 'Heatran @ Leftovers\nAbility: Flash Fire\nEVs: 252 SpA / 252 Spe\nTimid Nature\n- Magma Storm\n- Earth Power\n- Flash Cannon\n- Stealth Rock\n\n'
  + 'Rotom-Wash @ Sitrus Berry\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect';
const BELIEFS = {Heatran: {moves: ['Magma Storm', 'Earth Power', 'Taunt', 'Stealth Rock'], item: 'Air Balloon', ability: 'Flash Fire', tera: 'Grass',
  spread: 'Calm:252/0/0/4/252/0'}};

function battle(format = 'gen9customgame') {
  const b = new Battle({formatid: format, seed: [1, 2, 3, 4]});
  b.setPlayer('p1', {name: 'A', team: packTeam(importTeam(MINE))});
  b.setPlayer('p2', {name: 'B', team: packTeam(importTeam(THEIRS))});
  b.makeChoices('default', 'default');
  return b;
}

test('the log says what was shown', () => {
  const b = battle();
  b.makeChoices('move 1', 'move 4');           // Swords Dance; Stealth Rock
  const seen = revealed(b, 'p2');
  assert.equal(seen.preview, true);
  assert.deepEqual([...seen.seen.Heatran.moves], ['stealthrock']);
  assert.equal(seen.seen.Heatran.item, undefined);
  const mine = revealed(b, 'p1');
  assert.deepEqual([...mine.seen.Garchomp.moves], ['swordsdance']);
});

test('a copy with guesses, the real battle untouched', () => {
  const b = battle();
  b.makeChoices('move 1', 'move 4');
  const real = JSON.stringify(b.sides[1].pokemon[0].moveSlots.map((m) => m.id));
  const {battle: v, unseen} = believe(b, 'p1', BELIEFS);
  const h = v.sides[1].pokemon[0];
  assert.deepEqual(h.moveSlots.map((m) => m.id), ['stealthrock', 'magmastorm', 'earthpower', 'taunt']);
  assert.equal(h.item, 'airballoon');
  assert.equal(h.teraType, 'Grass');
  assert.equal(h.set.nature, 'Calm');
  assert.ok(h.storedStats.spd > b.sides[1].pokemon[0].storedStats.spd);
  assert.equal(h.hp / h.maxhp, b.sides[1].pokemon[0].hp / b.sides[1].pokemon[0].maxhp);
  assert.deepEqual(v.sides[1].activeRequest.active[0].moves.map((m) => m.id), h.moveSlots.map((m) => m.id));
  assert.equal(JSON.stringify(b.sides[1].pokemon[0].moveSlots.map((m) => m.id)), real);
  assert.equal(unseen.size, 0);                // team preview shows every species
  // its own side is the real one
  assert.deepEqual(v.sides[0].pokemon[0].moveSlots.map((m) => m.id), b.sides[0].pokemon[0].moveSlots.map((m) => m.id));
  // without statistics: no item, the first ability, the strongest moves of its own types
  const alone = believe(b, 'p1', {}).battle.sides[1].pokemon[1];
  assert.equal(alone.item, '');
  assert.equal(alone.moveSlots.length, 4);
  assert.ok(alone.moveSlots.some((m) => ['Water', 'Electric'].includes(alone.battle.dex.moves.get(m.id).type)));
});

test('a format without team preview hides the bench', () => {
  const b = battle('gen4customgame');
  const {unseen} = believe(b, 'p1', {});
  assert.deepEqual([...unseen], [2]);
});

test('every level chooses legally without seeing the other team', () => {
  for (const level of LEVELS) {
    const b = battle();
    const trace = {};
    const choice = chooseFor(b, 'p1', {level, rng: makeRng(5), hidden: true, beliefs: BELIEFS, trace});
    assert.ok(b.choose('p1', choice), `${level}: ${choice}`);
    assert.equal(trace.hidden, true);
    assert.ok(!trace.belief_error, trace.belief_error);
  }
});

test('whole battles with hidden AIs', () => {
  for (const [format, seed] of [['gen9customgame', [5, 6, 7, 8]], ['gen9doublescustomgame', [1, 3, 5, 7]]]) {
    const r = playOut({format, seed, p1: {name: 'A', sets: importTeam(MINE), ai: {level: 'expert', hidden: true, beliefs: BELIEFS}},
      p2: {name: 'B', sets: importTeam(THEIRS), ai: {level: 'hard', hidden: true}}});
    assert.deepEqual(r.errors, [], format);
    assert.ok(r.summary.turns > 0);
  }
});
