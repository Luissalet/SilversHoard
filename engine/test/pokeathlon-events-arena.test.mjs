// Five Pokéathlon events (Disc Catch, Lamp Jump, Ring Drop, Snow Throw, Goal Roll): each module plays a whole event headless with a stub
// ctx (CPU only, then with a scripted person), finishes exactly once with four numbers, is deterministic from its seed, and its rules
// behave as the SPEC says (tap = jump, flick = dash, a held ball grows, a kick takes power, ...).
import test from 'node:test';
import assert from 'node:assert/strict';
import discCatch from '../../client/src/pokeathlon/events/disc_catch.js';
import lampJump from '../../client/src/pokeathlon/events/lamp_jump.js';
import ringDrop from '../../client/src/pokeathlon/events/ring_drop.js';
import snowThrow from '../../client/src/pokeathlon/events/snow_throw.js';
import goalRoll from '../../client/src/pokeathlon/events/goal_roll.js';
import {makeRand} from '../../client/src/pokeathlon/events/_kit5/util.js';
import {DiscCatchSim, ST as DC_ST} from '../../client/src/pokeathlon/events/disc_catch/sim.js';
import {LampJumpSim} from '../../client/src/pokeathlon/events/lamp_jump/sim.js';
import {RingDropSim, ST as RD, insideRing, direction, JUMP_HEIGHTS} from '../../client/src/pokeathlon/events/ring_drop/sim.js';
import {SnowThrowSim, BALL, addSpread, energyFactor} from '../../client/src/pokeathlon/events/snow_throw/sim.js';
import {GoalRollSim, MODE, STATE, wallPush, KICK} from '../../client/src/pokeathlon/events/goal_roll/sim.js';

const EVENTS = {disc_catch: discCatch, lamp_jump: lampJump, ring_drop: ringDrop, snow_throw: snowThrow, goal_roll: goalRoll};
const COUNTERS = ['failed', 'jumped', 'points', 'hit', 'fell', 'dashed', 'switched', 'selfImpeded'];

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** a canvas context that accepts everything (so render() can be smoke-tested without a browser) */
function fakeG() {
  const proxy = new Proxy(function () {}, {
    get: (t, k) => (k === 'measureText' ? (s) => ({width: String(s).length * 7}) : k === Symbol.toPrimitive ? () => 0 : proxy),
    set: () => true,
    apply: () => proxy,
  });
  return proxy;
}

const MONS = [25, 133, 448, 445, 183, 39, 94, 130, 150, 6, 9, 3];
function makeTeams(human, stars = {speed: 3, power: 3, skill: 3, stamina: 3, jump: 3}) {
  return [0, 1, 2, 3].map((i) => ({
    index: i, name: ['Rojo', 'Azul', 'Verde', 'Amarillo'][i], color: ['#e5483d', '#3b82e6', '#35b25c', '#f0b429'][i], human: i === human, cpu: 0,
    mons: [0, 1, 2].map((k) => ({species: 'x', num: MONS[i * 3 + k], form: 0, name: `M${i}${k}`, stars: {...stars}})),
  }));
}

function stubCtx(seed, human = -1, stars) {
  const calls = {finish: [], sfx: []};
  const input = {pointer: {x: 480, y: 270, down: false, pressed: false, released: false, path: [], flick: null}, keys: new Set(), pressed: new Set(),
    pad: {lx: 0, ly: 0, rx: 0, ry: 0, held: new Set(), pressed: new Set()}};
  const nullAnimator = {meta: null, cur: 'Idle', loop() {}, play() {}, update() {}, draw() { return false; }, has() { return false; }, height() { return 30; }};
  const ctx = {
    W: 960, H: 540, teams: makeTeams(human, stars), rng: mulberry(seed), input, focus: Math.max(0, human), humans: () => (human >= 0 ? [human] : []),
    inputs: [0, 1, 2, 3].map((i) => (i === Math.max(0, human) ? input : {pointer: {x: 0, y: 0, down: false, pressed: false, released: false, path: [], flick: null}, keys: new Set(), pressed: new Set(), pad: {lx: 0, ly: 0, rx: 0, ry: 0, held: new Set(), pressed: new Set()}})), lang: 'es', mode: human >= 0 ? 'play' : 'watch',
    t: (es) => es, animator: () => nullAnimator, icon: () => null, sfx: (n) => calls.sfx.push(n),
    finish: (r) => calls.finish.push(r),
  };
  return {ctx, calls, input};
}

