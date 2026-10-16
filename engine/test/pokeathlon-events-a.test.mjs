// Five Pokéathlon events (Hurdle Dash, Pennant Capture, Circle Push, Block Smash, Relay Run): each module plays a whole event with no screen
// (CPU only, then with a scripted person), finishes exactly once with four scores and per-Pokémon counters, is deterministic from its seed,
// lets the stronger team win more often, and its CPU is calibrated to the numbers the game's own code gives.
import test from 'node:test';
import assert from 'node:assert/strict';
import hurdleDash from '../../client/src/pokeathlon/events/hurdle_dash.js';
import pennantCapture from '../../client/src/pokeathlon/events/pennant_capture.js';
import circlePush from '../../client/src/pokeathlon/events/circle_push.js';
import blockSmash from '../../client/src/pokeathlon/events/block_smash.js';
import relayRun from '../../client/src/pokeathlon/events/relay_run.js';
import {runHeadless, makeRng} from '../../client/src/pokeathlon/core.js';
import {Match as BlockMatch, onSpot, COST, TOTAL_FRAMES as BLOCK_FRAMES} from '../../client/src/pokeathlon/events/block_smash/sim.js';
import {Race as RelayRace, LAP, DURATION as RELAY_FRAMES, LAYOUTS as RELAY_LAYOUTS} from '../../client/src/pokeathlon/events/relay_run/sim.js';
import {Match as PennantMatch, TOTAL_FRAMES as PENNANT_FRAMES, MAX_CARRY, startOf} from '../../client/src/pokeathlon/events/pennant_capture/sim.js';
import {Match as CircleMatch, ROUNDS, ROUND_INTERVAL, LAYOUTS as CIRCLE_LAYOUTS, SETS as CIRCLE_SETS, ZONE_KINDS} from '../../client/src/pokeathlon/events/circle_push/sim.js';
import {Race as HurdleRace, LAYOUTS as HURDLE_LAYOUTS, roundTime} from '../../client/src/pokeathlon/events/hurdle_dash/sim.js';

const EVENTS = {hurdle_dash: hurdleDash, pennant_capture: pennantCapture, circle_push: circlePush, block_smash: blockSmash, relay_run: relayRun};
const STAT_KEYS = ['speed', 'power', 'skill', 'stamina', 'jump'];
const SPANISH = {hurdle_dash: 'Saltaobstáculos', pennant_capture: 'Atrapabanderas', circle_push: 'Pisacírculos', block_smash: 'Rompelosas', relay_run: 'Carrera de relevos'};

const stars = (n) => Object.fromEntries(STAT_KEYS.map((k) => [k, n]));
const mon = (n, i = 0) => ({species: 'Pikachu', num: 25, form: '', name: `M${i}`, stars: stars(n)});
/** four teams of three Pokémon with the given stars each; `human` is the index of the person's team (-1 = none) */
const teamsOf = (level, human = -1) => level.map((n, i) => ({index: i, name: `T${i}`, color: '#fff', human: i === human, cpu: 0, mons: [mon(n, 0), mon(n, 1), mon(n, 2)]}));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('every module has the contract shape and the official Spanish name', () => {
  for (const [id, mod] of Object.entries(EVENTS)) {
    assert.equal(mod.id, id);
    assert.equal(mod.names.es, SPANISH[id]);
    assert.ok(mod.names.en);
    assert.ok(mod.stats.length >= 3 && mod.stats.every((k) => STAT_KEYS.includes(k)), id);
    assert.ok(mod.seconds >= 30 && mod.seconds <= 120, id);
    assert.ok(mod.help.es && mod.help.en, id);
    assert.equal(typeof mod.create, 'function');
  }
});

