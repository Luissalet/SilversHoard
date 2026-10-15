import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../src/match.mjs';
import {RtBattle, rtRun} from '../src/realtime/sim.mjs';
import {rtMove} from '../src/realtime/moves.mjs';
import {protocolAbilities, protocolAbility, realtimeAbilities} from '../src/ability-events.mjs';

const seat = (species,ability,moves=['Splash']) => ({name:species,sets:[{species,ability,moves}]});
function rt(a,b,version=6) {return new RtBattle({seed:'abilities',version,format:'gen9customgame',p1:a,p2:b});}
function classic(a,b) {
  const m = new Match({id:'abilities',seed:'abilities',format:'gen9customgame',p1:a,p2:b});
  for(const side of ['p1','p2'])m.choose(side,'team 1');
  return m;
}
const abilities = b => realtimeAbilities(b).map(e=>e.ability);

test('classic: entry Intimidate, damage immunity, bypass, absorption and contact use actual simulator effects',()=>{
  const intimidate=classic(seat('Gyarados','Intimidate'),seat('Mew','Synchronize'));
  assert.equal(intimidate.battle.p2.active[0].boosts.atk,-1);
  assert.ok(protocolAbilities(intimidate.battle.log).some(e=>e.ability === 'Intimidate' && e.pokemon === 'Gyarados'));
  for(const ab of ['Rivalry','Mold Breaker']) {
    const m=classic(seat('Haxorus',ab,['Earthquake']),seat('Rotom','Levitate'));
    const hp=m.battle.p2.active[0].hp;
    m.choose('p1','move 1');m.choose('p2','move 1');
    assert.equal(m.battle.p2.active[0].hp === hp,ab === 'Rivalry');
    if(ab === 'Rivalry') assert.ok(protocolAbilities(m.battle.log).some(e=>e.ability === 'Levitate'));
  }
  const absorb=classic(seat('Mew','Synchronize',['Surf']),seat('Vaporeon','Water Absorb'));
  const vap=absorb.battle.p2.active[0];vap.hp=Math.floor(vap.maxhp/2);
  const hp=vap.hp;absorb.choose('p1','move 1');absorb.choose('p2','move 1');
  assert.ok(vap.hp > hp);assert.ok(protocolAbilities(absorb.battle.log).some(e=>e.ability === 'Water Absorb'));
  const contact=classic(seat('Mew','Synchronize',['Tackle']),seat('Garchomp','Rough Skin'));
  const me=contact.battle.p1.active[0], before=me.hp;
  contact.choose('p1','move 1');contact.choose('p2','move 1');
  assert.ok(me.hp < before);assert.ok(protocolAbilities(contact.battle.log).some(e=>e.ability === 'Rough Skin' && e.pokemon === 'Garchomp'));
});

test('real time: Mold Breaker bypasses Levitate, Sturdy and breakable damage modifiers, retaining v5 and exceptions',()=>{
  for(const version of [5,6]) {
    const b=rt(seat('Haxorus','Mold Breaker',['Earthquake']),seat('Rotom','Levitate'),version);
    const [a,d]=b.sides, hp=b.mon(d).hp;
    b.resolveHit(a,d,rtMove('Earthquake'));
    assert.equal(b.mon(d).hp < hp,version === 6);
    assert.ok(!abilities(b).includes('Levitate'));
  }
  for(const ability of ['Multiscale','Shadow Shield','Prism Armor','Fur Coat']) {
    const damage = ab => {const b=rt(seat('Haxorus',ab),seat('Mew',ability));return b.damage(b.sides[0],b.sides[1],rtMove('Ice Punch'),{expected:true}).dmg;};
    if(['Shadow Shield','Prism Armor'].includes(ability)) assert.equal(damage('Mold Breaker'),damage('Rivalry'));
    else assert.ok(damage('Mold Breaker') > damage('Rivalry'));
  }
  for(const ab of ['Rivalry','Mold Breaker']) {
    const b=rt(seat('Haxorus',ab,['Seismic Toss']),seat('Geodude','Sturdy'));
    const d=b.sides[1];b.mon(d).maxhp=50;b.mon(d).hp=50;
    b.resolveHit(b.sides[0],d,rtMove('Seismic Toss'));
    assert.equal(b.mon(d).hp,ab === 'Rivalry' ? 1 : 0);
    assert.equal(abilities(b).includes('Sturdy'),ab === 'Rivalry');
  }
});

