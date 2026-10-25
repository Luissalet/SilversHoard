import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle} from '../src/realtime/sim.mjs';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {Animator,image,sheetUrl} from '../../client/src/battle/rt/pmd.js';
import {DefeatPresentation, GROUND_SECONDS} from '../../client/src/battle/rt/defeats.js';

const geom = {w:20,h:30,ax:10,ay:25,n:2,r:8,d:[5,5]};
const meta = {key:'fixture',a:{Idle:geom,Hurt:geom}};
const mon = {species:'Mew',moves:['Tackle']};
function fixture(doubles=false) {
  const b=new RtBattle({format:doubles?'gen9doublescustomgame':'gen9customgame',doubles,seed:'pain-ground',
    p1:{sets:[mon,mon,mon]},p2:{sets:[mon,mon,mon]}});
  const r=Object.create(ArenaRenderer.prototype);
  Object.assign(r,{time:0,anims:b.sides.map(s=>s.mons.map(()=>new Animator(meta))),megaAnims:[[],[]],
    dynamaxAnims:[[],[]],ultraAnims:[[],[]],fallbacks:[[],[]],flash:[0,0,0,0],pains:[null,null,null,null],
    texts:{},vfx:{onEvent(){}},show:{onEvent(){}},specials:{onEvent(){}},reactions:{onEvent(){}},
    audio:{},hitstop:0,damageFloat:()=>false,defeats:new DefeatPresentation()});
  return {b,r};
}

test('only positive surviving damage strictly above 35% starts Pain; follow-ups cannot erase it',()=>{
  const {b,r}=fixture(), a=r.anims[1][0];
  const hit={k:'hit',s:1,dmg:35,maxhp:100,hp:65,eff:1,t:1};
  for(const dmg of [0,34,35]) {r.onEvent({...hit,dmg},b);assert.notEqual(a.cur,'Pain');}
  r.onEvent({...hit,dmg:36,hp:64},b);assert.equal(a.cur,'Pain');assert.equal(a.speed,10/(60*.65));
  r.onEvent({...hit,dmg:1},b);assert.equal(a.cur,'Pain');
  a.update(.66);assert.equal(a.cur,'Idle');
  r.onEvent({...hit,dmg:100,hp:0},b);assert.equal(a.cur,'Idle','KO belongs to HitGround');
  r.onEvent({...hit,dmg:999,maxhp:0},b);assert.equal(a.cur,'Hurt','invalid percentage cannot imply a large hit');
});

test('KO owns its pose and position until a replacement recalls it after at least 2.4 seconds',()=>{
  const {b,r}=fixture(), side=b.sides[1], original=structuredClone(b.view());
  const e={k:'faint',s:1,slot:0,t:1};
  r.defeats.onEvent(e,b,r);
  const body=r.defeats.bodies[0];
  assert.equal(body.animator.cur,'HitGround');assert.ok(body.animator.hold);
  body.animator.update(2);assert.ok(body.animator.done);assert.equal(body.animator.progress(),1);
  const frame=body.animator.frame;body.animator.loop('Idle');body.animator.update(9);
  assert.equal(body.animator.cur,'HitGround');assert.equal(body.animator.frame,frame);
  assert.equal(body.recallAt,null,'time alone cannot remove a waiting body');
  side.active=1;r.time=.1;r.defeats.onEvent({k:'switch',s:1,slot:1},b,r);
  assert.equal(body.recallAt,GROUND_SECONDS);assert.equal(body.slot,0);assert.equal(body.x,original.sides[1].x);
  assert.notEqual(body.animator,r.anims[1][0],'bench/current animations have separate ownership');
});

test('doubles isolate downed bodies; pause is stable and replay reset clears historical defeats',()=>{
  const {b,r}=fixture(true), before=JSON.stringify(b.view());
  r.defeats.onEvent({k:'faint',s:1,u:0,slot:0,t:1},b,r);
  r.defeats.onEvent({k:'faint',s:1,u:1,slot:1,t:1},b,r);
  r.time=4;r.defeats.onEvent({k:'switch',s:1,u:1,slot:2},b,r);
  assert.equal(r.defeats.bodies[0].recallAt,null);assert.equal(r.defeats.bodies[1].recallAt,4);
  for(const body of r.defeats.bodies) {body.animator.update(0);assert.equal(body.animator.frame,0);}
  assert.equal(JSON.stringify(b.view()),before,'presentation never changes the engine');
  r.offline=true;
  r.resetReplay(b);assert.equal(r.defeats.bodies.length,0);assert.ok(r.pains.every(x=>x===null));
});

test('defeat form survives same-tick Mega/Ultra/Dynamax reversion',()=>{
  for(const [end,table] of [['mega_end','megaAnims'],['ultra_end','ultraAnims'],['dynamax_end','dynamaxAnims']]) {
    const {b,r}=fixture();r[table][1][0]=new Animator({...meta,key:end});
    const e={k:'faint',s:1,slot:0,t:1};b.events.push(e,{k:end,s:1,slot:0,t:1});
    r.defeats.onEvent(e,b,r);assert.equal(r.defeats.bodies[0].animator.meta.key,end);
  }
});

test('derived and authored poses hold grounded, respect pause/reduced motion and keep uniform scale',()=>{
  const a=new Animator(meta), calls=[];
  const ctx={translate:(...x)=>calls.push(['translate',...x]),rotate:x=>calls.push(['rotate',x])};
  a.play('HitGround',{hold:true,duration:1.2});a.update(1.2);
  a.pose(ctx,100,100,2,2);assert.ok(calls.some(x=>x[0]==='rotate'&&x[1]===Math.PI/2));
  const stable=structuredClone(calls);calls.length=0;a.update(0);a.pose(ctx,100,100,2,2);
  assert.deepEqual(calls,stable);
  a.play('HitGround',{hold:true});calls.length=0;a.pose(ctx,100,100,2,2,true);
  assert.ok(calls.some(x=>x[0]==='rotate'&&x[1]===Math.PI/2),'reduced motion retains the final down pose');
  a.start('Idle',false);assert.equal(a.hold,false);assert.equal(a.once,false);
});

test('seeking to a waiting KO restores only a held down pose; restarting removes it',()=>{
  const {b,r}=fixture();r.offline=true;
  b.faint(b.sides[1],b.sides[0]);b.t+=30;
  r.resetReplay(b);
  assert.equal(r.defeats.bodies.length,1);
  const body=r.defeats.bodies[0];
  assert.equal(body.slot,0);assert.equal(body.animator.cur,'HitGround');assert.ok(body.animator.done);
  assert.equal(body.recallAt,null);assert.ok(r.time-body.at>=GROUND_SECONDS);
  const clean=fixture().b;r.resetReplay(clean);assert.equal(r.defeats.bodies.length,0);
});

test('an undecoded native ground sheet uses a downed Idle pose instead of standing up',async()=>{
  const old=globalThis.Image;
  globalThis.Image=class {set src(v){this.url=v;if(v.endsWith('/Idle.png'))queueMicrotask(()=>this.onload());}};
  try {
    const native={key:'late-ground1502',a:{Idle:geom,HitGround:geom}};
    await image(sheetUrl(native,'Idle')).loaded;
    const a=new Animator(native);a.play('HitGround',{hold:true,duration:1.2});a.update(1);
    const angles=[],ctx={globalAlpha:1,save(){},restore(){},translate(){},rotate:x=>angles.push(x),drawImage(){}};
    assert.equal(a.draw(ctx,100,100,2,2),true);
    assert.ok(angles.includes(Math.PI/2),'late native art retains a grounded presentation');
  } finally {globalThis.Image=old;}
});
