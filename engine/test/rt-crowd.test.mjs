import test from 'node:test';
import assert from 'node:assert/strict';
import {RtBattle} from '../src/realtime/sim.mjs';
import {crowdMembers} from '../../client/src/battle/rt/crowd.js';
import {CROWDS, crowdSpots} from '../../client/src/battle/rt/places.js';
import {Show} from '../../client/src/battle/rt/show.js';

const spec = (id = 'audience-a', gen = 9) => ({
  id, seed:'same-combat-seed', format:`gen${gen}customgame`, version:10, time_limit:30, arena:'open',
  p1:{name:'A',sets:[{species:'Snorlax',moves:['Body Slam']}],ai:{level:'normal'}},
  p2:{name:'B',sets:[{species:'Blastoise',moves:['Water Pulse']}],ai:{level:'normal'}},
});

test('an audience is stable on replay and varies between battles sharing a simulation seed', () => {
  const battle = new RtBattle(spec());
  const first = crowdMembers(battle);
  assert.deepEqual(crowdMembers(battle),first);
  assert.deepEqual(crowdMembers(new RtBattle(spec())),first);
  assert.notDeepEqual(crowdMembers(new RtBattle(spec('audience-b'))),first);
  assert.ok(first.length > 0 && first.length <= crowdSpots().length);
});

test('spectators use the generation catalog without repeats or a fixed biome shortlist', () => {
  for (const gen of [1,4,9]) {
    const seen = new Set();
    for (let i=0;i<15;i++) {
      const battle = new RtBattle(spec(`audience-${i}`,gen));
      const members = crowdMembers(battle);
      assert.equal(new Set(members.map(m=>m.num)).size,members.length);
      for (const member of members) {
        const species = battle.dex.species.get(member.species);
        assert.equal(species.num,member.num);
        assert.ok(species.gen <= gen && !species.forme);
        assert.ok(member.x < 0 || member.x > 28 || member.y > 17);
        seen.add(member.num);
      }
    }
    assert.ok(seen.size > 50);
    assert.ok([...seen].some(n=>!CROWDS.grass.includes(n)));
  }
});

test('choosing an audience leaves simulation state and random outcomes unchanged', () => {
  const withCrowd = new RtBattle(spec());
  const control = new RtBattle(spec());
  const before = structuredClone(withCrowd.view());
  crowdMembers(withCrowd);
  assert.deepEqual(withCrowd.view(),before);
  for (let i=0;i<120;i++) {withCrowd.step(); control.step();}
  assert.deepEqual(withCrowd.view(),control.view());
  assert.deepEqual(withCrowd.events,control.events);
});

test('a missing walking sheet keeps a bounded static spectator, with no new requests per frame', async () => {
  const originalImage = globalThis.Image, originalFetch = globalThis.fetch;
  let images=0, requests=0;
  globalThis.Image = class {
    width=80; height=40;
    constructor() {images++;}
    set src(value) {this.onload?.();}
  };
  globalThis.fetch = async () => {requests++; return {ok:false};};
  try {
    const renderer={sprites:{fallback:name=>'sprite:'+name},base:'',credits:new Set(),scale:20,k:1,px:x=>x,py:y=>y};
    const show = new Show(renderer);
    show.setupCrowd(new RtBattle(spec('missing-walking-sheets')));
    await new Promise(resolve=>setImmediate(resolve));
    const loaded=[images,requests];
    const draws=[];
    const ctx={save(){},restore(){},beginPath(){},ellipse(){},fill(){},drawImage(...args){draws.push(args);}};
    show.drawCrowd(ctx,0.016);
    assert.ok(show.crowd.length>0);
    assert.equal(draws.length,show.crowd.length);
    const pokemonDraws=draws.filter(args=>args.length===5);
    assert.equal(pokemonDraws.length,show.crowd.filter(c=>!c.trainer).length);
    assert.ok(pokemonDraws.every(args=>args[3]<=33 && args[4]<=33));
    show.drawCrowd(ctx,0.016);
    assert.deepEqual([images,requests],loaded);
    let walkingScale=0;
    show.crowd.find(c=>!c.trainer).anim={meta:{a:{Idle:{w:160,h:120}}},loop(){},update(){},draw(ctx,x,y,row,k){walkingScale=k;return true;}};
    show.drawCrowd(ctx,0.016);
    assert.ok(walkingScale>0 && walkingScale*160<=33);
    const offline = new Show({...renderer,offline:true});
    offline.setupCrowd(new RtBattle(spec()));
    assert.ok(offline.crowd.length>0 && offline.crowd.every(c=>c.trainer));
    assert.deepEqual([images,requests],loaded);
  } finally {
    if (originalImage === undefined) delete globalThis.Image; else globalThis.Image=originalImage;
    globalThis.fetch=originalFetch;
  }
});
