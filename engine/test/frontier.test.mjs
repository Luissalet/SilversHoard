// A battle's starting state (the Battle Frontier's Castle and Arcade): HP, status, PP, weather, Trick Room and fog applied before the
// first Pokémon come out, kept by snapshots, carried by the input log for practice branches, and read back at the end.
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Battle} from '@pkmn/sim';
import {importTeam} from '../src/core.mjs';
import {Match} from '../src/match.mjs';
import {playOut} from '../src/stats.mjs';
import {practiceSnapshot} from '../src/practice.mjs';
import {endState, frontierParty, hasStart, ownBench, ownerOf, startFromInput} from '../src/frontier.mjs';
import {RtBattle, rtRun, TPS} from '../src/realtime/sim.mjs';

const MINE = importTeam('Pikachu\nLevel: 50\n- Thunderbolt\n- Quick Attack\n\nGolem\nLevel: 50\n- Earthquake\n- Rock Slide\n\nMuk\nLevel: 50\n- Sludge Bomb\n- Rest');
const THEIRS = importTeam('Snorlax\nLevel: 50\n- Body Slam\n- Weather Ball\n- Moonlight\n- Rain Dance\n\nJolteon\nLevel: 50\n- Thunderbolt\n\nCloyster\nLevel: 50\n- Surf');
const RULES = ['Team Preview', 'Picked Team Size = 3'];
const START = {p1: [{hp: 30, status: 'par', pp: [3, 0]}, {hp_cut: 0.2}, {status: 'slp', sleep_turns: 4}], p2: [{status: 'brn'}],
  field: {weather: 'fog', trickroom: 5}};
const spec = (extra = {}) => ({id: 'frontier-test', seed: '7,7,7,7', format: 'gen4customgame', rules: RULES, level_rules: {},
  p1: {name: 'Yo', sets: MINE, ai: null}, p2: {name: 'Rival', sets: THEIRS, ai: {level: 'normal', style: 'balanced'}}, start: START, ...extra});
const clean = (log) => log.filter((l) => !l.startsWith('|t:'));
/** Play p1's turn: its first move, or the next Pokémon when it has to switch. */
const step = (m) => m.choose('p1', m.battle.sides[0].activeRequest?.forceSwitch ? 'default' : 'move 1');

test('the start state is in the battle before the first Pokémon come out', () => {
  const m = new Match(spec()).advance();
  m.choose('p1', 'team 123');
  const log = m.battle.log;
  const start = log.indexOf('|start');
  assert.ok(start > 0);
  assert.ok(log.indexOf('|-weather|Fog') > start && log.indexOf('|-fieldstart|move: Trick Room') > start);
  assert.ok(log.some((l) => l.startsWith('|switch|p1a: Pikachu') && l.endsWith('30/110 par')), 'the switch-in shows the HP and status');
  const [pika, golem, muk] = m.battle.sides[0].pokemon;
  assert.deepEqual([pika.hp, pika.status, pika.baseMoveSlots.map((s) => s.pp)], [30, 'par', [3, 0]]);
  assert.equal(golem.hp, golem.maxhp - (Math.floor(golem.maxhp * 1.2) - golem.maxhp));   // the Arcade's Lower HP
  assert.deepEqual([muk.status, muk.statusState.time], ['slp', 4]);
  assert.equal(m.battle.sides[1].pokemon.find((p) => p.species.name === 'Snorlax').status, 'brn');
  assert.equal(m.battle.field.weather, 'fog');
  assert.equal(m.battle.field.pseudoWeather.trickroom.duration, 5);
  assert.deepEqual(startFromInput(m.inputLog()), START);
});

test('fog cuts accuracy to 3/5 and lasts until another weather replaces it; Trick Room ends after five turns', () => {
  const m = new Match(spec({start: {field: {weather: 'fog', trickroom: 5}}})).advance();
  m.choose('p1', 'team 123');
  const b = m.battle;
  const acc = b.runEvent('ModifyAccuracy', b.sides[1].active[0], b.sides[0].active[0], b.dex.getActiveMove('thunderbolt'), 100);
  assert.equal(acc, 60);
  for (let i = 0; i < 12 && !b.ended && b.field.weather === 'fog'; i++) step(m);
  assert.ok(b.log.includes('|-weather|Fog|[upkeep]'));
  assert.ok(b.log.includes('|-fieldend|move: Trick Room') || b.turn <= 5 || b.ended);
  if (!b.ended) {
    b.field.setWeather('raindance', b.sides[1].active[0]);
    assert.equal(b.field.weather, 'raindance');
  }
});

