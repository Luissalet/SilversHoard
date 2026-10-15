// Real-time mode (Legends: Z-A rules): cooldowns instead of PP, deterministic battles, replays from inputs, the AI in every level.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Dex} from '@pkmn/sim';
import {importTeam, randomTeam} from '../src/core.mjs';
import {baseCooldown, cooldownTable, derivedCooldown, finalCooldown, rtMove, TPS} from '../src/realtime/moves.mjs';
import {ZA_COOLDOWN} from '../src/realtime/za-data.mjs';
import {GAUGE_SEGMENT, RtBattle, eventLines, inputFrame, placeRocks, prepareRtTeam, rtRun} from '../src/realtime/sim.mjs';
import {handle} from '../src/server.mjs';

const TEAM = 'Garchomp @ Choice Scarf\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage\n- Swords Dance\n- Stone Edge\n\n' +
  'Rotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect\n';

test('cooldowns: Legends Z-A table, Speed rule, priority, derived values', () => {
  assert.equal(baseCooldown(Dex.moves.get('tackle')), 4);
  assert.equal(baseCooldown(Dex.moves.get('hyperbeam')), 20);
  assert.equal(baseCooldown(Dex.moves.get('swordsdance')), 15);
  assert.equal(baseCooldown(Dex.moves.get('noretreat')), 60);
  // 3 s off per 100 Speed over 25, never under 3 s; priority moves always 3 s
  assert.equal(finalCooldown(20, 125), 17);
  assert.equal(finalCooldown(20, 25), 20);
  assert.equal(finalCooldown(4, 400), 3);
  assert.equal(Math.round(finalCooldown(20, 125, {mod: 1.5}) * 100) / 100, 15.14);
  assert.equal(finalCooldown(8, 300, {priority: 1}), 3);
  // moves Z-A does not have get a cooldown from PP and power, close to Z-A's own values
  assert.equal(rtMove('Flamethrower').za, true);
  assert.equal(rtMove('Moonblast').za, true);
  const missing = rtMove('Scald').za ? rtMove('Pound') : rtMove('Scald');
  assert.ok(missing.cooldown >= 3 && missing.cooldown <= 60);
  let err = 0;
  for (const [id, cd] of Object.entries(ZA_COOLDOWN)) err += Math.abs(derivedCooldown(Dex.moves.get(id)) - cd);
  assert.ok(err / Object.keys(ZA_COOLDOWN).length < 1.5, 'the PP-based rule stays close to Z-A');
  const table = cooldownTable(['Earthquake', 'Quick Attack', 'Nasty Plot'], {speed: 200});
  assert.deepEqual(table.map((r) => r.final), [4.8, 3, 9.8]);
  assert.equal(table[1].windup_s, 0);
});

test('teams: real stats and cooldowns per Pokémon', () => {
  const [chomp] = prepareRtTeam(importTeam(TEAM), {format: 'gen9customgame', levelRules: {level: 50}});
  assert.equal(chomp.level, 50);
  assert.equal(chomp.stats.spe, 169);
  assert.equal(chomp.moves.length, 4);
  assert.equal(chomp.moves[0].cooldown, 10);
  assert.ok(chomp.moves[0].final < chomp.moves[0].cooldown, 'Speed and Choice Scarf shorten the cooldown');
});

test('AI vs AI: every level plays to the end, the same seed gives the same battle', () => {
  for (const level of ['random', 'easy', 'normal', 'hard', 'expert']) {
    const spec = {seed: `lv-${level}`, format: 'gen9customgame', p1: {name: 'A', sets: randomTeam('gen9randombattle', `a${level}`).sets, ai: {level, style: 'balanced'}},
      p2: {name: 'B', sets: randomTeam('gen9randombattle', `b${level}`).sets, ai: {level: 'normal', style: 'aggressive'}}};
    const one = rtRun(spec);
    const two = rtRun(spec);
    assert.ok(one.ended);
    assert.ok(['ko', 'time'].includes(one.reason));
    assert.deepEqual(one.summary(), two.summary());
    assert.equal(one.events.length, two.events.length);
    assert.ok(eventLines(one).length > 5);
  }
});

