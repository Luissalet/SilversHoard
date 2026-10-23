import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle} from '../src/realtime/sim.mjs';
import {SpecialPresentation} from '../../client/src/battle/rt/special-presentation.js';
import {Show} from '../../client/src/battle/rt/show.js';

test('a real doubles Z retains its caster through control changes and omits a recalled caster',()=>{
const b=new RtBattle({version:14,format:'gen9doublescustomgame',seed:'peer1349',arena:'open',time_limit:60,
 p1:{sets:[{species:'Bulbasaur',moves:['Splash']},{species:'Pikachu',level:1,item:'Electrium Z',moves:['Thunderbolt']}]},
 p2:{sets:[{species:'Blissey',moves:['Splash']},{species:'Blissey',moves:['Splash']}]}});
b.partnerInput=()=>({});
b.sides[0].units[1].x=10;b.sides[0].units[1].y=8;b.sides[1].units[0].x=13;b.sides[1].units[0].y=8;
const p=new SpecialPresentation(),r={time:0,scale:20,k:1,offline:true,portraits:false,sprites:null,fallbacks:[],trainers:[],specials:p,reducedMotion:{matches:false},vfx:{fx:[],shake:0,emit(){}},trainerPos:s=>({x:s?29:-1,y:8})};
const show=new Show(r);let index=b.events.length,hit;
for(let tick=0;tick<70 && !hit;tick++) {
 b.step(tick===0?{p1:{ctl:1,use:0,zmove:true}}:tick===1?{p1:{ctl:0}}:{});
 for(;index<b.events.length;index++) {
  const e=b.events[index];show.onEvent(e,b);p.onEvent(e,b);
  if(e.k==='hit' && e.from===0 && e.move==='gigavolthavoc'){hit=e;break;}
 }
 p.update(1/30,b.view());
}
assert.ok(hit,'real Z hit');assert.equal(show.impact.special,'z');assert.equal(p.attacks[0].u,1);assert.equal(b.sides[0].ctl,0);
const selected=[];const ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{})});
const oldDoc=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>ctx})};
r.animOf=(side,slot)=>({draw(){selected.push({side,slot,species:b.sides[side].mons[slot].species});return true;}});
show.toScreen=(x,y)=>({x,y,k:1});
try {show.drawSilhouettes(ctx,b,show.impact,'#fff',640,360);}finally{globalThis.document=oldDoc;}
assert.equal(selected[0].slot,1,'impact retains the caster after control changes');
// A recalled caster must not turn into its replacement in the panel.
b.sides[0].units[1].active=0;selected.length=0;globalThis.document={createElement:()=>({getContext:()=>ctx})};
try {show.drawSilhouettes(ctx,b,show.impact,'#fff',640,360);}finally{globalThis.document=oldDoc;}
assert.equal(selected.filter(n=>n.side===0).length,0);
});

test('ordinary Dynamax retains its valid base fallback with uniform silhouette scale',()=>{
const b=new RtBattle({version:14,format:'gen9customgame',seed:'fallback1349',arena:'open',time_limit:60,p1:{sets:[{species:'Blissey',moves:['Splash']}]},p2:{sets:[{species:'Eevee',moves:['Splash']}]}});
const originalImage={name:'real-ready-base-fallback',width:120,height:100},images=[],heights=[];let ovals=0;
const offctx=new Proxy({drawImage(img,x,y,w,h){images.push(img.name);heights.push(h);},ellipse(){ovals++;}},{get:(o,k)=>o[k]??(()=>{})});
const ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{})}),oldDoc=globalThis.document;
globalThis.document={createElement:()=>({getContext:()=>offctx})};
const r={scale:20,k:1,anims:[[null]],dynamaxFallbacks:[[null]],fallbacks:[[{ready:true,img:originalImage}]],animOf:()=>null};
const show=new Show(r);show.toScreen=(x,y)=>({x,y,k:1});
try {
 show.drawSilhouettes(ctx,b,{a:0,s:0,u:0,actorOnly:true},'#fff',640,360);assert.deepEqual(images,['real-ready-base-fallback']);
 images.length=0;b.step({p1:{dynamax:true}});assert.ok(b.mon(b.sides[0]).dynamaxUntil);assert.equal(b.mon(b.sides[0]).species,'Blissey');
 show.drawSilhouettes(ctx,b,{a:0,s:0,u:0,actorOnly:true},'#fff',640,360);
 assert.deepEqual(images,['real-ready-base-fallback'],'ordinary Dynamax retains its own base fallback, scaled up');
 assert.equal(heights[1],heights[0]*2.2);
 const g=new RtBattle({version:14,format:'gen9customgame',seed:'gmax-fallback',p1:{sets:[{species:'Snorlax',gigantamax:true,moves:['Splash']}]},p2:{sets:[{species:'Eevee',moves:['Splash']}]}});
 g.step({p1:{dynamax:true}});assert.ok(g.mon(g.sides[0]).dynamax_info.look);
 images.length=0;show.drawSilhouettes(ctx,g,{a:0,s:0,u:0,actorOnly:true},'#fff',640,360);
 assert.deepEqual(images,[],'missing Gigamax art never borrows the ordinary-form image');
}finally{globalThis.document=oldDoc;}
});