test('a snapshot keeps the start state and the same battle replays the same', () => {
  const a = new Match(spec()).advance();
  const b = new Match(spec()).advance();
  for (const m of [a, b]) {
    m.choose('p1', 'team 213');
    for (let i = 0; i < 3 && !m.battle.ended; i++) step(m);
  }
  assert.deepEqual(clean(a.battle.log), clean(b.battle.log));
  const restored = new Match(spec(), a.snapshot());
  assert.equal(restored.battle.field.weather, a.battle.field.weather);
  assert.deepEqual(restored.battle.sides[0].pokemon.map((p) => [p.hp, p.status]), a.battle.sides[0].pokemon.map((p) => [p.hp, p.status]));
});

test('a practice branch rebuilt from the input log starts from the same state', () => {
  const m = new Match(spec()).advance();
  m.choose('p1', 'team 123');
  step(m);
  if (m.battle.ended) return;
  const before = m.battle.sides[0].pokemon.map((p) => p.hp);
  const point = practiceSnapshot(m.inputLog(), m.battle.turn, 'p1');
  const rebuilt = Battle.fromJSON(point.snapshot);
  assert.deepEqual(rebuilt.sides[0].pokemon.map((p) => p.hp), before);
  assert.equal(rebuilt.field.weather, 'fog');
});

test('the end state lists each side in the order of its sets, and a played-out battle returns it', () => {
  const r = playOut({...spec(), p1: {name: 'Yo', sets: MINE, ai: {level: 'normal'}}});
  assert.ok(r.end && r.end.p1.length === 3 && r.end.p2.length === 3);
  assert.deepEqual(r.end.p1.map((x) => x.index), [0, 1, 2]);
  for (const x of r.end.p1) assert.ok(x.maxhp > 0 && x.pp.length === x.maxpp.length && x.hp <= x.maxhp);
  const m = new Match(spec({start: null})).advance();
  assert.equal(hasStart(null), false);
  m.choose('p1', 'team 312');
  const end = endState(m.battle);
  assert.deepEqual(end.p1.map((x) => x.species), ['Pikachu', 'Golem', 'Muk']);
  assert.ok(!m.inputLog().some((l) => l.startsWith('>silverstart')));
});

test('frontier_party gives Gen 4 types, the ability the battle uses, max HP and PP with PP Ups', () => {
  const [clefairy, sprigatito] = frontierParty([{species: 'Clefairy', level: 50, moves: ['Moonlight', 'Sketch']}, {species: 'Sprigatito', moves: ['Leafage']}]);
  assert.deepEqual(clefairy.types, ['Normal']);   // Fairy only from generation 6
  assert.equal(clefairy.ability, 'Cute Charm');
  assert.equal(clefairy.maxhp, 145);
  assert.deepEqual(clefairy.moves.map((m) => m.pp), [8, 1]);
  assert.equal(sprigatito.gen, 9);
});

test('real time takes the starting HP, status and weather as well', () => {
  const spec = {id: 'rt-start', seed: 'rt-start', format: 'gen4customgame', p1: {name: 'Yo', sets: MINE, ai: null},
    p2: {name: 'Rival', sets: THEIRS, ai: {level: 'normal', style: 'balanced'}},
    start: {p1: [{hp: 30, status: 'par'}, {hp_cut: 0.2}], p2: [{status: 'brn'}], field: {weather: 'raindance', trickroom: 5}}};
  const b = new RtBattle(spec);
  const [pika, golem] = b.sides[0].mons;
  assert.deepEqual([pika.hp, pika.status], [30, 'par']);
  assert.equal(golem.hp, golem.maxhp - (Math.floor(golem.maxhp * 1.2) - golem.maxhp));
  assert.equal(b.sides[1].mons[0].status, 'brn');
  assert.equal(b.weather.id, 'raindance');
  const again = new RtBattle(spec);
  assert.deepEqual(again.sides.map((s) => s.mons.map((m) => [m.hp, m.status])), b.sides.map((s) => s.mons.map((m) => [m.hp, m.status])));
  const plain = new RtBattle({...spec, start: undefined});
  assert.equal(plain.sides[0].mons[0].hp, plain.sides[0].mons[0].maxhp);
});

