// The damage calculator: the simulator's own numbers over the 16 rolls, with immunities, boosts, screens, weather and HP left.
import test from 'node:test';
import assert from 'node:assert/strict';
import {damageCalc} from '../src/calc.mjs';
import {handle} from '../src/server.mjs';

const CHOMP = 'Garchomp @ Choice Band\nAbility: Rough Skin\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Swords Dance';
const TRAN = 'Heatran @ Leftovers\nAbility: Flash Fire\nEVs: 252 HP / 4 SpA / 252 SpD\nCalm Nature\n- Magma Storm';
const ROTOM = 'Rotom-Wash\nAbility: Levitate\nEVs: 252 HP / 252 Def\nBold Nature\n- Hydro Pump';

test('16 rolls from 85 % to 100 %, critical hits and knockouts', () => {
  const r = damageCalc({attacker: CHOMP, defender: TRAN});
  const eq = r.moves.find((m) => m.id === 'earthquake');
  assert.equal(eq.rolls.length, 16);
  assert.equal(eq.max, 1104);   // (42 * 100 * 538 / 248 / 50 + 2) * 1.5 STAB * 4 against Fire/Steel
  assert.ok(Math.abs(eq.min / eq.max - 0.85) < 0.01);
  assert.ok(eq.crit_max > eq.max);
  assert.equal(eq.ohko_rolls, 16);
  assert.deepEqual(eq.ko, {hits: 1, hits_sure: 1});
  const outrage = r.moves.find((m) => m.id === 'outrage');
  assert.ok(outrage.max < eq.max / 4, 'Steel resists Dragon');
  assert.equal(r.moves.find((m) => m.id === 'swordsdance').max, 0);
});

test('immunity, boosts, screens, weather and HP left change the numbers', () => {
  const plain = damageCalc({attacker: CHOMP, defender: ROTOM});
  assert.equal(plain.moves[0].max, 0);
  assert.equal(plain.moves[0].immune, true);   // Levitate
  const o1 = plain.moves.find((m) => m.id === 'outrage').max;
  const boosted = damageCalc({attacker: CHOMP, defender: ROTOM, attacker_boosts: {atk: 2}}).moves.find((m) => m.id === 'outrage').max;
  assert.ok(boosted > o1 * 1.9);
  const screened = damageCalc({attacker: CHOMP, defender: ROTOM, screens: ['reflect']}).moves.find((m) => m.id === 'outrage').max;
  assert.ok(screened < o1 * 0.6);
  const rain = damageCalc({attacker: ROTOM, defender: TRAN, weather: 'rain'});
  const dry = damageCalc({attacker: ROTOM, defender: TRAN, weather: ''});
  assert.ok(rain.moves[0].max > dry.moves[0].max * 1.4);
  assert.equal(rain.field.weather, 'raindance');
  const half = damageCalc({attacker: CHOMP, defender: ROTOM, defender_hp: 50});
  assert.equal(half.defender_hp, Math.round(half.defender.maxhp / 2));
});

test('the engine answers damage_calc and older generations use their own rules', async () => {
  const r = await handle({id: 1, cmd: 'damage_calc', args: {attacker: CHOMP, defender: TRAN, format: 'gen4ou', moves: ['earthquake']}});
  assert.equal(r.ok, true);
  assert.equal(r.result.format, 'gen4customgame');
  assert.equal(r.result.moves.length, 1);
  const bad = await handle({id: 2, cmd: 'damage_calc', args: {attacker: '', defender: TRAN}});
  assert.equal(bad.ok, false);
});
