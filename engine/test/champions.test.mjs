// Pokémon Champions: Showdown's champions mods registered on @pkmn/sim (champions.mjs), with their formats, stat points as the
// EVs field, the 20 PP cap and full battles in singles and doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Dex} from '@pkmn/sim';
import {completeSets, formatInfo, importTeam, listFormats, validateTeam} from '../src/core.mjs';
import {championsSets, isChampions} from '../src/champions.mjs';
import {Match} from '../src/match.mjs';
import {prepareRtTeam, rtRun} from '../src/realtime/sim.mjs';

const SIX = importTeam(`Garchomp @ Choice Scarf
Ability: Rough Skin
EVs: 252 HP / 252 Atk / 4 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Stone Edge
- Fire Fang

Starmie @ Starminite
Ability: Natural Cure
EVs: 252 SpA / 252 Spe
Timid Nature
- Hydro Pump
- Psychic
- Ice Beam
- Recover

Kingambit @ Black Glasses
Ability: Supreme Overlord
EVs: 252 HP / 252 Atk
Adamant Nature
- Kowtow Cleave
- Sucker Punch
- Iron Head
- Swords Dance

Rotom-Wash @ Leftovers
Ability: Levitate
EVs: 252 HP / 252 Def
Bold Nature
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Protect

Corviknight @ Sitrus Berry
Ability: Pressure
EVs: 252 HP / 252 SpD
Impish Nature
- Brave Bird
- Body Press
- Roost
- Iron Defense

Incineroar @ White Herb
Ability: Intimidate
EVs: 252 HP / 252 Def
Careful Nature
- Flare Blitz
- Darkest Lariat
- Fake Out
- Parting Shot`);

test('the Champions formats are there, with their own rules', () => {
  const ids = listFormats({query: 'champions'}).map((f) => f.id);
  for (const id of ['gen9championsou', 'gen9championsbssregmb', 'gen9championsvgc2026regmb', 'gen9championscustomgame', 'gen9championsuu']) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(isChampions('gen9championsbssregma') && !isChampions('gen9ou'));
  const info = formatInfo('gen9championsvgc2026regmb');
  assert.equal(info.game_type, 'doubles');
  // no move above 20 PP; the rest of the dex is untouched
  assert.equal(Dex.mod('champions').moves.get('tackle').pp, 20);
  assert.equal(Dex.moves.get('tackle').pp, 35);
});

test('stat points: the EVs field holds the points, HP = base + points + 75', () => {
  // Silver keeps points as EVs (252 = 32 points); Champions gets the points
  const sets = completeSets(SIX, 'gen9championsbssregmb');
  assert.deepEqual(sets[0].evs, {hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 1});
  assert.deepEqual(championsSets([{evs: {hp: 2, atk: 32, spe: 32}}])[0].evs, {hp: 2, atk: 32, spe: 32}, 'a Champions export stays as it is');
  const m = new Match({format: 'gen9championscustomgame', seed: 'champ-1', p1: {name: 'A', sets: SIX, ai: null}, p2: {name: 'B', sets: SIX, ai: null}});
  const chomp = m.battle.sides[0].pokemon[0];
  assert.equal(chomp.maxhp, 108 + 32 + 75);
  assert.equal(chomp.storedStats.spe, Math.trunc(Math.trunc((102 + 1 + 20) * 110, 16) / 100));
  // the regulation's validator: six Pokémon, one of each item, points within 66 / 32
  assert.deepEqual(validateTeam('gen9championsbssregmb', SIX), {ok: true, problems: []});
  const twoScarves = SIX.map((s, i) => (i === 1 ? {...s, item: 'Choice Scarf'} : s));
  assert.equal(validateTeam('gen9championsbssregmb', twoScarves).ok, false);
});

for (const format of ['gen9championsbssregmb', 'gen9championsvgc2026regma', 'gen9championsou']) {
  test(`two AIs play a whole ${format} battle`, () => {
    const m = new Match({format, seed: `champ-${format}`, max_turns: 200,
      p1: {name: 'A', sets: SIX, ai: {level: 'hard', style: 'balanced'}}, p2: {name: 'B', sets: SIX, ai: {level: 'normal', style: 'aggressive'}}});
    m.advance();
    assert.ok(m.battle.ended, 'the battle ends');
    assert.deepEqual(m.errors, []);
    assert.ok(m.battle.log.some((l) => l.startsWith('|move|')));
  });
}

test('real time keeps Champions\' stats: HP = base + points + 75', () => {
  const team = prepareRtTeam(SIX, {format: 'gen9championscustomgame'});
  assert.equal(team[0].stats.hp, 108 + 32 + 75);
  assert.equal(prepareRtTeam(SIX, {format: 'gen9customgame'})[0].stats.hp, 108 * 2 + 31 + 63 + 100 + 10, 'other formats keep the usual formula');
  const b = rtRun({id: 'champ-rt', seed: 'champ-rt', format: 'gen9championscustomgame', time_limit: 60, version: 5, arena: 'open',
    p1: {name: 'A', sets: SIX, ai: {level: 'hard', style: 'balanced'}}, p2: {name: 'B', sets: SIX, ai: {level: 'normal', style: 'balanced'}}});
  assert.ok(b.ended);
});