test('older generations and styles play in real time', () => {
  for (const [gen, style] of [[1, 'stall'], [3, 'setup'], [5, 'defensive'], [7, 'aggressive'], [8, 'balanced']]) {
    const b = rtRun({seed: `g${gen}`, format: `gen${gen}customgame`, time_limit: 120,
      p1: {name: 'A', sets: randomTeam(`gen${gen}randombattle`, `a${gen}`).sets, ai: {level: 'hard', style}},
      p2: {name: 'B', sets: randomTeam(`gen${gen}randombattle`, `b${gen}`).sets, ai: {level: 'normal', style: 'balanced'}}});
    assert.ok(b.ended, `gen ${gen}`);
  }
});

test('a person plays: inputs are recorded and the replay gives the same result', () => {
  const spec = {seed: 'human', format: 'gen9customgame', p1: {name: 'Me', sets: importTeam(TEAM), ai: null},
    p2: {name: 'AI', sets: randomTeam('gen9randombattle', 'foe').sets, ai: {level: 'normal', style: 'balanced'}}};
  const b = new RtBattle(spec);
  let tick = 0;
  while (!b.ended && tick < 200 * TPS) {
    tick++;
    // walk at the foe and use whatever is ready; roll every few seconds; switch once
    const me = b.sides[0];
    const foe = b.sides[1];
    const input = {mx: Math.sign(foe.x - me.x), my: Math.sign(foe.y - me.y) * 0.5, use: tick % 7 === 0 ? (tick / 7) % 4 : -1, dodge: tick % 150 === 0, sw: -1};
    if (tick === 300) input.sw = 1;
    if (me.need) input.sw = me.mons.findIndex((m) => !m.fainted);
    b.step({p1: input});
  }
  assert.ok(b.ended, 'the battle ends');
  assert.ok(b.inputLog.length > 10);
  assert.ok(b.events.some((e) => e.k === 'roll'));
  assert.ok(b.events.some((e) => e.k === 'recall'));
  const again = rtRun(spec, {inputs: b.inputLog});
  assert.deepEqual(again.summary(), b.summary());
});

test('rules: no accuracy, timed one-stage boosts, three switches, drowsiness doubles cooldowns', () => {
  const b = new RtBattle({seed: 'rules', format: 'gen9customgame', p1: {name: 'A', sets: importTeam(TEAM), ai: null},
    p2: {name: 'B', sets: importTeam('Snorlax @ Leftovers\n- Body Slam\n- Rest\n- Curse\n- Yawn\n\nBlissey\n- Soft-Boiled\n- Seismic Toss\n'), ai: null}});
  const [me, foe] = b.sides;
  b.boost(me, {atk: 2}, me, 'test');
  assert.equal(b.mon(me).boosts.atk, 1, 'one stage at most');
  for (let i = 0; i < 21 * TPS; i++) b.step({});
  assert.equal(b.mon(me).boosts.atk, 0, 'boosts wear off');
  b.setStatus(foe, 'slp', null);
  b.mon(foe).cds[0] = 2 * TPS;
  for (let i = 0; i < 2 * TPS; i++) b.step({});
  assert.ok(b.mon(foe).cds[0] >= TPS - 1, 'cooldowns run at half speed while drowsy');
  assert.equal(me.switchesLeft, 3);
  b.step({p1: {sw: 1}});
  assert.equal(me.switchesLeft, 2);
  for (let i = 0; i < TPS; i++) b.step({});
  assert.equal(me.active, 1);
});

test('engine commands for real time', async () => {
  const spec = {seed: 'cmd', format: 'gen9customgame', time_limit: 90, p1: {name: 'A', sets: importTeam(TEAM), ai: {level: 'hard'}},
    p2: {name: 'B', sets: randomTeam('gen9randombattle', 'cmd').sets, ai: {level: 'hard'}}};
  const check = await handle({id: 1, cmd: 'rt_check', args: {spec}});
  assert.equal(check.ok, true);
  assert.equal(check.result.view.sides[0].mons[0].species, 'Garchomp');
  const out = await handle({id: 2, cmd: 'rt_play_out', args: {spec}});
  assert.equal(out.ok, true);
  assert.equal(out.result.summary.mode, 'realtime');
  const cds = await handle({id: 3, cmd: 'rt_cooldowns', args: {moves: ['Tackle', 'Thunderbolt'], speed: 125}});
  assert.deepEqual(cds.result.moves.map((m) => m.final), [3, 5]);
  const bad = await handle({id: 4, cmd: 'rt_check', args: {spec: {...spec, p1: {name: 'A', sets: []}}}});
  assert.equal(bad.ok, false);
});

