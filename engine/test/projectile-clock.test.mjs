import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {Vfx} from '../../client/src/battle/rt/vfx.js';
import {MassRenderer} from '../../client/src/battle/mass/render.js';

function draw(vfx, move) {
  const ops=[];
  const ctx=Object.fromEntries(['save','restore','translate','rotate','beginPath','moveTo','lineTo','arc','ellipse','closePath','fill','stroke']
    .map(k=>[k,(...args)=>ops.push([k,...args])]));
  ctx.createRadialGradient=(...args)=>{ops.push(['gradient',...args]); return {addColorStop(...a) {ops.push(['stop',...a]);}};};
  ctx.drawImage=(_image,...args)=>ops.push(['image',...args]);
  vfx.drawBall(ctx,{move,type:'Normal',x:3,y:4,vx:1,vy:.5,r:.45});
  return ops;
}

test('the mass renderer passes its live clock to shared projectiles and fire frames', () => {
  const previousWindow=globalThis.window, previousImage=globalThis.Image;
  globalThis.window={devicePixelRatio:1,innerHeight:800};
  globalThis.Image=class {constructor() {this.complete=true;this.naturalWidth=652;this.naturalHeight=604;}};
  let wall=1000;
  const clock=mock.method(performance,'now',()=>wall);
  try {
    const canvas={style:{},clientWidth:600,getContext:()=>({})};
    const mass=new MassRenderer(canvas,{units:[],arena:{w:28,h:16}},{sprites:{},offline:true});
    const firstFire=draw(mass.vfx,'fireblast').find(op=>op[0]==='image');
    assert.ok(firstFire && firstFire.slice(1).every(Number.isFinite),'mass fire must draw a valid finite sheet cell');
    assert.equal(mass.vfx.r.time,0);
    mass.time=.25;
    const rock=draw(mass.vfx,'rockthrow'),fire=draw(mass.vfx,'fireblast');
    wall=9000;
    assert.deepEqual(draw(mass.vfx,'rockthrow'),rock,'a paused mass battle keeps the same rotation');
    assert.deepEqual(draw(mass.vfx,'fireblast'),fire,'a paused mass battle keeps the same fire frame');
    mass.time=.4;
    assert.notDeepEqual(draw(mass.vfx,'rockthrow'),rock,'the adapter reads the live clock, not its initial value');
    mass.time=.25;
    assert.deepEqual(draw(mass.vfx,'rockthrow'),rock,'a reset mass clock restores the same phase');
  } finally {clock.mock.restore();globalThis.window=previousWindow;globalThis.Image=previousImage;}
});

for (const move of ['shadowball','aurasphere','rockblast','mudshot','razorleaf','powdersnow','swift','payday']) {
  test(`${move} freezes with the replay clock and resumes/restarts its visual phase`, () => {
    let wall=1000;
    const clock=mock.method(performance,'now',()=>wall);
    try {
      const renderer={scale:20,time:.25,px:x=>x*20,py:y=>y*20};
      const vfx=new Vfx(renderer);
      const first=draw(vfx,move);
      wall=2250;
      assert.deepEqual(draw(vfx,move),first,'wall time must not animate a paused projectile');
      renderer.time=.4;
      assert.notDeepEqual(draw(vfx,move),first,'advancing the battle still animates the projectile');
      renderer.time=.25;
      wall=9000;
      assert.deepEqual(draw(vfx,move),first,'restarting the replay restores the same visual phase');
    } finally {clock.mock.restore();}
  });
}
