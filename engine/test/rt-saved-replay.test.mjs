import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle, rtRun} from '../src/realtime/sim.mjs';
import {createReplay, stepReplay} from '../../client/src/battle/rt/replay.js';

const spec = (extra = {}) => ({id:'saved-replay',seed:'saved-replay',version:11,format:'gen9customgame',arena:'open',time_limit:30,
  p1:{name:'A',sets:[{species:'Snorlax',moves:['Splash']}]},
  p2:{name:'B',sets:[{species:'Blissey',moves:['Splash']}]}, ...extra});

function play(battle, replay) {
  for (let i=0;i<2000 && !battle.ended;i++) stepReplay(battle,replay);
  assert.equal(battle.ended,true);
}

for (const side of ['p1','p2']) for (const tick of [0,1,212]) {
  test(`screen replay applies ${side} forfeit at tick ${tick}, once`, () => {
    const setup=spec(), expected=rtRun(setup,{inputs:[],forfeit:side,tick});
    const battle=new RtBattle(setup), replay=createReplay(battle,{inputs:[],forfeit:side,tick});
    play(battle,replay);
    assert.equal(battle.t,tick);
    assert.deepEqual(battle.summary(),expected.summary());
    assert.deepEqual(battle.events,expected.events);
    const frozen=JSON.stringify(battle.view());
    for(let i=0;i<20;i++) stepReplay(battle,replay);
    assert.equal(JSON.stringify(battle.view()),frozen);
  });
}

test('seek before, at and beyond a saved forfeit, and restart, share the same terminal state', () => {
  const setup=spec(), record={inputs:[],forfeit:'p1',tick:212}, expected=rtRun(setup,record);
  for(const seek of [0,211,212,999]) {
    const battle=new RtBattle(setup), replay=createReplay(battle,record,seek);
    assert.equal(battle.t,Math.min(seek,212));
    assert.equal(battle.ended,seek>=212);
    play(battle,replay);
    assert.deepEqual(battle.events,expected.events);
  }
});

for(const version of [1,10,11]) test(`legacy rules ${version} retain their own replay semantics`, () => {
  const setup=spec({version}), record={inputs:[],forfeit:'p2',tick:212}, expected=rtRun(setup,record);
  const battle=new RtBattle(setup), replay=createReplay(battle,record);
  play(battle,replay);
  assert.deepEqual(battle.summary(),expected.summary());
  assert.deepEqual(battle.events,expected.events);
});

test('old records without a forfeit play through to their natural end', () => {
  const setup=spec(), expected=rtRun(setup), battle=new RtBattle(setup);
  const replay=createReplay(battle,{inputs:[],tick:expected.t});
  play(battle,replay);
  assert.deepEqual(battle.summary(),expected.summary());
  assert.deepEqual(battle.events,expected.events);
});

test('recorded human movement and held input are preserved across seek and incremental replay', () => {
  const setup=spec(), record={inputs:[[1,0,1,0,-1,0,-1,0],[100,0,0,1,-1,0,-1,0],[180,0,0,0,-1,0,-1,0]],forfeit:'p1',tick:212};
  const expected=rtRun(setup,record);
  for(const seek of [0,150]) {
    const battle=new RtBattle(setup), replay=createReplay(battle,record,seek);
    play(battle,replay);
    assert.deepEqual(battle.view(),expected.view());
    assert.deepEqual(battle.events,expected.events);
  }
});
