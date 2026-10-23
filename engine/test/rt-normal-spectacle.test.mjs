import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle} from '../src/realtime/sim.mjs';
import {ImpactAccents,contactMaterial} from '../../client/src/battle/rt/impact-accents.js';
import {FighterReactions} from '../../client/src/battle/rt/visuals/reactions.js';
import {effectProfile} from '../../client/src/battle/rt/supplied-moves.js';
import {specialMoveRecipe,paintSpecialMove} from '../../client/src/battle/rt/special-moves.js';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {logLine} from '../../client/src/battle/rt/rt-log.js';
import {rtT} from '../../client/src/battle/rt/strings.js';
import art from '../../silvers_hoard/presets/supplied_sprites.json' with {type:'json'};
import catalog from '../../silvers_hoard/presets/rt_move_effects.json' with {type:'json'};

const spec=(move='Thunderbolt',doubles=false)=>({version:14,format:doubles?'gen9doublescustomgame':'gen9customgame',arena:'open',seed:'normal1362',time_limit:60,
  p1:{sets:[{species:'Mew',moves:[move,'Protect']},{species:'Eevee',moves:['Splash']}]},
  p2:{sets:[{species:'Blissey',moves:['Splash','Protect']},{species:'Snorlax',moves:['Splash']}]}});
const renderer=()=>({scale:24,px:x=>x*24,py:y=>y*24,reducedMotion:{matches:false}});
const context=()=>new Proxy({globalAlpha:1,createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]??(()=>{})});

test('real fog and other misses keep renderer captions and both language logs neutral',()=>{
  const b=new RtBattle({...spec(),seed:'peer-fog1362'});
  b.sides[0].x=10;b.sides[1].x=13;b.sides[0].y=b.sides[1].y=8;b.fog={until:b.timeLimit};
  let miss;
  for(let t=0;t<700&&!miss;t++){b.step(t%110===0?{p1:{use:0,focus:true}}:{});miss=b.events.find(e=>e.k==='miss'&&e.fog);}
  assert.ok(miss);assert.equal(b.events.filter(e=>e.k==='roll').length,0);
  for(const doubles of [false,true])for(const lang of ['es','en']){
    const sim=doubles?new RtBattle(spec('Thunderbolt',true)):b,tr=rtT(lang),labels=[],reactions=new FighterReactions();
    const r={texts:{missed:tr('rt_missed'),dodged:tr('rt_dodged')},time:1,reactions,vfx:{onEvent(){}},show:{onEvent(){}},specials:{onEvent(){}},audio:{sfx(){},cry(){}},
      unitOf:(battle,s,u)=>battle.doubles?battle.sides[s].units[u]:battle.sides[s],float(battle,s,text,color,opts){labels.push({s,text,u:opts.u});}};
    for(const e of [miss,{...miss,fog:false},{...miss,fog:false,range:true},{...miss,fog:false,aim:true}]){
      ArenaRenderer.prototype.onEvent.call(r,e,sim);
      const line=logLine(e,sim,lang,tr);assert.doesNotMatch(line.text,/esquiv|dodg/i);assert.match(line.text,lang==='es'?/falla/:/missed/);
    }
    assert.equal(labels.length,4);assert.ok(labels.every(l=>l.s===1&&l.text===tr('rt_missed')));
    assert.ok(reactions.reactions.every(n=>n===null));
  }
});

test('normal attack layers follow real windup/release/hit and never change deterministic combat',()=>{
  for(const move of ['Thunderbolt','Slash','Ice Beam','Flamethrower','Water Pulse']) {
    const a=new RtBattle(spec(move)),b=new RtBattle(spec(move)),fx=new ImpactAccents(renderer());
    for(const sim of [a,b]){sim.sides[0].x=10;sim.sides[1].x=12;sim.sides[0].y=sim.sides[1].y=8;}
    let seen=a.events.length,hit=false;
    for(let t=0;t<100;t++) {
      const input=t?{}:{p1:{use:0,focus:true}};a.step(input);b.step(input);
      for(;seen<a.events.length;seen++) {
        const e=a.events[seen];fx.onEvent(e,a);
        if(e.k==='hit'){fx.hit(e,a.sides[e.s]);hit=true;}
        if(e.k==='windup')assert.equal(fx.hits.length,0);
      }
      fx.update(1/30);
      const before=structuredClone(fx.hits);fx.draw(context(),a.view());fx.drawUnder(context());assert.deepEqual(fx.hits,before);
    }
    assert.ok(hit,move);assert.deepEqual(a.events,b.events);assert.deepEqual(a.view(),b.view());assert.deepEqual(a.inputLog,b.inputLog);
  }
});

