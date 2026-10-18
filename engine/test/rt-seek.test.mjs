import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle, rtRun} from '../src/realtime/sim.mjs';
import {createReplay, stepReplay, inspectReplay, replayEndTick} from '../src/realtime/replay.mjs';
import {handle} from '../src/server.mjs';

const spec = {id:'seek-test',seed:'seek-test',version:11,format:'gen9customgame',arena:'open',time_limit:30,
  p1:{name:'A',human:true,sets:[{species:'Snorlax',moves:['Splash']},{species:'Mew',moves:['Splash']}]},
  p2:{name:'B',sets:[{species:'Blissey',moves:['Splash']}]}};
const record = {inputs:[[1,0,1,0,-1,0,-1,0],[75,0,0,0,-1,0,1,0]],forfeit:'p1',tick:212};

test('inspection equals incremental playback before and after movement, switch and terminal event', () => {
  const original=JSON.stringify({spec,record});
  const battle=new RtBattle(spec), replay=createReplay(battle,record);
  for(let tick=0;tick<=212;tick++) {
    if([0,1,74,75,76,180,211,212].includes(tick)) {
      const frame=inspectReplay(spec,record,tick);
      assert.equal(frame.tick,tick);
      assert.deepEqual(frame.view,battle.view());
      assert.equal(frame.end_tick,212);
    }
    stepReplay(battle,replay);
  }
  assert.equal(JSON.stringify({spec,record}),original);
  assert.deepEqual(inspectReplay(spec,record,999).view,battle.view());
  assert.equal(inspectReplay(spec,record,-5).tick,0);
});

test('tick-zero forfeit and legacy duration have exact bounds', () => {
  const zero=inspectReplay(spec,{inputs:[],forfeit:'p2',tick:0},999,30);
  assert.equal(zero.tick,0);
  assert.equal(zero.end_tick,0);
  assert.equal(zero.view.ended,true);
  assert.equal(replayEndTick({tick:0},7.1),213);
  const natural=rtRun(spec);
  const frame=inspectReplay(spec,{inputs:[],tick:natural.t},natural.t+100);
  assert.deepEqual(frame.view,natural.view());
  assert.equal(frame.view.ended,true);
});

test('native engine inspection uses the same public replay snapshot', async () => {
  const response=await handle({id:7,cmd:'rt_inspect',args:{spec,record,tick:180}});
  assert.equal(response.ok,true);
  assert.deepEqual(response.result,inspectReplay(spec,record,180));
});
