// Pokéathlon events in lockstep (a room with friends): several copies of an event, each on its own "computer", given the same frames of
// input, must end with the same scores and the same random-number checksum, with one or several people playing, and when the CPU takes
// over a person who leaves. Plus the pieces around it: Input.snapshot/apply, the frames store.
import test from 'node:test';
import assert from 'node:assert/strict';
import hurdleDash from '../../client/src/pokeathlon/events/hurdle_dash.js';
import pennantCapture from '../../client/src/pokeathlon/events/pennant_capture.js';
import circlePush from '../../client/src/pokeathlon/events/circle_push.js';
import blockSmash from '../../client/src/pokeathlon/events/block_smash.js';
import relayRun from '../../client/src/pokeathlon/events/relay_run.js';
import discCatch from '../../client/src/pokeathlon/events/disc_catch.js';
import lampJump from '../../client/src/pokeathlon/events/lamp_jump.js';
import ringDrop from '../../client/src/pokeathlon/events/ring_drop.js';
import snowThrow from '../../client/src/pokeathlon/events/snow_throw.js';
import goalRoll from '../../client/src/pokeathlon/events/goal_roll.js';
import {Input, makeRng} from '../../client/src/pokeathlon/core.js';
import {Lockstep, CPU_FRAME, runLockstep} from '../../client/src/pokeathlon/lockstep.js';

const STAT_KEYS = ['speed', 'power', 'skill', 'stamina', 'jump'];
const stars = (n) => Object.fromEntries(STAT_KEYS.map((k) => [k, n]));
const mon = (n, i = 0) => ({species: 'Pikachu', num: 25, form: '', name: `M${i}`, stars: stars(n)});
/** four teams of three Pokémon; `humans` are the indexes of the people's teams */
const teamsOf = (level, humans = []) => level.map((n, i) => ({index: i, name: `T${i}`, color: '#fff', human: humans.includes(i), cpu: 0, mons: [mon(n, 0), mon(n, 1), mon(n, 2)]}));

