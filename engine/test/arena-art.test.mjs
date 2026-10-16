import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {ARENA_ART} from '../../client/src/battle/rt/arena-art.js';

function renderer() {
  const context = () => new Proxy({}, {get: (obj, key) => obj[key] ?? (() => ({addColorStop() {}}))});
  const previous = globalThis.document;
  globalThis.document = {createElement: () => ({width: 0, height: 0, getContext: context})};
  const r = {canvas: {width: 900, height: 510}, ctx: context(), scale: 27, rocks: [], time: 0,
    court: null, px: (x) => (x + 2.6) * 27, py: (y) => (y + .9) * 27, drawRock() {}};
  return {r, restore: () => {globalThis.document = previous;}};
}

test('changing the arena floor at the same size redraws its cached ground', () => {
  const {r, restore} = renderer();
  try {
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'grass'});
    const grass = r.court.canvas;
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'sand'});
    assert.notEqual(r.court.canvas, grass);
    const sand = r.court.canvas;
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'sand'});
    assert.equal(r.court.canvas, sand, 'unchanged ground is still cached');
  } finally {restore();}
});

test('floor art arriving after the first frame replaces the fallback once and remains cached', () => {
  const {r, restore} = renderer();
  const previous = globalThis.Image;
  const loaded = [];
  globalThis.Image = class {constructor() {loaded.push(this);}};
  try {
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'champion'});
    const pending = r.court.canvas;
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].src, ARENA_ART.champion);
    loaded[0].onload();
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'champion'});
    const ready = r.court.canvas;
    assert.notEqual(ready, pending);
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'champion'});
    assert.equal(r.court.canvas, ready);
    assert.equal(loaded.length, 1);
  } finally {globalThis.Image = previous; restore();}
});

test('a failed image keeps the procedural court usable without rebuilding every frame', () => {
  const {r, restore} = renderer();
  const previous = globalThis.Image;
  let pending;
  globalThis.Image = class {constructor() {pending = this;}};
  try {
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'summit'});
    const fallback = r.court.canvas;
    pending.onerror();
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'summit'});
    assert.equal(r.court.canvas, fallback);
    ArenaRenderer.prototype.drawCourt.call(r, {floor: 'grass'});
    assert.notEqual(r.court.canvas, fallback);
  } finally {globalThis.Image = previous; restore();}
});
