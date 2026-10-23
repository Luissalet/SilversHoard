import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle,prepareRtTeam,fastForward} from '../src/realtime/sim.mjs';
import {packRtInputs,unpackRtInputs} from '../../client/src/play/rtcode.js';
import {packFrame,unpackFrame} from '../../client/src/battle/rt/netplay.js';
import {SpecialPresentation} from '../../client/src/battle/rt/special-presentation.js';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';

const mon=(species='Necrozma-Dusk-Mane',extra={})=>({species,item:'Ultranecrozium Z',moves:['Photon Geyser','Protect'],...extra});
const config=(extra={})=>({version:14,format:'gen9customgame',seed:'ultra1337',arena:'open',time_limit:90,
  p1:{sets:[mon(),{species:'Charizard',item:'Charizardite X',moves:['Flamethrower']}]},p2:{sets:[{species:'Blissey',moves:['Splash']}]},...extra});

test('only the two fused forms with their crystal can Ultra Burst, without requiring Photon Geyser',()=>{
  for(const species of ['Necrozma-Dusk-Mane','Necrozma-Dawn-Wings']) {
    const b=new RtBattle(config({p1:{sets:[mon(species,{moves:['Protect']})]}}));
    assert.equal(b.canUltra(b.sides[0]),true);
    assert.equal(b.sides[0].gauge,0);
    b.step({p1:{mega:true}});assert.equal(b.mon(b.sides[0]).species,'Necrozma-Ultra');
    assert.equal(b.zMoveFor(b.sides[0],0),null);
  }
  for(const set of [mon('Necrozma'),mon('Necrozma-Dusk-Mane',{item:'Leftovers'})]) {
    const b=new RtBattle(config({p1:{sets:[set]}}));assert.equal(b.canUltra(b.sides[0]),false);
  }
  const old=new RtBattle(config({version:13}));assert.equal(old.canUltra(old.sides[0]),false);
  const gen6=new RtBattle(config({format:'gen6customgame'}));assert.equal(gen6.canUltra(gen6.sides[0]),false);
});

test('new battles reject Ultra as an initial species; historical v13 replays keep it',()=>{
  const c=config({p1:{sets:[mon('Necrozma-Ultra')]}});
  assert.throws(()=>new RtBattle(c),/battle transformation/);
  assert.equal(new RtBattle({...c,version:13}).mon(new RtBattle({...c,version:13}).sides[0]).species,'Necrozma-Ultra');
});

test('Ultra Burst changes actual stats/types/ability and is independent of Z and Mega uses',()=>{
  const b=new RtBattle(config()),s=b.sides[0],m=b.mon(s),original=m.stats;
  assert.equal(b.zMoveFor(s,0),null);m.hp-=20;b.step({p1:{mega:true,zmove:true,use:0}});
  assert.equal(m.species,'Necrozma-Ultra');assert.deepEqual(m.types,['Psychic','Dragon']);assert.equal(m.ability,'neuroforce');
  assert.ok(m.stats.spe>original.spe);assert.equal(m.hp,m.maxhp-20);assert.equal(s.gauge<100,true);
  assert.equal(s.megaUsed,false);assert.equal(s.zUsed,false);assert.equal(s.ultraUsed,true);
  assert.equal(s.act,null);assert.equal(b.canUltra(s),false);assert.equal(b.zMoveFor(s,0),null);
  fastForward(b,[],31);assert.equal(b.zMoveFor(s,0).id,'lightthatburnsthesky');
  b.step({p1:{zmove:true,use:0}});assert.equal(s.zUsed,true);assert.equal(s.megaUsed,false);
  assert.equal(b.view().sides[0].mons[0].is_ultra,true);assert.equal(b.view().sides[0].mons[0].is_mega,false);
});

