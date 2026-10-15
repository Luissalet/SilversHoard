// Real-time mode (Legends: Z-A rules): cooldowns instead of PP, deterministic battles, replays from inputs, the AI in every level.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Dex} from '@pkmn/sim';
import {importTeam, randomTeam} from '../src/core.mjs';
import {baseCooldown, cooldownTable, derivedCooldown, finalCooldown, rtMove, TPS} from '../src/realtime/moves.mjs';
import {ZA_COOLDOWN} from '../src/realtime/za-data.mjs';
import {RtBattle, eventLines, prepareRtTeam, rtRun} from '../src/realtime/sim.mjs';
import {handle} from '../src/server.mjs';

const TEAM = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Swords Dance\n- Stone Edge\n\n' +
  'Rotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect\n';

test('cooldowns: Legends Z-A table, Speed rule, priority, derived values', () => {
  assert.equal(baseCooldown(Dex.moves.get('tackle')), 4);
  assert.equal(baseCooldown(Dex.moves.get('hyperbeam')), 20);
  assert.equal(baseCooldown(Dex.moves.get('swordsdance')), 15);
  assert.equal(baseCooldown(Dex.moves.get('noretreat')), 60);
  // 3 s off per 100 Speed over 25, never under 3 s; priority moves always 3 s
  assert.equal(finalCooldown(20, 125), 17);
  assert.equal(finalCooldown(20, 25), 20);
  assert.equal(finalCooldown(4, 400), 3);
  assert.equal(Math.round(finalCooldown(20, 125, {mod: 1.5}) * 100) / 100, 15.14);
  assert.equal(finalCooldown(8, 300, {priority: 1}), 3);
  // moves Z-A does not have get a cooldown from PP and power, close to Z-A's own values
  assert.equal(rtMove('Flamethrower').za, true);
  assert.equal(rtMove('Moonblast').za, true);
  const missing = rtMove('Scald').za ? rtMove('Pound') : rtMove('Scald');
  assert.ok(missing.cooldown >= 3 && missing.cooldown <= 60);
  let err = 0;
  for (const [id, cd] of Object.entries(ZA_COOLDOWN)) err += Math.abs(derivedCooldown(Dex.moves.get(id)) - cd);
  assert.ok(err / Object.keys(ZA_COOLDOWN).length < 1.5, 'the PP-based rule stays close to Z-A');
  const table = cooldownTable(['Earthquake', 'Quick Attack', 'Nasty Plot'], {speed: 200});
  assert.deepEqual(table.map((r) => r.final), [4.8, 3, 9.8]);
  assert.equal(table[1].windup_s, 0);
});

test('teams: real stats and cooldowns per Pokémon', () => {
  const [chomp] = prepareRtTeam(importTeam(TEAM), {format: 'gen9customgame', levelRules: {level: 50}});
  assert.equal(chomp.level, 50);
  assert.equal(chomp.stats.spe, 169);
  assert.equal(chomp.moves.length, 4);
  assert.equal(chomp.moves[0].cooldown, 10);
  assert.ok(chomp.moves[0].final < chomp.moves[0].cooldown, 'Speed and Choice Scarf shorten the cooldown');
});

test('AI vs AI: every level plays to the end, the same seed gives the same battle', () => {
  for (const level of ['random', 'easy', 'normal', 'hard', 'expert']) {
    const spec = {seed: `lv-${level}`, format: 'gen9customgame', p1: {name: 'A', sets: randomTeam('gen9randombattle', `a${level}`).sets, ai: {level, style: 'balanced'}},
      p2: {name: 'B', sets: randomTeam('gen9randombattle', `b${level}`).sets, ai: {level: 'normal', style: 'aggressive'}}};
    const one = rtRun(spec);
    const two = rtRun(spec);
    assert.ok(one.ended);
    assert.ok(['ko', 'time'].includes(one.reason));
    assert.deepEqual(one.summary(), two.summary());
    assert.equal(one.events.length, two.events.length);
    assert.ok(eventLines(one).length > 5);
  }
});

test('older generations and styles play in real time', () => {
  for (const [gen, style] of [[1, 'stall'], [3, 'setup'], [5, 'defensive'], [7, 'aggressive'], [8, 'balanced']]) {
    const b = rtRun({seed: `g${gen}`, format: `gen${gen}customgame`, time_limit: 120,
      p1: {name: 'A', sets: randomTeam(`gen${gen}randombattle`, `a${gen}`).sets, ai: {level: 'hard', style}},
      p2: {name: 'B', sets: randomTeam(`gen${gen}randombattle`, `b${gen}`).sets, ai: {level: 'normal', style: 'balanced'}}});
    assert.ok(b.ended, `gen ${gen}`);
  }
});

