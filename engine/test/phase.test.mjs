// Bosses that change tactics (a trainer's phase): once its team's HP falls to half, or with its last Pokémon, its AI plays with
// another level or style and it says its line. Turn by turn (Match, and the check of a friend's result) and in real time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {importTeam} from '../src/core.mjs';
import {Match, phaseOf} from '../src/match.mjs';
import {replayCheck} from '../src/replay.mjs';
import {rtRun} from '../src/realtime/sim.mjs';

const STRONG = 'Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang\n\n' +
  'Dragonite @ Choice Band\nAbility: Multiscale\nEVs: 252 Atk / 252 Spe\nAdamant Nature\n- Extreme Speed\n- Outrage\n- Earthquake\n- Fire Punch\n';
const BOSS = 'Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt\n- Surf\n- Volt Switch\n- Nasty Plot\n\n' +
  'Raichu @ Life Orb\nAbility: Static\n- Thunderbolt\n- Focus Blast\n- Grass Knot\n- Nasty Plot\n\n' +
  'Jolteon @ Leftovers\nAbility: Volt Absorb\n- Thunderbolt\n- Shadow Ball\n- Volt Switch\n- Calm Mind\n';

test('phaseOf reads the change of tactics from the lines', () => {
  assert.equal(phaseOf({intro: 'hola'}), null);
  assert.deepEqual(phaseOf({phase_when: 'half', phase_style: 'aggressive', phase: '¡Ahora sí!'}), {when: 'half', style: 'aggressive', line: '¡Ahora sí!'});
  assert.deepEqual(phaseOf({phase_when: 'last', last: 'Mi último Pokémon…'}), {when: 'last', line: 'Mi último Pokémon…'});
});

test('turn by turn: the boss changes style once, says its line, and a friend\'s record of it checks out', () => {
  const phase = {when: 'half', style: 'aggressive', level: 'hard', line: '¡Ahora vas a ver!'};
  const spec = {seed: 'phase-1', format: 'gen9customgame', trace: true,
    p1: {name: 'Retador', sets: importTeam(STRONG), ai: {level: 'expert', style: 'balanced'}},
    p2: {name: 'Jefa', sets: importTeam(BOSS), ai: {level: 'easy', style: 'defensive', phase}}};
  const m = new Match(spec).advance();
  assert.ok(m.battle.ended);
  const marks = m.battle.log.filter((l) => l.startsWith('|silverphase|'));
  assert.deepEqual(marks, ['|silverphase|p2|¡Ahora vas a ver!']);
  const at = m.notes.findIndex((n) => n.side === 'p2' && n.style === 'aggressive');
  assert.ok(at > 0, 'it played defensively first, aggressively after');
  assert.ok(m.notes.slice(at).filter((n) => n.side === 'p2').every((n) => n.style === 'aggressive' && n.level === 'hard'));
  // the app checking a playable page's record replays the AI with the same phase: no choice differs
  const check = replayCheck({input: m.inputLog(), format: 'gen9customgame', p1_sets: importTeam(STRONG), p2_sets: importTeam(BOSS),
    ai: {level: 'easy', style: 'defensive', phase}, rng_id: 'phase-1'});
  assert.equal(check.problems.length, 0);
  assert.equal(check.ai_mismatches, 0);
  const without = replayCheck({input: m.inputLog(), format: 'gen9customgame', p1_sets: importTeam(STRONG), p2_sets: importTeam(BOSS),
    ai: {level: 'easy', style: 'defensive'}, rng_id: 'phase-1'});
  assert.ok(without.ai_mismatches > 0, 'without the phase the AI would have played otherwise');
});

test('real time: the phase comes with the last Pokémon, once, and replays the same', () => {
  const spec = {seed: 'phase-rt', version: 4, arena: 'open', format: 'gen9customgame', time_limit: 300,
    p1: {name: 'Retador', sets: importTeam(STRONG), ai: {level: 'expert', style: 'aggressive'}},
    p2: {name: 'Jefa', sets: importTeam(BOSS), ai: {level: 'easy', style: 'balanced', phase: {when: 'last', level: 'expert', line: '¡No me rindo!'}}}};
  const one = rtRun(spec);
  const phases = one.events.filter((e) => e.k === 'phase');
  assert.equal(phases.length, 1);
  assert.equal(phases[0].s, 1);
  assert.equal(phases[0].line, '¡No me rindo!');
  assert.equal(phases[0].level, 'expert');
  assert.equal(JSON.stringify(rtRun(spec).events), JSON.stringify(one.events));
});
