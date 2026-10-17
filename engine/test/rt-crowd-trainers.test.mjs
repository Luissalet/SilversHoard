import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CROWD_TRAINERS, mixTrainerCrowd, drawCrowdTrainer, crowdTrainerDirection} from '../../client/src/battle/rt/crowd-trainers.js';
import {Show, showSettings, setShowSetting} from '../../client/src/battle/rt/show.js';
import {RtBattle} from '../src/realtime/sim.mjs';

const seats = Array.from({length: 12}, (_, i) => ({x: i, y: 7, fx: 1, fy: 0, num: i + 1}));

test('human spectators mix with Pokémon reproducibly, vary across seeds, and leave seats and source untouched', () => {
  const before = structuredClone(seats), identities = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const crowd = mixTrainerCrowd(seats, seed), humans = crowd.filter(c => c.trainer);
    assert.deepEqual(crowd, mixTrainerCrowd(seats, seed));
    assert.equal(humans.length, 5);
    assert.equal(new Set(humans.map(c => c.trainer.id)).size, humans.length);
    crowd.forEach((c, i) => {
      assert.equal(c.x, seats[i].x); assert.equal(c.y, seats[i].y);
      assert.equal(c.fx, seats[i].fx); assert.equal(c.fy, seats[i].fy);
      assert.equal(c.num, c.trainer ? null : seats[i].num);
    });
    identities.add(humans.map(c => c.trainer.id).join('|'));
  }
  assert.equal(identities.size, 100);
  assert.deepEqual(seats, before);
  assert.deepEqual(mixTrainerCrowd([], 'empty'), []);
});

test('embedded atlas and manifest cover both credited sources and four standing directions', () => {
  const folder = new URL('../../client/src/battle/rt/art/crowd/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', folder)));
  const png = readFileSync(new URL('trainers.png', folder));
  assert.equal(CROWD_TRAINERS.length, 277);
  assert.deepEqual(new Set(CROWD_TRAINERS.map(c => c.source)), new Set(['frlg', 'taiga']));
  assert.equal(manifest.trainers.length, CROWD_TRAINERS.length);
  assert.equal(png.readUInt32BE(16), 2048); assert.equal(png.readUInt32BE(20), 2240);
  for (const trainer of CROWD_TRAINERS) {
    assert.equal(trainer.sizes.length, 4);
    for (const [w, h] of trainer.sizes) assert.ok(w > 0 && w <= 64 && h > 0 && h <= 64);
  }
  const module = readFileSync(new URL('atlas.js', folder), 'utf8');
  const data = module.match(/data:image\/png;base64,([^"\s]+)/)[1];
  assert.deepEqual(Buffer.from(data, 'base64'), png);
});

test('spectators use actual left, right and back frames, anchored at their feet, with decode fallback', () => {
  const previous = globalThis.Image, images = [], calls = [];
  globalThis.Image = class { constructor() { images.push(this); } };
  const ctx = {imageSmoothingEnabled: true, save() {}, restore() {}, drawImage(...args) { calls.push(args); }};
  try {
    const trainer = CROWD_TRAINERS[9];
    assert.equal(drawCrowdTrainer(ctx, trainer, 100, 200, 1, 0, 40), false);
    assert.equal(calls.length, 0);
    images[0].onload();
    for (const [fx, fy, direction] of [[1, 0, 2], [-1, 0, 1], [0, -1, 3], [0, 1, 0]]) {
      assert.equal(crowdTrainerDirection(fx, fy), direction);
      assert.equal(drawCrowdTrainer(ctx, trainer, 100, 200, fx, fy, 40), true);
      const [, sx, sy, w, h, dx, dy, dw, dh] = calls.at(-1);
      assert.deepEqual([w, h], trainer.sizes[direction]);
      assert.equal(sx, ((9 % 8) * 4 + direction) * 64 + Math.floor((64 - w) / 2));
      assert.equal(sy, 64 + 64 - h);
      assert.ok(Math.abs(dx + dw / 2 - 100) <= 1);
      assert.ok(Math.abs(dy + dh - 200) <= 1);
    }
    assert.equal(ctx.imageSmoothingEnabled, false);
  } finally { globalThis.Image = previous; }
});

test('the real show draws offline humans, cheers and pauses without fetching Pokémon or changing battle outcomes', () => {
  const oldImage = globalThis.Image, oldFetch = globalThis.fetch, settings = {...showSettings()};
  globalThis.Image = class {set src(value) {this.onload?.();}};
  let requests = 0;
  globalThis.fetch = async () => {requests++; return {ok:false};};
  const spec = {id:'human-crowd', seed:'702', format:'gen9customgame', version:10, time_limit:30, arena:'open',
    p1:{name:'A',sets:[{species:'Pikachu',moves:['Thunderbolt']}],ai:{level:'normal'}},
    p2:{name:'B',sets:[{species:'Eevee',moves:['Tackle']}],ai:{level:'normal'}}};
  try {
    const battle = new RtBattle(spec), control = new RtBattle(spec), before = structuredClone(battle.view());
    const renderer = {offline:true, scale:20, k:1, px:x=>x*20, py:y=>y*20};
    const show = new Show(renderer);
    show.setupCrowd(battle);
    assert.ok(show.crowd.length > 0 && show.crowd.every(c=>c.trainer && !c.anim && !c.fallback));
    const draws = [], ctx = {save(){},restore(){},beginPath(){},ellipse(){},fill(){},drawImage(...args){draws.push(args);}};
    show.cheer(1);
    for (const c of show.crowd) {c.hop=0; c.delay=0; c.big=1;}
    show.drawCrowd(ctx,.1);
    assert.equal(draws.length,show.crowd.length);
    const phase = structuredClone(draws.map(args=>args.slice(1)));
    for (let i=0;i<draws.length;i++) assert.ok(draws[i][6]+draws[i][8] < renderer.py(show.crowd[i].y));
    draws.length=0;
    show.drawCrowd(ctx,0);
    assert.deepEqual(draws.map(args=>args.slice(1)),phase);
    assert.equal(requests,0);
    assert.deepEqual(battle.view(),before);
    for (let i=0;i<120;i++) {battle.step(); control.step();}
    assert.deepEqual(battle.view(),control.view());
    assert.deepEqual(battle.events,control.events);
    setShowSetting('crowd',false);
    const hidden = new Show(renderer); hidden.setupCrowd(battle);
    assert.deepEqual(hidden.crowd,[]);
    setShowSetting('crowd',true); setShowSetting('style','plain');
    hidden.setupCrowd(battle); assert.deepEqual(hidden.crowd,[]);
  } finally {
    globalThis.Image = oldImage; globalThis.fetch = oldFetch;
    setShowSetting('crowd',settings.crowd); setShowSetting('style',settings.style);
  }
});
