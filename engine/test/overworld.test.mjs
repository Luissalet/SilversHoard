import test from 'node:test';
import assert from 'node:assert/strict';
import {OverworldAnimator} from '../../client/src/battle/rt/overworld.js';
import {makeSprites} from '../../client/src/battle/dex.js';

test('four-direction sheets follow the animation clock, remove only the color key, and keep source rectangles', () => {
  const previous = {Image: globalThis.Image, document: globalThis.document};
  const writes = [], draws = [];
  globalThis.Image = class {set src(s) {this.url = s; this.width = this.height = 64; this.onload?.();}};
  globalThis.document = {createElement: () => ({getContext: () => ({drawImage() {}, fillRect() {},
    getImageData: () => ({data: new Uint8ClampedArray([111, 232, 183, 255, 255, 0, 0, 255])}),
    putImageData: p => writes.push([...p.data])})})};
  try {
    const frames = Array.from({length: 4}, (_, r) => Array.from({length: 4}, (_, c) => [c * 16, r * 16, 16, 16]));
    const meta = {url: 'sheet:delphox', frames, background: [111, 232, 183, 255]};
    const original = structuredClone(meta), a = new OverworldAnimator(meta);
    const ctx = {globalAlpha: 1, drawImage: (...args) => draws.push(args)};
    a.loop('Walk'); a.update(.15);
    assert.equal(a.frame, 1);
    assert.equal(a.draw(ctx, 100, 80, 6, 1), true);
    assert.deepEqual(draws[0].slice(1, 5), [16, 16, 16, 16], 'left selects the left row and second frame');
    assert.deepEqual(writes[0], [111, 232, 183, 0, 255, 0, 0, 255], 'only the exact background color becomes transparent');
    const at = a.frame; a.update(0); assert.equal(a.frame, at);
    assert.deepEqual(meta, original, 'source metadata stays intact');
    assert.equal(a.has('Shoot'), false, 'walking art does not claim an attack pose');
  } finally {Object.assign(globalThis, previous);}
});

test('exported sheets need no app and retain source and shiny attribution', async () => {
  const normal = {url: 'data:image/png;base64,normal', credit: ['CamiLovesO']};
  const shiny = {url: 'data:image/png;base64,shiny', credit: ['CamiLovesO']};
  const sprites = makeSprites({server: 'https://play.example/sprites', overworld: {'delphox-mega|0': normal, 'delphox-mega|1': shiny}});
  assert.equal(await sprites.walking('delphox-mega', true), shiny);
  assert.equal(await sprites.walking('delphox-mega'), normal);
  assert.equal(await sprites.walking('missing-mega'), null);
});

test('eight-direction imported sheets retain every facing and use the walk clock', () => {
  const previous = {Image: globalThis.Image, document: globalThis.document};
  const draws = [];
  globalThis.Image = class {set src(s) {this.width = 150; this.height = 320; this.onload?.();}};
  globalThis.document = {createElement: () => ({getContext: () => ({drawImage() {}, fillRect() {}})})};
  try {
    const frames = Array.from({length: 8}, (_, r) => [0, 1, 2, 1].map(c => [c * 50, r * 40, 50, 40]));
    const a = new OverworldAnimator({url: 'sheet:swampert812', directions: 8, frames});
    const ctx = {globalAlpha: 1, drawImage: (...args) => draws.push(args)};
    a.loop('Walk'); a.update(.15);
    for (let row = 0; row < 8; row++) {
      assert.equal(a.draw(ctx, 100, 80, row, 1), true);
      assert.deepEqual(draws.at(-1).slice(1, 5), [50, row * 40, 50, 40]);
    }
    assert.equal(a.has('Attack'), false);
  } finally {Object.assign(globalThis, previous);}
});
