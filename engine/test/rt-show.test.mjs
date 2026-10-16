// The real-time battle's show (client/src/battle/rt/show.js): it only watches the battle (the same battle with and without it),
// and its callouts come at the right moments: fainted, last Pokémon, combos, clashes, K.O. and the winner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomTeam} from '../src/core.mjs';
import {RtBattle, inputFrame, rtRun} from '../src/realtime/sim.mjs';
import {Show, showSettings} from '../../client/src/battle/rt/show.js';

function stubRenderer() {
  return {
    texts: undefined, time: 0, scale: 20, k: 1, offline: true, sprites: null, fallbacks: [], trainers: [],
    canvas: {width: 800, height: 480},
    px: (x) => x * 20, py: (y) => y * 20,
    trainerPos: (si) => ({x: si ? 29.2 : -1.2, y: 8.5}),
    worldCenter: () => ({x: 14, y: 8.5}),
    animOf: () => null,
    vfx: {fx: [], shake: 0, emit() {}},
  };
}

const spec = (seed) => ({seed, format: 'gen9customgame', time_limit: 150,
  p1: {name: 'Rojo', sets: randomTeam('gen9randombattle', `${seed}a`).sets, ai: {level: 'hard', style: 'aggressive'}},
  p2: {name: 'Azul', sets: randomTeam('gen9randombattle', `${seed}b`).sets, ai: {level: 'normal', style: 'balanced'}}});

test('settings: the show is on by default, numbers in percent', () => {
  const s = showSettings();
  assert.equal(s.style, 'show');
  assert.equal(s.numbers, 'pct');
  assert.equal(s.camera, true);
  assert.equal(s.impact, true);
});

test('a recorded intro prepares a readable VS card before the battle clock starts', () => {
  const s = spec('prepared-video');
  s.p1.name = 'Luis'; s.p2.name = 'Red (HeartGold and SoulSilver)';
  const b = new RtBattle(s), show = new Show(stubRenderer());
  const events = JSON.stringify(b.events);
  assert.equal(show.startIntro(b, {prepared: true}), true);
  assert.equal(show.intro.t, 0.7, 'the panels and VS are already fully visible in the first recorded picture');
  assert.deepEqual(show.intro.sides.map(x => x.name), ['Luis', 'Red']);
  for (let i = 0; i < 120; i++) show.update(0, b);
  assert.equal(show.intro.t, 0.7, 'capture warmup keeps the card visible');
  assert.equal(show.holding, true);
  assert.equal(b.t, 0);
  assert.equal(JSON.stringify(b.events), events);
  for (let i = 0; i < 110; i++) show.update(1 / 30, b);
  assert.equal(show.holding, false);
});

test('the show never changes the battle and calls out faints, the last Pokémon, the K.O. and the winner', () => {
  for (const seed of ['show-1', 'show-2']) {
    const plain = rtRun(spec(seed));
    const b = new RtBattle(spec(seed));
    const r = stubRenderer();
    const show = new Show(r);
    assert.equal(show.startIntro(b), true);
    assert.ok(show.holding, 'the intro holds the battle');
    for (let i = 0; i < 120; i++) show.update(1 / 30, b);
    assert.ok(!show.holding, 'the intro lets the battle go');
    const said = [];
    let seen = 0;
    const limit = (b.timeLimit / 30 + 5) * 30;
    while (!b.ended && b.t < limit) {
      b.step(inputFrame(b, [], [null, null]));
      for (; seen < b.events.length; seen++) show.onEvent(b.events[seen], b);
      show.update(1 / 30, b);
      r.time += 1 / 30;
      for (const c of show.callouts) if (!said.includes(c.text)) said.push(c.text);
      assert.ok(show.cam.z >= 1 && show.cam.z < 1.6, 'the camera stays between the whole court and a push-in');
    }
    if (!b.ended) b.finish(2, 'time');
    for (; seen < b.events.length; seen++) show.onEvent(b.events[seen], b);
    const wait = show.ending(b);
    for (const c of show.callouts) said.push(c.text);
    assert.deepEqual(b.summary(), plain.summary(), 'same battle with the show watching');
    assert.equal(b.events.length, plain.events.length);
    assert.ok(wait > 2 && wait < 4, 'the ending plays for a few seconds');
    const v = b.view();
    if (v.reason === 'ko') assert.ok(said.includes('¡K.O.!'));
    const faints = b.events.filter((e) => e.k === 'faint').length;
    if (faints > 1) assert.ok(said.some((t) => t.endsWith('se ha debilitado!')), 'a faint gets its callout');
    const lastFor = [0, 1].filter((si) => b.events.some((e) => e.k === 'switch' && e.s === si && !e.first) && v.sides[si].mons.length > 1
      && b.events.filter((e) => e.k === 'faint' && e.s === si).length >= v.sides[si].mons.length - 1);
    for (const si of lastFor) assert.ok(said.includes(`¡Último Pokémon de ${v.sides[si].name}!`), `last Pokémon of side ${si}`);
    assert.ok(show.scars.length <= 48, 'the floor keeps at most 48 marks');
  }
});

