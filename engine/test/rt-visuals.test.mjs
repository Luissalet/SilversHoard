import test from 'node:test';
import assert from 'node:assert/strict';
import {motionFor, poseFor, tossLift} from '../../client/src/battle/rt/visuals/choreography.js';
import {drawWaterTextures, floorVariant} from '../../client/src/battle/rt/visuals/textures.js';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';

const unit = (move, kind, left, total = 30) => ({active:0, mons:[{moves:[{id:move}]}], act:{kind,slot:0,left,total}});

test('Dig hides during its preparation and emerges during the existing dash without changing its view', () => {
  const side=unit('dig','windup',8), before=structuredClone(side);
  assert.equal(motionFor(side,.4).opacity,0);
  assert.deepEqual(side,before);
  assert.ok(motionFor(unit('dig','dash',20,0),.5).opacity > 0);
  assert.equal(motionFor({...side,act:null},.5).opacity,1);
});
test('Fly rises then lands while its ground position remains unchanged', () => {
  assert.ok(motionFor(unit('fly','windup',5),.3).lift > 2);
  assert.ok(motionFor(unit('fly','dash',25,0),.4).lift > motionFor(unit('fly','dash',2,0),.8).lift);
  assert.equal(motionFor(unit('tackle','dash',25,0),.4).lift,0);
});
test('Rollout follows the replay clock, ordinary dodge rolls keep their own animation', () => {
  const side=unit('rollout','dash',15,0), first=motionFor(side,.4);
  assert.deepEqual(motionFor(side,.4),first);
  assert.notEqual(motionFor(side,.6).turn,first.turn);
  assert.deepEqual(motionFor(side,.4),first);
  assert.equal(motionFor({...side,act:{kind:'roll'}},.4).turn,0);
});
test('reduced motion preserves the Dig state but removes aerial and rotational displacement', () => {
  assert.equal(motionFor(unit('dig','windup',5),1,true).opacity,0);
  assert.equal(motionFor(unit('fly','windup',5),1,true).lift,0);
  assert.equal(motionFor(unit('rollout','dash',15,0),1,true).turn,0);
  assert.equal(tossLift(.3,true),0);
});
test('toss presentation has a bounded lifetime and does not move another slot', () => {
  assert.equal(tossLift(-1),0); assert.equal(tossLift(1),0);
  assert.ok(tossLift(.3)>0); assert.equal(tossLift(0),0);
});
test('pose timing uses the selected sheet and the engine windup, with a special-attack fallback', () => {
  const anim={meta:{a:{Attack:{d:[6,12]},Shoot:{d:[6,6,6]},SpAttack:{d:[12,12,12]}}},has(n){return !!this.meta.a[n];}};
  assert.deepEqual(poseFor({shape:'beam',category:'Special'},anim,30),{name:'SpAttack',speed:.6});
  delete anim.meta.a.SpAttack;
  assert.deepEqual(poseFor({shape:'beam',category:'Special'},anim,30),{name:'Shoot',speed:.3});
  assert.equal(poseFor({shape:'dash',category:'Physical'},anim,15).name,'Attack');
  assert.equal(poseFor({shape:'self'},anim,0).speed,1.6);
});

test('HitFrame reaches the contact pose at the existing windup boundary, without changing a profile', () => {
  const profile={shape:'beam',category:'Special'}, before=structuredClone(profile);
  const anim={meta:{a:{SpAttack:{d:[6,9,18],hit:2}}},has(n){return !!this.meta.a[n];}};
  const pose=poseFor(profile,anim,30);
  assert.equal(pose.name,'SpAttack');
  assert.equal((6+9)/pose.speed,30*2);
  assert.deepEqual(profile,before);
  delete anim.meta.a.SpAttack.hit;
  assert.equal(poseFor(profile,anim,30).speed,33/60);
});

test('water textures follow flight direction and the replay clock, with decode fallback and reduced motion', () => {
  const previous=globalThis.Image; let loaded;
  globalThis.Image=class {constructor(){loaded=this;}};
  const ops=[], ctx={save(){},restore(){},translate(...a){ops.push(['at',...a]);},rotate(a){ops.push(['angle',a]);},drawImage(_i,...a){ops.push(['cell',...a]);}};
  const renderer={time:0,scale:20,px:x=>x*20,py:y=>y*20}, view={projectiles:[{x:2,y:4,vx:-1,vy:0,r:.4,type:'Water'}]};
  const before=structuredClone(view);
  try {
    drawWaterTextures(ctx,renderer,view); assert.equal(ops.length,0);
    loaded.onload();
    drawWaterTextures(ctx,renderer,view); const first=structuredClone(ops); ops.length=0;
    drawWaterTextures(ctx,renderer,view); assert.deepEqual(ops,first); ops.length=0;
    renderer.time=.1; drawWaterTextures(ctx,renderer,view); assert.notDeepEqual(ops,first); ops.length=0;
    drawWaterTextures(ctx,renderer,view,true); assert.deepEqual(ops,first);
    assert.equal(ops.find(x=>x[0]==='angle')[1],Math.PI);
    assert.deepEqual(view,before);
  } finally {globalThis.Image=previous;}
});

test('real renderer keeps body transforms out of HP bars, clears tosses on replay reset, and caches the floor', () => {
  const oldWindow=globalThis.window,oldImage=globalThis.Image,oldDocument=globalThis.document;
  const ops=[], stack=[];
  const ctx=new Proxy({globalAlpha:1},{get(o,k){if(k in o)return o[k];return (...a)=>{ops.push([k,...a]);if(k==='save')stack.push(1);if(k==='restore')stack.pop();};},set(o,k,v){o[k]=v;return true;}});
  let surfaces=0;
  globalThis.window={devicePixelRatio:1,innerHeight:800};
  globalThis.Image=class {};
  globalThis.document={createElement(){surfaces++;return {width:640,height:400,getContext:()=>ctx};}};
  try {
    const renderer=new ArenaRenderer({style:{},clientWidth:640,width:640,height:400,getContext:()=>ctx},{sides:[{mons:[]}],sprites:{}});
    renderer.scale=20;renderer.k=1;renderer.show={hides:()=>false};
    const side={...unit('fly','windup',5),x:8,y:8,r:1,fx:1,fy:0,mons:[{moves:[{id:'fly'}],hp:100,maxhp:100}],name:'Solo'};
    const before=structuredClone(side);
    renderer.drawMon({version:9},side,0,0); assert.deepEqual(side,before); assert.equal(stack.length,0);
    assert.ok(ops.some(x=>x[0]==='translate' && x[2]<renderer.py(side.y)-16));
    renderer.tosses[0]={at:0,slot:0}; renderer.resetReplay({sides:[]}); assert.deepEqual(renderer.tosses,{});
    renderer.drawCourt({floor:'sand',sides:[]}); const first=surfaces;
    renderer.drawCourt({floor:'sand',sides:[]}); assert.equal(surfaces,first,'floor must not be allocated again every frame');
    assert.equal(floorVariant({floor:'sand',sides:[]}),floorVariant({floor:'sand',sides:[]}));
  } finally {globalThis.window=oldWindow;globalThis.Image=oldImage;globalThis.document=oldDocument;}
});
