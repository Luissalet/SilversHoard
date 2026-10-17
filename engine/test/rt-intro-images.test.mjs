import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle} from '../src/realtime/sim.mjs';
import {Show} from '../../client/src/battle/rt/show.js';

function setup({prepared = false} = {}) {
  const battle = new RtBattle({seed: 'intro-images', format: 'gen9customgame', time_limit: 10,
    p1: {name: 'Lapras', sets: [{species: 'Lapras', moves: ['Ice Beam']}]},
    p2: {name: 'Shuckle', sets: [{species: 'Shuckle', moves: ['Withdraw']}]}});
  const fallback = {ready: false, failed: false, img: {width: 96, height: 96}};
  const renderer = {offline: true, fallbacks: [[fallback], [{ready: true, img: {width: 40, height: 40}}]], trainers: [],
    canvas: {width: 800, height: 480}, scale: 20, k: 1, time: 0,
    px: x => x * 20, py: y => y * 20, trainerPos: si => ({x: si ? 29 : -1, y: 8}),
    worldCenter: () => ({x: 14, y: 8.5}), animOf: () => null, vfx: {fx: [], emit() {}}};
  const show = new Show(renderer);
  show.startIntro(battle, {prepared});
  return {battle, fallback, show};
}

test('a missing portrait does not consume the VS card while its fallback is loading', () => {
  const {battle, fallback, show} = setup();
  show.intro.sides[0].portrait = {failed: true, ready: false};
  const before = JSON.stringify(battle.view());
  show.update(0.5, battle);
  assert.equal(show.intro.t, 0, 'keep the slide-in for an available picture');
  fallback.ready = true;
  show.update(0.1, battle);
  assert.equal(show.intro.t, 0.1);
  assert.equal(JSON.stringify(battle.view()), before, 'loading never advances the simulation');
});

test('an available trainer or fallback does not wait for a lower-priority picture', () => {
  for (const trainer of [false, true]) {
    const {battle, fallback, show} = setup();
    show.intro.sides[0].portrait = {ready: false, failed: false};
    if (trainer) show.intro.sides[0].trainer = {ready: true};
    else fallback.ready = true;
    show.update(0.1, battle);
    assert.equal(show.intro.t, 0.1);
  }
});

test('unavailable pictures cannot block the intro indefinitely', () => {
  const {battle, fallback, show} = setup();
  show.update(0.5, battle);
  assert.equal(show.intro.t, 0);
  show.update(1.01, battle);
  assert.ok(show.intro.t > 0, 'retain the bounded 1.5 second wait');
  const failed = setup();
  failed.fallback.failed = true;
  failed.show.update(0.1, failed.battle);
  assert.equal(failed.show.intro.t, 0.1, 'all failed images have nothing left to wait for');
  assert.equal(fallback.ready, false);
});

test('recording warmup observes image readiness without moving the prepared card', () => {
  const {battle, fallback, show} = setup({prepared: true});
  show.update(0, battle);
  assert.equal(show.intro.ready, false);
  assert.equal(show.intro.t, 0.7);
  fallback.ready = true;
  show.update(0, battle);
  assert.equal(show.intro.ready, true);
  assert.equal(show.intro.t, 0.7);
});
