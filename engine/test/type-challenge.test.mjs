import test from 'node:test';
import assert from 'node:assert/strict';
import {Dex} from '@pkmn/sim';
import {TYPES} from '../src/core.mjs';
import {typeChallenge, scoreTypeChallenge, typeFactors} from '../src/type-challenge.mjs';
const factor = (gen, type, defence) => typeFactors(gen, type, defence).reduce((n, f) => n * f.multiplier, 1);
const best = (spec, q) => q.options.reduce((a, b) => factor(spec.gen, a, q.types) > factor(spec.gen, b, q.types) ? a : b);

test('historical chart retains immunities, changed resistances, Fairy and dual products', () => {
  assert.equal(factor(1, 'Ghost', ['Psychic']), 0);
  assert.equal(factor(2, 'Ghost', ['Psychic']), 2);
  assert.equal(factor(1, 'Bug', ['Poison']), 2);
  assert.equal(factor(2, 'Bug', ['Poison']), .5);
  assert.equal(factor(5, 'Ghost', ['Steel']), .5);
  assert.equal(factor(6, 'Ghost', ['Steel']), 1);
  assert.equal(factor(9, 'Ice', ['Dragon', 'Ground']), 4);
  assert.equal(factor(9, 'Fighting', ['Ghost', 'Dark']), 0);
  assert.equal(factor(9, 'Grass', ['Fire', 'Flying']), .25);
  assert.deepEqual(Dex.mod('gen1').species.get('Clefairy').types, ['Normal']);
  assert.deepEqual(Dex.mod('gen6').species.get('Clefairy').types, ['Fairy']);
});

test('all generations and modes give ten distinct defenders and one uniquely best option', () => {
  for (let gen = 1; gen <= 9; gen++) for (const mode of ['single', 'dual']) for (const seed of ['A', 'B', 'C']) {
    const deck = typeChallenge({gen, mode, seed}), dex = Dex.mod(`gen${gen}`);
    assert.equal(deck.questions.length, 10);
    assert.equal(new Set(deck.questions.map(q => q.species)).size, 10);
    for (const q of deck.questions) {
      assert.equal(q.types.length, mode === 'single' ? 1 : 2);
      assert.deepEqual(q.types, dex.species.get(q.species).types);
      assert.equal(new Set(q.options).size, 4);
      assert.ok(q.options.every(t => !dex.types.get(t).isNonstandard));
      const values = q.options.map(t => factor(gen, t, q.types)), top = Math.max(...values);
      assert.equal(values.filter(n => n === top).length, 1);
      assert.equal(top, Math.max(...TYPES.filter(t => !dex.types.get(t).isNonstandard).map(t => factor(gen, t, q.types))));
    }
  }
});

test('seeded questions do not use global randomness and regenerate from their returned specification', () => {
  const random = Math.random;Math.random = () => { throw Error('global randomness'); };
  try {
    const deck = typeChallenge({seed: 'repeat áé😊', gen: 3});
    assert.deepEqual(typeChallenge(deck.spec), deck);
    assert.notDeepEqual(typeChallenge({...deck.spec, seed: 'other'}).questions, deck.questions);
    assert.equal(deck.basis.abilities, false);
  } finally { Math.random = random; }
});

test('grading sequential prefixes preserves correct count, streak, explanations and completion', () => {
  const d = typeChallenge({gen: 9, seed: 'grade'}), answers = d.questions.map(q => best(d.spec, q));
  answers[2] = d.questions[2].options.find(t => t !== answers[2]);
  const prefix = scoreTypeChallenge({...d.spec, answers: answers.slice(0, 5)});
  assert.equal(prefix.correct, 4);assert.equal(prefix.streak, 2);assert.equal(prefix.best_streak, 2);assert.equal(prefix.complete, false);
  const result = scoreTypeChallenge({...d.spec, answers});
  assert.equal(result.correct, 9);assert.equal(result.streak, 7);assert.equal(result.best_streak, 7);assert.equal(result.complete, true);
  assert.equal(result.feedback[2].correct, false);
  for (const f of result.feedback) {
    for (const choice of [f.best, f.chosen]) assert.equal(choice.multiplier, choice.factors.reduce((n, x) => n * x.multiplier, 1));
  }
  assert.equal(scoreTypeChallenge({...d.spec, answers: []}).answered, 0);
});

test('bad settings and answers are rejected without accepting a forged deck', () => {
  for (const args of [{gen: 0}, {gen: 10}, {gen: 1.5}, {gen: true}, {mode: 'easy'}, {seed: ''}, {seed: '   '}, {seed: 'x'.repeat(101)}, {version: 2}]) {
    assert.throws(() => typeChallenge(args));
  }
  for (const answers of [null, 'Fire', Array(11).fill('Fire'), ['not-a-type'], [null]]) assert.throws(() => scoreTypeChallenge({answers}));
  const deck = typeChallenge();
  assert.throws(() => scoreTypeChallenge({...deck.spec, answers: ['Stellar'], questions: [{options: ['Stellar']}]}));
});