test('a person plays: inputs are recorded and the replay gives the same result', () => {
  const spec = {seed: 'human', format: 'gen9customgame', p1: {name: 'Me', sets: importTeam(TEAM), ai: null},
    p2: {name: 'AI', sets: randomTeam('gen9randombattle', 'foe').sets, ai: {level: 'normal', style: 'balanced'}}};
  const b = new RtBattle(spec);
  let tick = 0;
  while (!b.ended && tick < 200 * TPS) {
    tick++;
    // walk at the foe and use whatever is ready; roll every few seconds; switch once
    const me = b.sides[0];
    const foe = b.sides[1];
    const input = {mx: Math.sign(foe.x - me.x), my: Math.sign(foe.y - me.y) * 0.5, use: tick % 7 === 0 ? (tick / 7) % 4 : -1, dodge: tick % 150 === 0, sw: -1};
    if (tick === 300) input.sw = 1;
    if (me.need) input.sw = me.mons.findIndex((m) => !m.fainted);
    b.step({p1: input});
  }
  assert.ok(b.ended, 'the battle ends');
  assert.ok(b.inputLog.length > 10);
  assert.ok(b.events.some((e) => e.k === 'roll'));
  assert.ok(b.events.some((e) => e.k === 'recall'));
  const again = rtRun(spec, {inputs: b.inputLog});
  assert.deepEqual(again.summary(), b.summary());
});

test('rules: no accuracy, timed one-stage boosts, three switches, drowsiness doubles cooldowns', () => {
  const b = new RtBattle({seed: 'rules', format: 'gen9customgame', p1: {name: 'A', sets: importTeam(TEAM), ai: null},
    p2: {name: 'B', sets: importTeam('Snorlax @ Leftovers\n- Body Slam\n- Rest\n- Curse\n- Yawn\n\nBlissey\n- Soft-Boiled\n- Seismic Toss\n'), ai: null}});
  const [me, foe] = b.sides;
  b.boost(me, {atk: 2}, me, 'test');
  assert.equal(b.mon(me).boosts.atk, 1, 'one stage at most');
  for (let i = 0; i < 21 * TPS; i++) b.step({});
  assert.equal(b.mon(me).boosts.atk, 0, 'boosts wear off');
  b.setStatus(foe, 'slp', null);
  b.mon(foe).cds[0] = 2 * TPS;
  for (let i = 0; i < 2 * TPS; i++) b.step({});
  assert.ok(b.mon(foe).cds[0] >= TPS - 1, 'cooldowns run at half speed while drowsy');
  assert.equal(me.switchesLeft, 3);
  b.step({p1: {sw: 1}});
  assert.equal(me.switchesLeft, 2);
  for (let i = 0; i < TPS; i++) b.step({});
  assert.equal(me.active, 1);
});

test('engine commands for real time', async () => {
  const spec = {seed: 'cmd', format: 'gen9customgame', time_limit: 90, p1: {name: 'A', sets: importTeam(TEAM), ai: {level: 'hard'}},
    p2: {name: 'B', sets: randomTeam('gen9randombattle', 'cmd').sets, ai: {level: 'hard'}}};
  const check = await handle({id: 1, cmd: 'rt_check', args: {spec}});
  assert.equal(check.ok, true);
  assert.equal(check.result.view.sides[0].mons[0].species, 'Garchomp');
  const out = await handle({id: 2, cmd: 'rt_play_out', args: {spec}});
  assert.equal(out.ok, true);
  assert.equal(out.result.summary.mode, 'realtime');
  const cds = await handle({id: 3, cmd: 'rt_cooldowns', args: {moves: ['Tackle', 'Thunderbolt'], speed: 125}});
  assert.deepEqual(cds.result.moves.map((m) => m.final), [3, 5]);
  const bad = await handle({id: 4, cmd: 'rt_check', args: {spec: {...spec, p1: {name: 'A', sets: []}}}});
  assert.equal(bad.ok, false);
});

test('old replays: battles recorded before focus, rocks and Mega Evolution replay to the same result', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/rt-legacy-v1.json', import.meta.url), 'utf8'));
  assert.equal(fixture.battles.length, 4);
  for (const rec of fixture.battles) {
    const b = rtRun(rec.spec, {inputs: rec.inputs});
    assert.deepEqual(b.summary(), rec.summary, rec.name);
    assert.equal(b.t, rec.ticks, rec.name);
    assert.equal(b.events.length, rec.events, rec.name);
    assert.equal(createHash('sha256').update(JSON.stringify(b.events)).digest('hex'), rec.digest, `${rec.name}: the same events`);
  }
});