test('combos and clashes', () => {
  const r = stubRenderer();
  const show = new Show(r);
  const sides = [{x: 10, y: 8, fx: 1, fy: 0, active: 0, mons: [{name: 'Sceptile', hp: 100}]}, {x: 12, y: 8, fx: -1, fy: 0, active: 0, mons: [{name: 'Gengar', hp: 100}]}];
  const battle = {t: 0, doubles: false, ended: false, sides};
  const hit = (from, t, extra = {}) => { battle.t = t; show.onEvent({k: 'hit', s: 1 - from, from, move: 'leafblade', type: 'Grass', dmg: 5, hp: 90, maxhp: 100, eff: 1, crit: false, hit: 0, ...extra}, battle); };
  hit(0, 30); hit(0, 60);
  assert.ok(!show.callouts.some((c) => c.text.startsWith('¡Combo')), 'two blows are not a combo worth calling out yet');
  hit(0, 75);
  assert.ok(show.callouts.some((c) => c.text === '¡Combo de 3 golpes!'));
  hit(1, 90);   // being hit back breaks Sceptile's combo
  hit(0, 300);
  assert.ok(!show.callouts.some((c) => c.text === '¡Combo de 4 golpes!'));
  // both land a contact move at once
  battle.t = 400;
  show.onEvent({k: 'use', s: 0, shape: 'strike', move: 'leafblade'}, battle);
  show.onEvent({k: 'use', s: 1, shape: 'strike', move: 'shadowpunch'}, battle);
  hit(0, 402); hit(1, 404);
  assert.ok(show.callouts.some((c) => c.text === '¡Choque!'));
  // the hardest blow brings the impact frame and the camera
  hit(0, 600, {dmg: 60, hp: 30, crit: true});
  assert.ok(show.impact && show.impact.crit);
  assert.ok(show.punch && show.punch.z > 1);
});

test('trainers say their lines: the intro, a faint, the last Pokémon and the end', () => {
  const r = stubRenderer();
  r.sides = [{dialogue: {intro: 'A por ellos.', on_ko: 'Uno menos.', last: 'Todo o nada.', win: 'Sabía que ganaría.'}}, {dialogue: {on_faint: 'Vuelve, amigo.', lose: 'Me has ganado.'}}];
  const show = new Show(r);
  const b = new RtBattle(spec('talk-1'));
  show.startIntro(b);
  // the intro's last beat ("Fight!") is drawn on a canvas; here the line goes straight away
  assert.ok(show.talk(1, 'intro', {force: true}) === false, 'the second trainer has no intro line');
  assert.ok(show.talk(0, 'intro', {force: true}));
  assert.equal(show.bubbles[0].text, 'A por ellos.');
  const sides = [{x: 10, y: 8, fx: 1, fy: 0, active: 0, mons: [{name: 'Sceptile', hp: 100}, {name: 'Blastoise', hp: 0, fainted: true}], name: 'Rojo'},
    {x: 12, y: 8, fx: -1, fy: 0, active: 0, mons: [{name: 'Gengar', hp: 0, fainted: true}, {name: 'Chandelure', hp: 50}], name: 'Azul'}];
  const battle = {t: 600, doubles: false, ended: false, sides};
  r.time = 20;
  show.onEvent({k: 'faint', s: 1, slot: 0, by: 0}, battle);
  assert.ok(show.bubbles.some((x) => x.text === 'Uno menos.'), 'the trainer who knocked it out talks first');
  r.time = 30;
  show.onEvent({k: 'switch', s: 0, slot: 0, first: false}, battle);
  assert.ok(show.bubbles.some((x) => x.text === 'Todo o nada.'), 'the last Pokémon has its line');
  assert.equal(show.line(1, 'win'), '');
});
