import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';
import {RtBattle} from '../src/realtime/sim.mjs';
import {importTeam} from '../src/core.mjs';

function canvasRenderer() {
  let fogLayers = 0;
  const context = () => new Proxy({}, {get: (obj, key) => obj[key] ?? (() => ({addColorStop() {}}))});
  const ctx = context();
  ctx.createRadialGradient = () => {fogLayers++; return {addColorStop() {}};};
  const previous = globalThis.document;
  globalThis.document = {createElement: () => ({width: 0, height: 0, getContext: context})};
  const r = {canvas: {width: 900, height: 510}, ctx, scale: 27, rocks: [], time: 2,
    court: null, px: x => (x + 2.6) * 27, py: y => (y + .9) * 27, drawRock() {}};
  return {r, layers: () => fogLayers, reset: () => {fogLayers = 0;}, restore: () => {globalThis.document = previous;}};
}

function battle(fog = true, ability = 'Static') {
  const team = importTeam(`Pikachu\nAbility: ${ability}\n- Splash`);
  return new RtBattle({id:'fog-screen', seed:'fog-screen', version:11, format:'gen9customgame',
    time_limit:60, arena:'open', start:{field:{weather:fog ? 'fog' : ''}},
    p1:{name:'A',sets:team},p2:{name:'B',sets:team}});
}

test('public mechanical fog draws on an ordinary court and disappears when another weather clears it', () => {
  const b = battle(), {r,layers,reset,restore} = canvasRenderer();
  try {
    assert.equal(b.view().fog, true);
    const initial = JSON.stringify(b.view());
    ArenaRenderer.prototype.drawCourt.call(r,b.view());
    assert.equal(layers(),6,'the public fog must be visible beyond the Pyre floor');
    assert.equal(JSON.stringify(b.view()),initial,'drawing cannot change the simulator');
    const cached = r.court.canvas;
    reset(); b.setWeather('raindance',null);
    assert.equal(b.view().fog,undefined);
    ArenaRenderer.prototype.drawCourt.call(r,b.view());
    assert.equal(layers(),0,'cleared mechanical fog must stop drawing');
    assert.equal(r.court.canvas,cached,'weather animation does not rebuild the floor');
  } finally {restore();}
});

test('a fog-free ordinary court stays clear and Pyre keeps one existing decorative fog layer', () => {
  const {r,layers,reset,restore} = canvasRenderer();
  try {
    ArenaRenderer.prototype.drawCourt.call(r,battle(false).view());
    assert.equal(layers(),0);
    reset(); ArenaRenderer.prototype.drawCourt.call(r,{...battle().view(),floor:'pyre'});
    assert.equal(layers(),6,'mechanical and decorative fog must not stack');
    reset(); ArenaRenderer.prototype.drawCourt.call(r,{...battle(false).view(),floor:'pyre'});
    assert.equal(layers(),6,'the established Pyre decoration remains available');
  } finally {restore();}
});