test('normal moves may accompany Ultra Burst; switching preserves it, fainting and battle end revert it',()=>{
  const b=new RtBattle(config()),s=b.sides[0],m=b.mon(s);b.step({p1:{mega:true,use:1}});
  assert.ok(b.events.some(e=>e.k==='windup' && e.move==='protect'));
  fastForward(b,[],90);b.step({p1:{sw:1}});fastForward(b,[],130);
  assert.equal(m.species,'Necrozma-Ultra');s.gauge=10800;assert.equal(b.canMega(s),true);
  b.step({p1:{mega:true}});assert.equal(s.megaUsed,true);assert.equal(m.species,'Necrozma-Ultra');
  b.forfeit('p2');assert.equal(m.species,'Necrozma-Dusk-Mane');assert.equal(m.ability,'prismarmor');
  const f=new RtBattle(config()),fs=f.sides[0];f.step({p1:{mega:true}});f.faint(fs,f.sides[1]);
  assert.equal(f.mon(fs).species,'Necrozma-Dusk-Mane');assert.equal(fs.ultraUsed,true);
});

test('doubles share one Ultra Burst, select the eligible slot, and retain independent Mega power',()=>{
  const b=new RtBattle(config({format:'gen9doublescustomgame',p1:{sets:[mon(),mon('Necrozma-Dawn-Wings')]},p2:{sets:[mon('Eevee',{item:''}),mon('Eevee',{item:''})]}}));
  b.step({p1:{ctl:1,mega:true}});const tr=b.sides[0];
  assert.equal(tr.mons[1].species,'Necrozma-Ultra');assert.equal(tr.mons[0].species,'Necrozma-Dusk-Mane');
  assert.equal(b.canUltra(tr.units[0]),false);assert.equal(tr.megaUsed,false);assert.equal(tr.zUsed,false);
  assert.equal(b.view().sides[0].ultra_used,true);
});

test('Ultra inputs replay through portable and online formats without adding a protocol column',async()=>{
  for(const format of ['gen9customgame','gen9doublescustomgame']) {
    const c=config({format}),b=new RtBattle(c);b.step({p1:{mega:true}});fastForward(b,[],35);b.step({p1:{zmove:true,use:0}});fastForward(b,[],100);
    const packed=await unpackRtInputs(await packRtInputs(b.inputLog));const copy=new RtBattle(c);fastForward(copy,packed,b.t);
    assert.deepEqual(copy.view(),b.view());assert.deepEqual(copy.events,b.events);
    assert.equal(b.inputLog[0].length,14);assert.equal(unpackFrame(packFrame({mega:true})).mega,true);
  }
});

test('cooldown API preparation advertises the available target form and initial Z eligibility',()=>{
  const [m]=prepareRtTeam([mon('Necrozma-Dawn-Wings',{shiny:true})]);
  assert.equal(m.species,'Necrozma-Dawn-Wings');assert.equal(m.ultra.species,'Necrozma-Ultra');assert.equal(m.shiny,true);
  assert.equal(m.z_moves[0],null);
});

test('Ultra presentation freezes on pause, keeps its scale, settles on seek and selects its exact PMD form',()=>{
  const b=new RtBattle(config()),p=new SpecialPresentation();b.step({p1:{mega:true}});
  p.onEvent(b.events.find(e=>e.k==='ultra'),b);p.update(.3,b.view());
  assert.equal(p.transforms.length,1);assert.equal(p.bodyScale(0,0,0,1,false),1);
  const age=p.transforms[0].age;p.update(0,b.view());assert.equal(p.transforms[0].age,age);
  assert.ok(p.bodyFlash(0,0,0,false)>0);assert.equal(p.bodyFlash(0,0,0,true),0);
  p.update(2,b.view());assert.equal(p.transforms.length,0);
  assert.equal(new SpecialPresentation().bodyScale(0,0,0,1,false),1);
  const r=Object.create(ArenaRenderer.prototype),base={},ultra={};r.anims=[[base]];r.ultraAnims=[[ultra]];
  assert.equal(r.animOf(0,0,false,false,true),ultra);assert.equal(r.animOf(0,0,false),base);
  r.ultraAnims=[[null]];assert.equal(r.animOf(0,0,false,false,true),null);
});
