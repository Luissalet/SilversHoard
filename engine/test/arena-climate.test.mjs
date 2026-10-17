import test from 'node:test';
import assert from 'node:assert/strict';
import {importTeam} from '../src/core.mjs';
import {RtBattle, rtRun} from '../src/realtime/sim.mjs';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';

const sets = importTeam('Glaceon\nAbility: Ice Body\n- Water Pulse\n- Ice Beam\n- Tackle\n- Sunny Day');
const spec = (weather = '', rules = false, extra = {}) => ({id:'arena-climate', seed:'arena-climate',
  format:'gen9customgame', version:12, time_limit:30,
  arena:{floor:'grass', rocks:[], weather, weather_rules:rules},
  p1:{name:'A',sets}, p2:{name:'B',sets}, ...extra});

test('each decorative climate is public without enabling combat weather or consuming RNG', () => {
  for (const weather of ['sunnyday','raindance','snow','fog']) {
    const b = new RtBattle(spec(weather));
    assert.equal(b.view().arena_weather,weather);
    assert.equal(b.weather,null); assert.equal(b.fog,null);
    for (let i=0;i<120;i++) b.step({});
    // A fresh baseline is necessary for each climate's identical tick count.
    const baseline = new RtBattle(spec());
    for (let i=0;i<120;i++) baseline.step({});
    assert.deepEqual(b.events,baseline.events);
    assert.equal(b.rng(),baseline.rng());
  }
});

test('arena rules apply existing water damage, snow defence and fog, while decorative choices do not', () => {
  const damage = b => b.damage(b.sides[0],b.sides[1],b.mon(b.sides[0]).profiles[0],{expected:true}).dmg;
  const normal = new RtBattle(spec()), rain = new RtBattle(spec('raindance',true)), sun = new RtBattle(spec('sunnyday',true));
  assert.equal(rain.view().weather?.id,'raindance');
  assert.ok(damage(rain)>damage(normal)); assert.ok(damage(sun)<damage(normal));
  const snow = new RtBattle(spec('snow',true));
  assert.equal(snow.view().weather?.id,'snow');
  assert.equal(snow.stat(snow.sides[0],'def'),Math.floor(normal.stat(normal.sides[0],'def')*1.5));
  assert.equal(snow.weather.until,snow.timeLimit);
  const oldGen = new RtBattle(spec('snow',true,{format:'gen8customgame'}));
  const oldNormal = new RtBattle(spec('',false,{format:'gen8customgame'}));
  assert.equal(oldGen.stat(oldGen.sides[0],'def'),oldNormal.stat(oldNormal.sides[0],'def'));
  const fog = new RtBattle(spec('fog',true));
  assert.equal(fog.view().fog,true);
  fog.setWeather('raindance',null);
  assert.equal(fog.view().fog,undefined);
  assert.equal(fog.view().arena_weather,undefined,'mechanical weather follows replacement, not saved decoration');
  const airLock = importTeam('Rayquaza\nAbility: Air Lock\n- Tackle');
  const suppressed = new RtBattle(spec('fog',true,{p2:{name:'Air Lock',sets:airLock}}));
  assert.equal(suppressed.view().fog,undefined);
});

test('explicit starting field takes priority over the arena, with snow supported in version 12', () => {
  const b = new RtBattle(spec('fog',true,{start:{field:{weather:'snow'}}}));
  assert.equal(b.view().weather?.id,'snow'); assert.equal(b.view().fog,undefined);
});

test('rules versions 1-11 ignore arena weather and preserve their complete views and events', () => {
  for (let version=1;version<=11;version++) {
    const a = rtRun(spec('',false,{version}));
    const b = rtRun(spec('fog',true,{version}));
    assert.deepEqual(b.view(),a.view(),`version ${version}`);
    assert.deepEqual(b.events,a.events,`version ${version}`);
  }
});

test('new mechanical climates replay the same fixed ticks and events', () => {
  for (const weather of ['sunnyday','raindance','snow','fog']) {
    const setup = spec(weather,true,{p1:{name:'A',sets,ai:{level:'hard'}},p2:{name:'B',sets,ai:{level:'hard'}}});
    const initial = new RtBattle(setup);
    assert.equal(weather==='fog' ? initial.view().fog : initial.view().weather?.id,weather==='fog' ? true : weather);
    const a = rtRun(setup), b = rtRun(JSON.parse(JSON.stringify(setup)));
    assert.deepEqual(b.summary(),a.summary()); assert.deepEqual(b.events,a.events);
    assert.equal(a.t,b.t); assert.ok(a.ended);
  }
});

test('mechanical arena fog produces actual accuracy misses', () => {
  const ai = {level:'hard',style:'aggressive'};
  const attacks = importTeam('Glaceon\nAbility: Ice Body\n- Ice Beam');
  const setup = {p1:{name:'A',sets:attacks,ai},p2:{name:'B',sets:attacks,ai}};
  const fog = rtRun(spec('fog',true,setup)), clear = rtRun(spec('fog',false,setup));
  assert.ok(fog.events.some(e=>e.fog===true));
  assert.ok(!clear.events.some(e=>e.fog===true));
});

test('drawing climates keeps the floor cached, takes no simulation input and respects reduced motion', () => {
  const records = [];
  const context = () => new Proxy({}, {get:(obj,key)=>obj[key] ?? ((...args)=> {
    records.push([key,...args]); return {addColorStop(){}};
  })});
  const previous = globalThis.document;
  globalThis.document = {createElement:()=>({width:0,height:0,getContext:context})};
  const r = {canvas:{width:900,height:510},ctx:context(),scale:27,rocks:[],time:3,
    court:null,px:x=>(x+2.6)*27,py:y=>(y+.9)*27,drawRock(){},reducedMotion:{matches:true}};
  try {
    const b = new RtBattle(spec('raindance')), before = JSON.stringify(b.view());
    ArenaRenderer.prototype.drawCourt.call(r,b.view());
    const cached = r.court.canvas;
    records.length=0;
    ArenaRenderer.prototype.drawCourt.call(r,b.view());
    const first = JSON.stringify(records);
    records.length=0; r.time=9;
    ArenaRenderer.prototype.drawCourt.call(r,b.view());
    assert.equal(JSON.stringify(records),first,'reduced motion holds precipitation still');
    assert.equal(r.court.canvas,cached);
    assert.equal(JSON.stringify(b.view()),before);
    const rainLines = records.filter(x=>x[0]==='lineTo').length;
    assert.ok(rainLines>0,'rain is visible, beyond the tint');
    const snowOn = floor => {
      const view = {...b.view(),arena_weather:'snow',floor};
      ArenaRenderer.prototype.drawCourt.call(r,view); // warm the floor cache
      records.length=0;
      ArenaRenderer.prototype.drawCourt.call(r,view);
      return records.filter(x=>x[0]==='arc').length;
    };
    const ordinarySnow = snowOn('grass');
    assert.ok(ordinarySnow>0);
    assert.equal(snowOn('summit'),ordinarySnow,'floor snow and selected snow must not stack');
  } finally {globalThis.document=previous;}
});
