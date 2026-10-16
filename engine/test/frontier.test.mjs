// A battle's starting state (the Battle Frontier's Castle and Arcade): HP, status, PP, weather, Trick Room and fog applied before the
// first Pokémon come out, kept by snapshots, carried by the input log for practice branches, and read back at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {importTeam} from '../src/core.mjs';
import {Match} from '../src/match.mjs';
import {playOut} from '../src/stats.mjs';
import {practiceSnapshot} from '../src/practice.mjs';
import {endState, frontierParty, hasStart, startFromInput} from '../src/frontier.mjs';
import {RtBattle} from '../src/realtime/sim.mjs';

const MINE = importTeam('Pikachu\nLevel: 50\n- Thunderbolt\n- Quick Attack\n\nGolem\nLevel: 50\n- Earthquake\n- Rock Slide\n\nMuk\nLevel: 50\n- Sludge Bomb\n- Rest');
const THEIRS = importTeam('Snorlax\nLevel: 50\n- Body Slam\n- Weather Ball\n- Moonlight\n- Rain Dance\n\nJolteon\nLevel: 50\n- Thunderbolt\n\nCloyster\nLevel: 50\n- Surf');
const RULES = ['Team Preview', 'Picked Team Size = 3'];
const START = {p1: [{hp: 30, status: 'par', pp: [3, 0]}, {hp_cut: 0.2}, {status: 'slp', sleep_turns: 4}], p2: [{status: 'brn'}],
  field: {weather: 'fog', trickroom: 5}};
const spec = (extra = {}) => ({id: 'frontier-test', seed: '7,7,7,7', format: 'gen4customgame', rules: RULES, level_rules: {},
  p1: {name: 'Yo', sets: MINE, ai: null}, p2: {name: 'Rival', sets: THEIRS, ai: {level: 'normal', style: 'balanced'}}, start: START, ...extra});
const clean = (log) => log.filter((l) => !l.startsWith('|t:'));
/** Play p1's turn: its first move, or the next Pokémon when it has to switch. */
const step = (m) => m.choose('p1', m.battle.sides[0].activeRequest?.forceSwitch ? 'default' : 'move 1');

test('the start state is in the battle before the first Pokémon come out', () => {
  const m = new Match(spec()).advance();
  m.choose('p1', 'team 123');
  const log = m.battle.log;
  const start = log.indexOf('|start');
  assert.ok(start > 0);
  assert.ok(log.indexOf('|-weather|Fog') > start && log.indexOf('|-fieldstart|move: Trick Room') > start);
  assert.ok(log.some((l) => l.startsWith('|switch|p1a: Pikachu') && l.endsWith('30/110 par')), 'the switch-in shows the HP and status');
  const [pika, golem, muk] = m.battle.sides[0].pokemon;
  assert.deepEqual([pika.hp, pika.status, pika.baseMoveSlots.map((s) => s.pp)], [30, 'par', [3, 0]]);
  assert.equal(golem.hp, golem.maxhp - (Math.floor(golem.maxhp * 1.2) - golem.maxhp));   // the Arcade's Lower HP
  assert.deepEqual([muk.status, muk.statusState.time], ['slp', 4]);
  assert.equal(m.battle.sides[1].pokemon.find((p) => p.species.name === 'Snorlax').status, 'brn');
  assert.equal(m.battle.field.weather, 'fog');
  assert.equal(m.battle.field.pseudoWeather.trickroom.duration, 5);
  assert.deepEqual(startFromInput(m.inputLog()), START);
});

test('fog cuts accuracy to 3/5 and lasts until another weather replaces it; Trick Room ends after five turns', () => {
  const m = new Match(spec({start: {field: {weather: 'fog', trickroom: 5}}})).advance();
  m.choose('p1', 'team 123');
  const b = m.battle;
  const acc = b.runEvent('ModifyAccuracy', b.sides[1].active[0], b.sides[0].active[0], b.dex.getActiveMove('thunderbolt'), 100);
  assert.equal(acc, 60);
  for (let i = 0; i < 12 && !b.ended && b.field.weather === 'fog'; i++) step(m);
  assert.ok(b.log.includes('|-weather|Fog|[upkeep]'));
  assert.ok(b.log.includes('|-fieldend|move: Trick Room') || b.turn <= 5 || b.ended);
  if (!b.ended) {
    b.field.setWeather('raindance', b.sides[1].active[0]);
    assert.equal(b.field.weather, 'raindance');
  }
});

