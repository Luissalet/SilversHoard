// Records engine/test/fixtures/rt-v9.json: real-time battles played with rules version 9 (the Battle Frontier's field and PP, and
// multi battles). The tests replay them and must get the same events, so later rules versions leave version 9 as it was.
// node engine/test/fixtures/record-v9.mjs > engine/test/fixtures/rt-v9.json   (only to rebuild it on purpose)
import {createHash} from 'node:crypto';
import {importTeam} from '../../src/core.mjs';
import {RtBattle, rtRun, TPS} from '../../src/realtime/sim.mjs';

const MINE = 'Gengar\nLevel: 50\n- Shadow Ball\n- Thunderbolt\n- Hypnosis\n- Sludge Bomb\n\nGarchomp\nLevel: 50\n- Earthquake\n- Dragon Claw\n- Stone Edge\n- Fire Fang\n\n' +
  'Starmie\nLevel: 50\n- Surf\n- Psychic\n- Ice Beam\n- Recover\n';
const FOES = 'Snorlax\nLevel: 50\n- Body Slam\n- Earthquake\n- Rest\n- Curse\n\nDusknoir\nLevel: 50\n- Shadow Punch\n- Will-O-Wisp\n- Ice Punch\n- Fire Punch\n\n' +
  'Scizor\nLevel: 50\n- X-Scissor\n- Bullet Punch\n- Night Slash\n- Swords Dance\n';
const FOUR = 'Pikachu\nLevel: 50\n- Thunderbolt\n- Quick Attack\n\nMachamp\nLevel: 50\n- Cross Chop\n- Rock Slide\n\nRaichu\nLevel: 50\n- Thunderbolt\n- Surf\n\nMachoke\nLevel: 50\n- Cross Chop\n- Earthquake\n';

/** A scripted person on seat 0: walks at the foe, uses moves in turn, rolls now and then, sends the next Pokémon when one faints. */
function person(spec, ticks) {
  const b = new RtBattle(spec);
  let tick = 0;
  while (!b.ended && tick < ticks) {
    tick++;
    const me = b.doubles ? b.leadOf(b.sides[0]) : b.sides[0];
    const foe = b.foe(me);
    const input = {mx: Math.sign(foe.x - me.x) * 0.8, my: Math.round(Math.sin(tick / 40) * 1000) / 1000, use: tick % 13 === 0 ? (tick / 13) % 4 : -1,
      dodge: tick % 170 === 0, sw: -1, focus: true, plus: false, mega: false};
    if (me.need) input.sw = me.mons.findIndex((m) => !m.fainted && m.slot !== me.active && (!b.doubles || b.canSwitch(me, m.slot)));
    b.step({p1: input});
  }
  return b.inputLog;
}

const base = {version: 9, time_limit: 180, arena: 'open'};
const specs = [
  ['Arcade: Trick Room, fog and statuses, AI vs AI', {...base, seed: 'v9-arcade', format: 'gen4customgame',
    start: {p1: [{status: 'par'}, {hp_cut: 0.2}, {}], p2: [{status: 'brn'}, {}, {status: 'slp', sleep_turns: 3}], field: {weather: 'fog', trickroom: 5}},
    p1: {name: 'A', sets: importTeam(MINE), ai: {level: 'hard', style: 'aggressive'}}, p2: {name: 'B', sets: importTeam(FOES), ai: {level: 'hard', style: 'balanced'}}}, false],
  ['Castle: carried HP and PP, a person against the AI', {...base, seed: 'v9-castle', format: 'gen4customgame',
    start: {p1: [{hp: 60, maxhp: 135, pp: [4, 2, 1, 6], maxpp: [24, 24, 32, 16]}, {hp: 1, maxhp: 183}, {pp: [3, 3, 3, 3], maxpp: [24, 16, 16, 16]}]},
    p1: {name: 'Yo', sets: importTeam(MINE), ai: null}, p2: {name: 'Rival', sets: importTeam(FOES), ai: {level: 'normal', style: 'balanced'}}}, true],
  ['multi: a person with an AI partner against two trainers', {...base, seed: 'v9-multi', format: 'gen4doublescustomgame',
    p1: {name: 'Yo', sets: importTeam(FOUR), ai: null, owners: [0, 1, 0, 1], partner: true},
    p2: {name: 'Rivales', sets: importTeam(FOES).concat(importTeam(MINE).slice(0, 1)), ai: {level: 'normal', style: 'balanced'}, owners: [0, 1, 0, 1]}}, true],
];
const battles = [];
for (const [name, spec, human] of specs) {
  const inputs = human ? person(spec, 180 * TPS) : [];
  const b = rtRun(spec, {inputs});
  battles.push({name, spec, inputs, summary: b.summary(), ticks: b.t, events: b.events.length,
    digest: createHash('sha256').update(JSON.stringify(b.events)).digest('hex')});
}
console.log(JSON.stringify({note: 'Real-time battles recorded with rules version 9 (the Battle Frontier: Trick Room, fog, starting HP, status and PP; multi battles with owned slots). They must replay to the same events.', battles}));
