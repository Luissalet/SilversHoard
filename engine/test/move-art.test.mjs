import test from 'node:test';
import assert from 'node:assert/strict';
import {drawFireSprite} from '../../client/src/battle/rt/move-art.js';

test('the fire sheet tolerates loading/failure, loops four isolated cells, and anchors each bright core', () => {
  const previous = globalThis.Image;
  let image;
  globalThis.Image = class {constructor() {image = this; this.complete = false; this.naturalWidth = 0;}};
  const draws = [], transforms = [];
  const ctx = {save() {}, restore() {}, rotate: (a) => transforms.push(a), translate(x,y) {assert.deepEqual([x,y],[120,90]);},
    drawImage(...args) {draws.push(args);}};
  try {
    assert.equal(drawFireSprite(ctx,120,90,Math.PI,40,0),false);
    image.complete = true;
    assert.equal(drawFireSprite(ctx,120,90,Math.PI,40,0),false,'failed decode uses procedural fallback');
    image.naturalWidth = 652;
    image.naturalHeight = 604;
    for (let i=0; i<5; i++) assert.equal(drawFireSprite(ctx,120,90,Math.PI,40,i/12),true);
    assert.deepEqual(draws.map(a=>a.slice(1,5)),[[0,0,326,302],[326,0,326,302],[0,302,326,302],[326,302,326,302],[0,0,326,302]]);
    assert.deepEqual(draws[0],draws[4],'a loop returns to the exact same frame and offset');
    assert.ok(draws.every(a=>a[5]<0 && a[6]<0 && a[7]===40));
    assert.deepEqual(transforms,Array(5).fill(Math.PI),'the art follows the rendered flight direction');
    draws.length = 0;
    drawFireSprite(ctx,120,90,0,40,2/12);
    drawFireSprite(ctx,120,90,0,40,2/12);
    assert.deepEqual(draws[0],draws[1],'a paused renderer clock does not advance the sprite');
  } finally {globalThis.Image = previous;}
});
