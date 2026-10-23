import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle, fastForward} from '../src/realtime/sim.mjs';
import {TPS,rtMove} from '../src/realtime/moves.mjs';
import {flatRtInputs,packRtInputs,unpackRtInputs} from '../../client/src/play/rtcode.js';
import {packFrame,unpackFrame} from '../../client/src/battle/rt/netplay.js';
import {SeatInput} from '../../client/src/battle/rt/input.js';

const spec = (a={}, extra={}) => ({version:13,format:'gen9customgame',arena:'open',seed:'mechanics-1317',time_limit:90,
  p1:{sets:[{species:'Pikachu',moves:['Thunderbolt','Protect'],...a},{species:'Eevee',moves:['Tackle']}]},
  p2:{sets:[{species:'Blissey',moves:['Tackle','Protect']}]},...extra});
const close = b => {b.sides[0].x=10;b.sides[0].y=10;b.sides[1].x=13;b.sides[1].y=10;};

test('Dynamax doubles current/max HP, exposes Max profiles and a uniform display scale, then expires once',()=>{
  const b=new RtBattle(spec()),s=b.sides[0],m=b.mon(s),hp=m.maxhp;
  m.hp-=21;
  b.step({p1:{dynamax:true}});
  assert.equal(m.maxhp,hp*2);assert.equal(m.hp,(hp-21)*2);
  assert.equal(b.view().sides[0].mons[0].display_scale,2.2);
  assert.equal(m.profiles[0].id,'maxlightning');assert.equal(m.profiles[0].power,130);
  assert.equal(m.profiles[1].id,'maxguard');
  fastForward(b,[],b.t+18*TPS);
  assert.equal(m.maxhp,hp);assert.equal(m.hp,hp-21);assert.equal(m.profiles[0].id,'thunderbolt');
  assert.equal(b.view().sides[0].mons[0].display_scale,1);assert.equal(b.canDynamax(s),false);
});

test('Gigantamax preloads its exact look and replaces only moves matching its signature type',()=>{
  const b=new RtBattle(spec({gigantamax:true,moves:['Thunderbolt','Surf','Protect']})),s=b.sides[0];
  b.dynamaxStart(s);
  assert.equal(b.mon(s).species,'Pikachu-Gmax');
  assert.deepEqual(b.mon(s).profiles.map(p=>p.id),['gmaxvoltcrash','maxgeyser','maxguard']);
  b.maxEffect(s,b.sides[1],b.mon(s).profiles[0]);assert.equal(b.mon(b.sides[1]).status,'par');
  b.startSwitch(s,1);assert.equal(b.mon(s).species,'Pikachu');assert.equal(b.mon(s).maxhp,b.mon(s).stats.hp);
});

test('eligibility respects generation, forbidden species, Mega Stones, Z crystals and Shedinja HP',()=>{
  for(const a of [{species:'Zacian'},{species:'Eternatus'},{species:'Charizard',item:'Charizardite X'},{item:'Electrium Z'}]) {
    const b=new RtBattle(spec(a));assert.equal(b.canDynamax(b.sides[0]),false);
  }
  const old=new RtBattle(spec({}, {format:'gen7customgame'}));assert.equal(old.canDynamax(old.sides[0]),false);
  const shed=new RtBattle(spec({species:'Shedinja'}));shed.dynamaxStart(shed.sides[0]);assert.equal(shed.mon(shed.sides[0]).maxhp,1);
});

test('generic Z uses crystal data and base move power, consumes once at windup, and keeps projectile power',()=>{
  const b=new RtBattle(spec({item:'Electrium Z'})),s=b.sides[0];close(b);
  const p=b.zMoveFor(s,0);assert.equal(p.id,'gigavolthavoc');assert.equal(p.power,175);assert.equal(p.category,'Special');
  assert.equal(b.zMoveFor(s,1),null);
  b.step({p1:{use:0,zmove:true}});assert.equal(s.zUsed,true);assert.equal(s.act.profile.power,175);
  fastForward(b,[],b.t+3*TPS);
  assert.ok(b.events.some(e=>e.k==='use'&&e.move==='gigavolthavoc'));
  assert.ok(b.events.some(e=>e.k==='hit'&&e.dmg>0));assert.equal(b.zMoveFor(s,0),null);
  assert.equal(b.mon(s).profiles[0].id,'thunderbolt');
});

test('Z status bonus and signature species restrictions use canonical data',()=>{
  const b=new RtBattle(spec({item:'Normalium Z',moves:['Splash']})),s=b.sides[0];
  b.step({p1:{use:0,zmove:true}});assert.equal(s.zUsed,true);assert.equal(b.mon(s).boosts.atk,1);
  const eevee=new RtBattle(spec({species:'Eevee',item:'Eevium Z',moves:['Last Resort']}));
  assert.equal(eevee.zMoveFor(eevee.sides[0],0).id,'extremeevoboost');
  const fake=new RtBattle(spec({species:'Pikachu',item:'Eevium Z',moves:['Last Resort']}));assert.equal(fake.zMoveFor(fake.sides[0],0),null);
});

