import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle} from '../src/realtime/sim.mjs';
import {SpecialPresentation} from '../../client/src/battle/rt/special-presentation.js';

const spec=(set={},format='gen9customgame')=>({version:13,format,arena:'open',seed:'presentation1327',time_limit:90,
  p1:{sets:[{species:'Pikachu',moves:['Thunderbolt','Surf','Protect'],...set},{species:'Eevee',moves:['Tackle']}]},
  p2:{sets:[{species:'Blissey',moves:['Splash']},{species:'Snorlax',moves:['Splash']}]}});
function run(b,p,input={},ticks=1) {
  let i=b.events.length;
  for(let n=0;n<ticks;n++) {
    b.step(n?{}:{p1:input});
    for(;i<b.events.length;i++)p.onEvent(b.events[i],b);
    p.update(1/30,b.view());
  }
}
const close=b=>{b.sides[0].x=10;b.sides[0].y=10;b.sides[1].x=13;b.sides[1].y=10;};

test('real Z events retain a charging crystal until release, then decorate the confirmed hit only',()=>{
  const b=new RtBattle(spec({item:'Electrium Z'})),p=new SpecialPresentation();close(b);
  run(b,p,{use:0,zmove:true});
  assert.equal(p.charges.length,1);assert.equal(p.charges[0].type,'Electric');
  assert.equal(p.attacks.length,0);assert.equal(p.impacts.length,0);
  const paused=structuredClone(p);p.update(0,b.view());assert.deepEqual({...p},{...paused});
  run(b,p,{},5);assert.equal(p.charges.length,1);
  run(b,p,{},45);
  assert.equal(p.charges.length,0);assert.ok(p.attacks.some(a=>a.z));
  assert.ok(b.events.some(e=>e.k==='hit'&&e.move==='gigavolthavoc'));
});

test('Dynamax stages one uniform growth and timeout contracts, while seeking is immediately truthful',()=>{
  const b=new RtBattle(spec()),p=new SpecialPresentation();run(b,p,{dynamax:true});
  assert.equal(p.bodyScale(0,0,0,2.2,false),1);
  p.update(.48,b.view());assert.ok(p.bodyScale(0,0,0,2.2,false)>1.5);
  assert.equal(p.bodyScale(0,0,0,2.2,true),2.2);
  assert.equal(p.bodyScale(0,1,0,2.2,false),2.2);
  p.update(1,b.view());assert.equal(p.bodyScale(0,0,0,2.2,false),2.2);
  b.dynamaxEnd(b.sides[0],'time');p.onEvent(b.events.at(-1),b);
  assert.equal(p.bodyScale(0,0,0,1,false),2.2);
  p.update(.55,b.view());assert.equal(p.bodyScale(0,0,0,1,false),1);
  assert.equal(new SpecialPresentation().bodyScale(0,0,0,2.2,false),2.2);
});

test('Max and Z presentation leaves every deterministic event, input and final state unchanged',()=>{
  for(const set of [{gigantamax:true},{item:'Electrium Z'}]) {
    const a=new RtBattle(spec(set)),b=new RtBattle(spec(set)),p=new SpecialPresentation();close(a);close(b);
    const input=set.item?{use:0,zmove:true}:{dynamax:true,use:0};
    run(a,p,input,120);
    for(let n=0;n<120;n++)b.step(n?{}:{p1:input});
    assert.deepEqual(a.view(),b.view());assert.deepEqual(a.events,b.events);assert.deepEqual(a.inputLog,b.inputLog);
    assert.ok(p.attacks.length);
  }
});

test('miss, immunity and guard events never create a fictitious special impact',()=>{
  const b=new RtBattle(spec({item:'Electrium Z'})),p=new SpecialPresentation();
  run(b,p,{use:0,zmove:true},23);
  assert.ok(p.attacks.length);
  for(const k of ['miss','immune','protected','fizzle'])p.onEvent({k,s:1,from:0,move:'gigavolthavoc',t:b.t},b);
  assert.equal(p.impacts.length,0);
  p.onEvent({k:'hit',s:1,from:0,move:'gigavolthavoc',type:'Electric',t:b.t,hit:0},b);
  assert.equal(p.impacts.length,1);assert.equal(p.impacts[0].x,b.sides[1].x);
  p.onEvent({k:'hit',s:1,from:0,move:'gigavolthavoc',type:'Electric',t:b.t,hit:1},b);
  assert.equal(p.impacts.length,1,'multihits do not duplicate the cinematic');
});

test('doubles charge and transformation owners are independent; recall clears only its own unit',()=>{
  const b=new RtBattle(spec({item:'Electrium Z'},'gen9doublescustomgame')),p=new SpecialPresentation();
  for(let u=0;u<2;u++)p.onEvent({k:'dynamax',s:0,u,slot:u},b);
  p.onEvent({k:'recall',s:0,u:1},b);assert.deepEqual(p.transforms.map(n=>n.u),[0]);
  p.onEvent({k:'zmove',s:0,u:0,slot:0,move:'gigavolthavoc'},b);
  p.onEvent({k:'recall',s:0,u:1},b);assert.equal(p.charges.length,1);
  p.onEvent({k:'faint',s:0,u:0,slot:0},b);assert.equal(p.charges.length,0);assert.equal(p.transforms.length,0);
});

test('drawing is allocation-bounded on pause and all eighteen type materials support reduced motion',()=>{
  const b=new RtBattle(spec({item:'Electrium Z'})),p=new SpecialPresentation();close(b);run(b,p,{use:0,zmove:true},23);
  p.onEvent({k:'hit',s:1,from:0,move:'gigavolthavoc',type:'Electric',t:b.t,hit:0},b);
  const ctx=new Proxy({globalAlpha:1,createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:20})},{get:(o,k)=>o[k]??(()=>{})});
  const r={scale:20,px:x=>x*20,py:y=>y*20,time:1,canvas:{width:390,height:685},portrait:true,trainers:[],texts:{lang:'es'}};
  const frozen=structuredClone(p),v=b.view();
  for(let i=0;i<120;i++){p.drawGround(ctx,r,v,false,true);p.drawAttacks(ctx,r,v,false,true);p.drawScreen(ctx,r,false,true);}
  assert.deepEqual({...p},{...frozen});
  for(const type of ['Normal','Fire','Water','Grass','Electric','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy'])
    p.material(ctx,type,100,100,30,1,true);
  p.update(8,v);assert.equal(p.attacks.length,0);assert.equal(p.impacts.length,0);
});
