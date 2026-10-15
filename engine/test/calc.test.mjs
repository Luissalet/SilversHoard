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

test('moves are measured as used: Mega Evolution, type-changing abilities, Weather Ball and the abilities\' own weather', () => {
  const alt = 'Altaria @ Altarianite\nAbility: Natural Cure\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Double-Edge';
  const plain = damageCalc({attacker: alt, defender: 'Gyarados\nLevel: 50\n- Waterfall', format: 'gen9nationaldexag'});
  const mega = damageCalc({attacker: alt, defender: 'Gyarados\nLevel: 50\n- Waterfall', format: 'gen9nationaldexag', attacker_mega: true});
  assert.equal(mega.attacker.species, 'Altaria-Mega');
  assert.equal(mega.moves[0].type, 'Fairy');   // Pixilate
  assert.ok(mega.moves[0].max > plain.moves[0].max * 2);
  const peli = 'Pelipper\nAbility: Drizzle\n- Weather Ball';
  const auto = damageCalc({attacker: peli, defender: 'Charizard\n- Ember'});
  assert.equal(auto.field.weather, 'raindance');   // Drizzle on switch-in
  assert.equal(auto.moves[0].type, 'Water');
  const none = damageCalc({attacker: peli, defender: 'Charizard\n- Ember', weather: ''});
  assert.equal(none.moves[0].type, 'Normal');
});

test('a defender given as just a species works', () => {
  const r = damageCalc({attacker: CHOMP, defender: {species: 'Gyarados', level: 50}});
  assert.equal(r.defender.species, 'Gyarados');
  assert.ok(r.moves.find((m) => m.id === 'outrage').max > 0);
});

test('gen 1 and 2 enumerate the 39 damage factors, not the modern 16', () => {
  // fresh sets each call: the old probe reused one object the simulator mutates between generations
  for (const gen of [1, 2]) {
    const m = damageCalc({
      attacker: {species: 'Snorlax', level: 100, moves: ['Body Slam']},
      defender: {species: 'Chansey', level: 100, moves: ['Splash']},
      format: `gen${gen}customgame`,
    }).moves[0];
    assert.equal(m.rolls.length, 39);
    assert.equal(m.min, 518);
    assert.equal(m.max, 609);
    assert.equal(m.roll_space, 39);
  }
  const g9 = damageCalc({
    attacker: {species: 'Snorlax', level: 100, moves: ['Body Slam']},
    defender: {species: 'Chansey', level: 100, moves: ['Splash']},
    format: 'gen9customgame',
  }).moves[0];
  assert.equal(g9.rolls.length, 16);
  assert.ok(Math.abs(g9.min / g9.max - 0.85) < 0.01);
});

test('multi-hit moves use every hit count and independent rolls, Skill Link always maxes', () => {
  const def = {species: 'Dragonite', ability: 'Inner Focus', moves: ['Splash']};
  const plain = damageCalc({
    attacker: {species: 'Cloyster', ability: 'Shell Armor', moves: ['Icicle Spear']}, defender: def,
  }).moves[0];
  assert.equal(plain.hits_min, 2);
  assert.equal(plain.hits_max, 5);
  assert.equal(plain.rolls.length, 16);
  assert.equal(plain.min, 224);   // 2 × 112
  assert.equal(plain.max, 680);   // 5 × 136
  assert.ok(plain.ohko_chance > 0, 'five strong rolls can KO 323 HP');
  assert.ok(plain.ohko_chance < 1);
  const linked = damageCalc({
    attacker: {species: 'Cloyster', ability: 'Skill Link', moves: ['Icicle Spear']}, defender: def,
  }).moves[0];
  assert.equal(linked.hits_min, 5);
  assert.equal(linked.hits_max, 5);
  assert.equal(linked.min, 560);
  assert.equal(linked.max, 680);
});
