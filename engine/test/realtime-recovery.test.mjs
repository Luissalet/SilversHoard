import assert from 'node:assert/strict';
import test from 'node:test';
import {importTeam} from '../src/core.mjs';
import {ATTACK_RECOVERY, RtBattle, TPS, ULT_MAX, ULT_SLOT, rtRun} from '../src/realtime/sim.mjs';

const team = () => importTeam('Tyranitar\nAbility: Unnerve\n- Crunch\n- Earthquake\n- Stone Edge\n- Protect\n\nBlissey\n- Soft-Boiled');
const spec = (version = 8, doubles = false, ai = null) => ({version, seed: 'attack-recovery', arena: 'open',
  format: doubles ? 'gen9doublescustomgame' : 'gen9customgame', time_limit: 60,
  p1: {name: 'A', sets: team(), ai}, p2: {name: 'B', sets: importTeam('Blissey\n- Soft-Boiled\n\nChansey\n- Soft-Boiled'), ai: null}});

test('Crunch, Earthquake and Stone Edge share a recovery without replacing their individual cooldowns', () => {
  const b = new RtBattle(spec()), side = b.sides[0], m = b.mon(side);
  b.t = 100;
  b.finishMove(side, 0);
  assert.equal(b.usable(side, 1), 'cooldown');
  assert.equal(b.tryUse(side, 1), false);
  assert.equal(b.tryUse(side, 2), false);
  const own = m.cds[0];
  const view = b.view().sides[0].mons[0];
  assert.equal(view.moves[1].cd, ATTACK_RECOVERY / TPS);
  assert.equal(view.moves[2].cd, ATTACK_RECOVERY / TPS);
  assert.equal(m.cds[1], 0, 'the second move still has its own unused cooldown');
  b.t += ATTACK_RECOVERY - 1;
  assert.equal(b.usable(side, 2), 'cooldown');
  b.t++;
  assert.equal(b.usable(side, 2), '');
  assert.equal(b.usable(side, 0), 'cooldown');
  assert.equal(m.cds[0], own);
});

test('the special attack cannot bypass recovery and also starts shared recovery', () => {
  const b = new RtBattle(spec()), side = b.sides[0];
  side.ult = ULT_MAX;
  b.finishMove(side, 0);
  assert.equal(b.ultReady(side), false);
  assert.equal(b.tryUlt(side), false);
  b.t += ATTACK_RECOVERY;
  assert.equal(b.tryUlt(side), true);
  b.finishMove(side, ULT_SLOT);
  assert.equal(b.usable(side, 1), 'cooldown');
});

test('recovery belongs to the Pokémon, so doubles partners remain independent', () => {
  const b = new RtBattle(spec(8, true)), [a, partner] = b.sides[0].units;
  b.finishMove(a, 0);
  assert.equal(b.usable(a, 1), 'cooldown');
  assert.equal(b.usable(partner, 0), '');
  assert.equal(b.mon(partner).attackReady, undefined);
});

test('switching does not erase the outgoing Pokémon recovery or impose it on a fresh teammate', () => {
  const b = new RtBattle(spec()), side = b.sides[0];
  b.finishMove(side, 0);
  b.sendOut(side, 1);
  assert.equal(b.usable(side, 0), '');
  b.sendOut(side, 0);
  assert.equal(b.usable(side, 1), 'cooldown');
});

test('spamming different human inputs cannot start another move during recovery', () => {
  const b = new RtBattle(spec()), side = b.sides[0];
  b.finishMove(side, 0);
  for (let i = 0; i < ATTACK_RECOVERY - 1; i++) b.step({p1: {use: 1 + i % 2, focus: false}});
  assert.equal(b.events.filter(e => e.k === 'windup').length, 0);
  b.step({p1: {use: 2, focus: false}});
  assert.equal(b.events.filter(e => e.k === 'windup').length, 1);
});

test('AI attacks obey the same minimum separation', () => {
  const b = rtRun(spec(8, false, {level: 'expert', style: 'aggressive'}));
  const moves = b.events.filter(e => e.k === 'use' && e.s === 0);
  assert.ok(moves.length > 2);
  for (let i = 1; i < moves.length; i++) assert.ok(moves[i].t - moves[i - 1].t >= ATTACK_RECOVERY);
});

test('versions 1–7 keep the old move availability and do not gain new recovery state', () => {
  for (let version = 1; version <= 7; version++) {
    const b = new RtBattle(spec(version)), side = b.sides[0], m = b.mon(side);
    b.finishMove(side, 0);
    assert.equal(m.attackReady, undefined);
    assert.equal(b.usable(side, 1), '');
    assert.equal(b.view().sides[0].mons[0].moves[1].cd, 0);
    if (version >= 5) { side.ult = ULT_MAX; assert.equal(b.ultReady(side), true); }
  }
});