test('Max moves set field/ally effects and pierce Protect but not Max Guard',()=>{
  const b=new RtBattle(spec()),a=b.sides[0],d=b.sides[1];b.dynamaxStart(a);
  const p=b.mon(a).profiles[0];d.vol.protectUntil=100;d.vol.protectKind='maxguard';
  const hp=b.mon(d).hp;b.resolveHit(a,d,p);assert.equal(b.mon(d).hp,hp);
  d.vol.protectKind='protect';b.resolveHit(a,d,p);assert.ok(b.mon(d).hp<hp);assert.equal(b.terrain.id,'electricterrain');
  b.maxEffect(a,d,{id:'maxairstream'});assert.equal(b.mon(a).boosts.spe,1);
  b.maxEffect(a,d,{id:'maxwyrmwind'});assert.equal(b.mon(d).boosts.atk,-1);
});

test('Dynamax ends on knockout and cannot be forced out or flinched',()=>{
  const b=new RtBattle(spec()),s=b.sides[0];b.dynamaxStart(s);
  s.act={kind:'windup',slot:0,end:100,profile:b.mon(s).profiles[0]};b.flinch(s);assert.ok(s.act);
  b.forceOut(s);assert.notEqual(s.act.kind,'switch');
  b.faint(s,b.sides[1]);assert.equal(b.mon(s).hp,0);assert.equal(b.mon(s).maxhp,b.mon(s).stats.hp);assert.equal(b.mon(s).dynamaxUntil,undefined);
});

test('new single and double input logs replay Dynamax and Z exactly; historical rows stay unchanged',async()=>{
  for(const format of ['gen9customgame','gen9doublescustomgame']) {
    for(const a of [{gigantamax:true},{item:'Electrium Z'}]) {
      const config=spec(a,{format}),b=new RtBattle(config);
      b.step({p1:{dynamax:!a.item,use:a.item?0:-1,zmove:!!a.item}});
      fastForward(b,[],120);
      const copy=new RtBattle(config);fastForward(copy,b.inputLog,b.t);
      assert.deepEqual(copy.view(),b.view());assert.deepEqual(copy.events,b.events);
      assert.equal(b.inputLog[0].length,14);assert.equal(flatRtInputs(b.inputLog)[0],-13);
      assert.deepEqual(await unpackRtInputs(await packRtInputs(b.inputLog)),b.inputLog.filter(r=>r[1]===0));
    }
  }
  const b=new RtBattle(spec({}, {version:12}));b.step({p1:{dynamax:true,use:0,zmove:true}});
  assert.equal(b.inputLog[0].length,10);assert.equal(b.view().sides[0].dynamax_used,undefined);
  assert.equal(b.events.some(e=>['dynamax','zmove'].includes(e.k)),false);
});

test('keyboard controls and netplay preserve both mechanics without changing legacy frames',()=>{
  const i=new SeatInput('solo');i.mechanics=true;i.key('KeyB',true,new Set());i.key('KeyZ',true,new Set());i.key('Digit1',true,new Set());
  const q=i.take(new Set());assert.equal(q.dynamax,true);assert.equal(q.zmove,true);
  assert.deepEqual(unpackFrame(packFrame(q)),q);
  assert.equal(packFrame({use:-1}).length,10);
  assert.equal(i.take(new Set()).dynamax,false);
});

test('G-Max gravity grounds fliers, and ability-ignoring signatures bypass unbreakable defensive abilities',()=>{
  const b=new RtBattle(spec({species:'Charizard',moves:['Fly']})),a=b.sides[0],d=b.sides[1];
  assert.equal(b.grounded(a),false);b.maxEffect(d,a,{id:'gmaxgravitas'});assert.equal(b.grounded(a),true);
  assert.equal(b.usable(a,0),'gravity');
  b.mon(d).ability='prismarmor';assert.equal(b.defenderAbility(a,d,{ignoreAbility:true}),'');
  assert.equal(b.defenderAbility(a,d,{}),'prismarmor');
});

test('a released Max projectile retains its foe/field effect after its caster switches',()=>{
  const b=new RtBattle(spec()),a=b.sides[0],d=b.sides[1];b.dynamaxStart(a);
  const source=b.mon(a),p=source.profiles[0];b.sendOut(a,1);
  b.resolveHit(a,d,p,{mon:0});assert.equal(b.terrain.id,'electricterrain');
  assert.equal(b.view().sides[0].mons[0].display_scale,1);
});
