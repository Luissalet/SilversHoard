// The real-time part of the playable page's result code: the input log packs into a short text and unpacks to the same battle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {importTeam, randomTeam} from '../src/core.mjs';
import {RtBattle, rtRun, TPS} from '../src/realtime/sim.mjs';
import {flatRtInputs, newSeed, packRtInputs, unpackRtInputs} from '../../client/src/play/rtcode.js';

const TEAM = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Swords Dance\n- Stone Edge\n\n' +
  'Rotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect\n';

function play(spec, analog = false) {
  const b = new RtBattle(spec);
  let tick = 0;
  while (!b.ended && tick < 120 * TPS) {
    tick++;
    const me = b.sides[0];
    const foe = b.sides[1];
    const a = tick / 17;
    // a keyboard (eight directions, taps) or a stick (any angle, every few ticks); lock-on toggles, a Plus move now and then
    const mx = analog ? Math.round(Math.cos(a) * 100) / 100 : Math.sign(foe.x - me.x);
    const my = analog ? Math.round(Math.sin(a * 1.3) * 100) / 100 : Math.sign(foe.y - me.y) * 0.5;
    const input = {mx, my, use: tick % 11 === 0 ? (tick / 11) % 4 : -1, dodge: tick % 170 === 0, sw: me.need ? me.mons.findIndex((m) => !m.fainted) : -1,
      focus: tick % 90 < 60, plus: tick % 330 === 0, mega: tick === 600};
    b.step({p1: input});
  }
  return b;
}

test('the log packs into text and unpacks to the same rows, keyboard and stick', async () => {
  for (const analog of [false, true]) {
    const spec = {seed: `pc-${analog}`, format: 'gen9customgame', time_limit: 90, version: 2, arena: 'rocks', p1: {name: 'Me', sets: importTeam(TEAM), ai: null},
      p2: {name: 'AI', sets: randomTeam('gen9randombattle', 'pc').sets, ai: {level: 'hard', style: 'balanced'}}};
    const b = play(spec, analog);
    assert.ok(b.ended && b.inputLog.length > 50);
    const packed = await packRtInputs(b.inputLog);
    assert.match(packed, /^[A-Za-z0-9_-]+$/);
    assert.ok(flatRtInputs(b.inputLog).every(Number.isInteger));
    const rows = await unpackRtInputs(packed);
    assert.deepEqual(rows, b.inputLog.map((r) => [r[0], 0, r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]]));
    // replaying the unpacked rows is the battle that was played
    const again = rtRun(spec, {inputs: rows});
    assert.deepEqual(again.summary(), b.summary());
    assert.equal(again.t, b.t);
    console.log(`${analog ? 'stick' : 'keyboard'}: ${b.inputLog.length} rows over ${(b.t / TPS).toFixed(0)} s -> ${packed.length} characters`);
  }
});

test('rows recorded before focus, Plus and Mega existed read as focused, no Plus, no Mega', async () => {
  const rows = [[5, 0, 1, 0, -1, 0, -1], [9, 0, 0, 0, 2, 0, -1, 0]];
  const back = await unpackRtInputs(await packRtInputs(rows));
  assert.deepEqual(back, [[5, 0, 1, 0, -1, 0, -1, 1, 0, 0], [9, 0, 0, 0, 2, 0, -1, 0, 0, 0]]);
});

test('seeds are short and different', () => {
  const a = newSeed();
  assert.notEqual(a, newSeed());
  assert.ok(a.length <= 24 && /^pg-[0-9a-f]{16}$/.test(a));
});

test('doubles rows keep the controlled slot and the locked foe', async () => {
  const rows = [[5, 0, 0.5, -1, -1, 0, -1, 1, 0, 0, 1, 0], [9, 0, 0, 0, 2, 0, -1, 1, 1, 0, 0, 1]];
  const back = await unpackRtInputs(await packRtInputs(rows));
  assert.deepEqual(back, rows);
});
