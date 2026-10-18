import assert from 'node:assert/strict';
import test from 'node:test';
import {scoutTeam} from '../src/scouting.mjs';
import {playOut} from '../src/stats.mjs';
import {Match, viewLines} from '../src/match.mjs';

const candidate = (species, moves, usage = 1) => ({set: {species, moves}, usage});

test('scouting chooses actual damaging move coverage and adds coverage for another observed species', () => {
  const pool = [candidate('Pikachu', ['Thunderbolt'], 10), candidate('Raichu', ['Thunderbolt'], 20),
    candidate('Venusaur', ['Giga Drain'], 1), candidate('Charmander', ['Splash'], 100)];
  const before = JSON.stringify(pool);
  const out = scoutTeam(pool, ['Gyarados', 'Swampert'], {format: 'gen9customgame', size: 2});
  assert.deepEqual(out.choices.map(x => x.species), ['Raichu', 'Venusaur']);
  assert.deepEqual(out.choices[0].coverage, [{species: 'Gyarados', move_type: 'Electric', multiplier: 4}]);
  assert.deepEqual(out.choices[1].coverage, [{species: 'Swampert', move_type: 'Grass', multiplier: 4}]);
  assert.equal(JSON.stringify(pool), before);
});

test('scouting uses the generation type chart and never counts status moves as attacks', () => {
  const pool = [candidate('Clefable', ['Moonblast']), candidate('Pikachu', ['Thunder Wave'])];
  const modern = scoutTeam(pool, ['Dragonite'], {format: 'gen9customgame', size: 1});
  assert.equal(modern.choices[0].coverage[0].multiplier, 2);
  const old = scoutTeam(pool, ['Dragonite'], {format: 'gen1customgame', size: 1});
  assert.deepEqual(old.choices[0].coverage, []);
  assert.deepEqual(scoutTeam([pool[1]], ['Gyarados'], {format: 'gen9customgame', size: 1}).choices[0].coverage, []);
});

test('scouting does not fill duplicate base species and is stable across pool order', () => {
  const pool = [candidate('Rotom-Wash', ['Hydro Pump']), candidate('Rotom-Heat', ['Overheat']),
    candidate('Pikachu', ['Thunderbolt']), candidate('Raichu', ['Thunderbolt'])];
  const out = scoutTeam(pool, ['Eevee'], {format: 'gen9customgame', size: 6});
  assert.equal(out.choices.filter(x => x.species.startsWith('Rotom')).length, 1);
  assert.equal(out.choices.length, 3);
  assert.deepEqual(out, scoutTeam([...pool].reverse(), ['Eevee'], {format: 'gen9customgame', size: 6}));
});

test('scouting gives no team when there is no usable observation', () => {
  assert.deepEqual(scoutTeam([candidate('Pikachu', ['Thunderbolt'])], ['not a species'], {format: 'gen9customgame', size: 1}).choices, []);
});

test('watched battles keep the actual public disguise without changing the omniscient log', () => {
  const spec = {format: 'gen5customgame', rules: ['!Team Preview'], max_turns: 1, seed: 'scout-illusion',
    p1: {name: 'A', ai: {level: 'normal'}, sets: [{species: 'Zoroark', ability: 'Illusion', moves: ['Splash']}, {species: 'Pikachu', moves: ['Splash']}]},
    p2: {name: 'B', ai: {level: 'normal'}, sets: [{species: 'Eevee', moves: ['Splash']}]}};
  const expected = new Match(spec);
  expected.advance(100000);
  const out = playOut(spec);
  assert.deepEqual(out.scouting.p1, ['Pikachu']);
  assert.deepEqual(out.lines, viewLines(expected.battle.log, 0, 'omniscient'));
  assert.equal(expected.battle.sides[0].active[0].species.name, 'Zoroark');
});