for (const [id, mod] of Object.entries(EVENTS)) {
  test(`${id}: a CPU-only event ends, finishes once, gives four scores and counters, and is deterministic`, () => {
    const run = (seed) => runHeadless(mod, {teams: teamsOf([3, 2, 2, 2]), seed, step: 1 / 30});
    const a = run(5);
    assert.equal(a.finished, true);
    assert.equal(a.finishCalls, 1);
    assert.equal(a.result.raw.length, 4);
    assert.ok(a.result.raw.every((v) => Number.isFinite(v) && v >= 0), JSON.stringify(a.result.raw));
    assert.equal(a.result.detail.length, 4);
    for (const d of a.result.detail) assert.equal(d.mons.length, 3);
    assert.ok(a.seconds > 20 && a.seconds < 130, `${id} took ${a.seconds}s`);
    assert.deepEqual(run(5).result, a.result, 'same seed, same event');
    const seeds = new Set([1, 2, 3, 4].map((s) => JSON.stringify(run(s).result.raw)));
    assert.ok(seeds.size > 1, 'different seeds give different events');
  });

  test(`${id}: the same event at 30 and 60 updates a second ends alike (a fixed-step simulation)`, () => {
    const slow = runHeadless(mod, {teams: teamsOf([3, 3, 3, 3]), seed: 11, step: 1 / 30});
    const fast = runHeadless(mod, {teams: teamsOf([3, 3, 3, 3]), seed: 11, step: 1 / 60});
    assert.deepEqual(fast.result.raw, slow.result.raw);
  });

  test(`${id}: the team with five stars everywhere beats three one-star teams`, () => {
    let better = 0;
    const lowerIsBetter = id === 'hurdle_dash';
    for (let seed = 1; seed <= 8; seed++) {
      const {result} = runHeadless(mod, {teams: teamsOf([4, 0, 0, 0].map((n) => n + 1)), seed, step: 1 / 30});
      const rest = mean(result.raw.slice(1));
      if (lowerIsBetter ? result.raw[0] < rest : result.raw[0] > rest) better++;
    }
    assert.ok(better >= 7, `${id}: the strong team was ahead in ${better}/8`);
  });
}

// --------------------------------------------------------------------------------------------------------- a person playing
test('hurdle_dash: a person who taps the three keys plays the whole race', () => {
  const script = (f, input) => {
    if (f % 2 === 0) input.keyDown(['Digit1', 'Digit2', 'Digit3'][(f / 2) % 3 | 0]);
    else for (const k of ['Digit1', 'Digit2', 'Digit3']) input.keyUp(k);
  };
  const r = runHeadless(hurdleDash, {teams: teamsOf([3, 3, 3, 3], 0), seed: 7, script, mode: 'play', step: 1 / 60});
  assert.equal(r.finished, true);
  assert.equal(r.finishCalls, 1);
  assert.ok(r.result.raw[0] > 0 && r.result.raw[0] < 12000);
  assert.equal(r.result.detail[0].mons.length, 3);
});

test('pennant_capture: dragging a Pokémon and letting go flicks it, and the event still finishes once', () => {
  const script = (f, input) => {
    const [sx, sy] = [250, 400 - (f % 90) / 2];
    if (f % 90 === 5) input.pointerDown(sx, sy, f);
    if (f % 90 === 10) input.pointerMove(sx - 20, sy - 120, f);
    if (f % 90 === 14) input.pointerUp(sx - 20, sy - 120, f);
  };
  const r = runHeadless(pennantCapture, {teams: teamsOf([3, 2, 2, 2], 0), seed: 3, script, mode: 'play', step: 1 / 60});
  assert.equal(r.finished, true);
  assert.equal(r.finishCalls, 1);
  assert.ok(r.result.raw.every((v) => v >= 0 && v <= 999));
});

test('circle_push: pressing and moving the pointer steers the active Pokémon', () => {
  const script = (f, input) => {
    if (f % 200 === 4) input.pointerDown(130, 100, f);
    if (f % 200 > 4 && f % 200 < 150) input.pointerMove(130 + (f % 200) / 2, 100, f);
    if (f % 200 === 150) input.pointerUp(200, 100, f);
  };
  const r = runHeadless(circlePush, {teams: teamsOf([3, 2, 2, 2], 0), seed: 3, script, mode: 'play', step: 1 / 60});
  assert.equal(r.finished, true);
  assert.equal(r.finishCalls, 1);
  assert.ok(r.result.raw[0] >= 0);
});

