import test from 'node:test';
import assert from 'node:assert/strict';
import {FighterReactions, damageTextMotion} from '../../client/src/battle/rt/visuals/reactions.js';
import {motionFor} from '../../client/src/battle/rt/visuals/choreography.js';

const fighter = (index, x, y = 4) => ({index, x, y, fx: index ? -1 : 1, fy: 0, active: 0,
  mons: [{hp: 100, maxhp: 100}, {hp: 100, maxhp: 100}]});
const hit = {k:'hit',s:1,from:0,move:'tackle',dmg:20,maxhp:100,hp:80,hit:0};
function setup() { return {motion:new FighterReactions(),battle:{sides:[fighter(0,3),fighter(1,8)]}}; }

test('release, recoil and recovery are directional, bounded and leave battle inputs/state intact', () => {
  const {motion,battle} = setup(), before = structuredClone(battle);
  motion.onEvent({k:'use',s:0,move:'tackle',shape:'strike'},battle,1);
  motion.onEvent(Object.freeze(hit),battle,1.1);
  assert.ok(motion.sample(battle.sides[0],0,1.05).x > 0);
  const reaction = motion.sample(battle.sides[1],1,1.16);
  assert.ok(reaction.x > .3 && reaction.x < .9);
  assert.ok(reaction.sy < 1);
  assert.deepEqual(motion.sample(battle.sides[1],1,1.16),reaction,'paused frame is stable');
  assert.equal(motion.sample(battle.sides[1],1,1.6).x,0);
  assert.deepEqual(battle,before);
});

test('critical damage recoils more strongly, repeated multi-hits stay bounded, no zero-damage hurt', () => {
  const {motion,battle} = setup();
  motion.onEvent(hit,battle,1);
  const normal = motion.sample(battle.sides[1],1,1.06).x;
  for (let i=0;i<100;i++) motion.onEvent({...hit,crit:true,hit:i},battle,1);
  const strong = motion.sample(battle.sides[1],1,1.06).x;
  assert.ok(strong > normal && strong <= .8);
  assert.equal(motion.reactions.length,4);
  motion.onEvent({k:'switch',s:1},battle,2);
  motion.onEvent({...hit,dmg:0},battle,2);
  assert.equal(motion.sample(battle.sides[1],1,2.06).x,0);
});

test('block, a real roll and heal convey distinct outcomes; misses never invent a dodge', () => {
  const {motion,battle} = setup();
  motion.onEvent({k:'protected',s:1},battle,1);
  assert.ok(motion.sample(battle.sides[1],1,1.05).x > 0);
  assert.ok(motion.sample(battle.sides[1],1,1.05).x < .13);
  motion.onEvent({k:'miss',s:0},battle,2);
  assert.equal(motion.sample(battle.sides[1],1,2.05).y,0);
  motion.onEvent({k:'roll',s:1},battle,2);
  assert.ok(Math.abs(motion.sample(battle.sides[1],1,2.05).y) > .4);
  motion.onEvent({k:'switch',s:1},battle,3);
  motion.onEvent({k:'miss',s:0,fog:true},battle,3);
  assert.equal(motion.reactions[1],null);
  motion.onEvent({k:'heal',s:1},battle,4);
  const heal = motion.sample(battle.sides[1],1,4.2);
  assert.ok(heal.lift > 0); assert.equal(heal.x,0);
});

test('new slots, recall, faint, special choreography and reduced motion have safe interruption paths', () => {
  const {motion,battle} = setup(), side = battle.sides[1];
  motion.onEvent(hit,battle,1);
  const still = motion.sample(side,1,1.06,{reduced:true});
  assert.deepEqual(still,{x:0,y:0,lift:0,turn:0,sx:1,sy:1});
  side.active=1; assert.equal(motion.sample(side,1,1.06).x,0);
  side.active=0; side.mons[0].fainted=true;
  assert.deepEqual(motion.sample(side,1,1.06),still);
  side.mons[0].fainted=false;
  motion.onEvent({k:'recall',s:1},battle,1.07);
  assert.equal(motion.sample(side,1,1.08).x,0);
  side.act={kind:'windup',left:3,total:30};
  assert.ok(motion.sample(side,1,2).sy < 1);
  assert.deepEqual(motion.sample(side,1,2,{special:true}),still);
  assert.deepEqual(new FighterReactions().sample({...side,act:null},1,0),still,'seek reset is clean');
});

