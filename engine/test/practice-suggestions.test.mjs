import test from 'node:test';
import assert from 'node:assert/strict';
import {Match} from '../src/match.mjs';
import {practiceSuggestions} from '../src/practice-suggestions.mjs';
import {freeze} from '../src/ai.mjs';

function source(turns=3, side='p1', attack=false) {
  const seats = {p1:{name:'A',sets:[{species:'Mew',moves:['Splash','Psychic']}]},
    p2:{name:'B',sets:[{species:'Magikarp',moves:['Splash','Tackle']}]}};
  if (side === 'p2') [seats.p1,seats.p2] = [seats.p2,seats.p1];
  const m = new Match({id:'suggest', seed:'suggest',format:'gen9customgame',...seats});
  for (const s of ['p1','p2']) m.choose(s,'team 1');
  for(let t=0;t<turns && !m.battle.ended;t++) for(const s of ['p1','p2']) m.choose(s,attack && s === side ? 'move 2 terastallize' : 'move 1');
  return m;
}

test('finds weak decisions, names the alternative, and leaves the source untouched',()=>{
  const m=source(), before=freeze(m.battle), input=JSON.stringify(m.inputLog());
  const r=practiceSuggestions(m.inputLog());
  assert.equal(r.analysed,3); assert.equal(r.skipped,0); assert.equal(r.suggestions.length,3);
  assert.equal(r.suggestions[0].slots[0].actual.name,'Splash');
  assert.equal(r.suggestions[0].slots[0].recommended.name,'Psychic');
  assert.equal(r.hidden,true); assert.ok(r.suggestions[0].heuristic_gap > .35);
  assert.equal(freeze(m.battle),before); assert.equal(JSON.stringify(m.inputLog()),input);
  assert.equal(practiceSuggestions(source(1,'p1',true).inputLog()).suggestions.length,0);
});

test('future choices and a pending opponent choice do not change the same position',()=>{
  const m=source(3,'p2'), input=m.inputLog();
  const first=practiceSuggestions(input,'p2',1,1).suggestions;
  assert.equal(first.length,1);
  const changed=input.slice();
  const own=changed.findIndex(l=>l.startsWith('>p2 move'));
  changed[own-1]='>p1 move tackle'; // opponent choice already pending when the p2 line is read
  // Only analyse turn 1: later recorded decisions may change, but cannot inform this recommendation.
  changed[own+1]='>p1 move tackle';
  assert.deepEqual(practiceSuggestions(changed,'p2',1,1).suggestions,first);
});

test('incremental pages cover all decisions with stable scores and allow explicit thresholds',()=>{
  const input=source(3).inputLog();
  const a=practiceSuggestions(input,'p1',1,1), b=practiceSuggestions(input,'p1',a.next_turn,1);
  const c=practiceSuggestions(input,'p1',b.next_turn,1);
  assert.equal(c.next_turn,null);
  const sort=x=>x.sort((a,b)=>a.turn-b.turn);
  assert.deepEqual(sort([...a.suggestions,...b.suggestions,...c.suggestions]),sort(practiceSuggestions(input).suggestions));
  assert.equal(practiceSuggestions(input,'p1',1,10,100).suggestions.length,0);
  assert.throws(()=>practiceSuggestions(input,'p3'),/Choose/);
  assert.throws(()=>practiceSuggestions(input,'p1',0),/Choose/);
  assert.throws(()=>practiceSuggestions(input,'p1',1,0),/Choose/);
  assert.throws(()=>practiceSuggestions(input,'p1',1,1,NaN),/Choose/);
});

test('unrevealed opposing moves never affect the first suggestion',()=>{
  const input=source(2).inputLog(), changed=input.map(l=>l.startsWith('>player p2 ') ? l.replace('Splash,Tackle','Splash,HydroPump') : l);
  assert.notDeepEqual(changed,input);
  assert.deepEqual(practiceSuggestions(changed,'p1',1,1).suggestions,practiceSuggestions(input,'p1',1,1).suggestions);
});

test('doubles compare both active slots with their recorded targets',()=>{
  const m = new Match({id:'double',seed:'suggest',format:'gen9doublescustomgame',
    p1:{name:'A',sets:[{species:'Mew',moves:['Splash','Psychic']},{species:'Pikachu',moves:['Splash','Thunderbolt']}]},
    p2:{name:'B',sets:[{species:'Magikarp',moves:['Splash']},{species:'Magikarp',moves:['Splash']}]}});
  for(const s of ['p1','p2'])m.choose(s,'team 12');
  for(const s of ['p1','p2'])m.choose(s,'move 1, move 1');
  const r=practiceSuggestions(m.inputLog());
  assert.equal(r.analysed,1);assert.equal(r.skipped,0);assert.equal(r.suggestions[0].slots.length,2);
  assert.ok(r.suggestions[0].slots.every(s=>s.recommended.target));
});