test('a snapshot keeps the start state and the same battle replays the same', () => {
  const a = new Match(spec()).advance();
  const b = new Match(spec()).advance();
  for (const m of [a, b]) {
    m.choose('p1', 'team 213');
    for (let i = 0; i < 3 && !m.battle.ended; i++) step(m);
  }
  assert.deepEqual(clean(a.battle.log), clean(b.battle.log));
  const restored = new Match(spec(), a.snapshot());
  assert.equal(restored.battle.field.weather, a.battle.field.weather);
  assert.deepEqual(restored.battle.sides[0].pokemon.map((p) => [p.hp, p.status]), a.battle.sides[0].pokemon.map((p) => [p.hp, p.status]));
});

test('a practice branch rebuilt from the input log starts from the same state', () => {
  const m = new Match(spec()).advance();
  m.choose('p1', 'team 123');
  step(m);
  if (m.battle.ended) return;
  const before = m.battle.sides[0].pokemon.map((p) => p.hp);
  const point = practiceSnapshot(m.inputLog(), m.battle.turn, 'p1');
  const rebuilt = Battle.fromJSON(point.snapshot);
  assert.deepEqual(rebuilt.sides[0].pokemon.map((p) => p.hp), before);
  assert.equal(rebuilt.field.weather, 'fog');
});

test('the end state lists each side in the order of its sets, and a played-out battle returns it', () => {
  const r = playOut({...spec(), p1: {name: 'Yo', sets: MINE, ai: {level: 'normal'}}});
  assert.ok(r.end && r.end.p1.length === 3 && r.end.p2.length === 3);
  assert.deepEqual(r.end.p1.map((x) => x.index), [0, 1, 2]);
  for (const x of r.end.p1) assert.ok(x.maxhp > 0 && x.pp.length === x.maxpp.length && x.hp <= x.maxhp);
  const m = new Match(spec({start: null})).advance();
  assert.equal(hasStart(null), false);
  m.choose('p1', 'team 312');
  const end = endState(m.battle);
  assert.deepEqual(end.p1.map((x) => x.species), ['Pikachu', 'Golem', 'Muk']);
  assert.ok(!m.inputLog().some((l) => l.startsWith('>silverstart')));
});

test('frontier_party gives Gen 4 types, the ability the battle uses, max HP and PP with PP Ups', () => {
  const [clefairy, sprigatito] = frontierParty([{species: 'Clefairy', level: 50, moves: ['Moonlight', 'Sketch']}, {species: 'Sprigatito', moves: ['Leafage']}]);
  assert.deepEqual(clefairy.types, ['Normal']);   // Fairy only from generation 6
  assert.equal(clefairy.ability, 'Cute Charm');
  assert.equal(clefairy.maxhp, 145);
  assert.deepEqual(clefairy.moves.map((m) => m.pp), [8, 1]);
  assert.equal(sprigatito.gen, 9);
});

test('real time takes the starting HP, status and weather as well (PP, Trick Room and fog are turn-only)', () => {
  const spec = {id: 'rt-start', seed: 'rt-start', format: 'gen4customgame', p1: {name: 'Yo', sets: MINE, ai: null},
    p2: {name: 'Rival', sets: THEIRS, ai: {level: 'normal', style: 'balanced'}},
    start: {p1: [{hp: 30, status: 'par'}, {hp_cut: 0.2}], p2: [{status: 'brn'}], field: {weather: 'raindance', trickroom: 5}}};
  const b = new RtBattle(spec);
  const [pika, golem] = b.sides[0].mons;
  assert.deepEqual([pika.hp, pika.status], [30, 'par']);
  assert.equal(golem.hp, golem.maxhp - (Math.floor(golem.maxhp * 1.2) - golem.maxhp));
  assert.equal(b.sides[1].mons[0].status, 'brn');
  assert.equal(b.weather.id, 'raindance');
  const again = new RtBattle(spec);
  assert.deepEqual(again.sides.map((s) => s.mons.map((m) => [m.hp, m.status])), b.sides.map((s) => s.mons.map((m) => [m.hp, m.status])));
  const plain = new RtBattle({...spec, start: undefined});
  assert.equal(plain.sides[0].mons[0].hp, plain.sides[0].mons[0].maxhp);
});