test('doubles use the releasing unit, isolate all four slots and rotate motion into portrait coordinates', () => {
  const motion = new FighterReactions();
  const units = [fighter(0,3,2),fighter(0,3,7),fighter(1,9,2),fighter(1,9,7)];
  units.forEach((u,i)=>u.pos=i%2);
  const battle={doubles:true,sides:[{units:units.slice(0,2)},{units:units.slice(2)}],foe:s=>units[s.index?0:2]};
  motion.onEvent({k:'use',s:0,u:1,move:'tackle',shape:'strike'},battle,1);
  motion.onEvent({...hit,u:1},battle,1.1);
  assert.equal(motion.sample(units[2],2,1.16).x,0);
  const landscape=motion.sample(units[3],3,1.16),portrait=motion.sample(units[3],3,1.16,{portrait:true});
  assert.ok(landscape.x>0); assert.equal(landscape.y,0);
  assert.equal(portrait.x,0); assert.equal(portrait.y,-landscape.x);
});

test('damage typography is stable on pause and preserves stationary reduced-motion feedback', () => {
  const a=damageTextMotion(.05);
  assert.equal(a.x,0); assert.ok(a.scale>1);
  assert.deepEqual(damageTextMotion(.05),a);
  assert.equal(damageTextMotion(.4).scale,1);
  assert.equal(damageTextMotion(1.1).alpha,0);
  assert.deepEqual(damageTextMotion(.4,true),{x:0,rise:0,scale:1,alpha:1});
});

test('simultaneous allies using the same move never invent a recoil direction in doubles', () => {
  const motion=new FighterReactions();
  const a=fighter(0,2,2),b={...fighter(0,10,4),pos:1},target=fighter(1,6,4);
  const battle={doubles:true,sides:[{units:[a,b]},{units:[target,fighter(1,8,7)]}]};
  motion.onEvent({k:'use',s:0,u:0,move:'tackle',shape:'strike'},battle,1);
  motion.onEvent({k:'use',s:0,u:1,move:'tackle',shape:'strike'},battle,1);
  motion.onEvent(hit,battle,1.1);
  const pose=motion.sample(target,2,1.16);
  assert.equal(pose.x,0);assert.equal(pose.y,0);assert.equal(pose.turn,0);
  assert.ok(pose.sy<1,'still communicates the impact through compression');
});

test('the actual special-motion signal excludes rolling moves from ordinary anticipation', () => {
  for(const id of ['rollout','iceball']) {
    const side={...fighter(0,3),act:{kind:'windup',left:3,total:30,slot:0},mons:[{moves:[{id}]}]};
    const special=motionFor(side,1).ring;
    assert.equal(special,'roll');
    assert.equal(new FighterReactions().sample(side,0,1,{special:!!special}).turn,0);
  }
});


test('the real renderer gives static fallback sprites both body recoil and the cached hit silhouette', async () => {
  const {ArenaRenderer}=await import('../../client/src/battle/rt/render.js');
  const saved={window:globalThis.window,Image:globalThis.Image,document:globalThis.document};
  const ops=[],stack=[];
  const ctx=new Proxy({globalAlpha:1},{get(o,k){if(k in o)return o[k];return (...a)=>{ops.push([k,...a]);if(k==='save')stack.push(1);if(k==='restore')stack.pop();};},set(o,k,v){o[k]=v;return true;}});
  globalThis.window={devicePixelRatio:1,innerHeight:800};
  globalThis.Image=class {};
  globalThis.document={createElement:()=>({width:32,height:32,getContext:()=>ctx})};
  try {
    const {battle}=setup(),side=battle.sides[1];side.r=1;
    const r=new ArenaRenderer({style:{},clientWidth:640,getContext:()=>ctx},{sides:battle.sides,sprites:{fallback:()=> 'reaction-test.png'}});
    r.scale=20;r.k=1;r.show={hides:()=>false};
    r.fallbacks[1][0]={ready:true,img:{width:32,height:32}};
    r.reactions.onEvent(hit,battle,1);r.time=1.06;r.flash[1]=1;
    const before=structuredClone(battle);
    r.drawMon({version:9},side,1,0);
    assert.ok(ops.some(o=>o[0]==='translate' && o[1]>5 && o[1]<18),'recoil wraps fallback artwork');
    assert.ok(ops.filter(o=>o[0]==='drawImage').length>=3,'original, cached white creation and hit silhouette are drawn');
    assert.equal(stack.length,0);assert.deepEqual(battle,before);
    for(let i=0;i<5;i++)r.damageFloat(battle,{...hit,t:30,hit:i,dmg:7,crit:i===2});
    assert.equal(r.floats.length,1,'five hits are one legible damage figure');
    assert.equal(r.floats[0].text,'−35% ×5');
    assert.equal(r.floats[0].size,1.3,'strongest hit retains its emphasis');
    r.damageFloat(battle,{...hit,t:31,hit:0,dmg:10});
    assert.equal(r.floats.length,2,'a later attack keeps its own total');
    r.resetReplay({sides:[]});assert.equal(r.reactions.reactions[1],null);
    assert.equal(r.damageFloats[1],null);
  } finally {Object.assign(globalThis,saved);}
});
