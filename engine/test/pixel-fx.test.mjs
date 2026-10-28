import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RtBattle} from '../src/realtime/sim.mjs';
import {PixelEffects, PIXEL_FX_LIMITS, pixelFrame, paintContact, paintAura, silhouetteDistance, relativeMatrix} from '../../client/src/battle/rt/pixel-fx.js';
import {Vfx, setParticleStyle} from '../../client/src/battle/rt/vfx.js';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {OverworldAnimator} from '../../client/src/battle/rt/overworld.js';
import {setShowSetting} from '../../client/src/battle/rt/show.js';

const I={a:1,b:0,c:0,d:1,e:0,f:0};
const context=()=>new Proxy({globalAlpha:1,getTransform:()=>I,createRadialGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]??(()=>{})});
const renderer=()=>({scale:24,k:1,px:x=>x*24,py:y=>y*24,reducedMotion:{matches:false},animOf(){return null;}});
const spec=(doubles=false)=>({version:14,format:doubles?'gen9doublescustomgame':'gen9customgame',arena:'open',seed:'pixel1673',time_limit:40,
 p1:{sets:[{species:'Mew',moves:['Slash','Swords Dance']},{species:'Eevee',moves:['Splash']}]},p2:{sets:[{species:'Blissey',moves:['Splash']},{species:'Snorlax',moves:['Splash']}]}});
const maskData=()=>{
 const data=new Uint8ClampedArray(128*128*4);
 for(let y=40;y<84;y++)for(let x=55;x<(y<60?61:74);x++)data[(y*128+x)*4+3]=255;
 return data;
};
function canvases(data=maskData()) {
 const created=[];
 const factory=()=>{
  const c={width:0,height:0};c.context={...context(),setTransform(){},transform(){},drawImage(){},createImageData:()=>({data:new Uint8ClampedArray(128*128*4)}),getImageData:()=>({data}),putImageData(){}};
  c.getContext=()=>c.context;created.push(c);return c;
 };return {factory,created};
}
const signature=f=>{let h=0;for(const c of[...f.color,...f.light])h=Math.imul(h^c,16777619);return h>>>0;};
const count=f=>f.color.reduce((n,c)=>n+!!c,0);

test('real engine use/hit/boost events drive distinct materials without changing replay or engine state',()=>{
 const a=new RtBattle(spec()),b=new RtBattle(spec()),fx=new PixelEffects(renderer());
 for(const sim of[a,b]){sim.sides[0].x=10;sim.sides[1].x=12;sim.sides[0].y=sim.sides[1].y=8;}
 let seen=a.events.length,hit=false,boost=false;
 for(let n=0;n<240;n++){
  const input=n===0?{p1:{use:0,focus:true}}:n===100?{p1:{use:1,focus:true}}:{};
  a.step(input);b.step(input);
  for(;seen<a.events.length;seen++){const e=a.events[seen];fx.onEvent(e,a,'#9fdaff');hit||=e.k==='hit';boost||=e.k==='boost';}
  fx.update(1/30,a.view());
 }
 assert.ok(hit);assert.ok(boost);assert.deepEqual(a.events,b.events);assert.deepEqual(a.view(),b.view());assert.deepEqual(a.inputLog,b.inputLog);
});

test('contact requires a positive first hit; doubles direction uses actual caster and ambiguity stays neutral',()=>{
 const b=new RtBattle(spec(true)),fx=new PixelEffects(renderer());
 for(const e of[{k:'miss'},{k:'protected'},{k:'immune'},{k:'hit',dmg:0},{k:'hit',dmg:2,hit:1}])fx.onEvent({...e,s:1,u:0},b);
 assert.equal(fx.contacts.length,0);
 const caster=b.sides[0].units[1],target=b.sides[1].units[0];caster.x=8;caster.y=target.y=8;target.x=12;
 fx.onEvent({k:'use',s:0,u:1,move:'slash'},b);fx.onEvent({k:'hit',s:1,u:0,from:0,move:'slash',dmg:2},b);
 assert.equal(fx.contacts[0].kind,'cut');assert.equal(fx.contacts[0].angle,0);assert.equal(fx.contacts[0].directional,true);
 fx.onEvent({k:'use',s:0,u:0,move:'slash'},b);fx.onEvent({k:'hit',s:1,u:0,from:0,move:'slash',dmg:2},b);assert.equal(fx.contacts[1].directional,false);
});