// ---------------------------------------------------------------- multi battles, turn by turn: you and an AI partner against two trainers
const PAIR = importTeam('Pikachu\nLevel: 50\n- Thunderbolt\n- Quick Attack\n\nMachamp\nLevel: 50\n- Cross Chop\n- Rock Slide\n\n' +
  'Raichu\nLevel: 50\n- Thunderbolt\n- Surf\n\nMachoke\nLevel: 50\n- Cross Chop\n- Earthquake');
const RIVALS = importTeam('Snorlax\nLevel: 50\n- Body Slam\n- Earthquake\n\nMagikarp\nLevel: 5\n- Splash\n\nBlissey\nLevel: 50\n- Seismic Toss\n- Soft-Boiled\n\n' +
  'Caterpie\nLevel: 5\n- Tackle');
const multi = (extra = {}) => ({id: 'multi-test', seed: '3,1,4,1', format: 'gen4doublescustomgame', rules: [], level_rules: {},
  p1: {name: 'Yo y Malta', sets: PAIR, ai: null, owners: [0, 1, 0, 1], partner: {name: 'Malta', ai: {level: 'hard', style: 'balanced'}}},
  p2: {name: 'Rivales', sets: RIVALS, ai: {level: 'normal', style: 'balanced'}, owners: [0, 1, 0, 1]}, ...extra});
const OWN = {p1: [['Pikachu', 'Raichu'], ['Machamp', 'Machoke']], p2: [['Snorlax', 'Blissey'], ['Magikarp', 'Caterpie']]};
/** Every Pokémon sent to a slot of a multi battle is its owner's: |switch|p1a: is slot 1's trainer, p1b: slot 2's. */
const slotsKept = (log) => log.filter((l) => /^\|(switch|drag)\|p[12][ab]: /.test(l)).every((l) => {
  const [, side, pos, name] = /^\|(?:switch|drag)\|(p[12])([ab]): ([^|]+)/.exec(l);
  return OWN[side][pos === 'a' ? 0 : 1].includes(name);
});

test('multi: the person chooses for slot 1, the AI partner for slot 2, and nobody sends out the other trainer\'s Pokémon', () => {
  const m = new Match(multi({trace: true})).advance();
  const req = m.state('p1').requests.p1;
  assert.deepEqual(req.partner_slots, [1]);
  assert.equal(req.partner_name, 'Malta');
  assert.deepEqual(req.side.pokemon.map((p) => !!p.partner), [false, true, false, true]);
  assert.throws(() => m.choose('p1', 'switch 4'), /partner/);
  m.choose('p1', 'move 1 1');
  const p1choice = m.inputLog().filter((l) => l.startsWith('>p1 '));
  assert.ok(p1choice.length === 1 && p1choice[0].split(',').length === 2, 'one choice for both slots, the partner\'s added');
  for (let i = 0; i < 80 && !m.battle.ended; i++) {
    const r = m.state('p1').requests.p1;
    if (!r) break;
    if (r.forceSwitch) {
      const n = r.side.pokemon.findIndex((p) => !p.active && !p.partner && !p.condition.endsWith(' fnt'));
      m.choose('p1', `switch ${n + 1}`);
    } else m.choose('p1', 'move 1 1');
  }
  assert.ok(m.battle.ended, 'the battle is played to the end');
  assert.ok(slotsKept(m.battle.log));
  assert.ok(m.notes.some((n) => n.partner), 'the partner\'s decisions are in the AI notes');
});

