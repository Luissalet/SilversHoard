import test from 'node:test';
import assert from 'node:assert/strict';
import {teamAnalysis} from '../src/team-analysis.mjs';
import {handle} from '../src/server.mjs';

const member = (species, moves = ['Tackle'], extra = {}) => ({species, moves, ...extra});
const analyse = (team, format = 'gen9customgame', extra = {}) => teamAnalysis({team, format, ...extra});

test('dual-type weaknesses multiply, immunities win over weaknesses, shared counts identify the actual members', () => {
  const r = analyse([member('Charizard', ['Flamethrower']), member('Gyarados', ['Waterfall']), member('Gliscor')]);
  assert.equal(r.members[0].defence.Rock, 4);
  assert.equal(r.members[1].defence.Electric, 4);
  assert.equal(r.members[2].defence.Electric, 0);
  assert.equal(r.members[0].defence.Ground, 0);
  assert.equal(r.members[0].defence.Grass, 0.25);
  assert.deepEqual(r.shared_weaknesses.find((row) => row.type === 'Rock').weak, [0, 1]);
  assert.deepEqual(r.defence.find((row) => row.type === 'Ground').immune, [0, 1, 2]);
});

test('generation-specific species types and historical charts remain distinct', () => {
  const r1 = analyse([member('Clefable'), member('Magnemite', ['Thunderbolt']), member('Alakazam', ['Psychic'])], 'gen1customgame');
  assert.equal(r1.types.length, 15);
  assert.ok(!r1.types.includes('Fairy') && !r1.types.includes('Dark') && !r1.types.includes('Steel'));
  assert.deepEqual(r1.members[0].types, ['Normal']);
  assert.equal(r1.members[2].defence.Ghost, 0);
  const r5 = analyse([member('Metagross', ['Psychic'])], 'gen5customgame');
  const r6 = analyse([member('Metagross', ['Psychic'])], 'gen6customgame');
  assert.equal(r5.members[0].defence.Ghost, 1);
  assert.equal(r6.members[0].defence.Ghost, 2);
  assert.equal(r5.types.length, 17);
  assert.equal(r6.types.length, 18);
});

test('coverage counts members rather than duplicate moves, and never treats status as damage', () => {
  const r = analyse([member('Charizard', ['Flamethrower', 'Fire Blast', 'Roost']), member('Blastoise', ['Surf']), member('Mew', ['Toxic'])]);
  assert.deepEqual(r.coverage.find((row) => row.type === 'Grass').super_effective, [0]);
  assert.equal(r.coverage.find((row) => row.type === 'Grass').moves.length, 2);
  assert.equal(r.members[2].coverage.Grass, null);
  assert.equal(r.members[0].coverage.Water, 0.5);
  assert.ok(r.uncovered_types.includes('Dragon'));
  assert.ok(!r.uncovered_types.includes('Rock'));
});

test('fixed damage, context-dependent types and special effectiveness are disclosed and excluded', () => {
  const r = analyse([member('Mew', ['Seismic Toss', 'Weather Ball', 'Freeze-Dry', 'Thunderbolt'])]);
  assert.deepEqual(r.members[0].attacks.map((m) => m.id), ['thunderbolt']);
  assert.deepEqual(r.members[0].excluded_moves.map((m) => m.reason), ['fixed_damage', 'variable_type', 'special_effectiveness']);
  assert.equal(r.members[0].coverage.Ground, 0);
  const hp = analyse([member('Mew', ['Hidden Power Ice', 'Struggle'])], 'gen7customgame');
  assert.equal(hp.members[0].attacks.length, 0);
  assert.deepEqual(hp.members[0].excluded_moves.map((m) => m.reason), ['variable_type', 'special_effectiveness']);
});

test('abilities, items and Tera do not alter explicitly type-only defence or base Speed', () => {
  const r = analyse([member('Rotom-Wash', ['Hydro Pump'], {ability: 'Levitate', item: 'Choice Scarf', teraType: 'Grass'})]);
  assert.equal(r.members[0].defence.Ground, 2);
  assert.equal(r.members[0].speed, 208);
  assert.equal(r.basis.abilities, false);
  assert.equal(r.basis.items, false);
  assert.equal(r.basis.tera, false);
});

test('Speed uses actual nature and EVs, level rules, stable ties, and historical DVs without nature', () => {
  const team = [member('Garchomp', ['Earthquake'], {nature: 'Jolly', evs: {spe: 252}, level: 100}),
    member('Pikachu', ['Thunderbolt'], {nature: 'Timid', evs: {spe: 252}, level: 100}), member('Pikachu', ['Quick Attack'], {nature: 'Timid', evs: {spe: 252}, level: 100})];
  const r = analyse(team, 'gen9customgame', {level_rules: {level: 50}});
  assert.equal(r.members[0].speed, 169);
  assert.equal(r.members[1].speed, 156);
  assert.deepEqual(r.speed_order, [0, 1, 2]);
  assert.equal(analyse([team[1]], 'gen1customgame').members[0].speed, 305);
  assert.equal(analyse([team[1]], 'gen9customgame').members[0].speed, 306);
});

test('empty moves remain useful for drafting, without a synthetic Splash leaking into coverage', () => {
  const r = analyse([member('Snorlax', [])]);
  assert.equal(r.members[0].speed, 96);
  assert.equal(r.members[0].attacks.length, 0);
  assert.equal(r.members[0].excluded_moves.length, 0);
  assert.equal(r.uncovered_types.length, 18);
});

test('unknown species and moves, future generations, invalid formats and oversized teams return errors', () => {
  assert.throws(() => analyse([member('Missing Pokémon')]), /No Missing/);
  assert.throws(() => analyse([member('Clefable', ['Moonblast'])], 'gen1customgame'), /No move Moonblast/);
  assert.throws(() => analyse([member('Garchomp')], 'gen1customgame'), /No Garchomp/);
  assert.throws(() => analyse([member('Mew', ['Invented Attack'])]), /No move Invented/);
  assert.throws(() => analyse([member('Mew')], 'noformat'), /not valid|Unknown format/);
  assert.throws(() => analyse(Array.from({length: 7}, () => member('Mew'))), /one and six/);
  assert.throws(() => analyse([]), /one and six/);
});

test('native dispatcher supports paste and complete output without changing the input or choosing random teams', async () => {
  const args = {format: 'gen9randombattle', paste: 'Charizard\n- Flamethrower'};
  const before = JSON.stringify(args);
  const r = await handle({id: 9, cmd: 'team_analysis', args});
  assert.equal(r.ok, true);
  assert.equal(r.result.members.length, 1);
  assert.equal(r.result.members[0].species, 'Charizard');
  assert.equal(JSON.stringify(args), before);
  const direct = {team: [member('Mew', ['Psychic'])], format: 'gen9customgame'};
  const saved = structuredClone(direct);
  assert.deepEqual(teamAnalysis(direct), teamAnalysis(direct));
  assert.deepEqual(direct, saved);
});
