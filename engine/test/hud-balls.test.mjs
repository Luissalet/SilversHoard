import test from 'node:test';
import assert from 'node:assert/strict';
import {Match,viewLines} from '../src/match.mjs';
import {replayCheck} from '../src/replay.mjs';
import {RtBattle} from '../src/realtime/sim.mjs';
import {applyLine,newState} from '../../client/src/battle/protocol.js';
import BALLS from '../../client/src/battle/ball-icons.gen.js';

const spec={seed:'hud-balls',format:'gen9customgame',p1:{name:'A',sets:[{species:'Pikachu',moves:['Tackle'],pokeball:'Luxury Ball'}]},
  p2:{name:'B',sets:[{species:'Eevee',moves:['Tackle'],pokeball:'Moon Ball'}]}};
test('assigned balls survive real-time preparation/view and classic public replay without private team data',()=>{
  const rt=new RtBattle(spec);
  assert.equal(rt.view().sides[0].mons[0].pokeball,'luxuryball');
  assert.equal(rt.view().sides[1].mons[0].pokeball,'moonball');
  const match=new Match(spec),before=match.battle.log.slice();
  match.choose('p1','team 1');match.choose('p2','team 1');
  const state=newState();
  for(const line of match.state('p1').lines) applyLine(state,line);
  assert.equal(state.sides.p1.team[state.sides.p1.active[0]].pokeball,'luxuryball');
  assert.equal(state.sides.p2.team[state.sides.p2.active[0]].pokeball,'moonball');
  assert.ok(match.battle.log.every(line=>!line.includes('[pokeball]'))); // decoration never mutates simulator log
  assert.ok(before.every((line,i)=>match.battle.log[i]===line));
  assert.equal(Object.keys(BALLS).length,28);
  assert.ok(Object.values(BALLS).every(src=>src.startsWith('data:image/png;base64,')));
});

test('a nickname remains the active combatant when moves, damage and faint lines arrive',()=>{
  const named={...spec,p1:{...spec.p1,sets:[{...spec.p1.sets[0],name:'Sparky'}]},p2:{...spec.p2,sets:[{...spec.p2.sets[0],name:'Fluffy'}]}};
  const match=new Match(named);match.choose('p1','team 1');match.choose('p2','team 1');
  match.choose('p1','move 1');match.choose('p2','move 1');
  const state=newState(); for(const line of match.state('p1').lines) applyLine(state,line);
  for(const [id,name] of [['p1','Sparky'],['p2','Fluffy']]) {
    const side=state.sides[id],active=side.team[side.active[0]];
    assert.equal(active.name,name);assert.equal(side.team.length,1);
    assert.ok(active.hp<active.maxhp);
  }
  applyLine(state,'|faint|p1a: Sparky');
  assert.equal(state.sides.p1.team[state.sides.p1.active[0]].fainted,true);
  assert.equal(state.sides.p1.team.length,1);
});

test('public ball decoration cannot distinguish an Illusion from the same visible appearance',()=>{
  const base={format:'gen9ou',seed:'illusion-hud-review',p1:{sets:[
    {species:'Zoroark',name:'Shade',ability:'Illusion',gender:'M',moves:['Splash']},
    {species:'Pikachu',name:'Bolt',gender:'M',moves:['Splash']},
    {species:'Eevee',name:'Eon',gender:'M',moves:['Splash']}]},p2:{sets:[{species:'Blissey',moves:['Splash']}]}};
  const m=new Match(base);m.choose('p1','team 312');m.choose('p2','team 1');
  m.choose('p1','switch 3');m.choose('p2','move 1');
  const snapshot=m.snapshot();
  const a=new Match(base,JSON.parse(JSON.stringify(snapshot))),b=new Match(base,JSON.parse(JSON.stringify(snapshot)));
  a.choose('p1','switch 3');a.choose('p2','move 1');b.choose('p1','switch 2');b.choose('p2','move 1');
  assert.equal(a.battle.sides[0].active[0].species.name,'Eevee');
  assert.equal(b.battle.sides[0].active[0].species.name,'Zoroark');
  assert.equal(b.battle.sides[0].active[0].illusion?.species.name,'Eevee');
  for(const view of ['p2','spectator']) {
    const last=match=>match.state(view).lines.filter(l=>l.startsWith('|switch|p1')).at(-1);
    assert.equal(last(a),last(b));
    assert.ok(!last(b).includes('Shade')&&!last(b).includes('Zoroark'));
  }
});

