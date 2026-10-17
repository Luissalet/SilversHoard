import test from 'node:test';
import assert from 'node:assert/strict';
import {withCombinations, combinationValues} from '../../client/src/battle/expert-combinations.js';

const pair = {turn: 1, side: 'p2', end_index: 10, actions: [{actor:'Mouse',move:'Thunderbolt'},{actor:'Fairy',move:'Helping Hand'}]};
test('a planned pair stays hidden until its resolved public boundary is applied',()=>{
  const log = [{i:7,kind:'move',text:'second move'}];
  assert.equal(withCombinations(log,[pair],8,()=> 'pair'),log);
  assert.equal(withCombinations(log,[pair],10,()=> 'pair'),log);
  assert.deepEqual(withCombinations(log,[pair],11,()=> 'pair'),[...log,{i:9.5,kind:'combo',text:'pair'}]);
});
test('seeking backwards removes later pairs and preserves source entries',()=>{
  const log=Object.freeze([Object.freeze({i:7,kind:'move',text:'move'}),Object.freeze({i:10,kind:'turn',text:'Turn 2'})]);
  const shown=withCombinations(log,[pair],11,()=> 'pair');
  assert.equal(shown[1].kind,'combo');assert.equal(shown[2],log[1]);
  assert.equal(withCombinations([log[0]],[pair],9,()=> 'pair').length,1);
  assert.deepEqual(log.map(x=>x.kind),['move','turn']);
});
test('duplicate backend annotations are displayed once and empty results change no log',()=>{
  const log=[];
  assert.equal(withCombinations(log,[],20,()=> 'pair'),log);
  assert.equal(withCombinations(log,[pair,pair],20,()=> 'pair').length,1);
});
test('nicknames remain literal while move names and trainer labels use the supplied locale',()=>{
  const values=combinationValues(pair,{p2:'Experta'},name=>({'Thunderbolt':'Rayo','Helping Hand':'Refuerzo'})[name]);
  assert.deepEqual(values,{n:1,side:'Experta',moves:'Mouse: Rayo + Fairy: Refuerzo'});
});
