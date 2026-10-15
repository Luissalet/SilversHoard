// Records engine/test/fixtures/rt-v2.json: real-time battles played with rules version 2 (free aim, rocks, gauge, Plus, Mega
// Evolution), before rules version 3 (doubles) existed. The tests replay them and must get the same events.
// node engine/test/fixtures/record-v2.mjs > engine/test/fixtures/rt-v2.json   (only to rebuild it on purpose)
import {createHash} from 'node:crypto';
import {importTeam, randomTeam} from '../../src/core.mjs';
import {RtBattle, rtRun, TPS} from '../../src/realtime/sim.mjs';

const MEGA = 'Charizard @ Charizardite X\nAbility: Blaze\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Flare Blitz\n- Dragon Claw\n- Earthquake\n- Swords Dance\n\n' +
  'Lucario @ Lucarionite\nAbility: Justified\n- Aura Sphere\n- Flash Cannon\n- Close Combat\n- Extreme Speed\n\n' +
  'Rotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect\n';
const FOE = 'Gengar @ Gengarite\nAbility: Cursed Body\n- Shadow Ball\n- Sludge Bomb\n- Thunderbolt\n- Hypnosis\n\n' +
  'Garchomp @ Garchompite\nAbility: Rough Skin\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang\n\n' +
  'Blissey @ Leftovers\n- Soft-Boiled\n- Seismic Toss\n- Thunder Wave\n- Ice Beam\n';

/** A scripted person on the given seats: walks at the foe, aims free and locked in turns, uses moves, Plus, Mega, rolls, switches. */
function person(spec, seats, ticks) {
  const b = new RtBattle(spec);
  let tick = 0;
  while (!b.ended && tick < ticks) {
    tick++;
    const frame = {};
    for (const i of seats) {
      const me = b.sides[i], foe = b.sides[1 - i];
      const k = tick + i * 37;
      const input = {mx: Math.sign(foe.x - me.x) * 0.8, my: Math.round(Math.sin(k / 40) * 1000) / 1000, use: k % 11 === 0 ? (k / 11) % 4 : -1,
        dodge: k % 170 === 0, sw: k === 900 ? 2 : -1, focus: Math.floor(k / 90) % 2 === 0, plus: k % 3 === 0, mega: k % 50 === 0};
      if (me.need) input.sw = me.mons.findIndex((m) => !m.fainted);
      frame[me.id] = input;
    }
    b.step(frame);
  }
  return b.inputLog;
}

const base = {version: 2, format: 'gen9customgame', time_limit: 300, level_rules: {level: 50}};
const specs = [
  ['person vs AI on rocks', {...base, seed: 'v2-person', arena: 'rocks', p1: {name: 'Me', sets: importTeam(MEGA), ai: null}, p2: {name: 'AI', sets: importTeam(FOE), ai: {level: 'hard', style: 'balanced'}}}, [0]],
  ['two people on the open arena', {...base, seed: 'v2-two', arena: 'open', p1: {name: 'A', sets: importTeam(MEGA), ai: null}, p2: {name: 'B', sets: importTeam(FOE), ai: null}}, [0, 1]],
  ['AI vs AI expert on rocks', {...base, seed: 'v2-ai', arena: 'rocks', p1: {name: 'X', sets: importTeam(MEGA), ai: {level: 'expert', style: 'aggressive'}}, p2: {name: 'Y', sets: importTeam(FOE), ai: {level: 'expert', style: 'defensive'}}}, []],
  ['doubles format played as singles', {...base, seed: 'v2-dbl', arena: 'rocks', format: 'gen9doublescustomgame', p1: {name: 'D1', sets: randomTeam('gen9randombattle', 'v2d1').sets, ai: {level: 'normal', style: 'balanced'}}, p2: {name: 'D2', sets: randomTeam('gen9randombattle', 'v2d2').sets, ai: null}}, [1]],
];
const battles = [];
for (const [name, spec, seats] of specs) {
  const inputs = seats.length ? person(spec, seats, 300 * TPS) : [];
  const b = rtRun(spec, {inputs});
  battles.push({name, spec, inputs, summary: b.summary(), ticks: b.t, events: b.events.length,
    digest: createHash('sha256').update(JSON.stringify(b.events)).digest('hex')});
}
console.log(JSON.stringify({note: 'Real-time battles recorded with rules version 2 (free aim, rocks, the gauge, Plus moves, Mega Evolution) before rules version 3 (doubles). They must replay to the same events.', battles}));