test('real time: weather, Intimidate, absorb, contact and status immunities emit genuine named activations',()=>{
  const rain=rt(seat('Pelipper','Drizzle'),seat('Mew','Synchronize'));
  assert.equal(rain.weather.id,'raindance');assert.ok(abilities(rain).includes('Drizzle'));
  const intimidate=rt(seat('Gyarados','Intimidate'),seat('Mew','Synchronize'));
  assert.equal(intimidate.mon(intimidate.sides[1]).boosts.atk,-1);assert.ok(abilities(intimidate).includes('Intimidate'));
  const b=rt(seat('Mew','Synchronize'),seat('Vaporeon','Water Absorb'));
  const [a,d]=b.sides;b.mon(d).hp=Math.floor(b.mon(d).maxhp/2);const before=b.mon(d).hp;
  b.resolveHit(a,d,rtMove('Surf'));assert.ok(b.mon(d).hp > before);assert.ok(abilities(b).includes('Water Absorb'));
  const contact=rt(seat('Mew','Synchronize'),seat('Garchomp','Rough Skin'));
  const hp=contact.mon(contact.sides[0]).hp;
  contact.resolveHit(...contact.sides,rtMove('Tackle'));assert.ok(contact.mon(contact.sides[0]).hp < hp);
  assert.ok(realtimeAbilities(contact).some(e=>e.ability === 'Rough Skin' && e.pokemon === 'Garchomp'));
  for(const ab of ['Rivalry','Mold Breaker']) {
    const b=rt(seat('Haxorus',ab),seat('Snorlax','Immunity'));
    assert.equal(b.setStatus(b.sides[1],'psn',b.sides[0]),ab === 'Mold Breaker');
    assert.equal(abilities(b).includes('Immunity'),ab === 'Rivalry');
  }
  const volt=rt(seat('Mew','Synchronize'),seat('Jolteon','Volt Absorb'));
  const jolteon=volt.mon(volt.sides[1]);jolteon.hp=Math.floor(jolteon.maxhp/2);const voltHp=jolteon.hp;
  volt.statusMove(...volt.sides,rtMove('Thunder Wave'));
  assert.equal(jolteon.status,'');assert.ok(jolteon.hp > voltHp);assert.ok(abilities(volt).includes('Volt Absorb'));
  const cure=rt(seat('Chansey','Natural Cure'),seat('Mew','Synchronize'));
  cure.mon(cure.sides[0]).status='psn';cure.onSwitchOut(cure.sides[0]);
  assert.equal(cure.mon(cure.sides[0]).status,'');assert.ok(abilities(cure).includes('Natural Cure'));
});

test('real time: no false Mist ability; two Magic Bounce users reflect only once; deterministic legacy and current rules',()=>{
  const b=rt(seat('Mew','Synchronize'),seat('Mew','Synchronize'));
  b.sides[1].cond.mist=300;b.boost(b.sides[1],{atk:-1},b.sides[0],'growl');
  assert.equal(b.mon(b.sides[1]).boosts.atk,0);assert.deepEqual(abilities(b),[]);
  const bounce=rt(seat('Espeon','Magic Bounce'),seat('Espeon','Magic Bounce'));
  bounce.statusMove(...bounce.sides,rtMove('Thunder Wave'));
  assert.equal(bounce.mon(bounce.sides[0]).status,'par');assert.equal(bounce.mon(bounce.sides[1]).status,'');
  assert.equal(abilities(bounce).filter(a=>a === 'Magic Bounce').length,1);
  for(const version of [1,2,3,4,5,6]) {
    const spec={seed:'ability-replay',version,time_limit:20,format:'gen9customgame',
      p1:{...seat('Gyarados','Intimidate',['Waterfall']),ai:{level:'normal'}},
      p2:{...seat('Garchomp','Rough Skin',['Dragon Claw']),ai:{level:'normal'}}};
    const one=rtRun(spec),two=rtRun(spec);
    assert.deepEqual(one.summary(),two.summary());assert.deepEqual(one.events,two.events);
  }
});

test('protocol: source attribution, deduplication and negative cases preserve public information',()=>{
  const lines=['|switch|p1a: Vaporeon|Vaporeon|100/100',
    '|-ability|p1a: Vaporeon|Water Absorb',
    '|-heal|p1a: Vaporeon|100/100|[from] ability: Water Absorb',
    '|move|p2a: Mew|Surf|p1a: Vaporeon',
    '|-heal|p1a: Vaporeon|100/100|[from] ability: Water Absorb',
    '|-damage|p2a: Mew|90/100|[from] ability: Rough Skin|[of] p1a: Garchomp'];
  const events=protocolAbilities(lines);
  assert.equal(events.length,3);assert.equal(events[2].pokemon,'Garchomp');
  for(const line of ['|-endability|p1a: Mew|Synchronize','|-ability|p1a: Mew|Synchronize|[silent]',
    '|-ability|p1a: Mew|Levitate|[from] move: Skill Swap','|-damage|p1a: Mew|90/100|[from] item: Life Orb',
    '|-activate|p1a: Mew|move: Mist']) assert.equal(protocolAbility(line),null);
  assert.equal(protocolAbility('|-activate|p1a: Rotom|ability: Levitate').ability,'Levitate');
});