test('raster back/front, pause, dt partition and reduced motion preserve an authored stationary cue',()=>{
 const e={kind:'hit',age:.04,life:.44,color:0xff70d0f0,seed:4,angle:.2,directional:true};
 const f=pixelFrame();paintContact(f,e,'back');assert.equal(count(f),0);paintContact(f,e,'front');assert.ok(count(f)>20);
 const again=pixelFrame();paintContact(again,e,'front');assert.equal(signature(f),signature(again));assert.equal(e.age,.04);
 const cut=pixelFrame();paintContact(cut,{...e,kind:'cut',age:.12},'front');assert.ok(count(cut)>20);assert.notEqual(signature(cut),signature(f));
 const reduced=pixelFrame();paintContact(reduced,{...e,age:.1},'front',{reduced:true});const late=pixelFrame();paintContact(late,{...e,age:.2},'front',{reduced:true});assert.equal(signature(reduced),signature(late),'stationary cue during hold, no traveling fragments');
 const b=new RtBattle(spec()),x=new PixelEffects(renderer()),y=new PixelEffects(renderer());
 for(const fx of[x,y])fx.onEvent({k:'hit',s:1,dmg:3},b);
 x.update(.25,b.view());for(let i=0;i<5;i++)y.update(.05,b.view());assert.ok(Math.abs(x.contacts[0].age-y.contacts[0].age)<1e-9);
 const before=structuredClone(x.contacts);x.update(0,b.view());x.update(NaN,b.view());assert.deepEqual(x.contacts,before);x.update(3,b.view());assert.equal(x.contacts.length,0);
});

test('repeated uses by one actor keep direction while distinct actors remain ambiguous',()=>{
 const b=new RtBattle(spec(true)),fx=new PixelEffects(renderer());
 const caster=b.sides[0].units[0],target=b.sides[1].units[0];
 caster.x=8;target.x=12;caster.y=target.y=8;
 fx.onEvent({k:'use',s:0,u:0,move:'slash'},b);
 fx.update(.2,b.view());fx.onEvent({k:'use',s:0,u:0,move:'slash'},b);
 fx.onEvent({k:'hit',s:1,u:0,from:0,move:'slash',dmg:2},b);
 assert.equal(fx.contacts.at(-1).directional,true);assert.equal(fx.contacts.at(-1).angle,0);
 fx.onEvent({k:'use',s:0,u:1,move:'slash'},b);
 fx.onEvent({k:'hit',s:1,u:0,from:0,move:'slash',dmg:2},b);
 assert.equal(fx.contacts.at(-1).directional,false);
});

test('a hidden actor drops its old contour and empty captures remain capped at30Hz',()=>{
 const data=maskData(),pool=canvases(data),b=new RtBattle(spec()),fx=new PixelEffects(renderer(),pool.factory);
 fx.update(0,b.view());fx.onEvent({k:'boost',s:0,stage:1},b);fx.begin(context());let calls=0;
 const capture=()=>fx.captureActor(0,0,0,context(),{x:0,y:-48,w:40,h:48},()=>calls++);
 capture();assert.equal(fx.mattes.size,1);
 data.fill(0);fx.update(.04,b.view());capture();assert.equal(fx.mattes.size,0);assert.equal(calls,2);
 fx.update(1/60,b.view());capture();assert.equal(calls,2);
 data.set(maskData());fx.update(1/60+.001,b.view());capture();assert.equal(calls,3);assert.equal(fx.mattes.size,1);
 fx.dispose();assert.equal(fx.captureAttempts.size,0);
});

test('silhouette field follows concave alpha and keeps opaque body clear on both layers',()=>{
 const alpha=new Uint8Array(9*9);for(let y=2;y<7;y++)alpha[y*9+2]=1;for(let x=2;x<7;x++)alpha[6*9+x]=1;
 const dist=silhouetteDistance(alpha,9,9);assert.equal(dist[4*9+2],0);assert.equal(dist[4*9+3],3);assert.ok(dist[2*9+6]>dist[4*9+3]);
 const f=pixelFrame(9,9);paintAura(f,{age:.25,life:.9,color:0xffd080ff},{dist},'back',true);assert.ok(count(f)>0);
 for(let i=0;i<alpha.length;i++)if(alpha[i])assert.equal(f.color[i],0,'never fill the original body');
 const front=pixelFrame(9,9);paintAura(front,{age:.25,life:.9,color:0xffd080ff},{dist},'front',true);assert.ok(count(front)<count(f));
});

