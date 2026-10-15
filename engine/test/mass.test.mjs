// Mass battles (mass.mjs, mass-roster.mjs): rosters by generation and group with sets worked out from what each Pokémon learns,
// the three modes, the giants of "many against a few", the same battle every time from the same spec, a Pokémon played by a person
// (its input log replays to the same battle) and the engine's commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MASS_MAX_UNITS, MassBattle, massArena, massRun} from '../src/realtime/mass.mjs';
import {STARTERS, autoSet, composeMass, rosterSpecies} from '../src/realtime/mass-roster.mjs';
import {handle} from '../src/server.mjs';

test('rosters: whole generations, the strongest of each, the starters, the legendaries, names', () => {
  const kanto = rosterSpecies({kind: 'dex', gens: [1]});
  assert.equal(kanto.length, 151);
  assert.equal(kanto[0], 'Bulbasaur');
  assert.equal(kanto[150], 'Mew');
  assert.equal(rosterSpecies({kind: 'dex', gens: [9]}).length, 120);
  const top = rosterSpecies({kind: 'top', gens: [1, 3], count: 5});
  assert.equal(top.length, 10);
  assert.equal(top[0], 'Mewtwo');
  assert.ok(top.includes('Rayquaza'));
  assert.deepEqual(rosterSpecies({kind: 'starters'}), STARTERS);
  const legends = rosterSpecies({kind: 'legendaries', gens: [1]});
  assert.deepEqual(legends, ['Articuno', 'Zapdos', 'Moltres', 'Mewtwo', 'Mew']);
  assert.deepEqual(rosterSpecies({kind: 'species', list: ['pikachu', 'Eternatus-Eternamax']}), ['Pikachu', 'Eternatus-Eternamax']);
  assert.throws(() => rosterSpecies({kind: 'species', list: ['Missingno.x']}), /Unknown Pokémon/);
  assert.equal(rosterSpecies({kind: 'random', count: 12, seed: 'a'}).length, 12);
  assert.deepEqual(rosterSpecies({kind: 'random', count: 12, seed: 'a'}), rosterSpecies({kind: 'random', count: 12, seed: 'a'}));
});

test('sets worked out from the learnset: own types first, coverage, one extra, always something to hit with', () => {
  const zard = autoSet('Charizard');
  assert.equal(zard.moves.length, 4);
  assert.ok(zard.moves.some((m) => ['Overheat', 'Fire Blast', 'Flamethrower', 'Blast Burn', 'Flare Blitz', 'Heat Wave', 'Inferno', 'Eruption'].includes(m)), zard.moves.join());
  const karp = autoSet('Magikarp');
  assert.ok(karp.moves.length >= 1);
  const metapod = autoSet('Metapod');
  assert.ok(metapod.moves.length >= 1);
  // a set always fights: a Pokémon with no attack at all is given Struggle
  const b = new MassBattle({seed: 's', mode: 'ffa', teams: [{units: [{set: {species: 'Ditto', moves: ['Transform']}}, {set: autoSet('Pikachu')}]}]});
  assert.equal(b.units[0].moves[0].id, 'struggle');
});

test('everybody against everybody: one team each, a winner standing, the same battle from the same spec', () => {
  const spec = composeMass({mode: 'ffa', seed: 'royale', teams: [{roster: {kind: 'starters'}}]});
  assert.equal(spec.teams[0].units.length, 27);
  const b = massRun(spec);
  assert.ok(b.ended);
  assert.equal(b.teams.length, 27);
  const s = b.summary();
  assert.ok(s.winner >= 0 || s.reason === 'time');
  assert.equal(s.ranking[0].place, 1);
  assert.equal(s.ranking.length, 27);
  if (s.reason === 'last_standing') assert.equal(s.ranking.filter((r) => r.alive).length, 1);
  assert.equal(massRun(spec).hash(), b.hash());
  // nobody is hit by its own team: in teams mode the KO feed never pairs two of the same team
  const t = massRun(composeMass({mode: 'teams', seed: 'armies', teams: [{roster: {kind: 'top', gens: [1], count: 10}}, {roster: {kind: 'top', gens: [2], count: 10}}]}));
  for (const e of t.events) if (e.k === 'hit' || e.k === 'ko' && e.by >= 0) assert.notEqual(t.units[e.u].team, t.units[e.by].team);
  assert.ok(t.ended && t.summary().teams.length === 2);
});

test('many against a few: the giant is bigger, tougher and hits harder, worked out from the crowd', () => {
  const spec = composeMass({mode: 'boss', seed: 'giant', teams: [{roster: {kind: 'species', list: ['Mewtwo']}}, {roster: {kind: 'starters'}}]});
  const giant = spec.teams[0].units[0];
  assert.ok(giant.boss.hp > 1 && giant.boss.size >= 2 && giant.boss.power >= 1.5, JSON.stringify(giant.boss));
  const b = new MassBattle(spec);
  const g = b.units[0];
  const crowd = b.units[1];
  assert.ok(g.maxhp > crowd.maxhp * 4);
  assert.ok(g.r > crowd.r * 1.8);
  const end = massRun(spec);
  assert.ok(end.ended);
  assert.throws(() => composeMass({mode: 'boss', teams: [{roster: {kind: 'starters'}}]}), /at least one team against them/);
});

