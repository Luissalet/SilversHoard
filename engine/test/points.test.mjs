import test from 'node:test';
import assert from 'node:assert/strict';
import {SP_MAX, SP_TOTAL, calcStat, evFromSp, evsFromPoints, pointsFromEvs, spFromEv} from '../src/points.mjs';

test('stat points convert to EVs and back like HOME does', () => {
  assert.equal(evFromSp(0), 0);
  assert.equal(evFromSp(1), 4);
  assert.equal(evFromSp(2), 12);
  assert.equal(evFromSp(32), 252);
  assert.equal(spFromEv(252), 32);
  assert.equal(spFromEv(508), 32);
  assert.equal(spFromEv(3), 0);
  for (let s = 0; s <= SP_MAX; s++) assert.equal(spFromEv(evFromSp(s)), s);
  assert.deepEqual(pointsFromEvs({hp: 4, atk: 252, spe: 252}), {points: {hp: 1, atk: 32, def: 0, spa: 0, spd: 0, spe: 32}, total: 65});
});

test('a spread keeps the 66 / 32 limits', () => {
  assert.deepEqual(evsFromPoints({atk: 32, spe: 32, hp: 2}), {hp: 12, atk: 252, def: 0, spa: 0, spd: 0, spe: 252});
  assert.throws(() => evsFromPoints({atk: 33}), /32/);
  assert.throws(() => evsFromPoints({hp: 32, atk: 32, def: 3}), new RegExp(String(SP_TOTAL)));
  assert.deepEqual(evsFromPoints({hp: 32, atk: 32, def: 10}, {clamp: true}).def, evFromSp(2));
});

test('each point is one more stat point at level 50', () => {
  // Garchomp: base Attack 130
  const at = (sp) => calcStat('atk', 130, {level: 50, ev: evFromSp(sp)});
  assert.equal(at(0), 150);
  for (let s = 1; s <= SP_MAX; s++) assert.equal(at(s) - at(s - 1), 1);
  assert.equal(calcStat('hp', 108, {level: 50, ev: evFromSp(32)}), 215);
  assert.equal(calcStat('hp', 1, {level: 50}), 1);
  assert.equal(calcStat('spe', 102, {level: 50, ev: 252, nature: 1.1}), 169);
});
