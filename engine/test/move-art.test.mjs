import test from 'node:test';
import assert from 'node:assert/strict';
import {drawFireSprite} from '../../client/src/battle/rt/move-art.js';
import {Vfx, setParticleStyle} from '../../client/src/battle/rt/vfx.js';

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

    // Exercise the real renderer entry points, not just the sheet helper.
    const rendered = [], rotations = [], alphas = [], stack = [];
    let circles = 0, depth = 0;
    const canvas = {globalAlpha:1, globalCompositeOperation:'source-over',
      save() {depth++; stack.push([this.globalAlpha,this.globalCompositeOperation]);},
      restore() {depth--; [this.globalAlpha,this.globalCompositeOperation]=stack.pop();}, translate() {},
      rotate(a) {rotations.push(a);}, drawImage(...args) {rendered.push(args); alphas.push(this.globalAlpha);},
      createRadialGradient() {return {addColorStop() {}};},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {circles++;}};
    const renderer = {scale:20, time:2/12, px:x=>x*20, py:y=>y*20};
    const vfx = new Vfx(renderer);
    const ball = {move:'fireblast',type:'Fire',x:6,y:5,vx:-1,vy:0,r:.4};
    const ray = {kind:'fire',type:'Fire',ox:9,oy:5,hx:6,hy:5,t:.2,gone:.15};
    setParticleStyle('textured');
    vfx.drawBall(canvas,ball);
    assert.equal(rendered.length,1,'a real fire projectile renders the generated sheet');
    assert.equal(rotations.at(-1),Math.PI,'the projectile faces its actual velocity');
    vfx.drawBall(canvas,ball);
    assert.deepEqual(rendered[0],rendered[1],'the renderer pause keeps the same fire frame');
    renderer.time=3/12;
    vfx.drawBall(canvas,ball);
    assert.notDeepEqual(rendered[1].slice(1,5),rendered[2].slice(1,5),'advancing the replay changes the frame');
    vfx.drawRay(canvas,ray);
    assert.equal(rendered.length,4,'a real flame beam also renders its animated head');
    assert.equal(alphas.at(-1),.5,'a disappearing beam fades its bitmap with the existing beam');
    assert.equal(rotations.at(-1),Math.PI,'the beam head faces its rendered endpoint');
    image.naturalWidth=0;
    const beforeFallback=circles;
    vfx.drawBall(canvas,ball);
    vfx.drawRay(canvas,ray);
    assert.equal(rendered.length,4,'a failed decode draws no bitmap');
    assert.ok(circles>=beforeFallback+2,'procedural projectile and beam remain available');
    image.naturalWidth=652;
    setParticleStyle('plain');
    vfx.drawBall(canvas,ball);
    vfx.drawRay(canvas,ray);
    assert.equal(rendered.length,4,'plain particles retain the existing procedural style');
    assert.equal(depth,0,'all canvas state is restored');
    assert.equal(canvas.globalAlpha,1);
    assert.equal(canvas.globalCompositeOperation,'source-over');
    setParticleStyle('textured');
  } finally {setParticleStyle('textured'); globalThis.Image = previous;}
});
