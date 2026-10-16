// Mass battles (mass.mjs, mass-roster.mjs): rosters by generation and group with sets worked out from what each Pokémon learns,
// the three modes, the giants of "many against a few", the same battle every time from the same spec, a Pokémon played by a person
// (its input log replays to the same battle) and the engine's commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MASS_MAX_UNITS, MASS_VERSION, MassBattle, TPS, massArena, massRun} from '../src/realtime/mass.mjs';
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
  // without a person the battle is the one it always was (these fingerprints come from before people could play): rules version 1,
  // which is what a spec saved without a version plays by; version 2 (waves, no cap on area moves) and 3 (a wave spreads only over
  // several foes) have their own
  const royale = composeMass({mode: 'ffa', seed: 'royale', teams: [{roster: {kind: 'starters'}}]});
  const armies = composeMass({mode: 'teams', seed: 'armies', teams: [{roster: {kind: 'top', gens: [1], count: 10}}, {roster: {kind: 'top', gens: [2], count: 10}}]});
  assert.equal(royale.version, MASS_VERSION);
  assert.equal(massRun({...royale, version: 1}).hash(), '1b78fi5');
  assert.equal(massRun({...armies, version: 1}).hash(), '9rggu');
  const {version: _drop, ...unversioned} = royale;
  assert.equal(massRun(unversioned).hash(), '1b78fi5');
  assert.equal(massRun({...royale, version: 2}).hash(), 'obz398');
  assert.equal(massRun({...armies, version: 2}).hash(), 'r26z05');
  assert.equal(massRun(royale).hash(), '4elwde');
  assert.equal(massRun(armies).hash(), '6vhk86');
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

test('Surf rolls out as a wave: every foe within its reach takes it, the near ones first (rules version 2); version 1 keeps its burst', () => {
  // one Blastoise with only Surf in the middle of fourteen Magikarp: twelve on a spiral from 1.5 to 6.6 m, two beyond its reach
  const crowd = Array.from({length: 14}, () => ({set: {species: 'Magikarp', level: 100, moves: ['Splash']}}));
  const spec = {seed: 'surf', mode: 'teams', teams: [{name: 'A', units: [{set: {species: 'Blastoise', level: 100, moves: ['Surf']}}]}, {name: 'B', units: crowd}]};
  const place = (b) => {
    const c = b.units[0];
    c.x = b.arena.w / 2; c.y = b.arena.h / 2;
    b.units.slice(1).forEach((o, k) => {
      const d = k < 12 ? 1.5 + k * 0.45 : 8.5 + k;
      const a = k * 2.4;
      o.x = c.x + Math.cos(a) * d; o.y = c.y + Math.sin(a) * d * 0.55;
    });
    return c;
  };
  const surf = (version) => {
    const b = new MassBattle({...spec, version});
    const c = place(b);
    const far = b.units[1];
    b.rebuildGrid();
    c.act = {slot: 0, release: b.t, target: far.i, tx: far.x, ty: far.y};
    b.release(c);
    for (let i = 0; i < 2 * TPS; i++) { b.t++; b.rebuildGrid(); b.updateWaves(); }
    const hits = b.events.filter((e) => e.k === 'hit' && e.by === 0);
    return {b, c, hits};
  };
  const v2 = surf(2);
  const dist = (o) => Math.sqrt(v2.b.dist2(v2.c, o)) - o.r;
  const wave = v2.b.events.find((e) => e.k === 'wave');
  assert.ok(wave && wave.id === 'surf' && wave.r > 6.5, JSON.stringify(wave));
  const reached = v2.b.units.slice(1).filter((o) => dist(o) <= wave.r).map((o) => o.i);
  assert.equal(reached.length, 12);
  assert.deepEqual(v2.hits.map((e) => e.u).sort((a, b) => a - b), reached);
  // the front gets to the far ones later: hit ticks never go back as the distance grows
  const order = v2.hits.map((e) => ({t: e.t, d: dist(v2.b.units[e.u])})).sort((a, b) => a.d - b.d);
  for (let i = 1; i < order.length; i++) assert.ok(order[i].t >= order[i - 1].t, JSON.stringify(order));
  assert.ok(order.at(-1).t > order[0].t);
  // version 1: at once, within 3.4 m, eight at most
  const v1 = surf(1);
  assert.ok(!v1.b.events.some((e) => e.k === 'wave') && v1.b.events.some((e) => e.k === 'burst'));
  assert.ok(v1.hits.length <= 8 && v1.hits.length >= 3, String(v1.hits.length));
  assert.ok(new Set(v1.hits.map((e) => e.t)).size === 1);
});

test('a wave is a spread move only with more than one foe in its reach (rules version 3); version 2 keeps three quarters', () => {
  const lone = (version, foes = 1) => {
    const units = Array.from({length: foes}, () => ({set: {species: 'Snorlax', level: 100, moves: ['Splash']}}));
    const b = new MassBattle({seed: 'lone', mode: 'teams', version, teams: [{name: 'A', units: [{set: {species: 'Blastoise', level: 100, moves: ['Surf']}}]}, {name: 'B', units}]});
    const c = b.units[0];
    c.x = b.arena.w / 2; c.y = b.arena.h / 2;
    b.units.slice(1).forEach((o, k) => { o.x = c.x + 2 + k * 0.4; o.y = c.y + (k % 2 ? 1 : -1) * k * 0.3; });
    b.rebuildGrid();
    c.act = {slot: 0, release: b.t, target: 1, tx: b.units[1].x, ty: b.units[1].y};
    b.release(c);
    for (let i = 0; i < 2 * TPS; i++) { b.t++; b.rebuildGrid(); b.updateWaves(); }
    return b.events.filter((e) => e.k === 'hit' && e.by === 0).map((e) => e.dmg);
  };
  const [v3] = lone(3);
  const [v2] = lone(2);
  assert.ok(v3 > v2, `${v3} vs ${v2}`);
  assert.ok(v2 / v3 > 0.7 && v2 / v3 < 0.8, `${v2} / ${v3}`);
  // two foes in reach: both versions spread it the same
  assert.deepEqual(lone(3, 2), lone(2, 2));
});

test('a dash leaves its mark just ahead of the Pokémon however long the dash was', async () => {
  const {Vfx} = await import('../../client/src/battle/rt/vfx.js');
  const v = new Vfx({});
  v.meleeAt('extremespeed', 'Normal', 10, 5, 3.132, 0, {dash: true});
  v.meleeAt('extremespeed', 'Normal', 10, 5, 0.6, 0.8, {dash: true});
  const [a, b] = v.fx;
  assert.ok(Math.abs(a.x - 11.2) < 1e-9 && a.y === 5 && a.fx === 1, JSON.stringify(a));
  assert.ok(Math.abs(b.x - 10.72) < 1e-9 && Math.abs(b.y - 5.96) < 1e-9, JSON.stringify(b));
});