test('multi: a trainer with nobody left leaves its slot empty; snapshots and the AI\'s copies keep the owners', () => {
  const ai = {level: 'hard', style: 'aggressive'};
  const m = new Match(multi({p1: {name: 'Yo y Malta', sets: PAIR, ai, owners: [0, 1, 0, 1]}})).advance();
  assert.ok(m.battle.ended);
  const log = m.battle.log;
  assert.ok(slotsKept(log));
  assert.ok(log.some((l) => l.startsWith('|faint|p2b: Caterpie')) || log.some((l) => l.startsWith('|faint|p2b: Magikarp')), 'the weak pair went down');
  assert.ok(!log.some((l) => /^\|switch\|p2b: (Snorlax|Blissey)/.test(l)), 'Blissey never fills the second trainer\'s slot');
  const half = new Match(multi());
  half.advance();
  half.choose('p1', 'move 1 1');
  const copy = new Match(multi(), half.snapshot());
  assert.deepEqual(copy.battle.silverOwners, {p1: [0, 1, 0, 1], p2: [0, 1, 0, 1]});
  const clone = Battle.fromJSON(JSON.parse(JSON.stringify(new Match(multi()).battle.toJSON())));
  assert.deepEqual(clone.silverOwners, {p1: [0, 1, 0, 1], p2: [0, 1, 0, 1]});
  const side = clone.sides[1];
  assert.deepEqual([ownerOf(side, side.pokemon[0]), ownerOf(side, side.pokemon[1])], [0, 1]);
  assert.deepEqual([ownBench(side, 0), ownBench(side, 1)].map((l) => l.map((p) => p.species.name)), [['Blissey'], ['Caterpie']]);
  // Roar on the second rival's slot with only the first's Pokémon left benched does nothing
  side.pokemon[3].fainted = true;
  side.pokemon[3].hp = 0;
  assert.equal(clone.actions.dragIn(side, 1), false);
  const plain = new Match({...multi(), p1: {name: 'Yo', sets: PAIR, ai}, p2: {name: 'Rivales', sets: RIVALS, ai}});
  assert.equal(plain.battle.silverOwners, undefined, 'plain doubles stay as they were');
  assert.equal(hasStart({owners: {p1: [0, 1]}}), true);
});

// ---------------------------------------------------------------- real-time rules version 9: Trick Room, fog, multi battles
const SLOW = importTeam('Snorlax\nLevel: 50\n- Body Slam\n- Earthquake\n\nShuckle\nLevel: 50\n- Rock Throw');
const FAST = importTeam('Jolteon\nLevel: 50\n- Thunderbolt\n- Shadow Ball\n\nCrobat\nLevel: 50\n- Air Slash');
const rt = (extra = {}) => ({id: 'rt9', seed: 'rt9', version: 9, format: 'gen4customgame', time_limit: 120, arena: 'open',
  p1: {name: 'Lento', sets: SLOW, ai: {level: 'normal', style: 'aggressive'}}, p2: {name: 'Veloz', sets: FAST, ai: {level: 'normal', style: 'aggressive'}}, ...extra});

test('real time v9: Trick Room turns Speed around for walking and cooldowns, for 6 s a turn', () => {
  const plain = new RtBattle(rt());
  const tr = new RtBattle(rt({start: {field: {trickroom: 5}}}));
  const [slow, fast] = [tr.sides[0], tr.sides[1]];
  assert.ok(plain.moveSpeed(plain.sides[0]) < plain.moveSpeed(plain.sides[1]), 'normally Snorlax walks slower than Jolteon');
  assert.ok(tr.moveSpeed(slow) > tr.moveSpeed(fast), 'under Trick Room Snorlax walks faster');
  const move = (b, s) => b.cooldownTicks(s, s.mons[0].profiles[0]);
  assert.ok(move(tr, slow) < move(plain, plain.sides[0]) && move(tr, fast) > move(plain, plain.sides[1]));
  assert.equal(tr.view().trick_room, 30);
  assert.ok(tr.events.some((e) => e.k === 'trickroom' || e.kind === 'trickroom' || e.type === 'trickroom' || JSON.stringify(e).includes('trickroom')));
  const old = new RtBattle(rt({version: 8, start: {field: {trickroom: 5, weather: 'fog'}}}));
  assert.equal(old.trickRoom, null);
  assert.equal(old.fog, null, 'version 8 ignores the Frontier field');
  const done = rtRun(rt({start: {field: {trickroom: 1}}}), {maxSeconds: 10});
  assert.equal(done.trickRoomOn(), false, 'one turn of Trick Room is over after 6 s');
});