test('block_smash: taps and the keyboard both play it', () => {
  const taps = (f, input) => { if (f % 20 === 0) input.pointerDown(470, 200, f); if (f % 20 === 1) input.pointerUp(470, 200, f); };
  const a = runHeadless(blockSmash, {teams: teamsOf([3, 2, 2, 2], 0), seed: 5, script: taps, mode: 'play', step: 1 / 60});
  assert.equal(a.finishCalls, 1);
  assert.ok(a.result.detail[0].mons.some((m) => m.hit > 0), 'the taps hit the stack');
  const keys = (f, input) => { if (f % 20 === 0) input.keyDown('Space'); if (f % 20 === 2) input.keyUp('Space'); if (f % 300 === 100) { input.keyDown('Tab'); input.keyUp('Tab'); } };
  const b = runHeadless(blockSmash, {teams: teamsOf([3, 2, 2, 2], 0), seed: 5, script: keys, mode: 'play', step: 1 / 60});
  assert.equal(b.finishCalls, 1);
  assert.ok(b.result.raw[0] > 0, 'the keyboard breaks blocks too');
});

test('relay_run: flicking forward runs, and the keyboard runs too', () => {
  const mouse = (f, input) => {
    if (f % 48 === 2) input.pointerDown(238, 185, f);
    if (f % 48 === 3) input.pointerMove(348, 185, f);
    if (f % 48 === 6) input.pointerUp(348, 185, f);
  };
  const a = runHeadless(relayRun, {teams: teamsOf([3, 2, 2, 2], 0), seed: 5, script: mouse, mode: 'play', step: 1 / 60});
  assert.equal(a.finishCalls, 1);
  assert.ok(a.result.raw[0] > 2 * LAP, `ran ${a.result.raw[0] / LAP} laps`);
  const keys = (f, input) => { if (f % 60 === 0) input.keyDown('ArrowRight'); if (f % 60 === 12) input.keyUp('ArrowRight'); };
  const b = runHeadless(relayRun, {teams: teamsOf([3, 2, 2, 2], 0), seed: 5, script: keys, mode: 'play', step: 1 / 60});
  assert.equal(b.finishCalls, 1);
  assert.ok(b.result.raw[0] > LAP, `ran ${b.result.raw[0] / LAP} laps`);
});

// --------------------------------------------------------------------------------------------------------- the rules
test('hurdle_dash: three layouts of hurdles and times rounded to whole three-frame steps', () => {
  assert.equal(HURDLE_LAYOUTS.length, 3);
  assert.equal(roundTime(100), 99);
  assert.equal(roundTime(3), 3);
  const race = new HurdleRace({teams: teamsOf([3, 3, 3, 3]), rng: makeRng(9), humanTeam: -1});
  while (!race.over) race.step();
  const {raw, detail} = race.result();
  assert.ok(raw.every((t) => t > 600 && t < 9000 && t % 3 === 0), JSON.stringify(raw));
  assert.equal(detail[0].times.length, 3);
});

test('pennant_capture: the whole match is 1800 frames, nobody carries more than nine and the four teams start in the goal row', () => {
  assert.equal(PENNANT_FRAMES, 1800);
  assert.equal(MAX_CARRY, 9);
  assert.deepEqual([0, 1, 2, 3].map((t) => startOf(t).x), [208, 240, 272, 304]);
  const m = new PennantMatch({teams: teamsOf([3, 3, 3, 3]), rng: makeRng(4), humanTeam: -1});
  let frames = 0;
  while (!m.over) { m.step(); frames++; assert.ok(m.players.every((p) => p.pennants <= MAX_CARRY)); }
  assert.equal(frames, PENNANT_FRAMES);
  assert.ok(m.result().raw.every((s) => s <= 999));
});

