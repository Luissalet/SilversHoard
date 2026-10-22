import test from 'node:test';
import assert from 'node:assert/strict';
import {ImpactAccents} from '../../client/src/battle/rt/impact-accents.js';

function setup(reduced = false) {
  const ellipses = [], strokes = [];
  const context = {save() {}, restore() {}, translate(...v) { assert.ok(v.every(Number.isFinite)); },
    beginPath() {}, ellipse(...v) { ellipses.push(v); assert.ok(v.every(Number.isFinite)); },
    stroke() {}, moveTo(...v) { strokes.push(v); }, lineTo(...v) { strokes.push(v); }};
  return {accents: new ImpactAccents({scale: 20, px: x => x * 20, py: y => y * 20, reducedMotion: {matches: reduced}}), context, ellipses, strokes};
}

test('contact accents preserve public events and targets; misses and later multihits do not flood the field', () => {
  const {accents} = setup();
  const target = Object.freeze({x: 7, y: 8});
  const event = Object.freeze({dmg: 30, maxhp: 100, hp: 70, type: 'Fire', crit: true, hit: 0});
  accents.hit(event, target);
  accents.hit({...event, hit: 1}, target);
  accents.hit({...event, dmg: 0}, target);
  assert.equal(accents.hits.length, 1);
  assert.deepEqual(target, {x: 7, y: 8});
  assert.equal(event.hp, 70);
  for (let i = 0; i < 100; i++) accents.hit(event, target);
  assert.equal(accents.hits.length, 16);
});

test('pause holds the ring; presentation time advances and expires it without a wall clock', () => {
  const {accents, context, ellipses} = setup();
  accents.hit({dmg: 12, hp: 40}, {x: 4, y: 3});
  accents.draw(context);
  accents.update(0);
  accents.draw(context);
  assert.deepEqual(ellipses[0], ellipses[1]);
  accents.update(.12);
  accents.draw(context);
  assert.ok(ellipses[2][2] > ellipses[1][2]);
  accents.update(1);
  assert.equal(accents.hits.length, 0);
  assert.equal(new ImpactAccents(accents.r).hits.length, 0, 'replay renderer reset has no old hits');
});

test('reduced motion keeps a stationary contact mark and omits radial streaks', () => {
  const {accents, context, ellipses, strokes} = setup(true);
  accents.hit({dmg: 40, hp: 0, type: 'Electric'}, {x: 2, y: 1});
  accents.draw(context);
  accents.update(.15);
  accents.draw(context);
  assert.deepEqual(ellipses[0], ellipses[1]);
  assert.deepEqual(strokes, []);
  accents.update(1);
  assert.equal(accents.hits.length, 0);
});