test('limits and the field', () => {
  assert.deepEqual(massArena(10), massArena(40));
  assert.ok(massArena(300).w > massArena(40).w);
  // the whole National Dex fits; twice over does not
  assert.equal(composeMass({mode: 'ffa', teams: [{roster: {kind: 'dex', gens: [1, 2, 3, 4, 5, 6, 7, 8, 9]}}]}).teams[0].units.length, 1025);
  const all = {kind: 'dex', gens: [1, 2, 3, 4, 5, 6, 7, 8, 9]};
  assert.throws(() => composeMass({mode: 'teams', teams: [{roster: all}, {roster: all}]}), new RegExp(`At most ${MASS_MAX_UNITS}`));
  assert.throws(() => new MassBattle({mode: 'teams', teams: [{units: [{set: autoSet('Pikachu')}]}]}), /at least two sides/);
});

test('engine commands: mass_compose, mass_run', async () => {
  const spec = (await handle({id: 1, cmd: 'mass_compose', args: {mode: 'ffa', seed: 'cmd', level: 30, teams: [{roster: {kind: 'species', list: ['Pikachu', 'Eevee', 'Snorlax']}}]}})).result;
  assert.equal(spec.level_rules.level, 30);
  const out = (await handle({id: 2, cmd: 'mass_run', args: {spec}})).result;
  assert.ok(out.summary.ended && out.hash);
  assert.equal(out.hash, massRun(spec).hash());
  // a played battle comes with the person's log
  const rows = [[1, 0, 1000, -1, 0, 0, 0], [40, 0, 0, 0, 500, 500, 0]];
  const played = (await handle({id: 3, cmd: 'mass_run', args: {spec: {...spec, player: {unit: 1}}, inputs: rows}})).result;
  assert.equal(played.summary.player.i, 1);
  assert.equal(played.hash, massRun({...spec, player: {unit: 1}}, {inputs: rows}).hash());
});

test('a person plays one Pokémon: it goes where the stick points, fires at the aim point, rolls out of harm, and replays the same', () => {
  const spec = composeMass({mode: 'boss', seed: 'played', teams: [{roster: {kind: 'species', list: ['Mewtwo']}}, {roster: {kind: 'starters'}}]});
  // without a person the battle is the one it always was (these fingerprints come from before people could play)
  assert.equal(massRun(composeMass({mode: 'ffa', seed: 'royale', teams: [{roster: {kind: 'starters'}}]})).hash(), '1b78fi5');
  assert.equal(massRun(composeMass({mode: 'teams', seed: 'armies', teams: [{roster: {kind: 'top', gens: [1], count: 10}}, {roster: {kind: 'top', gens: [2], count: 10}}]})).hash(), '9rggu');
  assert.throws(() => new MassBattle({...spec, player: {unit: 99}}), /not in this battle/);
  const played = {...spec, player: {unit: 5}};
  const live = new MassBattle(played);
  const me = live.units[5];
  const x0 = me.x;
  // walk right for a second: a controlled Pokémon does not wander off after foes on its own
  live.input([1, 1000, 0, -1, 0, 0, 0]);
  for (let i = 0; i < 30; i++) live.step();
  assert.ok(me.x > x0 + 1.5, `${me.x} vs ${x0}`);
  // stop, then fire the first move at the giant
  const g = live.units[0];
  live.input([live.t + 1, 0, 0, 0, Math.round(g.x * 100), Math.round(g.y * 100), 0]);
  live.step();
  assert.ok(me.act && me.act.slot === 0 && Math.abs(me.act.tx - Math.round(g.x * 100) / 100) < 1e-9, JSON.stringify(me.act));
  for (let i = 0; i < 40; i++) live.step();
  assert.ok(!me.fainted && !me.act);
  // roll: a dash nothing can hit
  live.input([live.t + 1, 0, -1000, -1, 0, 0, 1]);
  live.step();
  assert.ok(me.inv > live.t && me.rollUntil > live.t);
  const before = me.hp;
  live.hit(g, me, g.moves[0]);
  assert.equal(me.hp, before);
  assert.equal(live.events.at(-1).k, 'dodge');
  // a row for a tick already gone is refused (the log only moves forward)
  assert.equal(live.input([1, 0, 0, -1, 0, 0, 0]), false);
  while (!live.ended) live.step();
  const s = live.summary();
  assert.equal(s.player.i, 5);
  assert.equal(s.player.inputs, 3);
  // the log is the whole battle: replaying it gives the same fingerprint
  const again = massRun(played, {inputs: live.inputs});
  assert.equal(again.hash(), live.hash());
  assert.deepEqual(again.summary().player, s.player);
  // and a different log gives a different battle
  assert.notEqual(massRun(played, {inputs: live.inputs.slice(0, 1)}).hash(), live.hash());
});