test('old replays: battles recorded before focus, rocks and Mega Evolution replay to the same result', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/rt-legacy-v1.json', import.meta.url), 'utf8'));
  assert.equal(fixture.battles.length, 4);
  for (const rec of fixture.battles) {
    const b = rtRun(rec.spec, {inputs: rec.inputs});
    assert.deepEqual(b.summary(), rec.summary, rec.name);
    assert.equal(b.t, rec.ticks, rec.name);
    assert.equal(b.events.length, rec.events, rec.name);
    assert.equal(createHash('sha256').update(JSON.stringify(b.events)).digest('hex'), rec.digest, `${rec.name}: the same events`);
  }
  // seven-column rows read as focused, no Plus, no Mega
  const b = new RtBattle({...fixture.battles[1].spec, version: 2});
  const frame = inputFrame(b, [[1, 0, 0.5, 0, 2, 0, -1]], [null, null]);
  assert.deepEqual(frame.p1, {mx: 0.5, my: 0, use: 2, dodge: false, sw: -1, focus: true, plus: false, mega: false});
});

// ---------------------------------------------------------------- rules version 2: free aim, rocks, Mega Evolution, Plus moves
const MEGA = 'Charizard @ Charizardite X\nAbility: Blaze\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Flare Blitz\n- Dragon Claw\n- Water Gun\n- Swords Dance\n\n' +
  'Lucario @ Lucarionite\nAbility: Justified\n- Aura Sphere\n- Flash Cannon\n- Close Combat\n- Extreme Speed\n\n' +
  'Rotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect\n';
const WALL = 'Blissey @ Leftovers\nAbility: Natural Cure\nEVs: 252 HP / 252 Def\n- Soft-Boiled\n- Seismic Toss\n- Thunder Wave\n- Ice Beam\n\n' +
  'Garchomp @ Garchompite\nAbility: Rough Skin\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang\n';
const v2 = (extra = {}) => ({seed: 'v2', version: 2, format: 'gen9customgame', time_limit: 300, p1: {name: 'A', sets: importTeam(MEGA), ai: null},
  p2: {name: 'B', sets: importTeam(WALL), ai: null}, ...extra});
const idle = {mx: 0, my: 0, use: -1, dodge: false, sw: -1};

test('focus: locked moves aim at the foe; free moves go where the Pokémon faces and can miss', () => {
  const shoot = (focus) => {
    const b = new RtBattle(v2());
    for (let i = 0; i < 20; i++) b.step({p1: {...idle, mx: -1, my: 0, focus}, p2: idle});   // walk away from the foe
    b.step({p1: {...idle, use: 2, focus}, p2: idle});                                         // Water Gun
    for (let i = 0; i < 3 * TPS; i++) b.step({p1: {...idle, focus}, p2: idle});
    return b;
  };
  const free = shoot(false);
  assert.ok(free.sides[0].fx < -0.99, 'not focusing, it faces where it walked');
  const shot = free.events.find((e) => e.k === 'shot');
  assert.ok(shot.vx < 0, 'the shot goes the way it faces');
  assert.ok(free.events.some((e) => e.k === 'fizzle' && e.id === shot.id), 'and misses');
  assert.ok(!free.events.some((e) => e.k === 'hit'));
  const locked = shoot(true);
  assert.ok(locked.sides[0].fx > 0.9, 'focusing, it keeps facing the foe while walking away (strafing)');
  assert.ok(locked.events.find((e) => e.k === 'shot').vx > 0);
  assert.ok(locked.events.some((e) => e.k === 'hit' && e.s === 1), 'and the shot hits');
  // aim assist: a foe within 30° of the facing is still hit
  const near = new RtBattle(v2());
  near.sides[0].fx = Math.cos(0.4); near.sides[0].fy = Math.sin(0.4);
  near.sides[1].y = near.sides[0].y + Math.tan(0.3) * (near.sides[1].x - near.sides[0].x);
  near.step({p1: {...idle, use: 2, focus: false}, p2: idle});
  for (let i = 0; i < 2 * TPS; i++) near.step({p1: {...idle, focus: false}, p2: idle});
  assert.ok(near.events.some((e) => e.k === 'hit' && e.s === 1), 'aim assist');
  // a free strike lunges forward and misses a foe that is far away (no walking up to it)
  const far = new RtBattle(v2());
  const x0 = far.sides[0].x;
  far.step({p1: {...idle, use: 1, focus: false}, p2: idle});   // Dragon Claw
  for (let i = 0; i < TPS; i++) far.step({p1: {...idle, focus: false}, p2: idle});
  assert.ok(far.sides[0].x > x0 && far.sides[0].x - x0 < 1, 'a short lunge');
  assert.ok(far.events.some((e) => e.k === 'miss' && e.s === 0));
});