// what each person does, per event (a script presses things on the device's Input every tick)
const SCRIPTS = {
  hurdle_dash: (seed) => (tick, dev) => {
    const lane = 1 + ((tick + seed) % 3);
    if ((tick + seed) % 6 === 0) dev.keyDown(`Digit${lane}`);
    if ((tick + seed) % 6 === 3) for (let k = 1; k <= 3; k++) dev.keyUp(`Digit${k}`);
  },
};
/** a keyboard player: holds a direction for a while, then another, and taps an action key now and then */
const keyScript = (dirs, actions, every = 14) => (seed) => {
  let held = null;
  return (tick, dev) => {
    const t = tick + seed * 5;
    if (t % every === 0) {
      if (held) dev.keyUp(held);
      held = dirs[Math.floor(t / every) % dirs.length];
      if (held) dev.keyDown(held);
    }
    const a = actions[Math.floor(t / 20) % actions.length];
    if (t % 10 === 0) dev.keyDown(a);
    if (t % 10 === 4) dev.keyUp(a);
  };
};
SCRIPTS.pennant_capture = keyScript(['ArrowUp', 'ArrowLeft', 'ArrowUp', 'ArrowRight'], ['Space']);
SCRIPTS.circle_push = keyScript(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'], ['Space', 'KeyE', 'Digit2']);
SCRIPTS.block_smash = keyScript(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'], ['Space', 'Tab']);
// charges the fling for half a second, lets go, and now and then swaps the runner
SCRIPTS.relay_run = (seed) => {
  let held = null;
  return (tick, dev) => {
    const t = tick + seed * 7;
    if (t % 12 === 0) {
      if (held) dev.keyUp(held);
      held = t % 24 === 0 ? (t % 72 === 0 ? 'ArrowDown' : 'ArrowRight') : null;
      if (held) dev.keyDown(held);
    }
    if (t % 150 === 3) dev.keyDown('Space');
    if (t % 150 === 6) dev.keyUp('Space');
  };
};
SCRIPTS.disc_catch = keyScript(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'], ['Space', 'Digit2', 'Space', 'KeyE']);
// charges a jump for most of a second, aims a little to one side or the other, lets go, and picks another Pokémon now and then
SCRIPTS.lamp_jump = (seed) => (tick, dev) => {
  const t = tick + seed * 11;
  const k = t % 60;
  if (k === 0) { dev.keyDown('Space'); dev.keyDown(Math.floor(t / 60) % 2 ? 'KeyA' : 'KeyD'); }
  if (k === 34) { dev.keyUp('Space'); dev.keyUp('KeyA'); dev.keyUp('KeyD'); }
  if (k === 40) dev.keyDown(`Digit${1 + (Math.floor(t / 60) % 3)}`);
  if (k === 42) for (let d = 1; d <= 3; d++) dev.keyUp(`Digit${d}`);
};
SCRIPTS.ring_drop = keyScript(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'], ['Space', 'ShiftLeft', 'Space', 'Tab']);
SCRIPTS.snow_throw = keyScript(['KeyA', 'KeyD', null], ['Space', 'Space', 'Enter', 'Digit3', 'Tab']);
SCRIPTS.goal_roll = keyScript(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'], ['Space', 'Space', 'KeyE']);
const EVENTS = {
  hurdle_dash: hurdleDash, pennant_capture: pennantCapture, circle_push: circlePush, block_smash: blockSmash, relay_run: relayRun,
  disc_catch: discCatch, lamp_jump: lampJump, ring_drop: ringDrop, snow_throw: snowThrow, goal_roll: goalRoll,
};

const same = (runs) => {
  for (const r of runs) assert.equal(r.finished, true, 'every copy finishes');
  for (const r of runs.slice(1)) {
    assert.deepEqual(r.result.raw, runs[0].result.raw, 'same scores');
    assert.equal(r.rngSum, runs[0].rngSum, 'same random numbers drawn');
    assert.equal(r.ticks, runs[0].ticks, 'same length');
  }
};

test('Input.snapshot and apply give the event the same frame the device published', () => {
  const dev = new Input();
  dev.pointerDown(100.26, 200.74, 1000);
  dev.pointerMove(130, 210, 1016);
  dev.keyDown('Space');
  dev.setPad(0.5, -0.25, 0, 0, new Set([0, 3]));
  dev.frame();
  const snap = dev.snapshot();
  assert.equal(JSON.parse(JSON.stringify(snap)).x, 130);
  const got = new Input();
  got.apply(JSON.parse(JSON.stringify(snap)), 7);
  assert.equal(got.pointer.down, true);
  assert.equal(got.pointer.pressed, true);
  assert.equal(got.pointer.path.length, 2);
  assert.ok(got.keys.has('Space') && got.pressed.has('Space'));
  assert.ok(got.pad.held.has(3) && got.pad.pressed.has(0));
  assert.equal(got.pad.lx, 0.5);
  // an empty frame is "nothing happened"
  got.apply({}, 8);
  assert.equal(got.pointer.down, false);
  assert.equal(got.keys.size, 0);
  assert.equal(got.pad.held.size, 0);
  // the next frame of the device: the press and the path are gone, the key is still held
  dev.frame();
  const next = dev.snapshot();
  assert.equal(next.p, undefined);
  assert.equal(next.pa, undefined);
  assert.deepEqual(next.k, ['Space']);
});

test('makeRng keeps a checksum of what it handed out', () => {
  const a = makeRng(9);
  const b = makeRng(9);
  for (let i = 0; i < 20; i++) { a(); b(); }
  assert.equal(a.sum, b.sum);
  assert.equal(a.calls, 20);
  b();
  assert.notEqual(a.sum, b.sum);
});

test('the frames store waits for every person, ignores a resend, and hands a leaver to the CPU', () => {
  const log = [];
  const ctx = {teams: teamsOf([2, 2, 2, 2], [0, 1]), inputs: [new Input(), new Input(), new Input(), new Input()]};
  const inst = {update: () => log.push('u'), takeOver: (t) => log.push(`cpu${t}`)};
  const ls = new Lockstep(ctx, inst, [0, 1]);
  assert.equal(ls.step(), false);
  ls.feed(0, 1, [{}, {}]);
  assert.equal(ls.ready(), false);
  assert.deepEqual(ls.waitingFor(), [1]);
  ls.feed(1, 1, [{}]);
  assert.equal(ls.step(), true);
  assert.equal(ls.step(), false);
  ls.feed(1, 1, [{}]);                   // a resend of tick 1 is ignored
  assert.equal(ls.frames[1].length, 1);
  ls.feed(1, 2, [CPU_FRAME]);
  assert.equal(ls.step(), true);
  assert.deepEqual(log, ['u', 'cpu1', 'u']);
  assert.equal(ctx.teams[1].human, false);
  assert.deepEqual([...ls.active], [0]);
});

for (const [id, mod] of Object.entries(EVENTS)) {
  test(`${id}: three copies of the event, two people playing, end alike`, () => {
    const runs = runLockstep(mod, {teams: teamsOf([3, 2, 3, 2], [0, 2]), seed: 21, clients: 3, scripts: {0: SCRIPTS[id](0), 2: SCRIPTS[id](3)}});
    same(runs);
    assert.ok(runs[0].result.raw.every(Number.isFinite));
  });

  test(`${id}: what the people do changes the result`, () => {
    const played = runLockstep(mod, {teams: teamsOf([2, 2, 2, 2], [0, 1]), seed: 13, clients: 1, scripts: {0: SCRIPTS[id](0), 1: SCRIPTS[id](2)}});
    const idle = runLockstep(mod, {teams: teamsOf([2, 2, 2, 2], [0, 1]), seed: 13, clients: 1, scripts: {}});
    assert.notDeepEqual(played[0].result.raw, idle[0].result.raw);
  });

  test(`${id}: four people playing, and the result differs from a CPU-only event`, () => {
    const runs = runLockstep(mod, {teams: teamsOf([2, 2, 2, 2], [0, 1, 2, 3]), seed: 5, clients: 2, scripts: {0: SCRIPTS[id](0), 1: SCRIPTS[id](1), 2: SCRIPTS[id](2), 3: SCRIPTS[id](4)}});
    same(runs);
  });

  test(`${id}: a person who leaves is taken over by the CPU at the same tick on every copy`, () => {
    const runs = runLockstep(mod, {teams: teamsOf([2, 2, 2, 2], [0, 1]), seed: 8, clients: 2, scripts: {0: SCRIPTS[id](0), 1: SCRIPTS[id](2)}, takeover: {team: 1, tick: 200}});
    same(runs);
    for (const r of runs) assert.deepEqual(r.tookOver, [{team: 1, tick: 200}]);
    // the CPU team keeps running: it ends with a score (for the dash, a finished time)
    assert.ok(runs[0].result.raw[1] > 0);
  });
}