test('camera-relative capture preserves portrait rotation, throttles by playback time, rejects clipped masks and disposes canvases',()=>{
 assert.deepEqual(relativeMatrix({a:2,b:0,c:0,d:2,e:10,f:20},{a:0,b:2,c:-2,d:0,e:16,f:28}),[0,1,-1,0,3,4]);
 assert.equal(relativeMatrix({a:0,b:0,c:0,d:0,e:0,f:0},I),null);
 const b=new RtBattle(spec()),r=renderer(),pool=canvases(),fx=new PixelEffects(r,pool.factory);fx.update(0,b.view());fx.onEvent({k:'mega',s:0},b);fx.begin(context());let draws=0;
 const capture=()=>fx.captureActor(0,0,0,context(),{x:0,y:-48,w:40,h:48},()=>draws++);
 capture();assert.equal(draws,1);assert.equal(fx.mattes.size,1);capture();assert.equal(draws,1,'pause does not recapture');fx.update(.04,b.view());capture();assert.equal(draws,2);
 fx.draw(context(),'back','textured');fx.draw(context(),'front','pixel');assert.equal(pool.created.length,2,'one mask canvas and one paint canvas');
 const data=maskData();data[3]=255;const clipped=new PixelEffects(r,canvases(data).factory);clipped.update(0,b.view());clipped.onEvent({k:'boost',s:0,stage:1},b);clipped.begin(context());clipped.captureActor(0,0,0,context(),{x:0,y:0,w:40,h:48},()=>{});assert.equal(clipped.mattes.size,0,'no rectangular outline from cropped alpha');
 fx.dispose();assert.equal(fx.mattes.size,0);assert.ok(pool.created.every(c=>c.width===0&&c.height===0));assert.equal(fx.frame,null);fx.onEvent({k:'hit',s:1,dmg:3},b);assert.equal(fx.contacts.length,0);
});

test('bounded owners expire, cancel recalled party slots, and plain/style changes retain legacy behavior',()=>{
 const b=new RtBattle(spec()),r=renderer(),fx=new PixelEffects(r);
 for(let n=0;n<100;n++)fx.onEvent({k:'hit',s:1,dmg:2,t:n},b);assert.equal(fx.contacts.length,PIXEL_FX_LIMITS.contacts);
 fx.update(0,b.view());fx.onEvent({k:'boost',s:0,stage:1},b);fx.onEvent({k:'recall',s:0},b);assert.equal(fx.auras.length,0);
 fx.onEvent({k:'dynamax',s:0},b);const v=b.view();v.sides[0].active=1;fx.update(.04,v);assert.equal(fx.auras.length,0,'replacement cannot inherit an aura');
 const previous=globalThis.localStorage;let stored='textured';globalThis.localStorage={getItem:()=>stored,setItem:(k,v)=>{stored=v;}};
 setParticleStyle('plain');const vfx=new Vfx(r);vfx.onEvent({k:'hit',s:1,from:0,move:'tackle',dmg:2,type:'Normal'},b);assert.equal(vfx.pixel.contacts.length,0);assert.ok(vfx.parts.length>0);
 setParticleStyle('pixel');vfx.update(0,{...b.view(),projectiles:[]});vfx.onEvent({k:'hit',s:1,from:0,move:'tackle',dmg:2,type:'Normal'},b);assert.equal(vfx.pixel.contacts.length,1);
 const old=vfx.pixel;setParticleStyle('plain');vfx.update(0,b.view());assert.equal(old.disposed,true);assert.equal(vfx.pixel.contacts.length,0);vfx.dispose();setParticleStyle('textured');
 assert.equal(new Vfx({scale:24}).pixel,null,'classic adapter gets no uncaptured synthetic aura');globalThis.localStorage=previous;
});

test('ordinary renderer captures the current animator without advancing it twice',()=>{
 const r=Object.create(ArenaRenderer.prototype),b=new RtBattle(spec()),pool=canvases();let updates=0,draws=0;
 const a={meta:{a:{Idle:{w:20,h:20,ax:10,ay:20}}},cur:'Idle',busy:()=>false,start(){},loop(){},update(){updates++;},draw(){draws++;return true;},height:()=>20};
 Object.assign(r,{ctx:context(),scale:24,k:1,time:0,portrait:false,reducedMotion:{matches:false},show:{hides:()=>false,on:false},specials:{bodyPhase:()=>({alpha:1,flash:0}),drawBody(){}},reactions:{sample:()=>({x:0,y:0,lift:0,turn:0,sx:1,sy:1})},tosses:{},flash:[0,0],lastActive:[],heads:[],labels:[null,null],animOf:()=>a});
 r.vfx={pixel:new PixelEffects(r,pool.factory)};r.vfx.pixel.update(0,b.view());r.vfx.pixel.onEvent({k:'boost',s:0,stage:1},b);r.vfx.pixel.begin(r.ctx);r.drawUprightMon(b.view(),b.view().sides[0],0,.03);
 assert.equal(updates,1);assert.equal(draws,2,'one actual draw plus one exact-alpha draw');assert.equal(r.vfx.pixel.mattes.size,1);
});