test('rocks: placed from the seed, mirrored, clear of the spawns; they block walking and projectiles but not quakes', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const rocks = placeRocks(seed);
    assert.ok(rocks.length >= 3 && rocks.length <= 6, `${seed}: ${rocks.length} rocks`);
    for (const r of rocks) {
      assert.ok(rocks.some((o) => Math.abs(o.x - (28 - r.x)) < 1e-9 && o.y === r.y && o.r === r.r), 'mirrored');
      assert.ok(Math.abs(r.y - 8.5) >= r.r + 2.3, 'off the centre line');
    }
  }
  assert.deepEqual(placeRocks('same'), placeRocks('same'));
  assert.equal(new RtBattle(v2()).rocks.length, 0, 'open arena by default');
  const b = new RtBattle(v2({arena: 'rocks'}));
  assert.ok(b.rocks.length >= 3);
  assert.deepEqual(b.view().rocks, b.rocks);
  b.rocks = [{x: 14, y: 4, r: 1}];   // one rock alone, to measure against
  const rk = b.rocks[0];
  const [me, foe] = b.sides;
  me.x = rk.x - rk.r - 3; me.y = rk.y;
  foe.x = rk.x + rk.r + 3; foe.y = rk.y;
  // walking into the rock stops at its edge
  for (let i = 0; i < 2 * TPS; i++) b.step({p1: {...idle, mx: 1}, p2: idle});
  assert.ok(Math.hypot(me.x - rk.x, me.y - rk.y) >= b.radius(me) + rk.r - 1e-6, 'pushed out of the rock');
  assert.ok(me.x < rk.x);
  // a projectile into the rock ends on it
  me.x = rk.x - rk.r - 2; me.y = rk.y;
  b.step({p1: {...idle, use: 2}, p2: idle});
  for (let i = 0; i < 2 * TPS; i++) b.step({p1: idle, p2: idle});
  const shot = b.events.find((e) => e.k === 'shot' && e.s === 0);
  const end = b.events.find((e) => e.k === 'fizzle' && e.id === shot.id);
  assert.ok(end && end.rock, 'stopped by the rock');
  assert.ok(Math.hypot(end.x - rk.x, end.y - rk.y) <= rk.r + 0.5);
  assert.ok(!b.events.some((e) => e.k === 'hit' && e.s === 1));
  // the AI walks around rocks: steering turns along the edge
  const dir = b.steer(me, {x: 1, y: 0});
  assert.ok(Math.abs(dir.y) > 0.8, 'turns along the rock');
  // a quake goes through: the rock does not shelter the foe from it
  const q = new RtBattle(v2({arena: 'rocks', p1: {name: 'A', sets: importTeam('Garchomp\n- Earthquake\n'), ai: null}}));
  q.rocks = [{x: 14, y: 4, r: 0.5}];
  q.sides[0].x = 12.4; q.sides[0].y = 4;
  q.sides[1].x = 15.6; q.sides[1].y = 4;
  q.step({p1: {...idle, use: 0}, p2: idle});
  for (let i = 0; i < TPS; i++) q.step({p1: idle, p2: idle});
  assert.ok(q.events.some((e) => e.k === 'hit' && e.s === 1 && e.move === 'earthquake'));
});

