import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalMoveFilter,classicSeekIndex,replayPosition,replaySearchHref} from '../../client/src/history-search.js';

test('turn links pause at the same turn boundary as the existing replay bar',()=>{
  const lines=['|player|p1|A','|switch|p1a: Bolt|Pikachu|100/100','|turn|1','|move|p1a: Bolt|Splash|p1a: Bolt','|turn|2','|move|p1a: Bolt|Thunderbolt|p2a: Fish'];
  const before=lines.slice();
  assert.equal(classicSeekIndex(lines,1),3);assert.equal(classicSeekIndex(lines,2),5);
  assert.equal(classicSeekIndex(lines,0),2);assert.equal(classicSeekIndex(lines,99),null);
  assert.deepEqual(lines,before);
});
test('malformed or unrelated URL positions cannot seek a replay',()=>{
  for(const value of ['', '-1','1.5','1x','Infinity','1000001']) assert.equal(replayPosition(new URLSearchParams({turn:value}),'classic'),null,value);
  assert.deepEqual(replayPosition(new URLSearchParams({turn:'2'}),'classic'),{turn:2});
  assert.deepEqual(replayPosition(new URLSearchParams({tick:'25'}),'realtime'),{tick:25});
  assert.equal(replayPosition(new URLSearchParams({turn:'2'}),'realtime'),null);
});
test('search links encode the battle id and choose the mode appropriate position',()=>{
  assert.equal(replaySearchHref('bt/1','classic',{turn:2}),'#/combate/bt%2F1?turn=2');
  assert.equal(replaySearchHref('bt_1','realtime',{tick:25}),'#/combate/bt_1?tick=25');
  assert.equal(replaySearchHref('bt_1','classic',{}),'#/combate/bt_1');
});
test('Spanish complete move names resolve to canonical IDs without modifying the submitted text',()=>{
  assert.equal(canonicalMoveFilter('Rayo'),'thunderbolt');
  assert.equal(canonicalMoveFilter('  Rayo Hielo  '),'icebeam');
  assert.equal(canonicalMoveFilter('Tóxico'),'toxic');
  assert.equal(canonicalMoveFilter('Thunderbolt'),'Thunderbolt');
  assert.equal(canonicalMoveFilter(''), '');
});
