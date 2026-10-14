// The engine on its own: teams, AI choices that the simulator accepts in every generation and game type, snapshots, summaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {applyLevelRules, buildFormatId, exportTeam, importTeam, randomTeam, seedArray, validateTeam} from '../src/core.mjs';
import {chooseFor, makeRng} from '../src/ai.mjs';
import {Match, viewLines} from '../src/match.mjs';
import {playOut, series, summarize, tournament} from '../src/stats.mjs';
import {handle} from '../src/server.mjs';

const TEAM = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\n- Earthquake\n- Outrage\n\nRotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n';

test('teams: import, export, level rules, validation', () => {
  const sets = importTeam(TEAM);
  assert.equal(sets.length, 2);
  assert.match(exportTeam(sets), /Garchomp @ Choice Scarf/);
  assert.deepEqual(applyLevelRules(sets, {level: 50}).map((s) => s.level), [50, 50]);
  assert.deepEqual(applyLevelRules(sets, {level_cap: 30}).map((s) => s.level), [30, 30]);
  assert.equal(validateTeam('gen9customgame', sets).ok, true);
  assert.throws(() => buildFormatId('gen9nosuchthing'));
  assert.equal(buildFormatId('gen9customgame', ['!Team Preview']), 'gen9customgame@@@!Team Preview');
});

for (const format of ['gen9customgame', 'gen9doublescustomgame', 'gen8customgame', 'gen7customgame', 'gen4customgame', 'gen3customgame', 'gen2customgame', 'gen1customgame']) {
  for (const level of ['random', 'easy', 'normal', 'hard']) {
    test(`AI ${level} plays a whole ${format} battle with legal choices`, () => {
      const gen = Number(format.match(/gen(\d)/)[1]);
      const rf = gen >= 7 ? `gen${gen}randombattle` : gen >= 1 ? `gen${gen}randombattle` : 'gen9randombattle';
      const r = playOut({format, seed: [3, 1, 4, 1], p1: {name: 'A', sets: randomTeam(rf, 'a' + format).sets, ai: {level}},
        p2: {name: 'B', sets: randomTeam(rf, 'b' + format).sets, ai: {level: 'hard'}}}, {keepLog: true});
      assert.deepEqual(r.errors, []);
      assert.ok(r.lines.some((l) => l.startsWith('|win|') || l === '|tie'));
    });
  }
}

test('expert AI plays singles', () => {
  const r = playOut({format: 'gen9customgame', seed: [1, 1, 1, 1], p1: {name: 'A', sets: randomTeam('gen9randombattle', 'x').sets, ai: {level: 'expert'}},
    p2: {name: 'B', sets: randomTeam('gen9randombattle', 'y').sets, ai: {level: 'normal'}}});
  assert.deepEqual(r.errors, []);
  assert.ok(r.summary.turns > 0);
});

test('a person seat waits; snapshots resume the same battle', () => {
  const m = new Match({format: 'gen9customgame', seed: [5, 5, 5, 5], p1: {name: 'Me', sets: importTeam(TEAM), ai: null},
    p2: {name: 'AI', sets: importTeam(TEAM), ai: {level: 'hard'}}});
  m.advance();
  let st = m.state('p1');
  assert.ok(st.requests.p1.teamPreview);
  m.choose('p1', 'team 12');
  st = m.state('p1');
  assert.equal(st.turn, 1);
  assert.equal(st.requests.p1.active[0].moves[0].type, 'Ground');
  const copy = new Match(m.spec, JSON.parse(JSON.stringify(m.snapshot())));
  copy.choose('p1', 'move 1');
  m.choose('p1', 'move 1');
  assert.deepEqual(viewLines(copy.battle.log, 0, 'omniscient').slice(-5), viewLines(m.battle.log, 0, 'omniscient').slice(-5));
  assert.throws(() => m.choose('p1', 'move 7'), /Can't|Invalid/);
  m.forfeit('p1');
  assert.equal(m.state('p1').winner_side, 'p2');
});

test('AI never changes the live battle it reads', () => {
  const b = new Battle({formatid: 'gen9customgame', seed: '7,7,7,7', p1: {name: 'A', team: randomTeam('gen9randombattle', 'q').sets.map((s) => s)}, p2: {name: 'B', team: randomTeam('gen9randombattle', 'r').sets}});
  b.makeChoices('team 1', 'team 1');
  const before = JSON.stringify(b.toJSON());
  chooseFor(b, 'p1', {level: 'expert', rng: makeRng(1)});
  chooseFor(b, 'p2', {level: 'hard', rng: makeRng(2)});
  assert.equal(JSON.stringify(b.toJSON()), before);
});

test('summaries, series and tournaments', () => {
  const a = randomTeam('gen9randombattle', 's1').sets;
  const c = randomTeam('gen9randombattle', 's2').sets;
  const s = series({format: 'gen9customgame', seed: 9, p1: {name: 'A', sets: a, ai: {level: 'easy'}}, p2: {name: 'C', sets: c, ai: {level: 'easy'}}}, 3);
  assert.equal(s.wins.p1 + s.wins.p2 + s.wins.tie, 3);
  const r = playOut({format: 'gen9customgame', p1: {name: 'A', sets: a}, p2: {name: 'C', sets: c}});
  const sum = summarize(r.lines);
  assert.equal(sum.sides.p1.lost + sum.sides.p2.lost >= 6, true);
  const entrants = ['w', 'x', 'y', 'z', 'v'].map((id) => ({id, name: id, sets: randomTeam('gen9randombattle', id).sets, ai: {level: 'easy'}}));
  const t = tournament({format: 'gen9customgame', entrants, kind: 'bracket', seed: 1});
  assert.ok(entrants.some((e) => e.id === t.champion));
  assert.equal(t.matches.length, 4);
});

test('the line protocol answers errors as data', async () => {
  const bad = await handle({id: 1, cmd: 'validate', args: {format: 'gen9nope', sets: TEAM}});
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'invalid_format');
  const unknown = await handle({id: 2, cmd: 'fly'});
  assert.equal(unknown.error.code, 'unknown_command');
});

test('seeds given as text: a list of four numbers, any word, or an array give the same battle each time', () => {
  for (const seed of ['1,2,3,4', 'gym rematch', 'a,b', [1, 2, 3, 4]]) {
    const spec = () => ({format: 'gen9customgame', seed, p1: {name: 'A', sets: importTeam(TEAM), ai: {level: 'normal'}},
      p2: {name: 'B', sets: importTeam(TEAM), ai: {level: 'normal'}}});
    const a = playOut(spec());
    const b = playOut(spec());
    assert.equal(a.summary.turns, b.summary.turns);
    assert.equal(a.summary.winner_side, b.summary.winner_side);
  }
  assert.deepEqual(seedArray('1,2,3,4'), [1, 2, 3, 4]);
});