test('Mega Evolution: a full gauge, the Mega forme, every move Plus, back when the gauge empties', () => {
  const [chomp] = prepareRtTeam(importTeam(MEGA), {format: 'gen9customgame'});
  assert.equal(chomp.mega.species, 'Charizard-Mega-X');
  assert.deepEqual(chomp.mega.types, ['Fire', 'Dragon']);
  assert.equal(prepareRtTeam(importTeam(MEGA), {format: 'gen5customgame'})[0].mega, null, 'no Mega Evolution before generation 6');
  const b = new RtBattle(v2());
  const [me] = b.sides;
  const far = () => ({...idle, mx: -0.2, my: -1});   // keep away from the foe, nobody attacks
  let t = 0;
  for (; t < 44 * TPS; t++) b.step({p1: far(), p2: idle});
  assert.equal(b.canMega(me), false, 'the gauge is not full yet');
  assert.ok(b.view().sides[0].gauge > 2.9 && b.view().sides[0].gauge < 3);
  for (; t < 46 * TPS; t++) b.step({p1: far(), p2: idle});
  assert.equal(me.gauge, 3 * GAUGE_SEGMENT, 'full after 45 s');
  assert.ok(b.canMega(me));
  const hp = b.mon(me).hp;
  b.step({p1: {...idle, mega: true}, p2: idle});
  const m = b.mon(me);
  assert.equal(m.species, 'Charizard-Mega-X');
  assert.equal(m.ability, 'toughclaws');
  assert.deepEqual(m.types, ['Fire', 'Dragon']);
  assert.equal(m.hp, hp);
  assert.ok(b.events.some((e) => e.k === 'mega' && e.species === 'Charizard-Mega-X'));
  assert.ok(b.view().sides[0].mons[0].is_mega);
  // every move is a Plus move while Mega Evolved, at no cost
  const before = me.gauge;
  b.step({p1: {...idle, use: 3}, p2: idle});   // Swords Dance
  assert.ok(b.events.some((e) => e.k === 'plus' && e.s === 0 && e.mega));
  assert.equal(me.gauge, before - 15, 'only the drain');
  for (let i = 0; i < 26 * TPS && me.mega >= 0; i++) b.step({p1: far(), p2: idle});
  const end = b.events.find((e) => e.k === 'mega_end');
  const start = b.events.find((e) => e.k === 'mega');
  assert.ok(end, 'back to the base forme');
  assert.ok(Math.abs((end.t - start.t) / TPS - 24) < 0.2, 'a segment every 8 s');
  assert.equal(b.mon(me).species, 'Charizard');
  assert.equal(b.mon(me).ability, 'blaze');
  for (let i = 0; i < 50 * TPS; i++) b.step({p1: {...far(), mega: true}, p2: idle});
  assert.equal(b.events.filter((e) => e.k === 'mega').length, 1, 'once per battle');
  // the whole thing replays from the inputs
  const again = rtRun(v2(), {inputs: b.inputLog, maxSeconds: b.t / TPS});
  assert.deepEqual(again.events.filter((e) => e.k.startsWith('mega')), b.events.filter((e) => e.k.startsWith('mega')));
  assert.equal(b.inputLog.every((row) => row.length === 10), true);
});

test('Plus moves: a gauge segment for more damage, more secondary effects, more healing and through protection', () => {
  const play = (plus) => {
    const b = new RtBattle(v2({seed: 'plus'}));
    for (let i = 0; i < 16 * TPS; i++) b.step({p1: idle, p2: idle});
    b.step({p1: {...idle, use: 2, plus}, p2: idle});   // Water Gun: neutral on Blissey
    for (let i = 0; i < 2 * TPS; i++) b.step({p1: idle, p2: idle});
    return b;
  };
  const normal = play(false);
  const plus = play(true);
  const hit = (b) => b.events.find((e) => e.k === 'hit' && e.s === 1);
  assert.ok(plus.events.some((e) => e.k === 'plus' && e.s === 0));
  assert.ok(!normal.events.some((e) => e.k === 'plus'));
  const ratio = hit(plus).dmg / hit(normal).dmg;
  assert.ok(ratio > 1.15 && ratio < 1.25, `x1.2 (${hit(normal).dmg} -> ${hit(plus).dmg})`);
  assert.ok(plus.sides[0].gauge < normal.sides[0].gauge - GAUGE_SEGMENT + 200, 'a segment spent');
  // super effective: x1.3
  const b = new RtBattle(v2({seed: 'plus'}));
  const [me, foe] = b.sides;
  const p = b.mon(me).profiles[2];
  const blissey = b.damage(me, foe, p, {expected: true});
  const blisseyPlus = b.damage(me, foe, p, {expected: true, plus: true});
  assert.ok(Math.abs(blisseyPlus.dmg / blissey.dmg - 1.2) < 0.05);
  foe.vol.types = ['Fire'];
  const fire = b.damage(me, foe, p, {expected: true});
  const firePlus = b.damage(me, foe, p, {expected: true, plus: true});
  assert.ok(Math.abs(firePlus.dmg / fire.dmg - 1.3) < 0.05);
  delete foe.vol.types;
  // without a full segment, asking for Plus does nothing
  const early = new RtBattle(v2({seed: 'plus'}));
  early.step({p1: {...idle, use: 2, plus: true}, p2: idle});
  assert.ok(!early.events.some((e) => e.k === 'plus'));
  // through protection for a quarter, and a third more healing
  const prot = new RtBattle(v2({seed: 'prot', p2: {name: 'B', sets: importTeam(MEGA.split('\n\n')[2]), ai: null}}));
  prot.sides[0].gauge = 2 * GAUGE_SEGMENT;
  prot.sides[1].vol.protectUntil = 10 ** 6;
  prot.sides[1].vol.protectKind = 'protect';
  prot.step({p1: {...idle, use: 2, plus: true}, p2: idle});
  for (let i = 0; i < 2 * TPS; i++) prot.step({p1: idle, p2: idle});
  assert.ok(prot.events.some((e) => e.k === 'protected' && e.pierced));
  const through = prot.events.find((e) => e.k === 'hit' && e.s === 1);
  assert.ok(through && through.dmg >= 1);
  const healer = new RtBattle(v2({seed: 'heal', p1: {name: 'A', sets: importTeam('Blissey\n- Soft-Boiled\n- Seismic Toss\n'), ai: null}}));
  const bl = healer.mon(healer.sides[0]);
  healer.sides[0].gauge = GAUGE_SEGMENT;
  bl.hp = 1;
  healer.step({p1: {...idle, use: 0, plus: true}, p2: idle});
  for (let i = 0; i < TPS; i++) healer.step({p1: idle, p2: idle});
  assert.equal(bl.hp, 1 + Math.floor(bl.maxhp * (2 / 3)), 'half the HP becomes two thirds');
});