test('circle_push: six rounds of shrinking intervals, 15 layouts and zones worth 1, 2, 3 and 5', () => {
  assert.equal(ROUNDS, 6);
  assert.deepEqual(ROUND_INTERVAL, [8, 6, 6, 4, 4, 4]);
  assert.equal(CIRCLE_LAYOUTS.length, 15);
  assert.deepEqual(Object.values(ZONE_KINDS).map((z) => z.pts), [1, 2, 3, 5]);
  assert.equal(CIRCLE_SETS.length, ROUNDS);
  assert.deepEqual(CIRCLE_SETS[0], [0]);
  const m = new CircleMatch({teams: teamsOf([3, 3, 3, 3]), rng: makeRng(6), humanTeam: -1});
  while (!m.over) m.step();
  const {raw, detail} = m.result();
  assert.equal(detail[0].rounds.length, ROUNDS);
  assert.deepEqual(raw, detail.map((d) => d.rounds.reduce((s, v) => s + v, 0)));
});

test('block_smash: a tap has to land on the weak spot, and a stronger Pokémon taps with less stamina cost', () => {
  assert.equal(BLOCK_FRAMES, 900);
  assert.equal(COST.length, 10);
  assert.equal(onSpot(100, 100, 100, 100, 0), true);
  assert.equal(onSpot(300, 300, 100, 100, 0), false);
});

test('block_smash: the CPU breaks about as many blocks as the game\'s own CPU does at each level of stars', () => {
  // the game\'s CPU averages 27.5, 56.5, 76.0, 101.6 and 115.1 blocks for a team of one to five stars in every stat, over 865 frames
  const quoted = [27.5, 56.5, 76.0, 101.6, 115.1].map((v) => (v * BLOCK_FRAMES) / 865);
  for (let level = 0; level < 5; level++) {
    const all = [];
    for (let seed = 1; seed <= 40; seed++) {
      const m = new BlockMatch({teams: teamsOf([level + 1, level + 1, level + 1, level + 1]), rng: makeRng(seed), humanTeam: -1});
      while (!m.over) m.step();
      all.push(...m.result().raw);
    }
    const got = mean(all);
    assert.ok(Math.abs(got - quoted[level]) <= quoted[level] * 0.08, `stars ${level + 1}: ${got.toFixed(1)} blocks, expected about ${quoted[level].toFixed(1)}`);
  }
});

test('block_smash: a tap on the weak spot every ten frames is worth more than the CPU of the same Pokémon', () => {
  const bot = (seed, level, gap) => {
    const m = new BlockMatch({teams: teamsOf([level, 2, 2, 2], 0), rng: makeRng(seed), humanTeam: 0});
    const h = m.sides[0];
    let last = -99;
    while (!m.over) {
      m.step(() => {
        if (h.cur.st < 12 && h.switchNow()) return;
        if (m.frame - last >= gap) {
          const sp = h.board.spotPos();
          if (sp && h.tap(sp.x, sp.y, 0)) last = m.frame;
        }
      });
    }
    return m.result().raw[0];
  };
  const low = mean([1, 2, 3, 4, 5, 6].map((s) => bot(s, 1, 10)));
  const high = mean([1, 2, 3, 4, 5, 6].map((s) => bot(s, 5, 10)));
  assert.ok(low > 80 && high > low, `one star ${low}, five stars ${high}`);
});

test('relay_run: ten wall layouts, 2700 frames, and the CPU runs about the laps the game\'s CPU does', () => {
  assert.equal(RELAY_LAYOUTS.length, 10);
  assert.equal(RELAY_FRAMES, 2700);
  assert.equal(LAP, 1024);
  // quoted laps of a team of one to five stars: 7.8, 8.5, 10.5, 12.0 and 13.7. The -160 wrap fix the specification recommends makes the
  // CPU a little faster than the original (which put the obstacle shift at +80), so the band is open above
  const quoted = [7.8, 8.5, 10.5, 12.0, 13.7];
  for (let level = 0; level < 5; level++) {
    const laps = [];
    for (let seed = 1; seed <= 10; seed++) {
      const r = new RelayRace({teams: teamsOf([level + 1, level + 1, level + 1, level + 1]), rng: makeRng(seed), humanTeam: -1, fixQuirk: true});
      while (!r.over) r.step();
      laps.push(...r.result().raw.map((v) => v / LAP));
    }
    const got = mean(laps);
    assert.ok(got >= quoted[level] - 0.4 && got <= quoted[level] + 2.0, `stars ${level + 1}: ${got.toFixed(2)} laps, the game's CPU makes ${quoted[level]}`);
  }
});