test('real time v9: fog makes 2 hits in 5 miss, and a new weather lifts it', () => {
  const misses = (b) => b.events.filter((e) => JSON.stringify(e).includes('"fog":true')).length;
  const foggy = rtRun(rt({start: {field: {weather: 'fog'}}}), {maxSeconds: 60});
  const clear = rtRun(rt(), {maxSeconds: 60});
  assert.ok(misses(foggy) > 0 && misses(clear) === 0);
  const again = rtRun(rt({start: {field: {weather: 'fog'}}}), {maxSeconds: 60});
  assert.equal(misses(again), misses(foggy), 'the same seed misses the same hits');
  const b = new RtBattle(rt({start: {field: {weather: 'fog'}}}));
  assert.ok(b.fogOn());
  b.setWeather('raindance', null);
  assert.equal(b.fogOn(), false);
});

test('real time v9 multi: each slot only sends out its owner\'s Pokémon and the person keeps slot a', () => {
  const four = importTeam('Pikachu\nLevel: 50\n- Thunderbolt\n\nMachamp\nLevel: 50\n- Cross Chop\n\nRaichu\nLevel: 50\n- Thunderbolt\n\nMachoke\nLevel: 50\n- Cross Chop');
  const spec = {id: 'multi', seed: 'multi', version: 9, format: 'gen4doublescustomgame', time_limit: 120, arena: 'open',
    p1: {name: 'Yo', sets: four, ai: null, owners: [0, 1, 0, 1], partner: true},
    p2: {name: 'Rivales', sets: FAST.concat(SLOW), ai: {level: 'normal', style: 'balanced'}, owners: [0, 1, 0, 1]}};
  const b = new RtBattle(spec);
  const [a, partner] = b.sides[0].units;
  assert.deepEqual([b.mon(a).species, b.mon(partner).species], ['Pikachu', 'Machamp']);
  assert.deepEqual(b.bench(a).map((m) => m.species), ['Raichu']);
  assert.deepEqual(b.bench(partner).map((m) => m.species), ['Machoke']);
  assert.equal(b.canSwitch(a, 3), false, "not the partner's Machoke");
  b.personInput(b.sides[0], {ctl: 1, mx: 0, my: 0, use: -1, sw: -1});
  assert.equal(b.leadOf(b.sides[0]), a, 'the person cannot take the partner\'s slot');
  const plain = new RtBattle({...spec, version: 8});
  assert.equal(plain.bench(plain.sides[0].units[0]).length, 2, 'version 8: a shared party');
});

test('real time v9: starting PP count, a move with none left cannot be used, and the summary returns them', () => {
  const b = new RtBattle(rt({start: {p1: [{pp: [1, 0], maxpp: [24, 16]}]}}));
  const m = b.sides[0].mons[0];
  assert.deepEqual(m.ppLeft, [1, 0]);
  assert.equal(b.usable(b.sides[0], 1), 'nopp');
  assert.equal(b.view().sides[0].mons[0].moves[1].pp_left, 0);
  const done = rtRun(rt({start: {p1: [{pp: [3, 2], maxpp: [24, 16]}]}}), {maxSeconds: 90});
  const end = done.summary().sides.p1.pokemon[0];
  assert.ok(end.pp && end.pp[0] <= 3 && end.pp[1] <= 2 && end.maxpp[0] === 24 && end.moves >= 3 - end.pp[0]);
  const old = new RtBattle(rt({version: 8, start: {p1: [{pp: [1, 0]}]}}));
  assert.equal(old.sides[0].mons[0].ppLeft, undefined, 'version 8 has no PP');
  assert.equal(new RtBattle(rt()).sides[0].mons[0].ppLeft, undefined, 'without starting PP there are none');
});

test('real time v9 battles recorded in fixtures/rt-v9.json replay to the same events', () => {
  const fix = JSON.parse(readFileSync(new URL('./fixtures/rt-v9.json', import.meta.url), 'utf8'));
  assert.equal(fix.battles.length, 3);
  for (const rec of fix.battles) {
    const b = rtRun(rec.spec, {inputs: rec.inputs});
    assert.deepEqual(b.summary(), rec.summary, rec.name);
    assert.equal(b.t, rec.ticks, rec.name);
    assert.equal(createHash('sha256').update(JSON.stringify(b.events)).digest('hex'), rec.digest, `${rec.name}: the same events`);
  }
});