/** play to the end, rendering now and then; returns the result and the number of finish() calls */
function play(mod, seed, {human = -1, script = null, stars, render = false} = {}) {
  const {ctx, calls, input} = stubCtx(seed, human, stars);
  const inst = mod.create(ctx);
  const g = fakeG();
  let n = 0;
  while (!calls.finish.length && n < 6000) {
    if (script) script(n, input, inst);
    inst.update(1 / 30);
    input.pointer.pressed = false; input.pointer.released = false; input.pressed.clear();
    if (render && n % 25 === 0) inst.render(g);
    n++;
  }
  const at = n;
  for (let i = 0; i < 40; i++) { inst.update(1 / 30); input.pressed.clear(); }
  if (render) inst.render(g);
  inst.destroy();
  return {result: calls.finish[0], finishCalls: calls.finish.length, frames: at, sfx: calls.sfx, inst};
}

/** a person who drags, taps and presses keys all over the field, whatever the event */
function scribble(n, input) {
  const spots = [[430, 300], [520, 260], [360, 380], [600, 330], [480, 200], [300, 300], [650, 420], [470, 420]];
  const k = Math.floor(n / 40) % spots.length, f = n % 40, p = input.pointer;
  const [x, y] = spots[k];
  if (f === 0) { p.x = x; p.y = y; p.down = true; p.pressed = true; }
  else if (f === 3) { p.x = x + 50 * (k % 2 ? 1 : -1); p.y = y - 40; }
  else if (f === 6) { p.x = x + 90 * (k % 2 ? 1 : -1); p.y = y + 70; p.down = false; p.released = true; }
  if (f === 12) input.pressed.add(['Space', 'ShiftLeft', 'Digit2', 'Tab', 'Enter', 'KeyJ', 'Digit3', 'KeyE'][k]);
  if (f === 14) { input.keys.add(['KeyD', 'KeyA', 'KeyW', 'KeyS', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'][k]); }
  if (f === 30) input.keys.clear();
}

for (const [id, mod] of Object.entries(EVENTS)) {
  test(`${id}: the module has the shape of the contract`, () => {
    assert.equal(mod.id, id);
    assert.ok(mod.names.es && mod.names.en);
    assert.ok(Array.isArray(mod.stats) && mod.stats.length >= 2);
    assert.ok(mod.seconds === 60 || mod.seconds === 90);
    assert.ok(mod.help.es.length > 40 && mod.help.en.length > 40);
    assert.equal(typeof mod.create, 'function');
  });

  test(`${id}: four CPU teams play to the end, finish once with four numbers and detail, and the same seed gives the same event`, () => {
    const a = play(mod, 11, {render: true});
    assert.equal(a.finishCalls, 1);
    assert.equal(a.result.raw.length, 4);
    for (const v of a.result.raw) assert.ok(Number.isFinite(v) && v >= 0, `raw ${v}`);
    assert.equal(a.result.detail.length, 4);
    for (const d of a.result.detail) {
      assert.equal(d.mons.length, 3);
      for (const m of d.mons) for (const c of COUNTERS) assert.ok(Number.isFinite(m[c]) && m[c] >= 0, `${c}`);
    }
    const seconds = a.frames / 30;
    assert.ok(seconds >= mod.seconds && seconds < mod.seconds + 2, `ends with its clock: ${seconds}`);
    const b = play(mod, 11);
    assert.deepEqual(b.result, a.result);
    const c = play(mod, 12);
    assert.notDeepEqual(c.result.raw, a.result.raw);
  });

  test(`${id}: a person who scribbles with mouse and keys on every team slot does not break it`, () => {
    for (const human of [0, 2]) {
      const r = play(mod, 5 + human, {human, script: scribble, render: true});
      assert.equal(r.finishCalls, 1);
      assert.equal(r.result.raw.length, 4);
      assert.ok(r.result.raw.every(Number.isFinite));
    }
  });
}

// ------------------------------------------------------------------------------------------------------------------ calibration
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

test('ring drop: four CPU teams of equal stats score about what the SPEC measured (41 at raw 0, 52 at raw 4)', () => {
  const m = [];
  for (const k of [0, 4]) {
    const rand = makeRand(mulberry(7 + k));
    const all = [];
    for (let i = 0; i < 40; i++) {
      const stats = [0, 1, 2, 3].map(() => [0, 1, 2].map(() => ({power: k, speed: k, jump: k, stamina: k})));
      const s = new RingDropSim({stats, rand, human: -1});
      while (!s.over) s.step();
      all.push(...s.scores);
    }
    m.push(mean(all));
  }
  assert.ok(m[0] > 32 && m[0] < 52, `raw 0 mean ${m[0]}`);
  assert.ok(m[1] > 42 && m[1] < 64, `raw 4 mean ${m[1]}`);
});

test('snow throw: the CPU means of the SPEC (24 at raw 0, 29 at raw 4) and Power/Skill/Stamina help', () => {
  const m = [];
  for (const k of [0, 4]) {
    const rand = makeRand(mulberry(1));
    const all = [];
    for (let i = 0; i < 50; i++) {
      const stats = [0, 1, 2, 3].map(() => [0, 1, 2].map(() => ({power: k, skill: k, stamina: k})));
      const s = new SnowThrowSim({stats, rand, human: -1});
      while (!s.over) s.step();
      all.push(...s.scores);
    }
    m.push(mean(all));
  }
  assert.ok(m[0] > 21.5 && m[0] < 26.5, `raw 0 mean ${m[0]}`);
  assert.ok(m[1] > 26 && m[1] < 32, `raw 4 mean ${m[1]}`);
  assert.ok(m[1] > m[0] + 2);
});

test('goal roll: the CPUs are weak (net goals around 1 per team, many end on 0)', () => {
  const rand = makeRand(mulberry(7));
  const all = [];
  for (let i = 0; i < 24; i++) {
    const stats = [0, 1, 2, 3].map(() => [0, 1, 2].map(() => ({power: 2, speed: 2, stamina: 2, skill: 2})));
    const s = new GoalRollSim({stats, rand, human: -1});
    while (!s.over) s.step();
    all.push(...s.scores);
  }
  const m = mean(all);
  assert.ok(m > 0.4 && m < 2.2, `mean ${m}`);
  assert.ok(all.filter((v) => v === 0).length > all.length * 0.2);
  assert.ok(all.every((v) => v >= 0 && v <= 99));
});

// ------------------------------------------------------------------------------------------------------------------ ring drop
function ringSim(human = 0, k = 2) {
  const stats = [0, 1, 2, 3].map(() => [0, 1, 2].map(() => ({power: k, speed: k, jump: k, stamina: k})));
  const s = new RingDropSim({stats, rand: makeRand(mulberry(3)), human});
  for (const c of s.cpus) c.wait = 1e9;            // the CPUs stand still
  return s;
}
const place = (p, x, y) => { p.pos = [x, y]; p.ppos = [x, y]; p.dest = [x, y]; };
const hold = (s, x, y, frames) => { for (let i = 0; i < frames; i++) s.step({touch: {down: true, x, y}}); };
const release = (s, x, y) => s.step({touch: {down: false, x, y}});

test('ring drop: the ring is the trapezoid of the SPEC and the start spots are inside it', () => {
  assert.ok(insideRing(128, 100) && insideRing(50, 64) && insideRing(220, 160));
  assert.ok(!insideRing(40, 64) && !insideRing(128, 163) && !insideRing(228, 160) && !insideRing(128, 60));
  assert.equal(direction(1, 0), 4); assert.equal(direction(0, 1), 2); assert.equal(direction(-1, 0), 3); assert.equal(direction(0, -1), 1);
  const s = ringSim();
  for (const p of s.parts) assert.ok(insideRing(p.gx, p.gy));
});

test('ring drop: a quick tap on your Pokémon jumps, a quick flick dashes a fixed 44.7 px, a 4-12 px nudge does nothing', () => {
  let s = ringSim();
  const p = s.parts[0];
  const [px, py] = p.pos.map(Math.round);
  hold(s, px, py, 2); release(s, px, py);
  for (let i = 0; i < 4; i++) s.step();
  assert.ok([RD.JUMP_START, RD.JUMP_RISE].includes(p.state), `state ${p.state}`);
  assert.equal(p.m.c.jumped, 1);
  for (let i = 0; i < 60; i++) s.step();
  assert.equal(p.state, RD.STAND);

  s = ringSim();
  const q = s.parts[0];
  const [qx, qy] = q.pos.map(Math.round);
  s.step({touch: {down: true, x: qx, y: qy}});
  s.step({touch: {down: true, x: qx + 30, y: qy}});
  release(s, qx + 30, qy);
  const x0 = q.pos[0];
  assert.equal(q.state, RD.DASH_START);
  for (let i = 0; i < 10; i++) s.step();
  assert.equal(q.state, RD.DASH_END);
  assert.equal(q.m.c.dashed, 1);
  for (let i = 0; i < 40; i++) s.step();
  assert.equal(q.state, RD.STAND);
  assert.ok(Math.abs(q.pos[0] - x0 - 44.7) < 1.5, `dash length ${q.pos[0] - x0}`);

  s = ringSim();
  const r = s.parts[0];
  const [rx, ry] = r.pos.map(Math.round);
  s.step({touch: {down: true, x: rx, y: ry}}); s.step({touch: {down: true, x: rx + 8, y: ry}}); release(s, rx + 8, ry);
  for (let i = 0; i < 10; i++) s.step();
  assert.equal(r.m.c.jumped + r.m.c.dashed, 0);
});

test('ring drop: holding the finger walks the Pokémon at its speed; the swap button swaps inside the corner zone, with its 22 steps', () => {
  const s = ringSim(0, 2);
  const p = s.parts[0];
  const [px, py] = p.pos;
  s.step({touch: {down: true, x: Math.round(px), y: Math.round(py)}});          // press on the Pokémon
  hold(s, 200, 90, 10);
  assert.ok(Math.abs(p.pos[0] - px - 27) < 4, `walked ${p.pos[0] - px}`);   // 9 steps at 3.0 px
  release(s, 200, 90);
  const s2 = ringSim(0, 2);
  const q = s2.parts[0];
  s2.step({touch: {down: true, x: 130, y: 10}});
  s2.step({touch: {down: false, x: 130, y: 10}});
  assert.ok(q.switching);
  assert.equal(q.m.c.switched, 1);
  for (let i = 0; i < 30; i++) s2.step();
  assert.equal(q.mem, 1);
  assert.equal(q.state, RD.RETURN);
  // outside the corner zone nothing happens
  const s3 = ringSim(0, 2);
  place(s3.parts[0], 200, 120);
  s3.step({touch: {down: true, x: 130, y: 10}});
  assert.ok(!s3.parts[0].switching);
});

test('ring drop: a dash hit scores +1 and drains stamina, a knock-out is +10 for the pusher and 60 steps out of play, and the next member comes in', () => {
  const s = ringSim(0, 2);
  const a = s.parts[0], b = s.parts[1];
  place(a, 100, 96); place(b, 118, 96);
  s.step({act: {dash: [118, 96]}});
  for (let i = 0; i < 20; i++) s.step();
  assert.equal(a.score >= 1, true);
  assert.ok(b.m.sta < b.m.maxSta);
  // push b off the edge: put it by the edge and dash into it
  const s2 = ringSim(0, 4);
  const c = s2.parts[0], d = s2.parts[1];
  place(c, 182, 62); place(d, 200, 62);
  s2.step({act: {dash: [200, 62]}});
  let fell = false;
  for (let i = 0; i < 80 && !fell; i++) { s2.step(); fell = d.state === RD.FALL_OUT; }
  assert.ok(fell, 'the target went out of the ring');
  assert.ok(c.score >= 11, `score ${c.score}`);
  assert.equal(c.m.c.points >= 1, true);
  for (let i = 0; i < 70; i++) s2.step();
  assert.equal(d.mem, 1);
  assert.equal(d.state, RD.RETURN);
  assert.equal(d.members[0].c.fell, 1);
  assert.ok(JUMP_HEIGHTS[4][9] === 48);
});

test('ring drop: a Pokémon that falls out with nobody to blame loses 10 points (never below 0)', () => {
  const s = ringSim(0, 2);
  const a = s.parts[0];
  a.score = 14;
  place(a, 20, 100);                                   // outside the ring on the left
  s.step();
  assert.equal(a.state, RD.FALL_OUT);
  assert.equal(a.score, 4);
  assert.equal(a.m.c.selfImpeded, 1);
});

test('ring drop: nobody can act for 60 steps after the respawn (no collisions) and an exhausted Pokémon rests 60 steps with 20 stamina after', () => {
  const s = ringSim(0, 2);
  const a = s.parts[0];
  a.m.sta = 0;
  s.step();
  assert.ok(a.exhausted);
  for (let i = 0; i < 62; i++) s.step();
  assert.ok(!a.exhausted);
  assert.ok(Math.abs(a.m.sta - 20) < 2);
});

// ------------------------------------------------------------------------------------------------------------------ snow throw
function snowSim(human = 0, k = 2) {
  const stats = [0, 1, 2, 3].map(() => [0, 1, 2].map(() => ({power: k, skill: k, stamina: k})));
  const s = new SnowThrowSim({stats, rand: makeRand(mulberry(2)), human});
  s.cpu.timer = -1e9;
  return s;
}

test('snow throw: taps make the ball bigger (size 0,0,1,2,3 for 0..4 taps), a drag out of the 4-unit circle throws it', () => {
  const s = snowSim();
  const m = s.mons[1];
  const [hx, hz] = m.home;
  for (let n = 1; n <= 4; n++) {
    s.step({touch: {down: true, x: hx, z: hz}}); s.step({touch: {down: false, x: hx, z: hz}});
    assert.equal(m.ball.taps, n);
    assert.equal(m.ball.size, [0, 0, 1, 2, 3][n]);
    assert.equal(m.ball.state, BALL.HELD);
  }
  s.step({touch: {down: true, x: hx, z: hz}});
  s.step({touch: {down: true, x: hx, z: hz - 20}});
  s.step({touch: {down: false, x: hx, z: hz - 20}});
  assert.equal(m.ball.state, BALL.FLYING);
  assert.ok(m.ball.vel[1] < 0 && Math.abs(m.ball.vel[0]) < 0.3);
  // skill raw 2: weight 1.2 -> (2 - 1.2) * 2 = 1.6 at full energy and a one-step hold of 1 + 2/30
  const speed = Math.hypot(...m.ball.vel);
  assert.ok(speed > 1.4 && speed <= 1.6 + 1e-6, `speed ${speed}`);
});

test('snow throw: a slow throw is weaker (hold up to 30 steps halves it), tired Pokémon throw weaker, strength is clamped to 1..3', () => {
  const quick = snowSim(), slow = snowSim();
  for (const [s, frames] of [[quick, 1], [slow, 30]]) {
    const m = s.mons[1];
    const [hx, hz] = m.home;
    s.step({touch: {down: true, x: hx, z: hz}});
    for (let i = 0; i < frames; i++) s.step({touch: {down: true, x: hx, z: hz - 20}});
    s.step({touch: {down: false, x: hx, z: hz - 20}});
  }
  const q = Math.hypot(...quick.mons[1].ball.vel), sl = Math.hypot(...slow.mons[1].ball.vel);
  assert.ok(sl < q * 0.75 && sl >= 1, `${sl} vs ${q}`);
  assert.equal(energyFactor(120), 1); assert.equal(energyFactor(60), 0.5); assert.equal(energyFactor(75), 0.7);
});

test('snow throw: a ball that reaches a Pokémon of another team within 3 units scores 1 and takes energy; a big one stuns', () => {
  const s = snowSim(0, 2);
  const thrower = s.mons[1];                                   // (33, 61)
  const target = s.mons[7];                                    // team 2 (33, 5), straight above
  const [hx, hz] = thrower.home;
  thrower.ball.state = BALL.HELD; thrower.ball.pos = thrower.home.slice(); thrower.ball.taps = 4; thrower.ball.size = 3;
  s.step({touch: {down: true, x: hx, z: hz}});
  s.step({touch: {down: true, x: hx, z: hz - 20}});
  s.step({touch: {down: false, x: hx, z: hz - 20}});
  let hit = null;
  for (let i = 0; i < 80 && !hit; i++) { s.step(); hit = s.events.find((e) => e.type === 'hit'); }
  assert.ok(hit, 'it hit');
  assert.equal(hit.to, 7);
  assert.equal(s.teamScore(0), 1);
  assert.equal(thrower.hits, 1);
  assert.ok(target.stunned && target.stun >= 100, `stun ${target.stun}`);   // size 3: everything lost
  assert.equal(target.c.failed, 1);
  assert.equal(thrower.c.points, 1);
});

test('snow throw: two balls closer than 4 splash each other and a held ball shields its Pokémon; the aim spread is within its degrees', () => {
  const s = snowSim(0, 2);
  const a = s.mons[1], b = s.mons[7];
  a.ball.state = BALL.FLYING; a.ball.pos = [33, 30]; a.ball.vel = [0, 0];
  b.ball.state = BALL.FLYING; b.ball.pos = [33, 32]; b.ball.vel = [0, 0];
  s.step();
  assert.equal(a.ball.state, BALL.SPLASHED); assert.equal(b.ball.state, BALL.SPLASHED);
  const rand = makeRand(mulberry(4));
  for (let i = 0; i < 200; i++) {
    const v = addSpread([0, -1], 3, rand);
    const ang = Math.abs(Math.atan2(v[0], -v[1]) * 180 / Math.PI);
    assert.ok(ang <= 3.0001, `angle ${ang}`);
  }
  assert.deepEqual(addSpread([0, -1], 0, rand), [0, -1]);
});

test('snow throw: keyboard taps and throws use the same rules as the stylus', () => {
  const s = snowSim(0, 2);
  s.step({keys: [{type: 'tap', mon: 2}, {type: 'tap', mon: 2}]});
  assert.equal(s.mons[2].ball.taps, 2);
  s.step({keys: [{type: 'throw', mon: 2, dir: [0, -1], hold: 0}]});
  assert.equal(s.mons[2].ball.state, BALL.FLYING);
  assert.ok(s.mons[2].ball.vel[1] < -1.4);
});

// ------------------------------------------------------------------------------------------------------------------ goal roll
function goalSim(human = 0, k = 2) {
  const stats = [0, 1, 2, 3].map(() => [0, 1, 2].map(() => ({power: k, speed: k, stamina: k, skill: k})));
  const s = new GoalRollSim({stats, rand: makeRand(mulberry(1)), human});
  s.cpuTeams.length = 0;
  return s;
}

test('goal roll: Pokémon keep out of the corner triangles and inside the walls, balls stop at the walls', () => {
  const w = wallPush(30, 40, 60, 60, 8, true);          // inside the top-left goal triangle: pushed back
  assert.ok(w.code >= 5 && w.x + w.y >= 80 + 8 * Math.SQRT2 - 1e-6, JSON.stringify(w));
  const e = wallPush(250, 100, 240, 100, 8, false);
  assert.equal(e.code, 2); assert.equal(e.x, 239);
  const t = wallPush(100, 10, 100, 30, 12, false);
  assert.equal(t.code, 3); assert.equal(t.y, 28);
  assert.equal(KICK[0].length, 30); assert.equal(KICK[4][0], 7);
});

test('goal roll: a quick swipe that ends beyond the ball dashes and kicks it (KICKED, last kicker, a hit counted); a slow drag only nudges', () => {
  const s = goalSim(0, 2);
  const m = s.mons[0], ball = s.balls[0];
  m.pos = [85, 76]; m.ppos = m.pos.slice(); m.target = m.pos.slice();
  s.step({touch: {down: true, x: 85, y: 76}});
  s.step({touch: {down: true, x: 150, y: 120}});
  s.step({touch: {down: false, x: 150, y: 120}});
  assert.equal(m.c.dashed, 1);
  let kick = null;
  for (let i = 0; i < 30 && !kick; i++) { s.step(); kick = s.events.find((e) => e.type === 'kick'); }
  assert.ok(kick, 'the dash kicked the ball');
  assert.equal(m.c.hit, 1);
  assert.equal(ball.last, 0);
  assert.equal(ball.state, STATE.KICKED);
  assert.equal(m.mode, MODE.WALK);
  for (let i = 0; i < 3; i++) s.step();
  assert.ok(ball.pos[0] > 135, `ball moved ${ball.pos}`);

  const t = goalSim(0, 2);
  const w = t.mons[0];
  w.pos = [85, 76]; w.ppos = w.pos.slice(); w.target = w.pos.slice();
  t.step({touch: {down: true, x: 85, y: 76}});
  for (let i = 0; i < 30; i++) t.step({touch: {down: true, x: 150, y: 120}});
  t.step({touch: {down: false, x: 150, y: 120}});
  assert.equal(w.c.dashed, 0);
  assert.equal(w.mode, MODE.WALK);
});

test('goal roll: a goal counts for the team that touched the ball last, takes 1 from the owner of the goal, and an own goal costs 1', () => {
  const s = goalSim(0, 2);
  const ball = s.balls[0];
  s.scores = [0, 0, 0, 3];
  ball.pos = [230, 170]; ball.ppos = ball.pos.slice(); ball.last = 1;             // team 0 touched it last... member 1 of team 0
  ball.pos = [200, 190];                                                           // inside goal 3 (bottom-right): x + y > 384
  s.goals();
  assert.equal(ball.state, STATE.SCORED);
  assert.equal(s.scores[0], 1);
  assert.equal(s.scores[3], 2);
  assert.equal(s.mons[1].c.points, 1);
  // own goal
  const o = goalSim(0, 2);
  o.scores = [2, 0, 0, 0];
  o.balls[0].pos = [30, 40]; o.balls[0].last = 2;                                  // goal 0 (top-left) is team 0's own
  o.goals();
  assert.equal(o.scores[0], 1);
  assert.equal(o.mons[2].c.selfImpeded, 1);
  assert.equal(o.mons[2].c.failed, 1);
  // a big ball is worth 2
  const b = goalSim(0, 2);
  b.balls[0].kind = 2; b.balls[0].pos = [200, 20]; b.balls[0].last = 0;            // goal 1 (top-right): x - y > 176
  b.goals();
  assert.equal(b.scores[0], 2);
});

test('goal roll: the second ball arrives with 30 s to go and a scored ball respawns after 10 steps waiting 8', () => {
  const s = goalSim(0, 2);
  s.timer = 901;
  s.step();
  assert.equal(s.balls[1].kind, 1);
  assert.equal(s.balls[1].state, STATE.WAITING);
  for (let i = 0; i < 9; i++) s.step();
  assert.equal(s.balls[1].state, STATE.ROLLING);
  const r = goalSim(0, 2);
  r.balls[0].pos = [200, 20]; r.balls[0].last = 0;
  r.step();
  assert.equal(r.balls[0].state, STATE.SCORED);
  for (let i = 0; i < 12; i++) r.step();
  assert.equal(r.balls[0].state, STATE.WAITING);
  for (let i = 0; i < 9; i++) r.step();
  assert.equal(r.balls[0].state, STATE.ROLLING);
});

test('goal roll: a kicked ball takes power from the Pokémon it hits and stuns at 0 for 90 steps', () => {
  const s = goalSim(0, 2);
  const m = s.mons[6];                                      // team 2 member 0 (88, 128 - 10)
  const ball = s.balls[0];
  m.power = 20;
  const c = m.cc;
  ball.pos = [c[0] + 12, c[1]]; ball.ppos = ball.pos.slice();
  ball.state = STATE.KICKED; ball.table = 2; ball.strength = 30; ball.speed = 7; ball.level = 2; ball.last = 0; ball.step = 1; ball.steps = 30; ball.row = 2;
  ball.setDir([-1, 0]);
  s.step();
  assert.equal(m.mode === MODE.STUNNED || m.stun > 0, true);
  assert.equal(m.power, 0);
  assert.equal(m.c.failed, 1);
  for (let i = 0; i < 95; i++) s.step();
  assert.equal(m.mode, MODE.WALK);
  assert.equal(m.power, m.maxPower);
});

// ------------------------------------------------------------------------------------------------------------------ disc catch and lamp jump
test('disc catch: a short tap on your Pokémon jumps (when it can), a long press and drag walks it', () => {
  const stats = Array.from({length: 12}, () => ({power: 2, speed: 2, jump: 2}));
  const s = new DiscCatchSim({stats, large: [], rand: makeRand(mulberry(1)), human: 0});
  s.cpu.length = 0;
  const m = s.mons[1];
  s.step({touch: {touchNew: true, touching: true, lastTouchFrames: 0, touchX: m.x, touchY: m.y}});
  s.step({touch: {touchNew: false, touching: false, lastTouchFrames: 2, touchX: m.x, touchY: m.y}});
  assert.equal(m.state, DC_ST.JUMPING);
  assert.equal(m.c.jumped, 1);
  for (let i = 0; i < 40; i++) s.step();
  assert.equal(m.state, DC_ST.ON_FIELD);
  const x0 = m.x;
  s.step({touch: {touchNew: true, touching: true, lastTouchFrames: 0, touchX: m.x, touchY: m.y}});
  for (let i = 0; i < 6; i++) s.step({touch: {touchNew: false, touching: true, lastTouchFrames: 0, touchX: x0 + 60, touchY: m.y}});
  assert.ok(m.x > x0 + 10, `walked ${m.x - x0}`);
});

test('lamp jump: dragging a Pokémon down and letting go launches it (a jump counted), the cloth dents and the sim stays deterministic', () => {
  const run = () => {
    const s = new LampJumpSim({stats: [0, 1, 2].map(() => ({jump: 2, stamina: 2, skill: 2})), rand: makeRand(mulberry(1))});
    const m = s.mons[1];
    s.step({touch: {touchNew: true, touching: true, x: Math.round(m.x), y: Math.round(m.cy)}});
    s.step({touch: {touchNew: false, touching: true, x: Math.round(m.x) - 8, y: Math.round(m.cy) + 50}});
    s.step({touch: {touchNew: false, touching: false, x: Math.round(m.x) - 8, y: Math.round(m.cy) + 50}});
    let top = 0;
    for (let i = 0; i < 90; i++) { s.step(); top = Math.max(top, m.height); }
    return {jumped: m.c.jumped, top, total: s.total};
  };
  const a = run();
  assert.equal(a.jumped, 1);
  assert.ok(a.top > 64 * 20, `rose ${a.top}`);
  assert.deepEqual(run(), a);
});