test('publicly observed temporary forms rejoin their previous party entry without merging unrelated regional forms',()=>{
  const spec={format:'gen9customgame',seed:'public-forme-review',p1:{sets:[
    {name:'Sword',species:'Aegislash',ability:'Stance Change',moves:['Shadow Claw','Splash'],pokeball:'Luxury Ball'},
    {species:'Pikachu',moves:['Splash']}]},p2:{sets:[{species:'Mew',moves:['Splash']}]}};
  const m=new Match(spec);m.choose('p1','team 12');m.choose('p2','team 1');
  for(const choice of ['move 1','switch 2','switch 2']) { m.choose('p1',choice);m.choose('p2','move 1'); }
  const state=newState();for(const line of m.state('p1').lines) applyLine(state,line);
  assert.equal(state.sides.p1.team.length,2);
  const active=state.sides.p1.team[state.sides.p1.active[0]];
  assert.equal(active.name,'Sword');assert.equal(active.species,'Aegislash');assert.equal(active.pokeball,'luxuryball');
  assert.ok(active.revealedForms.includes('Aegislash-Blade'));
  const regional=newState();
  for(const line of ['|switch|p1a: Rat|Rattata-Alola, M|100/100|[pokeball]pokeball',
    '|switch|p1a: Other|Pikachu, M|100/100|[pokeball]pokeball',
    '|switch|p1a: Rat|Rattata, M|100/100|[pokeball]pokeball']) applyLine(regional,line);
  assert.equal(regional.sides.p1.team.length,3);
});

test('duplicate nicknames and species retain their public appearances, damage and balls through snapshot and saved replay',()=>{
  const twins={...spec,format:'gen9doublescustomgame',p1:{name:'A',sets:[
    {name:'Twin',species:'Pikachu',moves:['Tackle'],pokeball:'Luxury Ball'},
    {name:'Twin',species:'Pikachu',moves:['Tackle'],pokeball:'Moon Ball'}]},p2:{...spec.p2,sets:[...spec.p2.sets,{species:'Mew',moves:['Tackle']} ]}};
  const match=new Match(twins);
  match.choose('p1','team 12');match.choose('p2','team 12');
  const check=lines=>{
    const state=newState(); for(const line of lines) applyLine(state,line);
    const side=state.sides.p1;
    assert.notEqual(side.active[0],side.active[1]);
    assert.deepEqual(side.active.slice(0,2).map(i=>side.team[i].pokeball),['luxuryball','moonball']);
    assert.deepEqual(side.active.slice(0,2).map(i=>side.team[i].name),['Twin','Twin']);
    const before=side.team.length,hp=side.team[side.active[0]].hp;
    applyLine(state,'|-damage|p1b: Twin|17/211');
    assert.equal(side.team[side.active[1]].hp,17);
    assert.equal(side.team[side.active[0]].hp,hp);
    assert.equal(side.team.length,before);
    assert.ok(lines.every(l=>!l.includes('[silverid]')));
  };
  check(match.state('p1').lines);check(match.state('spectator').lines);
  const restored=new Match(twins,match.snapshot());check(restored.state('p1').lines);
  const saved=viewLines(match.battle.log,0,'omniscient',match.battle);check(saved);
  const result=replayCheck({input:match.inputLog(),format:twins.format,p1_sets:twins.p1.sets,p2_sets:twins.p2.sets,forfeit:'p1'});
  assert.equal(result.ok,true);check(result.lines);
  assert.ok(match.battle.log.every(l=>!l.includes('[silverid]')&&!l.includes('[pokeball]')));
});
