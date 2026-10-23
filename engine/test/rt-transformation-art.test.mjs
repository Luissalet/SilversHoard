import test from 'node:test';
import assert from 'node:assert/strict';
import {SpecialPresentation} from '../../client/src/battle/rt/special-presentation.js';
import {transformationBody,paintTransformationFrame} from '../../client/src/battle/rt/transformation-art.js';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {Show} from '../../client/src/battle/rt/show.js';
import {RtBattle} from '../src/realtime/sim.mjs';

test('all three transformations keep the old body, conceal the switch and reveal a single new silhouette',()=>{
  for(const kind of ['ultra','mega','giant']) {
    const n={[kind]:true,life:1.35,age:.1};
    assert.deepEqual(transformationBody(n),{base:true,alpha:1,flash:kind==='giant'?.1/.3*.65:kind==='ultra'?.1/.28*.65:.1/.24*.65});
    n.age=.4;assert.equal(transformationBody(n).alpha,0);assert.equal(transformationBody(n).base,true);
    n.age=kind==='giant'?.52:.60;assert.deepEqual(transformationBody(n),{base:false,alpha:1,flash:1});
    n.age=1.1;assert.deepEqual(transformationBody(n),{base:false,alpha:1,flash:0});
    assert.deepEqual(transformationBody({...n,age:.4},true),{base:false,alpha:1,flash:0});
  }
  assert.deepEqual(transformationBody(null),{base:false,alpha:1,flash:0});
});

test('actual renderer selects base PMD during charge and exact transformed PMD after the envelope',()=>{
  const old={window:globalThis.window,document:globalThis.document,Image:globalThis.Image};
  const ctx=new Proxy({globalAlpha:1,measureText:()=>({width:20}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{})});
  globalThis.window={devicePixelRatio:1,innerHeight:800};globalThis.document={createElement:()=>({getContext:()=>ctx})};
  globalThis.Image=class {set src(v){this.width=this.height=96;this.onload?.();}};
  try {
    for(const [kind,flag,table] of [['ultra','is_ultra','ultraAnims'],['mega','is_mega','megaAnims'],['giant','is_dynamax','dynamaxAnims']]) {
      const m={species:'Pikachu',num:25,forme:'',hp:100,maxhp:100,[flag]:true,display_scale:2.2};
      const r=new ArenaRenderer({style:{},clientWidth:640,getContext:()=>ctx},{sides:[{mons:[m]}],sprites:{fallback:()=>''}});
      r.show={on:true,hides:()=>false};const calls=[];
      const anim=label=>({start(){},loop(){},busy:()=>false,update(){},height:k=>24*k,draw(c,x,y,row,k,opts){calls.push({label,k,alpha:opts.alpha});return true;}});
      r.anims[0][0]=anim('base');r[table][0][0]=anim(kind);
      const side={active:0,mons:[m],x:8,y:8,r:1,fx:1,fy:0};
      const n={s:0,u:0,slot:0,[kind]:true,age:.1,life:1.35};r.specials.transforms.push(n);
      r.drawMon({},side,0,0);assert.equal(calls.at(-1).label,'base');assert.equal(calls.at(-1).alpha,1);
      n.age=.4;r.drawMon({},side,0,0);assert.equal(calls.at(-1).alpha,0);
      n.age=.7;r.drawMon({},side,0,0);assert.equal(calls.at(-1).label,kind);assert.equal(calls.at(-1).alpha,1);
      r.reducedMotion={matches:true};n.age=.4;r.drawMon({},side,0,0);assert.equal(calls.at(-1).label,kind);assert.equal(calls.at(-1).alpha,1);
      r.show.on=false;r.reducedMotion.matches=false;r.drawMon({},side,0,0);assert.equal(calls.at(-1).label,kind);
    }
  } finally {Object.assign(globalThis,old);}
});

test('the rupture is a bounded single panel at the actual owner, and disabled for reduced/plain/impact-off',()=>{
  const p=new SpecialPresentation(),w={active:2,x:4,y:6};
  const b={doubles:true,sides:[{units:[{active:0},w]}]};
  const n={s:0,u:1,slot:2,ultra:true,age:.6,life:1.25};p.transforms.push(n);
  let fills=0,silhouettes=0;
  const ctx=new Proxy({fillRect(){fills++;},measureText:()=>({width:10})},{get:(o,k)=>o[k]??(()=>{})});
  const r={canvas:{width:390,height:844},show:{toScreen:(x,y)=>({x,y}),drawSilhouettes(){silhouettes++;}},trainers:[],texts:{lang:'es'}};
  for(const age of [.59,.6,.65,.706,.9]){n.age=age;paintTransformationFrame(ctx,n,r,b);}
  assert.equal(fills,2);assert.equal(silhouettes,2);
  n.age=.65;const before=fills;
  p.drawScreen(ctx,r,true,true,b,true);p.drawScreen(ctx,r,false,false,b,true);p.drawScreen(ctx,r,false,true,b,false);
  // Caption rectangles are separate from the full-screen frame.
  assert.equal(silhouettes,2);assert.ok(fills>=before);
  w.active=0;paintTransformationFrame(ctx,n,r,b);assert.equal(silhouettes,2);
  const snapshot=structuredClone(p);p.update(0,{...b,sides:[{...b.sides[0],mons:[]}]});assert.deepEqual({...p},{...snapshot});
});

test('a real low-damage Z gets one confirmed impact panel; its windup and release invent none',()=>{
  const b=new RtBattle({version:14,format:'gen9customgame',seed:'impact1349',arena:'open',time_limit:60,
    p1:{sets:[{species:'Pikachu',level:1,item:'Electrium Z',moves:['Thunderbolt']}]},
    p2:{sets:[{species:'Blissey',moves:['Splash']}]}});
  b.sides[0].x=10;b.sides[1].x=13;b.sides[0].y=b.sides[1].y=8;
  const p=new SpecialPresentation();
  const r={texts:undefined,time:0,scale:20,offline:true,sprites:null,fallbacks:[],trainers:[],specials:p,
    reducedMotion:{matches:false},vfx:{fx:[],shake:0,emit(){}},trainerPos:s=>({x:s?29:-1,y:8})};
  const show=new Show(r);let i=b.events.length,hit;
  for(let tick=0;tick<60;tick++) {
    b.step(tick?{}:{p1:{use:0,zmove:true}});
    for(;i<b.events.length;i++) {
      const e=b.events[i];show.onEvent(e,b);p.onEvent(e,b);
      if(e.k==='use')assert.equal(show.impact,null);
      if(e.k==='hit'){hit=e;assert.equal(show.impact.special,'z');assert.equal(show.impact.x,b.sides[e.s].x);}
    }
    p.update(1/30,b.view());
  }
  assert.ok(hit);assert.ok(hit.dmg/hit.maxhp<.3);
  r.reducedMotion.matches=true;show.punch=null;show.push(10,8,1.35,1);assert.equal(show.punch,null);
});
