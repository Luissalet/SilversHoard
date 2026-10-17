import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {samplePads, ControllerSession} from '../../client/src/controller-diagnostics.js';
import {makeT} from '../../client/src/i18n.js';
import {SeatInput} from '../../client/src/battle/rt/input.js';

const pad = (index=0) => ({index,connected:true,id:'Synthetic controller',mapping:'standard',axes:[.21349,-.82,0,0],buttons:[{pressed:true,touched:true,value:.75}]});
test('snapshots preserve analog buttons, stick readings and indexes without browser objects',()=>{
  const raw=pad(2);const out=samplePads([null,raw]);
  assert.equal(out[0].index,2);assert.deepEqual(out[0].axes,[.213,-.82,0,0]);
  assert.deepEqual(out[0].buttons,[{pressed:true,touched:true,value:.75}]);
  raw.axes[0]=0;assert.equal(out[0].axes[0],.213);
});
test('disconnected pads and malformed analog values cannot poison the JSON log',()=>{
  const raw=pad();raw.axes=[NaN,Infinity,-2,2];raw.buttons=[{value:NaN}, {value:2}];
  assert.deepEqual(samplePads([raw,{...pad(1),connected:false}])[0].axes,[0,0,-1,1]);
  assert.equal(samplePads([raw])[0].buttons[1].value,1);
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify(samplePads([raw]))));
});
test('only changed inputs are logged and a disconnect is a real sample',()=>{
  const s=new ControllerSession('realtime','za','2026-10-17T00:00:00Z');
  const raw=pad();s.observe(samplePads([raw]),10);s.observe(samplePads([raw]),20);
  raw.buttons[0].pressed=false;raw.buttons[0].value=0;s.observe(samplePads([raw]),30);s.observe([],40);
  assert.equal(s.entries.filter(e=>e.kind==='inputs').length,3);
  assert.deepEqual(s.entries.at(-1).pads,[]);
});
test('mode changes, stop and resume keep the same bounded exportable session',()=>{
  const s=new ControllerSession('realtime','za','2026-10-17T00:00:00Z');
  s.mode('maps','za',5);s.event('stop',{},6);s.event('start',{},7);
  const out=JSON.parse(JSON.stringify(s.export()));
  assert.equal(out.kind,'silver-controller-session');assert.equal(out.v,1);
  assert.equal(out.synthetic,false);assert.equal(out.entries[1].mode,'maps');
  assert.equal(out.entries[1].layout,'za');assert.equal(out.started_at,'2026-10-17T00:00:00Z');
});
test('the limit stops new entries and exported values cannot mutate the retained log',()=>{
  const s=new ControllerSession('mass','simple','now',3);s.event('one',{},1);s.event('two',{},2);s.event('three',{},3);
  assert.equal(s.entries.length,3);assert.equal(s.full,true);
  const out=s.export();out.entries.length=0;assert.equal(s.entries.length,3);
});
test('every guide label exists in both languages and campal does not promise ignored controls',()=>{
  const guide=JSON.parse(readFileSync(new URL('../../silvers_hoard/presets/controller_guide.json',import.meta.url),'utf8'));
  for (const lang of ['es','en']) {
    const t=makeT(lang);
    for(const mode of guide.modes) {
      assert.ok(t.has(`controller_mode_${mode.id}`));
      for(const [layout,rows] of Object.entries(mode.bindings)) {
        assert.ok(t.has(`controller_layout_${layout}`));
        for(const [,action] of rows) assert.ok(t.has(`controller_action_${action}`),action);
      }
    }
  }
  assert.deepEqual(guide.modes.find(m=>m.id==='mass').bindings.simple.map(row=>row[1]),['move_mass','moves_four','roll']);
});
test('the documented Z-A diamond and simple first move match the actual SeatInput handler',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const raw={...pad(),axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>[raw]}});
  try {
    raw.buttons[6].pressed=true;raw.buttons[3].pressed=true;
    const za=new SeatInput('solo',0,'za').take(new Set());assert.equal(za.use,0);assert.equal(za.focus,true);
    raw.buttons[6].pressed=false;raw.buttons[3].pressed=false;raw.buttons[0].pressed=true;
    assert.equal(new SeatInput('solo',0,'simple').take(new Set()).use,0);
  } finally {
    if(previous) Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;
  }
});
