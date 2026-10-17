import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {makeSprites} from '../../client/src/battle/dex.js';

test('exported pages resolve new Mega form models without an app or a PokeAPI name lookup', () => {
  const sprites = makeSprites({server: 'https://play.example/sprites', set: 'gen5ani'});
  assert.match(sprites.fallback('Delphox-Mega'), /legends-za\/10293.webp$/);
  assert.match(sprites.fallback('Raichu-Mega-X', {back: true, shiny: true}), /legends-za\/back\/shiny\/10304.webp$/);
  assert.match(sprites.fallback('Delphox'), /gen5\/delphox.png$/);
  assert.match(makeSprites({server: 'https://play.example/sprites', set: 'za'}).pokemon('Delphox-Mega'), /legends-za\/10293.webp$/);
  assert.match(makeSprites().fallback('Delphox-Mega', {shiny: true}), /api\/sprites\/pokemon\/delphox-mega\?back=0&shiny=1&set=gen5$/);
});

test('Mega Delphox uses its battle sprite when PMD returns its normal or shiny base sheets', async () => {
  const previous = {window: globalThis.window, document: globalThis.document, Image: globalThis.Image, fetch: globalThis.fetch};
  const draws = [];
  const ctx = new Proxy({globalAlpha: 1}, {get(o, k) { return k in o ? o[k] : (...args) => { if (k === 'drawImage') draws.push(args[0].src); }; }});
  globalThis.window = {devicePixelRatio: 1, innerHeight: 800};
  globalThis.document = {createElement: () => ({getContext: () => ctx})};
  globalThis.Image = class {set src(s) { this.url = s; this.width = this.height = 96; this.onload?.(); } get src() { return this.url; }};
  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://localhost');
    const num = Number(u.pathname.split('/').at(-1));
    const shiny = u.searchParams.get('shiny') === 'true';
    const form = u.searchParams.get('form');
    const key = `${String(num).padStart(4, '0')}${num === 6 && form ? '-0001' : shiny ? '-0000-0001' : ''}`;
    return {ok: true, json: async () => ({key, a: {Idle: {w: 96, h: 96, n: 1, r: 8, d: [6], ax: 48, ay: 80}}})};
  };
  try {
    for (const shiny of [false, true]) {
      const m = {num: 655, species: 'Delphox', forme: '', sprite_id: 'delphox', shiny,
        mega_info: {num: 655, species: 'Delphox-Mega', forme: 'Mega', sprite_id: 'delphox-mega'}};
      const renderer = new ArenaRenderer({style: {}, clientWidth: 640, getContext: () => ctx},
        {sides: [{mons: [m]}], sprites: {fallback: species => `sprite:${species}`}});
      await renderer.preload(() => {}, 1);
      assert.ok(renderer.animOf(0, 0, false), 'normal Delphox keeps its walking animation');
      assert.equal(renderer.animOf(0, 0, true), null, 'a base PMD sheet must not hide the Mega sprite');
      draws.length = 0;
      renderer.show = {hides: () => false};
      renderer.drawMon({version: 10}, {active: 0, mons: [{...m, is_mega: true, hp: 100, maxhp: 100}],
        x: 8, y: 8, r: 1, fx: 1, fy: 0, name: 'Delphox'}, 0, 0);
      assert.ok(draws.includes('sprite:Delphox-Mega'), 'the actual draw uses the Mega image');
    }
    const alreadyMega = new ArenaRenderer({style: {}, clientWidth: 640, getContext: () => ctx},
      {sides: [{mons: [{num: 655, species: 'Delphox-Mega', forme: 'Mega'}]}], sprites: {fallback: species => `sprite:${species}`}});
    await alreadyMega.preload(() => {}, 1);
    assert.equal(alreadyMega.animOf(0, 0, false), null, 'a team starting in Mega forme also keeps its own appearance');
    const m = {num: 6, species: 'Charizard', forme: '', mega_info: {num: 6, species: 'Charizard-Mega-X', forme: 'Mega-X'}};
    const renderer = new ArenaRenderer({style: {}, clientWidth: 640, getContext: () => ctx},
      {sides: [{mons: [m]}], sprites: {fallback: species => `sprite:${species}`}});
    await renderer.preload(() => {}, 1);
    assert.equal(renderer.animOf(0, 0, true).meta.key, '0006-0001', 'a real Mega PMD animation still takes precedence');
  } finally { Object.assign(globalThis, previous); }
});