test('imported walking sheets use their real normalized geometry for alpha capture',()=>{
 const r=Object.create(ArenaRenderer.prototype),b=new RtBattle(spec());let bounds;
 const a=Object.assign(Object.create(OverworldAnimator.prototype),{meta:{a:{Idle:{w:16,h:32,ax:8,ay:30.4}}},cur:'Idle',busy:()=>false,start(){},loop(){},update(){},draw:()=>true,height:()=>91.2});
 Object.assign(r,{ctx:context(),scale:24,k:1,time:0,portrait:false,reducedMotion:{matches:false},show:{hides:()=>false,on:false},specials:{bodyPhase:()=>({alpha:1,flash:0}),drawBody(){}},reactions:{sample:()=>({x:0,y:0,lift:0,turn:0,sx:1,sy:1})},tosses:{},flash:[0,0],lastActive:[],heads:[],labels:[null,null],animOf:()=>a,vfx:{pixel:{captureActor(s,u,slot,c,rect){bounds=rect;}}}});
 r.drawUprightMon(b.view(),b.view().sides[0],0,.03);assert.equal(bounds.w,48);assert.equal(bounds.h,96);
});

test('seek disposes the previous owner and buffers before creating a clean replacement',()=>{
 const r=Object.create(ArenaRenderer.prototype),b=new RtBattle(spec()),pool=canvases();
 Object.assign(r,{scale:24,k:1,time:0,px:x=>x*24,py:y=>y*24,reducedMotion:{matches:false},offline:true,animOf:()=>null});
 r.vfx=new Vfx(r);const old=r.vfx.pixel;old.factory=pool.factory;old.onEvent({k:'hit',s:1,dmg:2},b);old.draw(context(),'front','pixel');assert.ok(old.frame);
 setShowSetting('crowd',false);r.resetReplay(b);setShowSetting('crowd',true);
 assert.equal(old.disposed,true);assert.equal(old.frame,null);assert.ok(pool.created.every(c=>!c.width&&!c.height));assert.notEqual(r.vfx.pixel,old);assert.equal(r.vfx.pixel.contacts.length,0);assert.equal(r.vfx.pixel.auras.length,0);
});

test('static fallback captures its actual image and keeps original geometry/material outside the mask',()=>{
 const r=Object.create(ArenaRenderer.prototype),b=new RtBattle(spec());let source,bounds;
 const img={width:96,height:64};
 Object.assign(r,{ctx:context(),scale:24,k:1,time:0,portrait:false,reducedMotion:{matches:false},show:{hides:()=>false,on:false},specials:{bodyPhase:()=>({alpha:1,flash:0}),drawBody(){}},reactions:{sample:()=>({x:0,y:0,lift:0,turn:0,sx:1,sy:1})},tosses:{},pains:[],flash:[0,0],lastActive:[],heads:[],labels:[null,null],animOf:()=>null,fallbacks:[[{ready:true,img}]],vfx:{pixel:{captureActor(s,u,slot,c,rect,draw){bounds=rect;draw({drawImage(image){source=image;}});}}}});
 r.drawUprightMon(b.view(),b.view().sides[0],0,.03);assert.equal(source,img);assert.ok(Math.abs(bounds.w/bounds.h-1.5)<1e-9);assert.equal(img.width,96);assert.equal(img.height,64);
});

test('MIT notice accompanies the adapted module, with a legal comment for portable bundling',()=>{
 const source=readFileSync(new URL('../../client/src/battle/rt/pixel-fx.js',import.meta.url),'utf8');const license=readFileSync(new URL('../../client/src/battle/rt/pixel-fx.LICENSE.txt',import.meta.url),'utf8');
 for(const s of[source,license])assert.match(s,/Copyright \(c\) 2026 Hugo Duprez/);assert.match(source,/\/\*! @license MIT/);assert.match(license,/Permission is hereby granted/);assert.doesNotMatch(source,/https?:\/\/|fetch\(|setInterval\(|requestAnimationFrame\(/);
});
