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
  // battles recorded with rules version 2 (free aim, rocks, gauge, Plus, Mega Evolution; a doubles format played as singles)
  const v2fix = JSON.parse(readFileSync(new URL('./fixtures/rt-v2.json', import.meta.url), 'utf8'));
  assert.equal(v2fix.battles.length, 4);
  for (const rec of v2fix.battles) {
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

test('rules version 4: no Plus moves; the gauge only Mega Evolves, and a Mega Evolved Pokémon moves as usual', () => {
  const v4 = (extra = {}) => v2({version: 4, ...extra});
  const play = (plus, version) => {
    const b = new RtBattle(version === 4 ? v4({seed: 'plus'}) : v2({seed: 'plus'}));
    for (let i = 0; i < 16 * TPS; i++) b.step({p1: idle, p2: idle});
    b.step({p1: {...idle, use: 2, plus}, p2: idle});   // Water Gun: neutral on Blissey
    for (let i = 0; i < 2 * TPS; i++) b.step({p1: idle, p2: idle});
    return b;
  };
  const armed = play(true, 4);
  const plain = play(false, 4);
  assert.ok(!armed.events.some((e) => e.k === 'plus'), 'an armed Plus does nothing');
  const hit = (b) => b.events.find((e) => e.k === 'hit' && e.s === 1);
  assert.equal(hit(armed).dmg, hit(plain).dmg, 'same damage');
  assert.equal(armed.sides[0].gauge, plain.sides[0].gauge, 'no segment spent');
  const v = armed.view();
  assert.equal(v.plus_moves, false);
  assert.equal(v.sides[0].plus_moves, false);
  assert.equal(v.sides[0].plus_ready, false);
  assert.equal(new RtBattle(v2()).view().plus_moves, true, 'version 2 keeps them');
  // Mega Evolution still works, without Plus moves
  const b = new RtBattle(v4({seed: 'mega4'}));
  const me = b.sides[0];
  while (!b.canMega(me) && b.t < 60 * TPS) b.step({p1: idle, p2: idle});
  assert.ok(b.canMega(me), 'the gauge fills');
  b.step({p1: {...idle, mega: true}, p2: idle});
  assert.ok(b.view().sides[0].mons[0].is_mega);
  b.step({p1: {...idle, use: 3}, p2: idle});
  for (let i = 0; i < TPS; i++) b.step({p1: idle, p2: idle});
  assert.ok(!b.events.some((e) => e.k === 'plus'), 'no Plus while Mega Evolved');
  // the AI never arms one either
  const ai = new RtBattle(v4({seed: 'ai4', p1: {name: 'A', sets: importTeam(MEGA), ai: {level: 'hard'}}, p2: {name: 'B', sets: importTeam(WALL), ai: {level: 'hard'}}}));
  for (let i = 0; i < 90 * TPS && !ai.ended; i++) ai.step({});
  assert.ok(!ai.events.some((e) => e.k === 'plus'));
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

// ---------------------------------------------------------------- rules version 3: doubles
const DBL_A = 'Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Earthquake\n- Rock Slide\n- Dragon Claw\n- Protect\n\n' +
  'Clefable @ Leftovers\nAbility: Magic Guard\n- Follow Me\n- Helping Hand\n- Moonblast\n- Water Gun\n\n' +
  'Heatran @ Leftovers\nAbility: Flash Fire\n- Heat Wave\n- Flash Cannon\n- Earth Power\n- Protect\n';
const DBL_B = 'Snorlax @ Leftovers\nAbility: Thick Fat\nEVs: 252 HP / 252 Def\n- Body Slam\n- Rest\n- Curse\n- Water Gun\n\n' +
  'Blissey @ Leftovers\nAbility: Natural Cure\nEVs: 252 HP / 252 Def\n- Soft-Boiled\n- Seismic Toss\n- Rage Powder\n- Water Gun\n\n' +
  'Dragonite @ Leftovers\nAbility: Multiscale\n- Dragon Claw\n- Extreme Speed\n- Earthquake\n- Roost\n';
const dbl = (extra = {}) => ({seed: 'dbl', version: 3, format: 'gen9doublescustomgame', time_limit: 300, p1: {name: 'A', sets: importTeam(DBL_A), ai: null},
  p2: {name: 'B', sets: importTeam(DBL_B), ai: null}, ...extra});
const place = (u, x, y) => { u.x = x; u.y = y; };
// a battle where the partner slots of the people stand still (the AI drives them in real games), to measure one move at a time
const still = (spec) => { const b = new RtBattle(spec); b.partnerInput = () => ({}); return b; };

test('doubles: two Pokémon per trainer only from rules version 3 and in doubles formats', () => {
  const b = new RtBattle(dbl());
  assert.equal(b.doubles, true);
  assert.equal(b.units.length, 4);
  assert.deepEqual(b.sides.map((s) => s.units.map((u) => b.mon(u).species)), [['Garchomp', 'Clefable'], ['Snorlax', 'Blissey']]);
  assert.ok(b.sides[0].units[0].y < b.sides[0].units[1].y, 'slot a above slot b');
  const v = b.view();
  assert.equal(v.doubles, true);
  assert.deepEqual(v.sides[0].units.map((u) => u.active), [0, 1]);
  assert.deepEqual(v.sides[0].mons.map((m) => m.field), [0, 1, -1]);
  assert.equal(new RtBattle(dbl({version: 2})).doubles, false, 'version 2 plays doubles formats as singles');
  assert.equal(new RtBattle(dbl({format: 'gen9customgame'})).doubles, false, 'singles formats stay singles');
  // a one-Pokémon team leaves its second slot empty
  const solo = new RtBattle(dbl({p2: {name: 'B', sets: importTeam('Snorlax\n- Body Slam\n'), ai: null}}));
  assert.equal(solo.sides[1].units[1].vacant, true);
  assert.equal(solo.onField(solo.sides[1].units[1]), false);
});

test('doubles: spread moves hit both foes and, around the user, the partner too, at x0.75', () => {
  const b = still(dbl());
  b.rng = () => 0.5;   // the same damage roll for every hit, no critical hits
  const [a, c] = b.sides[0].units;
  const [s, l] = b.sides[1].units;
  place(a, 14, 8.5); place(c, 14, 10.8); place(s, 16.2, 7.6); place(l, 16.2, 9.6);
  const eq = b.mon(a).profiles[0];
  const want = Object.fromEntries([['c', c], ['s', s], ['l', l]].map(([k, u]) => [k, b.damage(a, u, eq, {mon: 0, spread: true}).dmg]));
  b.step({p1: {...idle, use: 0}, p2: idle});   // Earthquake: around the user, the partner included
  for (let i = 0; i < 2 * TPS && !b.events.some((e) => e.k === 'hit'); i++) b.step({p1: idle, p2: idle});
  const hits = b.events.filter((e) => e.k === 'hit' && e.move === 'earthquake');
  assert.deepEqual(hits.map((e) => [e.s, e.u]).sort(), [[0, 1], [1, 0], [1, 1]], 'both foes and the partner');
  assert.equal(hits.find((e) => e.s === 1 && e.u === 0).dmg, want.s);
  assert.equal(hits.find((e) => e.s === 1 && e.u === 1).dmg, want.l);
  assert.equal(hits.find((e) => e.s === 0).dmg, want.c);
  const full = b.damage(a, s, eq, {mon: 0});
  assert.ok(Math.abs(want.s / full.dmg - 0.75) < 0.02, `x0.75 (${want.s} / ${full.dmg})`);
  // a move that hits only the foes (Rock Slide falls on both, not on the partner) and one target alone takes full damage
  const r = still(dbl({seed: 'dbl2'}));
  r.rng = () => 0.5;
  const [ra, rc] = r.sides[0].units;
  const [rs, rl] = r.sides[1].units;
  place(ra, 10, 8.5); place(rc, 15.5, 6.6); place(rs, 16, 8); place(rl, 16, 9.4);
  const slide = r.mon(ra).profiles[1];
  const solo = r.damage(ra, rs, slide, {mon: 0}).dmg;
  r.step({p1: {...idle, use: 1}, p2: idle});
  for (let i = 0; i < 2 * TPS && !r.events.some((e) => e.k === 'hit'); i++) r.step({p1: idle, p2: idle});
  const slides = r.events.filter((e) => e.k === 'hit' && e.move === 'rockslide');
  assert.deepEqual(slides.map((e) => [e.s, e.u]).sort(), [[1, 0], [1, 1]], 'the foes, never the partner');
  assert.equal(slides.find((e) => e.u === 0).dmg, r.damage(ra, rs, slide, {mon: 0, spread: true}).dmg, 'x0.75 with two targets');
  assert.ok(slides.find((e) => e.u === 0).dmg < solo);
  place(rl, 16, 15);   // the other foe far away: one target, full damage
  r.mon(ra).cds[1] = 0;
  r.events.length = 0;
  r.step({p1: {...idle, use: 1}, p2: idle});
  for (let i = 0; i < 2 * TPS && !r.events.some((e) => e.k === 'hit'); i++) r.step({p1: idle, p2: idle});
  const one = r.events.filter((e) => e.k === 'hit' && e.move === 'rockslide');
  assert.equal(one.length, 1);
  assert.equal(one[0].dmg, r.damage(ra, rs, slide, {mon: 0}).dmg);
});

test('doubles: Follow Me and Rage Powder draw projectiles; Helping Hand powers the partner up', () => {
  const setup = () => {
    const b = still(dbl());
    const [a, c] = b.sides[0].units;
    const [s, l] = b.sides[1].units;
    place(a, 6, 4); place(c, 6, 13); place(s, 20, 5); place(l, 20, 12);
    return b;
  };
  // Blissey (B's slot b) uses Rage Powder; Clefable (A's slot b) then fires Water Gun locked on Snorlax (slot a): it ends on Blissey
  const b = setup();
  b.step({p1: {...idle, ctl: 1, tgt: 0}, p2: {...idle, ctl: 1, use: 2}});
  assert.ok(b.events.some((e) => e.k === 'follow' && e.s === 1 && e.u === 1 && e.move === 'ragepowder'));
  b.step({p1: {...idle, ctl: 1, tgt: 0, use: 3}, p2: {...idle, ctl: 1}});
  for (let i = 0; i < 2 * TPS && !b.events.some((e) => e.k === 'hit'); i++) b.step({p1: {...idle, ctl: 1}, p2: {...idle, ctl: 1}});
  const hit = b.events.find((e) => e.k === 'hit');
  assert.deepEqual([hit.s, hit.u, hit.move], [1, 1, 'watergun'], 'redirected to the user of Rage Powder');
  // without it, the same shot hits the locked foe
  const n = setup();
  n.step({p1: {...idle, ctl: 1, tgt: 0, use: 3}, p2: idle});
  for (let i = 0; i < 2 * TPS && !n.events.some((e) => e.k === 'hit'); i++) n.step({p1: {...idle, ctl: 1}, p2: idle});
  const plain = n.events.find((e) => e.k === 'hit');
  assert.deepEqual([plain.s, plain.u], [1, 0]);
  // a shot already flying bends towards a foe that uses Follow Me
  const f = setup();
  f.step({p1: {...idle, ctl: 1, tgt: 0, use: 3}, p2: idle});
  f.step({p1: {...idle, ctl: 1}, p2: {...idle, ctl: 1, use: 2}});
  for (let i = 0; i < 2 * TPS && !f.events.some((e) => e.k === 'hit'); i++) f.step({p1: {...idle, ctl: 1}, p2: {...idle, ctl: 1}});
  const bent = f.events.find((e) => e.k === 'hit');
  assert.deepEqual([bent.s, bent.u], [1, 1]);
  // Helping Hand: the partner's next damaging move goes out with x1.5 power
  const h = still(dbl());
  const [ha, hc] = h.sides[0].units;
  const hs = h.sides[1].units[0];
  h.step({p1: {...idle, ctl: 1, use: 1}, p2: idle});
  assert.ok(h.events.some((e) => e.k === 'helping' && e.ally === 0));
  assert.ok(ha.vol.helpedUntil > h.t);
  const claw = h.mon(ha).profiles[2];
  const helped = h.damage(ha, hs, claw, {expected: true, helped: true}).dmg / h.damage(ha, hs, claw, {expected: true}).dmg;
  assert.ok(helped > 1.4 && helped < 1.6, `x1.5 (${helped})`);
  assert.ok(h.mon(hc).cds[1] >= 10 * TPS - 1, 'a long cooldown in doubles');
  // in singles these moves still have no effect
  const single = still(dbl({version: 2}));
  single.step({p1: {...idle, use: 0}, p2: idle});
  single.sides[0].active = 1;
  single.step({p1: {...idle, use: 0}, p2: idle});
  assert.ok(single.events.some((e) => e.k === 'noeffect' && e.move === 'followme'));
});

test('doubles: a person swaps the Pokémon they control and cycles the locked foe; inputs replay exactly', () => {
  const b = new RtBattle(dbl());
  const [a, c] = b.sides[0].units;
  const y0 = a.y;
  const x0 = c.x;
  for (let i = 0; i < 20; i++) b.step({p1: {...idle, my: -1, ctl: 0}, p2: idle});
  assert.ok(a.y < y0 - 1, 'the controlled slot walks');
  for (let i = 0; i < 20; i++) b.step({p1: {...idle, mx: -1, my: 0.3, ctl: 1, tgt: 1}, p2: idle});
  assert.equal(b.view().sides[0].ctl, 1);
  assert.equal(b.view().sides[0].tgt, 1);
  assert.ok(c.x < x0 - 1, 'now the other one walks');
  assert.equal(b.foe(c).pos, 1, 'locked on the foe in slot b');
  assert.ok(b.inputLog.every((r) => r.length === 12), 'doubles rows carry ctl and tgt');
  assert.ok(b.inputLog.some((r) => r[10] === 1 && r[11] === 1));
  // rows without the new columns read as slot a, foe a
  const frame = inputFrame(b, [[1, 0, 0.5, 0, 2, 0, -1, 1, 0, 0]], [null, null]);
  assert.equal(frame.p1.ctl, 0);
  assert.equal(frame.p1.tgt, 0);
  // a whole battle against the AI with swaps, target changes, switches, Plus and Mega, replayed from the input log
  const spec = dbl({seed: 'dbl-person', arena: 'rocks', p2: {name: 'AI', sets: importTeam(DBL_B), ai: {level: 'hard', style: 'balanced'}}});
  const p = new RtBattle(spec);
  let tick = 0;
  while (!p.ended && tick < 300 * TPS) {
    tick++;
    const tr = p.sides[0];
    const lead = p.leadOf(tr);
    const foe = p.foe(lead);
    const input = {mx: Math.sign(foe.x - lead.x) * 0.7, my: Math.round(Math.sin(tick / 30) * 100) / 100, use: tick % 13 === 0 ? (tick / 13) % 4 : -1,
      dodge: tick % 150 === 0, sw: -1, focus: Math.floor(tick / 120) % 2 === 0, plus: tick % 5 === 0, mega: tick % 60 === 0,
      ctl: Math.floor(tick / 200) % 2, tgt: Math.floor(tick / 270) % 2};
    const waiting = tr.units.find((u) => u.need);
    if (waiting && tick % 40 === 0) input.sw = p.bench(waiting)[0]?.slot ?? -1;
    p.step({p1: input});
  }
  assert.ok(p.ended);
  assert.ok(p.events.some((e) => e.k === 'switch' && !e.first && e.s === 0), 'a fainted slot of the person was refilled');
  const again = rtRun(spec, {inputs: p.inputLog});
  assert.deepEqual(again.summary(), p.summary());
  assert.equal(JSON.stringify(again.events), JSON.stringify(p.events));
});

test('doubles: a fainted slot is refilled (the AI at once, a person by choice); the last one leaves it empty', () => {
  const b = new RtBattle(dbl({p2: {name: 'AI', sets: importTeam(DBL_B), ai: {level: 'expert'}}}));
  const [, c] = b.sides[0].units;
  const [s, l] = b.sides[1].units;
  b.faint(s, null);
  assert.equal(s.need, true);
  for (let i = 0; i < TPS && s.need; i++) b.step({p1: idle});
  assert.equal(s.need, false);
  assert.equal(b.mon(s).species, 'Dragonite', 'the AI sends the one left on the bench');
  // a person picks for the partner slot from the party
  b.faint(c, null);
  assert.equal(c.need, true);
  b.step({p1: {...idle, sw: 2}});
  assert.equal(b.mon(c).species, 'Heatran');
  assert.equal(c.need, false);
  // nobody left on the bench: the slot stays empty, the trainer plays on with one
  b.faint(l, null);
  assert.equal(l.vacant, true);
  b.step({p1: idle});
  assert.equal(b.ended, false);
  b.faint(s, null);
  b.step({p1: idle});
  assert.equal(b.ended, true, 'no Pokémon left to come out: the trainer loses');
  assert.equal(b.winner, 0);
});

test('doubles: AI vs AI in every level plays to the end and replays the same', () => {
  for (const level of ['random', 'easy', 'normal', 'hard', 'expert']) {
    const spec = {seed: `d-${level}`, version: 3, arena: 'rocks', format: 'gen9doublescustomgame', time_limit: 300,
      p1: {name: 'A', sets: randomTeam('gen9randombattle', `da${level}`).sets, ai: {level, style: 'balanced'}},
      p2: {name: 'B', sets: importTeam(DBL_A), ai: {level: 'hard', style: 'aggressive'}}};
    const one = rtRun(spec);
    const two = rtRun(spec);
    assert.ok(one.ended && ['ko', 'time'].includes(one.reason), level);
    assert.equal(JSON.stringify(one.events), JSON.stringify(two.events));
    assert.deepEqual(one.summary(), two.summary());
    assert.ok(one.events.some((e) => e.k === 'hit' && e.u === 1), 'the slot b Pokémon fight too');
    assert.ok(eventLines(one)[0].endsWith('|doubles'));
  }
});

test('rules version 3 fills the Mega Power gauge a segment every 8 s, version 2 every 15 s', () => {
  for (const [version, secs] of [[3, 8], [2, 15]]) {
    const b = new RtBattle({seed: `gauge${version}`, format: 'gen9customgame', version, arena: 'open',
      p1: {name: 'A', sets: importTeam('Snorlax\n- Rest\n'), ai: null}, p2: {name: 'B', sets: importTeam('Snorlax\n- Rest\n'), ai: null}});
    for (let t = 0; t < secs * TPS - 2; t++) b.step({});
    assert.ok(b.sides[0].gauge < GAUGE_SEGMENT, `v${version}: not yet a segment just before ${secs} s`);
    for (let t = 0; t < 4; t++) b.step({});
    assert.ok(b.sides[0].gauge >= GAUGE_SEGMENT, `v${version}: a segment after ${secs} s`);
  }
});

// ---------------------------------------------------------------- training
const DUMMY = 'Sudowoodo @ Leftovers\nAbility: Sturdy\nLevel: 100\n- Rock Slide\n- Wood Hammer\n- Sucker Punch\n- Earthquake\n';

test('training: the dummy never faints, heals back at a knockout, and its patterns replay the same', () => {
  const base = {seed: 'train', version: 4, arena: 'open', format: 'gen9customgame', time_limit: 40, training: {pattern: 'still'},
    p1: {name: 'Me', sets: importTeam(TEAM), ai: {level: 'expert', style: 'aggressive'}},
    p2: {name: 'Dummy', sets: importTeam(DUMMY), ai: {level: 'dummy', style: 'balanced', pattern: 'still'}}};
  const still = rtRun(base);
  assert.equal(still.reason, 'time', 'nobody is knocked out: the time runs out');
  assert.ok(still.events.some((e) => e.k === 'dummy_reset'), 'the dummy went down and stood up again');
  assert.ok(!still.events.some((e) => e.k === 'faint'), 'nobody faints in training, not even from recoil');
  assert.ok(!still.events.some((e) => (e.k === 'use' || e.k === 'roll') && e.s === 1), 'a still dummy never moves a finger');
  assert.equal(still.view().training.pattern, 'still');
  // walking: it moves around but never attacks; fighting back: it uses moves
  const walk = rtRun({...base, p2: {...base.p2, ai: {...base.p2.ai, pattern: 'walk'}}});
  assert.ok(walk.events.every((e) => e.k !== 'use' || e.s !== 1));
  const fight = rtRun({...base, p2: {...base.p2, ai: {...base.p2.ai, pattern: 'fight'}}});
  assert.ok(fight.events.some((e) => e.k === 'use' && e.s === 1), 'the fighting dummy attacks');
  // the same spec plays the same battle again, and without `training` the Sudowoodo faints as usual
  assert.equal(JSON.stringify(rtRun(base).events), JSON.stringify(still.events));
  const normal = rtRun({...base, training: undefined, time_limit: 120});
  assert.ok(normal.events.some((e) => e.k === 'faint' && e.s === 1));
});

// ---------------------------------------------------------------- rules version 5: the ultimate
const FP_A = 'Charizard @ Charizardite X\nAbility: Blaze\nEVs: 252 HP / 252 Def\n- Roost\n- Dragon Tail\n- Will-O-Wisp\n- Earthquake\n\nSkarmory @ Leftovers\nAbility: Sturdy\nEVs: 252 HP / 252 Def\n- Roost\n- Brave Bird\n- Spikes\n- Whirlwind\n';
const FP_B = 'Chansey @ Eviolite\nAbility: Natural Cure\nEVs: 252 HP / 252 Def\n- Seismic Toss\n- Soft-Boiled\n- Toxic\n- Thunder Wave\n\nToxapex @ Black Sludge\nAbility: Regenerator\n- Scald\n- Recover\n- Toxic Spikes\n- Haze\n';
const fpSpec = (version) => ({seed: 'v4-fingerprint-long', version, arena: 'rocks', format: 'gen9customgame', time_limit: 120,
  p1: {name: 'X', sets: importTeam(FP_A), ai: {level: 'expert', style: 'balanced'}}, p2: {name: 'Y', sets: importTeam(FP_B), ai: {level: 'hard', style: 'stall'}}});
const sha1 = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex');

test('rules version 4 battles play exactly as before the ultimate existed', () => {
  // fingerprints taken with the simulator before rules version 5 (a 2-minute battle with a Mega Evolution, and a short one)
  assert.equal(sha1(rtRun(fpSpec(4)).events), 'e47c9bea8fceaa707cb2ce02916208f1c10a3875');
  const A = 'Charizard @ Charizardite X\nAbility: Blaze\nEVs: 252 Atk / 252 Spe\nJolly Nature\n- Dragon Dance\n- Flare Blitz\n- Dragon Claw\n- Earthquake\n\nGengar @ Life Orb\nAbility: Cursed Body\n- Shadow Ball\n- Sludge Bomb\n- Focus Blast\n- Thunderbolt\n';
  const B = 'Lucario @ Lucarionite\nAbility: Justified\n- Close Combat\n- Meteor Mash\n- Extreme Speed\n- Swords Dance\n\nBlissey @ Leftovers\nAbility: Natural Cure\n- Soft-Boiled\n- Seismic Toss\n- Thunder Wave\n- Ice Beam\n';
  const short = {seed: 'v4-fingerprint', version: 4, arena: 'rocks', format: 'gen9customgame', time_limit: 200,
    p1: {name: 'X', sets: importTeam(A), ai: {level: 'expert', style: 'aggressive'}}, p2: {name: 'Y', sets: importTeam(B), ai: {level: 'hard', style: 'balanced'}}};
  assert.equal(sha1(rtRun(short).events), 'f90d394d3e00cc771ccabe0c70a928b735481a36');
});

test('rules version 5: damage fills the ultimate gauge, the AI unleashes it, it falls where it was telegraphed and replays the same', () => {
  const one = rtRun(fpSpec(5));
  const ults = one.events.filter((e) => e.k === 'ultimate');
  assert.ok(ults.length >= 1, 'the AI unleashes its ultimate');
  const u = ults[0];
  assert.ok(one.events.some((e) => e.k === 'use' && e.move === 'silverultimate' && e.s === u.s));
  assert.ok(one.events.some((e) => e.k === 'area' && e.move === 'silverultimate' && e.r === 2.6));
  assert.equal(JSON.stringify(rtRun(fpSpec(5)).events), JSON.stringify(one.events));
  assert.equal(rtRun(fpSpec(4)).events.filter((e) => e.k === 'ultimate').length, 0, 'version 4 has no ultimate');
  // a person: the key does nothing until the gauge is full; then the ultimate goes out, the gauge empties, and the log replays it
  const human = {...fpSpec(5), seed: 'ult-person', p1: {...fpSpec(5).p1, ai: null}};
  const b = new RtBattle(human);
  assert.equal(b.view().sides[0].ult, 0);
  b.step({p1: {use: 9}});
  assert.ok(!b.events.some((e) => e.k === 'ultimate'), 'an empty gauge does nothing');
  let fired = false;
  while (!b.ended && b.t < 120 * TPS) {
    const me = b.sides[0], foe = b.sides[1];
    const input = {mx: Math.sign(foe.x - me.x) * 0.6, my: 0, use: b.t % 13 === 0 ? (b.t / 13) % 4 : -1, focus: true};
    if (me.need) input.sw = me.mons.findIndex((m) => !m.fainted);
    if (b.view().sides[0].ult_ready) { input.use = 9; fired = true; }
    b.step({p1: input});
  }
  assert.ok(fired && b.events.some((e) => e.k === 'ultimate' && e.s === 0));
  const again = rtRun(human, {inputs: b.inputLog});
  assert.equal(JSON.stringify(again.events), JSON.stringify(b.events));
});