test('guard, miss and zero damage produce no contact frame; pause, reduced motion and budgets are bounded',()=>{
  const b=new RtBattle(spec()),r=renderer(),fx=new ImpactAccents(r);
  for(const k of ['miss','immune','protected'])fx.onEvent({k,s:1,move:'thunderbolt'},b);
  assert.equal(fx.hits.length,0);assert.equal(fx.guards.length,1);
  fx.hit({s:1,from:0,dmg:0,hp:100,move:'thunderbolt'},b.sides[1]);assert.equal(fx.hits.length,0);
  for(let n=0;n<100;n++){fx.onEvent({k:'windup',s:0,move:'thunderbolt',type:'Electric',shape:'beam',ticks:12},b);fx.onEvent({k:'use',s:0,move:'thunderbolt',type:'Electric',shape:'beam',category:'Special'},b);fx.hit({dmg:10,maxhp:100,hp:90,type:'Electric'},b.sides[1]);}
  assert.ok(fx.charges.length<=4);assert.equal(fx.releases.length,16);assert.equal(fx.hits.length,16);
  const frozen=JSON.stringify(fx,(k,v)=>k==='r'?undefined:v);fx.update(0);for(let n=0;n<100;n++){fx.draw(context(),b.view());fx.drawUnder(context());}
  assert.equal(JSON.stringify(fx,(k,v)=>k==='r'?undefined:v),frozen);
  let fills=0;const c=context();c.fill=()=>fills++;
  fx.drawUnder(c,false);assert.equal(fills,0);r.reducedMotion.matches=true;fx.drawUnder(c,true);assert.equal(fills,0);
  fx.update(7);assert.equal(fx.hits.length+fx.charges.length+fx.releases.length+fx.guards.length,0);
});

test('doubles release direction retains the actual caster; ambiguity has a symmetric contact mark',()=>{
  const b=new RtBattle(spec('Thunderbolt',true)),fx=new ImpactAccents(renderer());
  b.partnerInput=()=>({});const w=b.sides[0].units[1],target=b.sides[1].units[0];
  w.x=8;w.y=8;target.x=12;target.y=8;
  fx.onEvent({k:'use',s:0,u:1,move:'thunderbolt',shape:'beam',type:'Electric',category:'Special'},b);
  b.sides[0].ctl=0;fx.hit({s:1,u:0,from:0,move:'thunderbolt',type:'Electric',dmg:5,maxhp:100,hp:95},target);
  assert.equal(fx.hits[0].fx,1);assert.equal(fx.hits[0].fy,0);
  fx.onEvent({k:'use',s:0,u:0,move:'thunderbolt',shape:'beam',type:'Electric',category:'Special'},b);
  fx.hit({s:1,from:0,move:'thunderbolt',dmg:5,maxhp:100,hp:90},target);assert.equal(fx.hits[1].fx,0);assert.equal(fx.hits[1].fy,0);
  fx.onEvent({k:'recall',s:0,u:1},b);assert.deepEqual(fx.releases.map(n=>n.u),[0]);
  assert.equal(new ImpactAccents(renderer()).hits.length,0);
});

test('Ultra Z and normal light profiles never select the mislabeled Manaphy egg atlas',()=>{
  for(const move of ['solarbeam','hyperbeam']) {
    const p=effectProfile({id:move,type:'Normal'});assert.notEqual(p.travel,'fx-rt-light');assert.equal(catalog.profiles[move].travel,p.travel);
  }
  for(const p of Object.values(catalog.profiles))for(const field of ['prepare','travel','impact','area','contact'])assert.notEqual(p[field],'fx-rt-light',p.id);
  const old=globalThis.Image,seen=[];
  globalThis.Image=class {complete=true;naturalWidth=64;set src(v){seen.push(v);}};
  try {
    for(const reduced of [false,true])for(const stage of ['charge','travel','impact'])
      paintSpecialMove(context(),specialMoveRecipe('lightthatburnsthesky','Psychic',true),{x:100,y:100,scale:24,age:.2,progress:.5,stage,reduced});
    assert.ok(seen.length);assert.ok(!seen.includes(art.sprites['fx-rt-light'].image));
  } finally {globalThis.Image=old;}
});

test('body acting preserves sprite aspect ratio and uses a real roll instead of an inferred dodge',()=>{
  const b=new RtBattle(spec()),r=new FighterReactions(),w=b.sides[0];
  w.act={kind:'windup',left:2,total:12};const prepare=r.sample({...w,mons:b.sides[0].mons},0,1);assert.equal(prepare.sx,prepare.sy);
  r.onEvent({k:'miss',s:1},b,1);assert.equal(r.reactions[0],null);
  r.onEvent({k:'roll',s:0},b,1);assert.equal(r.reactions[0].kind,'dodge');
  r.onEvent({k:'use',s:1,move:'tackle',shape:'strike',category:'Physical'},b,2);
  r.onEvent({k:'hit',s:0,from:1,move:'tackle',dmg:25,maxhp:100,hp:75},b,2.1);
  const hurt=r.sample({...w,act:null,mons:b.sides[0].mons},0,2.16);assert.equal(hurt.sx,hurt.sy);
});
