import test from 'node:test';
import assert from 'node:assert/strict';
import {Vfx, setParticleStyle} from '../../client/src/battle/rt/vfx.js';
import {ICE_ATLAS} from '../../client/src/battle/rt/art/ice/ice.gen.js';

function canvas() {
  const images = [], angles = [], positions = [], stack = [];
  let fills = 0;
  const ctx = new Proxy({globalAlpha:1, globalCompositeOperation:'source-over', imageSmoothingEnabled:true,
    save() {stack.push([this.globalAlpha,this.globalCompositeOperation,this.imageSmoothingEnabled]);},
    restore() {[this.globalAlpha,this.globalCompositeOperation,this.imageSmoothingEnabled]=stack.pop();},
    translate(...point) {positions.push(point);}, rotate(angle) {angles.push(angle);},
    drawImage(image,...args) {images.push({args,alpha:this.globalAlpha,composite:this.globalCompositeOperation});},
    fill() {fills++;}, createRadialGradient() {return {addColorStop(){}};},
  }, {get(target,key) {return key in target ? target[key] : () => {};}});
  return {ctx,images,angles,positions,get fills(){return fills;}};
}

test('missing browser or failed decode keeps procedural rendering available without repeated loads', async () => {
  const previous=globalThis.Image;
  try {
    delete globalThis.Image;
    const missing=await import('../../client/src/battle/rt/ice-art.js?missing');
    assert.equal(missing.drawIceSprite({},0,0,0,32,0),false);
    let requests=0;
    globalThis.Image=class {constructor(){requests++;this.complete=true;this.naturalWidth=0;}};
    const broken=await import('../../client/src/battle/rt/ice-art.js?failed');
    for(let i=0;i<100;i++) assert.equal(broken.drawIceSprite({},0,0,0,32,i),false);
    assert.equal(requests,1);
  } finally {globalThis.Image=previous;}
});

test('real ice projectile renderer preserves direction, anchors, clock, reduced motion and plain fallback', () => {
  const previous=globalThis.Image; let loaded,requests=0;
  globalThis.Image=class {constructor(){loaded=this;requests++;this.complete=false;this.naturalWidth=0;}};
  const renderer={scale:20,time:0,px:x=>x*20,py:y=>y*20,reducedMotion:{matches:false}};
  const fx=new Vfx(renderer), p=Object.freeze({move:'iceshard',type:'Ice',x:4,y:6,vx:-8,vy:0,r:.4});
  const before=structuredClone(p);
  try {
    setParticleStyle('textured');
    const pending=canvas(); fx.drawBall(pending.ctx,p);
    assert.equal(pending.images.length,0); assert.ok(pending.fills>0);
    loaded.complete=true; loaded.naturalWidth=ICE_ATLAS.w*2;
    const first=canvas(); fx.drawBall(first.ctx,p);
    assert.equal(first.images.length,1); assert.equal(first.angles[0],Math.PI);
    assert.deepEqual(first.positions[0],[80,108]);
    const paused=canvas(); fx.drawBall(paused.ctx,p);
    assert.deepEqual(paused.images,first.images);
    renderer.time=.1;
    const next=canvas(); fx.drawBall(next.ctx,p);
    assert.notDeepEqual(next.images[0].args.slice(0,2),first.images[0].args.slice(0,2));
    const args=next.images[0].args;
    assert.ok(Math.abs(args[4]+ICE_ATLAS.anchors[1][0]*args[6])<1e-9);
    assert.ok(Math.abs(args[5]+ICE_ATLAS.anchors[1][1]*args[7])<1e-9);
    renderer.time=0;
    const reset=canvas(); fx.drawBall(reset.ctx,p); assert.deepEqual(reset.images,first.images);
    renderer.time=3.21; renderer.reducedMotion.matches=true;
    const reduced=canvas(); fx.drawBall(reduced.ctx,p); assert.deepEqual(reduced.images,first.images);
    setParticleStyle('plain');
    const plain=canvas(); fx.drawBall(plain.ctx,p);
    assert.equal(plain.images.length,0); assert.ok(plain.fills>0);
    assert.equal(requests,1); assert.deepEqual(p,before);
  } finally {globalThis.Image=previous;setParticleStyle('textured');}
});

test('ice beam head uses the actual endpoint and existing fade while other projectile families stay intact', () => {
  const previous=globalThis.Image;
  globalThis.Image=class {constructor(){this.complete=true;this.naturalWidth=ICE_ATLAS.w*2;}};
  const renderer={scale:20,time:.2,px:x=>x*20,py:y=>y*20,reducedMotion:{matches:false}};
  const fx=new Vfx(renderer), ray=Object.freeze({kind:'ice',type:'Ice',ox:2,oy:6,hx:7,hy:6,t:.2,gone:.15});
  try {
    const drawn=canvas(); drawn.ctx.globalAlpha=.8; fx.drawRay(drawn.ctx,ray);
    assert.equal(drawn.images.length,1); assert.deepEqual(drawn.positions.at(-1),[140,108]);
    assert.equal(drawn.images[0].alpha,.4); assert.equal(drawn.images[0].composite,'source-over');
    assert.equal(drawn.ctx.globalAlpha,.8);
    for(const move of ['powergem','powdersnow','rockthrow']) {
      const other=canvas(); fx.drawBall(other.ctx,{move,type:'Ice',x:4,y:6,vx:8,vy:0,r:.4});
      assert.equal(other.images.length,0); assert.ok(other.fills>0);
    }
  } finally {globalThis.Image=previous;}
});
