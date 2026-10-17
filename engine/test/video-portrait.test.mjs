import test from 'node:test';
import assert from 'node:assert/strict';
import { videoFormat, videoPreviewPath } from '../../client/src/video-format.js';
import { portraitPoint, portraitFacing, worldInput, upright } from '../../client/src/battle/rt/portrait-camera.js';
import { ArenaRenderer } from '../../client/src/battle/rt/render.js';
import { dirRow } from '../../client/src/battle/rt/pmd.js';
import { RtBattle } from '../src/realtime/sim.mjs';
import { importTeam } from '../src/core.mjs';

test('export format retains horizontal defaults and offers both vertical resolutions', () => {
  assert.deepEqual(videoFormat(), {width: 1280, height: 720});
  assert.deepEqual(videoFormat('1080p', 'portrait'), {width: 1080, height: 1920});
  assert.deepEqual(videoFormat('720p', 'portrait'), {width: 720, height: 1280});
});

test('quarter-turn maps the lower player, eight facing directions and upright billboards consistently', () => {
  assert.deepEqual(portraitPoint(0, 100, 900), {x:100,y:900});
  assert.deepEqual(portraitPoint(900, 100, 900), {x:100,y:0});
  for (const [fx,fy] of [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]]) {
    const face = portraitFacing(fx,fy);
    assert.equal(dirRow(face.fx,face.fy), (dirRow(fx,fy)+2)%8);
  }
  const angles=[],ctx={save(){},restore(){},translate(){},rotate(a){angles.push(a);}};
  upright(ctx,10,20,true,()=>angles.push('sprite'));
  assert.deepEqual(angles,[Math.PI/2,'sprite']);
  const up={mx:0,my:-1,use:2,focus:true,dodge:false};
  assert.deepEqual(worldInput(up,true),{...up,mx:1,my:0});
  assert.equal(worldInput(up,false),up);
  assert.deepEqual(up,{mx:0,my:-1,use:2,focus:true,dodge:false},'input queues are never rewritten');
});

test('rendering and switching portrait preserves every simulator tick, seeded result and saved forfeit', () => {
  const previous = {window:globalThis.window,document:globalThis.document,Image:globalThis.Image};
  const context = () => new Proxy({measureText:text=>({width:String(text).length*6})}, {
    get:(o,k)=>o[k]??(()=>({addColorStop(){}})), set:(o,k,v)=>(o[k]=v,true)});
  const canvas = () => ({width:900,height:510,style:{},getContext:context});
  globalThis.window={devicePixelRatio:1,innerHeight:1920};
  globalThis.document={createElement:canvas};
  globalThis.Image=class {};
  try {
    const team=importTeam('Pikachu\n- Thunderbolt\n- Quick Attack');
    const spec={id:'same-presentation',seed:'same-presentation',version:11,format:'gen9customgame',time_limit:60,arena:'open',
      p1:{name:'A',sets:team},p2:{name:'B',sets:team}};
    const original=new RtBattle(spec), shown=new RtBattle(spec), view=shown.view();
    let portrait=false;
    const output={...canvas(),clientWidth:900,parentElement:{clientWidth:900},closest:selector=>selector==='.portrait-layout' ? (portrait?{}:null) : {clientHeight:1920}};
    const renderer=new ArenaRenderer(output,{sides:view.sides.map(s=>({mons:s.mons})),sprites:{fallback:()=>''},texts:{lang:'en'}});
    const snapshot=b=>JSON.stringify(b,(key,value)=>key==='dex'?undefined:value);
    const directions=[];
    renderer.anims=view.sides.map(()=>[{start(){},loop(){},busy(){return false;},update(){},height(){return 20;},draw(_ctx,_x,_y,row){directions.push(row);return true;}}]);
    for(let tick=0;tick<90;tick++) {
      const input={p1:{mx:1,my:0,slot:tick===20?0:-1},p2:{mx:-1,my:0,slot:tick===30?1:-1}};
      original.step(input);shown.step(input);
      portrait=tick>=30&&tick<70;
      const before=snapshot(shown);
      renderer.draw(shown,1/30);
      assert.equal(snapshot(shown),before,'camera must only read the live battle');
      assert.equal(snapshot(shown),snapshot(original),'same inputs must retain every simulation field');
      assert.equal(renderer.portrait,portrait);
      assert.equal(output.width<output.height,portrait);
    }
    original.forfeit('p1');shown.forfeit('p1');
    assert.deepEqual(shown.summary(),original.summary());
    assert.deepEqual(shown.events,original.events);
    assert.deepEqual(Array.from({length:8},()=>shown.rng()),Array.from({length:8},()=>original.rng()),'camera must not consume battle randomness');
    assert.ok(directions.includes(4),'the lower player faces up when the camera turns');
  } finally {Object.assign(globalThis,previous);}
});

test('preview keeps the selected language, speed, frame and exact played mass run', () => {
  const classic = videoPreviewPath('bt_example', {aspect: 'portrait', speed: 'fast', lang: 'es'});
  const cq = new URLSearchParams(classic.split('?')[1]);
  assert.equal(cq.get('aspect'), 'portrait');
  assert.equal(cq.get('speed'), '550');
  assert.equal(cq.get('lang'), 'es');
  const mass = videoPreviewPath('mass_example', {aspect: 'portrait', speed: 'slow', play_id: 'run_1 & next'});
  const mq = new URLSearchParams(mass.split('?')[1]);
  assert.equal(mq.get('mspeed'), '1');
  assert.equal(mq.get('play'), 'run_1 & next');
  assert.equal(mq.get('speed'), null);
});