test('AI vs AI on rocks with Mega Stones plays to the end and replays the same; a person with every new input too', () => {
  const FOE = 'Gengar @ Gengarite\nAbility: Cursed Body\n- Shadow Ball\n- Sludge Bomb\n- Thunderbolt\n- Hypnosis\n\n' +
    'Garchomp @ Garchompite\nAbility: Rough Skin\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang\n\n' +
    'Blissey @ Leftovers\n- Soft-Boiled\n- Seismic Toss\n- Thunder Wave\n- Ice Beam\n';
  const spec = {seed: 'r1', version: 2, arena: 'rocks', format: 'gen9customgame', time_limit: 300, level_rules: {level: 50},
    p1: {name: 'X', sets: importTeam(MEGA), ai: {level: 'expert', style: 'aggressive'}}, p2: {name: 'Y', sets: importTeam(FOE), ai: {level: 'hard', style: 'balanced'}}};
  const one = rtRun(spec);
  const two = rtRun(spec);
  assert.ok(one.ended && ['ko', 'time'].includes(one.reason));
  assert.ok(one.events.some((e) => e.k === 'mega'), 'the AI Mega Evolves');
  assert.ok(one.events.some((e) => e.k === 'plus' && !e.mega), 'and uses Plus moves');
  assert.deepEqual(one.summary(), two.summary());
  assert.equal(JSON.stringify(one.events), JSON.stringify(two.events));
  assert.ok(eventLines(one).some((l) => l.includes('Mega Evolved into')));
  // a person: free aim and focus in turns, Plus, Mega, rolls and switches, then the replay from the input log
  const human = {...spec, seed: 'human-v2', p1: {name: 'Me', sets: importTeam(MEGA), ai: null}};
  const b = new RtBattle(human);
  let tick = 0;
  while (!b.ended && tick < 300 * TPS) {
    tick++;
    const me = b.sides[0], foe = b.sides[1];
    const focus = Math.floor(tick / 90) % 2 === 0;
    const input = {mx: Math.sign(foe.x - me.x) * 0.8, my: Math.sin(tick / 40), use: tick % 11 === 0 ? (tick / 11) % 4 : -1, dodge: tick % 170 === 0,
      sw: -1, focus, plus: tick % 3 === 0, mega: tick % 50 === 0};
    if (me.need) input.sw = me.mons.findIndex((m) => !m.fainted);
    b.step({p1: input});
  }
  assert.ok(b.ended);
  assert.ok(b.events.some((e) => e.k === 'plus' && e.s === 0));
  const again = rtRun(human, {inputs: b.inputLog});
  assert.deepEqual(again.summary(), b.summary());
  assert.equal(JSON.stringify(again.events), JSON.stringify(b.events));
});
